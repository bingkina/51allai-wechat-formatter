import {chromium} from 'playwright';
import katex from 'katex';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createVisualRenderer() {
  const server=createServer(async(req,res)=>{
    if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="/vendor/katex/dist/katex.min.css"><style>body{margin:0;background:white}#visual{display:inline-block;padding:12px;color:#172B4D;font:16px Arial,"PingFang SC",sans-serif}svg{display:block}</style><div id="visual"></div>');return;}
    try {
      const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/vendor\//,'');
      const target=path.resolve(root,'node_modules',rel);
      if(!req.url.startsWith('/vendor/')||!target.startsWith(path.join(root,'node_modules')+path.sep)) throw Error('Invalid path');
      if(!(await stat(target)).isFile()) throw Error('Not a file');
      const ext=path.extname(target);
      res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'})[ext]||'application/octet-stream');
      res.end(await readFile(target));
    }catch {res.statusCode=404;res.end('Not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:900,height:700},deviceScaleFactor:2});
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.goto(origin);
    await page.evaluate(async()=>{await document.fonts.ready;});
    let mermaidReady=false;
    return {
      async render(kind,source,destination,{displayMode=false}={}) {
        if(kind==='math') {
          const html=katex.renderToString(source,{displayMode,throwOnError:true,trust:false,strict:'warn'});
          await page.evaluate(({html,displayMode})=>{const v=document.getElementById('visual');v.style.width='max-content';v.style.padding=displayMode?'8px 12px':'2px 3px';v.innerHTML=html;},{html,displayMode});
        } else {
          if(!mermaidReady) {
            await page.evaluate(async()=>{window.diagram=(await import('/vendor/mermaid/dist/mermaid.esm.min.mjs')).default;window.diagram.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:{primaryColor:'#F4EFFC',primaryTextColor:'#151226',primaryBorderColor:'#7C3AED',lineColor:'#625D72',fontFamily:'Arial, PingFang SC, sans-serif'},flowchart:{htmlLabels:false}});});
            mermaidReady=true;
          }
          await page.evaluate(async src=>{const {svg}=await window.diagram.render('diagram'+Date.now(),src);const v=document.getElementById('visual');v.style.width='640px';v.style.padding='12px';v.innerHTML=svg;},source);
        }
        await page.evaluate(async()=>{await document.fonts.ready;});
        const el=page.locator('#visual');const box=await el.boundingBox();
        if(!box||box.width>12000||box.height>16000) throw Error('图形尺寸过大，已保留源码');
        await el.screenshot({path:destination,timeout:20000,animations:'disabled'});
        return {width:Math.ceil(box.width),height:Math.ceil(box.height)};
      },
      async close(){await browser.close();await new Promise(resolve=>server.close(resolve));},
    };
  }catch(error){if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));throw error;}
}
