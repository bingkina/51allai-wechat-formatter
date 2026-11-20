// Math is parsed as tokens; rendering is asynchronous and happens in a separate stage.
export function mathPlugin(md) {
  md.block.ruler.before('fence','math_block',(state,start,end,silent)=>{
    const begin=state.bMarks[start]+state.tShift[start], stop=state.eMarks[start];
    const first=state.src.slice(begin,stop);
    const open=first.startsWith('$$')?'$$':first.startsWith('\\[')?'\\[':null;
    if(!open || state.sCount[start]>=4) return false;
    const close=open==='$$'?'$$':'\\]';
    let content=first.slice(open.length), next=start+1, found=false;
    if(content.trimEnd().endsWith(close)) {content=content.trimEnd().slice(0,-close.length); found=true;}
    else {
      for(;next<end;next++) {
        const line=state.src.slice(state.bMarks[next]+state.tShift[next],state.eMarks[next]);
        if(line.trimEnd().endsWith(close)) {content+='\n'+line.trimEnd().slice(0,-close.length); next++;found=true;break;}
        content+='\n'+line;
      }
    }
    if(!found) return false;
    if(silent) return true;
    const token=state.push('math_block','',0);
    token.content=content.trim();token.markup=open;token.map=[start,next];
    token.meta={original:state.getLines(start,next,state.blkIndent,false)};
    state.line=next;return true;
  },{alt:['paragraph','reference','blockquote','list']});
  md.inline.ruler.before('escape','math_inline',(state,silent)=>{
    const at=state.pos, src=state.src;
    let open,close;
    if(src.startsWith('\\(',at)){open='\\(';close='\\)';}
    else if(src[at]==='$' && !/\s/.test(src[at+1]||' ') && src[at+1]!=='$'){open=close='$';}
    else return false;
    let end=at+open.length;
    while((end=src.indexOf(close,end))!==-1) {
      let n=0;for(let i=end-1;i>=0&&src[i]==='\\';i--)n++;
      if(n%2===0 && end>at+open.length && !/\s/.test(src[end-1]) && (close!=='$'||!/[0-9]/.test(src[end+1]||''))) break;
      end+=close.length;
    }
    if(end===-1) return false;
    if(!silent) {const t=state.push('math_inline','',0);t.content=src.slice(at+open.length,end);t.markup=open;t.meta={original:src.slice(at,end+close.length)};}
    state.pos=end+close.length;return true;
  });
}
