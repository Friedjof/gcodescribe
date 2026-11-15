// Run with a Vite dev server: PERF_URL=http://127.0.0.1:5192 node benchmarks/interaction.cjs
// PLAYWRIGHT_MODULE and CHROMIUM_PATH can select an existing local browser installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const base = process.env.PERF_URL || 'http://127.0.0.1:5192';
const cal = {plot_width:200,plot_height:200,bed_width:210,bed_height:210,obstacles:[],paper_corners:{bl:[0,0],tr:[200,200]}};
const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/__performance__.js"></script></body></html>`;
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
 const results=[];
 for(const throttle of [1,4]) for(const points of [20000,100000,400000]) {
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
  await page.route(base+'/api/**',route=>route.fulfill({json:{}}));
  await page.route('**/__performance__',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/__performance__.js',route=>route.fulfill({contentType:'text/javascript',body:`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import PaintCanvas from '/src/features/paint/PaintCanvas.tsx';
import { preparePath } from '/src/features/paint/lib/geometryTasks.ts';
import { I18nProvider } from '/src/i18n/index.tsx';
import '/src/styles.css';
const h=React.createElement;
const lines=Array.from({length:100},(_,row)=>Array.from({length:${points}/100},(_,i)=>[-35+70*i/(${points}/100-1),-35+row*.7+Math.sin(i*.12)*.2]));
window.commits=0; window.frames=[]; window.longTasks=[]; window.measure=false;
new PerformanceObserver(list=>{if(window.measure)window.longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask',buffered:false});
let last; function frame(ts){if(window.measure && last)window.frames.push(ts-last);last=ts;requestAnimationFrame(frame);} requestAnimationFrame(frame);
const initial={id:'bench',name:'Benchmark',grid:{step:10,snap:false},objects:[{id:'image',type:'image',cachedPolylines:lines,transform:{x:100,y:100,scale:1,rotation:0}}]};
function App(){const [page,setPage]=React.useState(initial);const [ids,select]=React.useState(['image']);window.scene=page;
return h('div',{style:{width:1000,height:650}},h(PaintCanvas,{cal:${JSON.stringify(cal)},page,tool:'select',selectedIds:ids,onSelect:select,onAdd:()=>{},onUpdate:()=>{},onUpdateMany:updates=>{window.commits++;setPage(p=>({...p,objects:p.objects.map(o=>updates.has(o.id)?{...o,transform:updates.get(o.id)}:o)}));},onEditStart:()=>{},onContextMenuSelection:()=>{},onImageDrop:()=>{},onTextAdd:()=>{},onErase:()=>{},viewRotation:0,onViewRotationChange:()=>{}}));}
ReactDOM.createRoot(document.getElementById('root')).render(h(I18nProvider,null,h(App)));
preparePath(lines).then(()=>window.ready=true);
window.original=lines;
` }));
  await page.goto(base+'/__performance__');
  await page.waitForFunction(()=>window.ready,{},{timeout:60000});
  const rect=await page.locator('svg rect[fill="transparent"]').first().boundingBox();
  if(!rect)throw Error('No selection rectangle');
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  await page.evaluate(()=>{window.frames=[];window.longTasks=[];window.measure=true;window.start=performance.now();window.firstFeedback=null;const target=document.querySelector('g[pointer-events="none"]');const observer=new MutationObserver(()=>{if(window.firstFeedback===null){window.firstFeedback=performance.now()-window.start;observer.disconnect();}});observer.observe(target,{attributes:true,subtree:true});});
  await page.mouse.move(x+70,y+45,{steps:45});
  const interim=await page.evaluate(()=>({commits:window.commits, transform:document.querySelector('g[pointer-events="none"]').getAttribute('transform')}));
  await page.mouse.up();
  const measured=await page.evaluate(()=>{window.measure=false;const f=window.frames.sort((a,b)=>a-b);return {feedbackMs:window.firstFeedback,frameP95:f[Math.floor(f.length*.95)],frameMedian:f[Math.floor(f.length*.5)],longTasks:window.longTasks,commits:window.commits,geometryUnchanged:window.original===window.scene.objects[0].cachedPolylines,x:window.scene.objects[0].transform.x};});
  if(interim.commits!==0||measured.commits!==1||!measured.geometryUnchanged||measured.x===100||errors.length)throw Error(JSON.stringify({interim,measured,errors}));
  results.push({points,throttle,...measured});console.log(JSON.stringify(results.at(-1)));
  if(points>40000) await page.locator('svg image').waitFor({state:'attached',timeout:60000});
  if(points===100000 && throttle===1) await page.screenshot({path:'/tmp/gcodescribe-large-editor.png'});
  await page.close();
 }
 await browser.close();
 if(process.env.PERF_OUTPUT)fs.writeFileSync(process.env.PERF_OUTPUT,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
