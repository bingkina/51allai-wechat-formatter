#!/usr/bin/env node
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import hljs from 'highlight.js';
import {parseFragment} from 'parse5';
import {styles as S,esc,leaf,wrap,syntaxStyle} from './theme.mjs';
import {mathPlugin} from './math-plugin.mjs';
import {createVisualRenderer} from './visuals.mjs';
import {readPost,identifyLead,sourcesHTML,webUrl} from './post.mjs';

const skillRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=s=>createHash('sha256').update(s).digest('hex');
const safeName=s=>Array.from(s.replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^[.-]+|[.-]+$/g,'')).slice(0,52).join('')||'公众号文章';
function textOf(node){return node.nodeName==='#text'?node.value:(node.childNodes||[]).map(textOf).join('');}
export function htmlText(html){return textOf(parseFragment(html));}
function walk(tokens,fn,parentLine=null){for(const t of tokens){const line=t.map?t.map[0]+1:parentLine;fn(t,line);if(t.children)walk(t.children,fn,line);}}
function syntaxHTML(code,language){
  if(!language||!hljs.getLanguage(language))return leaf(code);
  const highlighted=hljs.highlight(code,{language,ignoreIllegals:true}).value;
  function convert(n){
    if(n.nodeName==='#text')return leaf(n.value);
    const inner=(n.childNodes||[]).map(convert).join('');
    return n.tagName==='span'?wrap('span',syntaxStyle(n.attrs?.find(a=>a.name==='class')?.value),inner):inner;
  }
  const html=parseFragment(highlighted).childNodes.map(convert).join('');
  if(htmlText(html)!==code)throw Error('代码高亮改变了源码文本');
  return html;
}

const hashtagPattern = /^#[\p{L}\p{N}][\p{L}\p{M}\p{N}_.+#&-]*$/u;

export async function renderDocument(source,{baseDir=process.cwd(),outputDir,filename='',tags=''}={}){
  if(!outputDir)throw Error('必须指定 outputDir');
  if(!source.trim())throw Error('请提供 Markdown 正文');
  let hashtags = tags.trim().split(/\s+/).filter(Boolean);
  if (hashtags.some(tag => !hashtagPattern.test(tag))) {
    throw Error('请按 #标签1 #标签2 的格式传入文末标签');
  }
  outputDir=path.resolve(outputDir);baseDir=path.resolve(baseDir);
  await fs.mkdir(outputDir,{recursive:true});
  const report={sourceSha256:digest(source),warnings:[],images:[],inventory:[],coverage:{},checks:{}};
  const post=readPost(source,report.warnings);
  const {body,sourceLine,baseUrl}=post;
  const md=new MarkdownIt({html:true,typographer:false,linkify:true,breaks:false})
    .use(footnote).use(deflist).use(sub).use(sup).use(mark).use(ins).use(mathPlugin);
  md.block.ruler.before('fence','unsupported_container',(state,start,end,silent)=>{
    const line=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]);
    const match=line.match(/^(:{3,})[^\s:]/);if(!match)return false;
    if(silent)return true;
    let next=start+1;for(;next<end;next++)if(state.src.slice(state.bMarks[next]+state.tShift[next],state.eMarks[next]).trim()===match[1]){next++;break;}
    const token=state.push('unsupported_block','',0);token.content=state.getLines(start,next,state.blkIndent,false);token.map=[start,next];state.line=next;return true;
  },{alt:['paragraph','blockquote','list']});
  const env={rendered:new Set(),tableStack:[],codeChecks:[]};
  function codeBlock(content,lang=''){
    const label=lang?wrap('p',S.codeLabel,leaf(lang)):'';
    return wrap('section',S.codeBox,label+wrap('pre',S.pre,wrap('code','font-family:inherit;',syntaxHTML(content,lang))));
  }

  function withoutWebAddresses(text){
    const addresses=md.linkify.match(text)?.filter(match=>match.schema!=='mailto:')||[];
    let result='', cursor=0;
    for(const address of addresses){
      result+=text.slice(cursor,address.index);
      cursor=address.lastIndex;
    }
    return result+text.slice(cursor);
  }

  const tokens=md.parse(body,env).filter(t=>t.type!=='html_block'||!/^<!--\s*more\s*-->\s*$/i.test(t.content));
  if (hashtags.length) {
    const footnotesAt = tokens.findIndex(token => token.type === 'footnote_block_open');
    const end = footnotesAt === -1 ? tokens.length : footnotesAt;
    const [open, inline] = tokens.slice(Math.max(0, end - 3), end);
    if (open?.type === 'paragraph_open' && open.level === 0 && inline?.type === 'inline') {
      const existing = inline.content.trim().split(/\s+/).map(tag => tag.replace(/^\\#/, '#'));
      if (existing.every(tag => hashtagPattern.test(tag))) {
        hashtags = existing.concat(hashtags);
        tokens.splice(end - 3, 3);
      }
    }
  }
  const emptyParagraphs=new Set();
  for(const token of tokens){
    if(token.type!=='inline')continue;
    let inCode=false;
    let removedAddress=false;
    token.children=token.children.filter(child=>{
      if(child.type==='link_open'||child.type==='link_close')return false;
      if(child.type==='html_inline'){
        if(/^<\/?a(?:\s|>)/i.test(child.content))return false;
        if(/^<\/?code(?:\s|>)/i.test(child.content))inCode=!child.content.startsWith('</');
      }
      if(child.type==='text'&&!inCode){
        const text=withoutWebAddresses(child.content);
        removedAddress||=text!==child.content;
        child.content=text;
      }
      return true;
    });
    if(removedAddress&&token.children.every(child=>child.type==='text'?!child.content.trim():child.nesting!==0||child.type.endsWith('break'))){
      emptyParagraphs.add(token);
    }
  }
  const removableContainers=new Set(['blockquote_open','bullet_list_open','ordered_list_open','list_item_open']);
  for(let i=tokens.length-1;i>=0;i--){
    if(emptyParagraphs.has(tokens[i])&&tokens[i-1]?.type==='paragraph_open'&&tokens[i+1]?.type==='paragraph_close'){
      tokens.splice(--i,3);
    }else if(removableContainers.has(tokens[i].type)&&tokens[i+1]?.type===tokens[i].type.replace('_open','_close')){
      tokens.splice(i,2);
    }
  }
  const existingSources=identifyLead(tokens,post);
  const structuredSources=existingSources?[]:post.sources.map(({name,note})=>({
    name:withoutWebAddresses(name).trim(),note:withoutWebAddresses(note).trim(),
  })).filter(({name,note})=>name||note);
  for(let i=0;i<tokens.length;i++)if(tokens[i].type==='blockquote_open'){
    const start=tokens[i+1]?.type==='paragraph_open'?tokens[i+2]:null;
    const first=start?.type==='inline'?start.children?.[0]:null;
    const hit=first?.type==='text'&&first.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/);
    if(hit){tokens[i].meta={...tokens[i].meta,alert:hit[1]};const badge=new first.constructor('alert_marker','span',0);badge.content=hit[0];badge.meta={kind:hit[1]};first.content=first.content.slice(hit[0].length);start.children.unshift(badge);}
  }
  // Task checkboxes remain static and copyable, including nested lists.
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.type==='inline'&&tokens[i-1]?.type==='paragraph_open'){
      // Only list paragraphs may interpret a task marker.
      let depth=0,inList=false;
      for(let j=i-2;j>=0;j--){if(tokens[j].type==='list_item_close')depth++;if(tokens[j].type==='list_item_open'){if(depth===0){inList=true;break;}depth--;}if(depth===0&&tokens[j].level<t.level-2)break;}
      const first=t.children?.[0], match=first?.type==='text'&&first.content.match(/^\[([ xX])\](?=\s|$)/);
      if(inList&&match){const task=new first.constructor('task_marker','span',0);task.content=match[0];task.meta={checked:match[1]!==' '};first.content=first.content.slice(match[0].length);t.children.unshift(task);}
    }
  }
  // Table metadata is attached without flattening the original cell token tree.
  for(let i=0;i<tokens.length;i++)if(tokens[i].type==='table_open'){
    const start=i;let end=i+1;while(end<tokens.length&&tokens[end].type!=='table_close')end++;
    const headers=[];
    for(let j=start;j<end;j++)if(tokens[j].type==='th_open')headers.push(tokens[j+1]?.children?.map(t=>t.content||'').join('')||'');
    const wide=headers.length>4;
    for(let j=start;j<=end;j++){tokens[j].meta={...tokens[j].meta,tableWide:wide};}
    tokens[start].meta.headers=headers;
    i=end;
  }
  let nodeId=0;
  walk(tokens,(t,line)=>{
    if(t.type==='inline')return;
    if(t.content || t.type==='image' || (t.nesting===1&&!t.hidden)){
      t.meta={...t.meta,auditId:++nodeId};
      report.inventory.push({id:nodeId,type:t.type,line:line===null?null:sourceLine(line)});
    }
  });

  const imageTokens=[];walk(tokens,t=>{if(t.type==='image')imageTokens.push(t);});
  async function prepareImage(src,alt='',kind='original'){
    const item={id:report.images.length+1,kind,source:src,alt,status:'',manualInsert:true};report.images.push(item);
    const remote=webUrl(src.startsWith('//')?`https:${src}`:src);
    if(remote){item.src=remote;item.status='remote_unverified';return item;}
    try{
      if(/^(?:待补图|待上传|待补图片)$/.test(decodeURIComponent(src))){item.status='placeholder';return item;}
      let data,ext;
      if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)){
        const parts=src.match(/^data:image\/(png|jpeg|gif|webp);base64,([\s\S]+)$/i);data=Buffer.from(parts[2],'base64');ext=parts[1].toLowerCase().replace('jpeg','jpg');
      }else{
        if(/^\w[\w+.-]*:/.test(src)&&!src.startsWith('file:'))throw Error('不支持的图片协议');
        let p=src.startsWith('file:')?fileURLToPath(src):decodeURIComponent(src.split(/[?#]/)[0]);
        p=path.resolve(baseDir,p);data=await fs.readFile(p);ext=path.extname(p).slice(1).toLowerCase();
        if(!['png','jpg','jpeg','gif','webp','avif','bmp'].includes(ext))throw Error('图片格式不在兼容列表中；请转换为 PNG/GIF');
      }
      const filename=`image-${digest(data).slice(0,12)}.${ext}`;
      await fs.mkdir(path.join(outputDir,'assets'),{recursive:true});
      await fs.writeFile(path.join(outputDir,'assets',filename),data);
      item.src=`assets/${filename}`;item.file=item.src;item.status='local_requires_insert';item.sha256=digest(data);
    }catch(error){item.status='missing';item.message=error.message;report.warnings.push({type:'image',message:'图片读取失败，已保留位置与原始路径',source:src,detail:error.message});}
    return item;
  }
  for(const t of imageTokens){t.meta.image=await prepareImage(t.attrGet('src'),t.content);Object.assign(t.meta.image,{nodeId:t.meta.auditId,line:report.inventory.find(n=>n.id===t.meta.auditId)?.line});}
  const visuals=[];walk(tokens,t=>{if(t.type==='math_block'||t.type==='math_inline'||(t.type==='fence'&&t.info.trim().split(/\s/)[0]==='mermaid'))visuals.push(t);});
  let renderer;
  if(visuals.length){
    await fs.mkdir(path.join(outputDir,'assets'),{recursive:true});
    try{renderer=await createVisualRenderer();}catch(error){report.warnings.push({type:'visual_runtime',message:'图形运行环境不可用，已保留美化源码',detail:error.message});}
  }
  try{
    for(const t of visuals){
      const kind=t.type==='fence'?'mermaid':'math',file=`assets/${kind}-${digest(t.type+'\n'+t.content).slice(0,12)}.png`;
      const item={id:report.images.length+1,kind,source:t.content,sourceSha256:digest(t.content),file,status:'render_failed',manualInsert:true,nodeId:t.meta.auditId,line:report.inventory.find(n=>n.id===t.meta.auditId)?.line};report.images.push(item);
      try{if(!renderer)throw Error('本地图形运行环境不可用');Object.assign(item,await renderer.render(kind,t.content,path.join(outputDir,file),{displayMode:t.type==='math_block'}));item.status='generated_requires_insert';item.src=file;}
      catch(error){item.message=error.message.slice(0,1000);report.warnings.push({type:kind,message:'渲染失败，已在原位置保留源码',source:t.content,detail:item.message});}
      t.meta.visual=item;
    }
  }finally{if(renderer)await renderer.close();}

  function imageHTML(item,inline=false,cover=false){
    if(!item.src){
      const detail=item.alt||(item.status==='placeholder'?'':item.source);
      return wrap('span',S.placeholder,leaf(detail?`待补图 · ${detail}`:'待补图'));
    }
    const size=item.kind==='math'&&item.width?`width:${item.width}px;`:'';
    const style=inline?`${size}max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:0 2px;`:`${cover?S.cover:S.image}${size}`;
    const img=`<img src="${esc(item.src)}" alt="${esc(item.alt||((item.kind==='math'||item.kind==='mermaid')?item.source:''))}" style="${esc(style)}">`;
    return img;
  }
  function visualHTML(t){const item=t.meta.visual;return item.src?imageHTML(item,t.type==='math_inline'):t.type==='math_inline'?wrap('code',S.code,leaf(t.meta.original||t.content)):codeBlock(t.meta.original||t.content,t.type==='fence'?'mermaid':'tex');}

  // HTML is parsed into a small component vocabulary; unsupported HTML is shown literally.
  const safeTags=new Set(['p','section','span','strong','b','em','i','u','ins','s','del','sub','sup','mark','br','hr','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','a','img','pre','code','dl','dt','dd','table','thead','tbody','tr','th','td']);
  const htmlImageCache=new Map();
  for(const t of tokens)if(t.type==='html_block'||t.type==='inline'){
    const snippets=t.type==='html_block'?[t.content]:(t.children||[]).filter(c=>c.type==='html_inline').map(c=>c.content);
    for(const snippet of snippets){
      const nodes=parseFragment(snippet).childNodes;
      async function find(n){if(n.tagName==='img'){const src=n.attrs.find(a=>a.name==='src')?.value||'';if(!htmlImageCache.has(src))htmlImageCache.set(src,await prepareImage(src,n.attrs.find(a=>a.name==='alt')?.value||''));}for(const c of n.childNodes||[])await find(c);}
      const before=report.images.length;
      for(const n of nodes)await find(n);
      for(const im of report.images.slice(before))Object.assign(im,{nodeId:t.meta?.auditId||t.children?.find(c=>c.type==='html_inline')?.meta?.auditId,line:t.map?sourceLine(t.map[0]+1):null});
    }
  }
  const allImages=[...imageTokens.map(t=>t.attrGet('src')),...htmlImageCache.keys()];
  const coverUrl=webUrl(post.cover,baseUrl);
  const coverInBody=allImages.some(src=>src===post.cover||(coverUrl&&webUrl(src,baseUrl)===coverUrl));
  const coverImage=post.cover&&!coverInBody?await prepareImage(post.cover,post.title,'cover'):null;
  const leadCover=coverImage?wrap('p',tokens[0]?.meta?.summary?S.summaryCover:'margin:0;',imageHTML(coverImage,false,true)):'';
  const referenceMark=label=>label?wrap('span',S.reference,leaf(`[${label}]`)):'';
  function htmlNode(n){
    if(n.nodeName==='#text')return leaf(withoutWebAddresses(n.value));
    if(n.nodeName==='#comment')return wrap('code',S.code,leaf(`<!--${n.data}-->`));
    if(!safeTags.has(n.tagName))throw Error(`不支持的 HTML 标签 ${n.tagName}`);
    const attrs=Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value]));
    const tag=({b:'strong',i:'em',u:'ins',del:'s'})[n.tagName]||n.tagName;
    if(tag==='img')return imageHTML(htmlImageCache.get(attrs.src)||{source:attrs.src,alt:attrs.alt});
    if(tag==='br')return '<br>';
    if(tag==='hr')return `<hr style="${S.hr}">`;
    if(tag==='pre')return codeBlock(textOf(n));
    if(tag==='code')return wrap('code',S.code,leaf(textOf(n)));
    const content=(n.childNodes||[]).map(htmlNode).join('');
    if(tag==='a')return content;
    const extra=tag==='ol'&&/^-?\d+$/.test(attrs.start||'')?` start="${attrs.start}"`:'';
    return wrap(tag,S[tag]||S.p,content,extra);
  }
  function htmlBlock(src){try{return parseFragment(src).childNodes.map(htmlNode).join('');}catch(error){report.warnings.push({type:'html',message:'HTML 已作为美化源码保留',detail:error.message});return codeBlock(src,'html');}}
  function htmlInline(src){
    const match=src.match(/^<\s*(\/?)\s*([a-z][\w-]*)\b[^>]*>$/i);
    if(!match||!safeTags.has(match[2].toLowerCase())||['script','style'].includes(match[2].toLowerCase())){report.warnings.push({type:'html_inline',message:'不支持的 HTML 已按原文展示',source:src});return leaf(src);}
    const [,,rawTag]=match,tag=({b:'strong',i:'em',u:'ins',del:'s'})[rawTag.toLowerCase()]||rawTag.toLowerCase();
    if(tag==='a')return '';
    if(match[1])return ['img','br','hr'].includes(tag)?leaf(src):`</${tag}>`;
    if(tag==='img'||tag==='br'||tag==='hr')return htmlBlock(src);
    return `<${tag} style="${esc(S[tag]||'')}">`;
  }

  const rules=md.renderer.rules;
  rules.text=(ts,i)=>leaf(ts[i].content);
  rules.code_inline=(ts,i)=>wrap('code',S.code,leaf(ts[i].content));
  rules.code_block=(ts,i)=>{env.codeChecks.push({id:ts[i].meta.auditId,preserved:true});return codeBlock(ts[i].content);};
  rules.fence=(ts,i)=>{const t=ts[i];if(t.meta.visual)return visualHTML(t);env.codeChecks.push({id:t.meta.auditId,preserved:true});const lang=t.info.trim().split(/\s/)[0];if(lang&&!hljs.getLanguage(lang))report.warnings.push({type:'language',message:'未知代码语言已保留为等宽源码块',source:lang});return codeBlock(t.content,lang);};
  rules.math_inline=rules.math_block=(ts,i)=>visualHTML(ts[i]);
  rules.unsupported_block=(ts,i)=>{report.warnings.push({type:'extension',message:'未识别的扩展块已保留为美化源码',source:ts[i].content});return codeBlock(ts[i].content);};
  rules.softbreak=()=> '\n';rules.hardbreak=()=>'<br>\n';
  rules.hr=()=>`<hr style="${S.hr}">`;
  rules.task_marker=(ts,i)=>wrap('span',`${S.strong}margin-right:4px;`,leaf(ts[i].meta.checked?'☑':'☐'));
  rules.alert_marker=(ts,i)=>wrap('span','display:inline-block;color:#5B21B6;background:#EDE9FE;border-radius:4px;padding:1px 7px;font-size:13px;font-weight:700;',leaf(ts[i].content));
  rules.heading_open=(ts,i)=>`<${ts[i].tag} style="${S[ts[i].tag]}">`;
  rules.heading_close=(ts,i)=>`</${ts[i].tag}>\n`;
  const pairs={strong:['strong',S.strong],em:['em',S.em],s:['s',S.s],mark:['mark',S.mark],ins:['ins',S.ins],sub:['sub',S.sub],sup:['sup',S.sup],bullet_list:['ul',S.ul],ordered_list:['ol',S.ol],list_item:['li',S.li],dl:['dl',S.dl],dt:['dt',S.dt],dd:['dd',S.dd]};
  for(const [type,[tag,style]] of Object.entries(pairs)){
    rules[`${type}_open`]=(ts,i)=>ts[i].hidden?'':`<${tag} style="${esc(style)}"${type==='ordered_list'&&ts[i].attrGet('start')?` start="${esc(ts[i].attrGet('start'))}"`:''}>`;
    rules[`${type}_close`]=(ts,i)=>ts[i].hidden?'':`</${tag}>`;
  }
  rules.paragraph_open=(ts,i)=>{
    const {hidden,meta}=ts[i];
    if(hidden)return '';
    const style=meta?.cover?(meta.inSummary?S.summaryCover:'margin:0;'):meta?.summaryLast?S.summaryLast:meta?.summary?S.summaryText:S.p;
    return `<p style="${esc(style)}">`;
  };
  rules.paragraph_close=(ts,i)=>ts[i].hidden?'':'</p>';
  rules.blockquote_open=(ts,i)=>{
    const { summary, alert }=ts[i].meta||{};
    if(summary)return `<section style="${esc(S.summary)}">${wrap('p',S.summaryLabel,leaf('摘要'))}`;
    const accent=['WARNING','CAUTION'].includes(alert)?'border-left-color:#A44918;':'';
    return `<blockquote style="${esc(S.quote+accent)}">`;
  };
  rules.blockquote_close=(ts,i)=>ts[i].meta?.summary?`${leadCover}</section>`:'</blockquote>';
  rules.image=(ts,i,opts,e,self)=>{
    const t=ts[i];if(t.children)walk(t.children,c=>{if(c.meta?.auditId)env.rendered.add(c.meta.auditId);});
    const caption=t.content&&t.meta.image.src&&!t.meta.cover?wrap('span',S.caption,self.renderInline(t.children||[],opts,e)):'';
    return imageHTML(t.meta.image,false,t.meta.cover)+caption;
  };
  rules.link_open=rules.link_close=()=>'';
  rules.html_block=(ts,i)=>htmlBlock(ts[i].content);
  rules.html_inline=(ts,i)=>htmlInline(ts[i].content);
  rules.table_open=(ts,i)=>{env.tableStack.push({wide:ts[i].meta.tableWide,headers:ts[i].meta.headers,col:0,head:false});return ts[i].meta.tableWide?`<section style="${S.wide}">`:`<table style="${S.table}">`;};
  rules.table_close=()=>env.tableStack.pop().wide?'</section>':'</table>';
  for(const type of ['thead','tbody']){
    rules[`${type}_open`]=()=>{const t=env.tableStack.at(-1);t.head=type==='thead';return t.wide?`<section style="${type==='thead'?S.strong:''}">`:`<${type}>`;};
    rules[`${type}_close`]=()=>env.tableStack.at(-1).wide?'</section>':`</${type}>`;
  }
  rules.tr_open=()=>{const t=env.tableStack.at(-1);t.col=0;return t.wide?`<section style="${t.head?S.sourceNote:S.row}">`:'<tr>';};
  rules.tr_close=()=>env.tableStack.at(-1).wide?'</section>':'</tr>';
  for(const tag of ['th','td']){
    rules[`${tag}_open`]=(ts,i)=>{const t=env.tableStack.at(-1),col=t.col++;const align=ts[i].attrGet('style')||'';return t.wide?tag==='th'?'<span>':`<p style="margin:5px 0;">${wrap('strong',S.strong,leaf((t.headers[col]||`字段 ${col+1}`)+'：'))}`:`<${tag} style="${esc(S[tag]+align)}">`;};
    rules[`${tag}_close`]=()=>{const t=env.tableStack.at(-1);return t.wide?tag==='th'?'</span>'+(t.col<t.headers.length?leaf(' · '):''):'</p>':`</${tag}>`;};
  }
  rules.footnote_ref=(ts,i)=>referenceMark(`注${ts[i].meta.id+1}`);
  rules.footnote_block_open=()=>`<section style="${S.footnote}"><hr style="${S.hr}">${wrap('p',S.strong,leaf('注释'))}`;
  rules.footnote_block_close=()=>'</section>';
  rules.footnote_open=(ts,i)=>`<section style="margin:8px 0;">${wrap('span',S.strong,leaf(`[注${ts[i].meta.id+1}] `))}`;
  rules.footnote_close=()=>'</section>';
  rules.footnote_anchor=()=>'';

  // Each original node must pass through its renderer. Unknown tokens keep their literal source.
  const types=new Set();walk(tokens,t=>types.add(t.type));
  for(const type of types){
    if(type==='inline')continue;
    const original=rules[type];
    rules[type]=(ts,i,opts,e,self)=>{
      const t=ts[i];let result;
      if(original)result=original(ts,i,opts,e,self);
      else if(t.nesting!==0)result=self.renderToken(ts,i,opts);
      else {result=leaf(t.content||t.markup||'');report.warnings.push({type:'unknown_token',message:'未知节点按原文保留',source:t.type});}
      if(t.meta?.auditId){env.rendered.add(t.meta.auditId);}
      return result;
    };
  }
  let rendered=md.renderer.render(tokens,md.options,env);
  if(structuredSources.length)rendered+=sourcesHTML(structuredSources);
  if (hashtags.length) {
    const seen = new Set();
    const unique = hashtags.filter(tag => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    rendered += wrap('p', S.p, leaf(unique.join(' ')));
  }
  const article=wrap('section',S.root,(tokens[0]?.meta?.summary?'':leadCover)+rendered);
  report.images.sort((a,b)=>(a.nodeId||Infinity)-(b.nodeId||Infinity)).forEach((im,i)=>im.id=i+1);
  report.coverage={expected:report.inventory.length,rendered:env.rendered.size,missing:report.inventory.filter(n=>!env.rendered.has(n.id))};
  report.checks.code=env.codeChecks;
  report.checks.html=validateArticle(article);
  report.checks.visualMappings=visuals.every(t=>report.images.some(im=>im.sourceSha256===digest(t.content)));
  report.complete=report.coverage.missing.length===0&&report.checks.html.errors.length===0&&report.checks.visualMappings;
  const stem=safeName(filename||post.title||'公众号文章');
  const files={preview:path.join(outputDir,`${stem}-公众号预览.html`)};
  const title=post.title?wrap('h1','',esc(post.title),' id="article-title"'):'';
  const byline=[post.author,post.date].filter(Boolean).join('　');
  const header=title||byline?wrap('header','',title+(byline?wrap('p','',esc(byline)):''),' class="article-header"'):'';
  const manualImages=report.images.filter(image=>['local_requires_insert','generated_requires_insert'].includes(image.status));
  const pendingImages=report.images.filter(image=>['placeholder','missing'].includes(image.status));
  const notes=[
    manualImages.length?`有 ${manualImages.length} 处本地素材。若图片未随正文带入，可从预览旁的 assets 文件夹补入。`:'',
    pendingImages.length?`正文保留 ${pendingImages.length} 处待补图位置。`:'',
  ].filter(Boolean).join(' ');
  const template=await fs.readFile(path.join(skillRoot,'assets','preview.html'),'utf8');
  const replacements={TITLE:esc(post.title||'51AllAI 公众号排版'),HEADER:header,ARTICLE:article,NOTES:notes?wrap('p','',esc(notes),' class="notes"'):'',TITLE_BUTTON:post.title?'<button id="copy-title" type="button">复制标题</button>':''};
  const preview=template.replace(/\{\{([A-Z_]+)\}\}/g,(placeholder,key)=>replacements[key]??placeholder);
  await fs.writeFile(files.preview,preview);
  return {article,report,files,title:post.title};
}

export function validateArticle(html){
  const errors=[];
  const fragment=parseFragment(html);let unwrapped=0;
  function visit(n,inLeaf=false){
    if(['a','script','style','link','iframe','input','button','svg'].includes(n.tagName))errors.push(`正文含不兼容标签 ${n.tagName}`);
    for(const a of n.attrs||[]){
      if(['class','id'].includes(a.name)||/^on/i.test(a.name))errors.push(`正文含不兼容属性 ${a.name}`);
      if(a.name==='style'){
        if(/position\s*:\s*(absolute|fixed|sticky)|display\s*:\s*grid|var\(\s*--|@import/i.test(a.value))errors.push('正文含不兼容 CSS');
        for(const [,value,unit] of a.value.matchAll(/(?:^|;)\s*line-height\s*:\s*(\d*\.?\d+)([a-z%]*)\s*(?:!important\s*)?(?=;|$)/gi)){
          const minimum=unit==='%'?100:['','em'].includes(unit.toLowerCase())?1:0;
          if((Number(value)===0||Number(value)<minimum)&&textOf(n).trim()){
            errors.push(`${n.tagName} 的文字行高过小（${value}${unit}）`);
          }
        }
      }
      if(['href','src'].includes(a.name)&&/^\s*(javascript|vbscript):/i.test(a.value))errors.push('正文含不兼容 URL');
    }
    const leafParent=inLeaf||(n.tagName==='span'&&n.attrs?.some(a=>a.name==='leaf'));
    if(n.nodeName==='#text'&&n.value.trim()&&!leafParent)unwrapped++;
    for(const c of n.childNodes||[])visit(c,leafParent);
  }
  visit(fragment);
  if(unwrapped)errors.push(`${unwrapped} 处文本没有 leaf 包裹`);
  return {errors,unwrappedTextNodes:unwrapped};
}

async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')||!args.length){console.log('用法：node scripts/render.mjs <文件.md|-> --out-dir <目录> [--title <名称>] [--tags "#标签1 #标签2"]\n文本通过标准输入时使用 -；图片相对于输入文件目录（标准输入相对于工作目录）。');return;}
  const input=args[0],out=args.indexOf('--out-dir'),titleAt=args.indexOf('--title'),tagsAt=args.indexOf('--tags');
  if(out<0||!args[out+1])throw Error('请使用 --out-dir 指定输出目录');
  if(tagsAt>=0&&!args[tagsAt+1]?.trim())throw Error('请在 --tags 后提供文末标签');
  const outputDir=path.resolve(args[out+1]);
  const src=input==='-'?await new Promise((resolve,reject)=>{let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>resolve(s));process.stdin.on('error',reject);}):await fs.readFile(path.resolve(input),'utf8');
  const filename=titleAt>=0?args[titleAt+1]:'';
  const tags=tagsAt>=0?args[tagsAt+1]:'';
  const result=await renderDocument(src,{baseDir:input==='-'?process.cwd():path.dirname(path.resolve(input)),outputDir,filename,tags});
  const {complete,coverage,images,warnings,checks}=result.report;
  console.log(JSON.stringify({
    files:result.files,title:result.title,complete,coverage,
    images:images.map(({status,alt,line,src})=>({status,alt,line,src})),
    warnings:warnings.map(({type,message,detail})=>({type,message,detail})),
    errors:checks.html.errors,
  },null,2));
  if(!result.report.complete)process.exitCode=1;
}
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntry()) main().catch(error => { console.error(error.message); process.exitCode = 1; });
