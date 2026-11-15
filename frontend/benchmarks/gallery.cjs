const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.PERF_URL || 'http://127.0.0.1:5192';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 const cdp=await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const items=Array.from({length:500},(_,i)=>({id:'item'+i,title:'item'+i,filename:'item'+i+'.svg',kind:'svg',uploader:'admin',created:100,status:'active',mode:'vector',detail:2,pages:[{n:1}],width:100,height:100,lines:1,render_revision:'r1'}));
 let requests=0, running=0,maxConcurrent=0;
 await page.route(base+'/api/**',async route=>{
  if(route.request().url().includes('/thumbnail')){ requests++;running++;maxConcurrent=Math.max(maxConcurrent,running);await new Promise(r=>setTimeout(r,400));running--;await route.fulfill({json:{polylines:[[[0,0],[100,100]]],width:100,height:100}}); }
  else if(route.request().url().includes('/gallery?'))await route.fulfill({json:items});
  else throw Error('Unexpected API '+route.request().url());
 });
 await page.route('**/__gallery_perf__',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/__gallery_perf__.js"></script></body></html>`}));
 await page.route('**/__gallery_perf__.js',route=>route.fulfill({contentType:'text/javascript',body:`
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';import Gallery from '/src/features/gallery/Gallery.tsx';import {I18nProvider} from '/src/i18n/index.tsx';import {ToastProvider} from '/src/components/Toasts.tsx';import '/src/styles.css';const h=React.createElement;
window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
function App(){const [visible,setVisible]=React.useState(true);window.show=setVisible;return h('div',{className:'app tab-gallery'},h('main',null,h(Gallery,{visible,onOpenPaint:()=>{}})));}
ReactDOM.createRoot(document.getElementById('root')).render(h(I18nProvider,null,h(ToastProvider,null,h(App))));` }));
 await page.goto(base+'/__gallery_perf__');
 await page.locator('.gallery-item').first().waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.gallery-thumbnail-view .poly-preview').length>5);
 const initial={requests,domCards:await page.locator('.gallery-item').count(),longTasks:await page.evaluate(()=>window.longTasks)};
 await page.evaluate(()=>{window.longTasks=[];const input=document.querySelector('.gallery-search');input.addEventListener('input',()=>{window.start=performance.now();new MutationObserver((_,o)=>{if(document.querySelectorAll('.gallery-item').length===1){window.feedback=performance.now()-window.start;o.disconnect();}}).observe(document.querySelector('.gallery-grid'),{childList:true,subtree:true});},{once:true});});
 await page.locator('.gallery-search').fill('item499');await page.waitForFunction(()=>window.feedback!==undefined);
 const feedback=await page.evaluate(()=>({feedbackMs:window.feedback,longTasks:window.longTasks}));
 await page.waitForFunction(()=>document.querySelector('.gallery-thumbnail-view .poly-preview'));
 await page.screenshot({path:'/tmp/gcodescribe-gallery-performance.png'});
 if(initial.requests>=100||maxConcurrent>4||errors.length)throw Error(JSON.stringify({initial,maxConcurrent,errors}));
 console.log(JSON.stringify({items:500,throttle:4,latencyMs:400,initial,maxConcurrent,...feedback}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
