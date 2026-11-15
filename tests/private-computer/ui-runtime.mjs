import {cdpClient,waitForOpen} from './proof-transport.mjs';
import {ProofScope} from './proof-resources.mjs';
/** Observe the actual app in its already running, app-managed desktop browser.
 * No separate browser, global profile, API key in UI, or signed URL in screenshots.
 */
import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import {WebSocket} from 'ws';
const scope=new ProofScope();const uiName='UI proof '+scope.nonce;let returnHome=async()=>{};
const root=process.env.HQ_ROOT,origin='http://127.0.0.1:'+process.env.PORT,out=process.env.HQ_PROOF_DIR??root+'/proof';fs.mkdirSync(out,{recursive:true});
const owner=crypto.createHmac('sha256',process.env.SESSION_SECRET).update('owner-login').digest('hex');
async function api(p,method='GET',body,cookie){const r=await fetch(origin+'/api'+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...(p==='/auth/owner'?{Authorization:'Bearer '+owner}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r;}
try {
let r=await api('/auth/owner','POST',{email:'operator@bot-hq.invalid'});const cookie=r.headers.get('set-cookie').split(';')[0];const token=cookie.split('=').slice(1).join('=');
scope.defer(async()=>{const all=await(await api('/bots','GET',undefined,cookie)).json();for(const bot of all.bots.filter(b=>b.name===uiName))await api('/bots/'+bot.id,'DELETE',undefined,cookie);});
const targets=await (await fetch('http://127.0.0.1:9300/json/list')).json();const target=targets.find(t=>t.type==='page');assert.ok(target);
const ws=scope.socket(new WebSocket(target.webSocketDebuggerUrl));await waitForOpen(ws);const errors=[];
const {call}=cdpClient(ws,{timeoutMs:8000,onEvent:data=>{if(data.method==='Runtime.exceptionThrown')errors.push('Runtime exception');}});
returnHome=async()=>{if(ws.readyState===WebSocket.OPEN)await call('Page.navigate',{url:'chrome://newtab/'});};
const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('UI evaluation failed');return r.result.value;};
async function wait(expression,description,ms=60000){const end=Date.now()+ms;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('UI state timeout: '+description);}
async function click(selector){assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`),'UI button '+selector);}
const checks=[];function ok(name,data={}){checks.push({name,...data});console.log(JSON.stringify({ok:name,...data}));}
async function capture(name,state){if(state.includes('live authenticated')) await wait(`(()=>{const c=document.querySelector('.screen--stage.is-live canvas');if(!c||!c.width||!c.height)return false;const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=64)if(p[i]>12||p[i+1]>12||p[i+2]>12)return true;return false})()`,'first real framebuffer pixels',60000);const viewport=await evaluate('({width:innerWidth,height:innerHeight})');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});const bytes=Buffer.from(shot.data,'base64');fs.writeFileSync(out+'/'+name+'.png',bytes);ok('real UI capture',{file:name+'.png',state,viewport,origin,time:new Date().toISOString(),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
// A seeded server-issued owner session is installed only for the loopback origin.
await call('Network.setCookie',{name:'grokbot_session',value:token,url:origin,httpOnly:true,secure:false,sameSite:'Lax'});
await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/'});
await wait('!!document.querySelector(".pinned__tile")','signed-in roster');ok('real UI seeded owner session and roster loaded');
await click('[aria-label="New Bot"]');await wait('!!document.querySelector("[aria-label=\\"Bot name\\"]")','create dialog');await evaluate('document.querySelector("[aria-label=\\"Bot name\\"]").focus()');await call('Input.insertText',{text:uiName});await click('.create-modal button[type="submit"]');
await wait(`!document.querySelector(".create-modal") && Array.from(document.querySelectorAll(".bot-row")).some(e=>e.textContent.includes(${JSON.stringify(uiName)}))`,'bot created via UI');ok('temporary second bot created through actual UI form');
async function openViewer(){await click('.chat__pill');assert.ok(await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Open computer');if(!e)return false;e.click();return true})()`));try {await wait('!!document.querySelector(".screen--stage.is-live canvas")','live noVNC viewer',45000);}catch(error){const retried=await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('.viewer button')).find(e=>e.textContent.trim()==='Retry');if(!b)return false;b.click();return true})()`);if(!retried)throw error;ok('used existing Retry after startup disconnect');await wait('!!document.querySelector(".screen--stage.is-live canvas")','live viewer after Retry',90000);}}
await openViewer();
const created=(await(await api('/bots','GET',undefined,cookie)).json()).bots.find(b=>b.name===uiName);assert.ok(created);
const state=(await(await api('/computer','GET',undefined,cookie)).json()).computer;const screen=state.screens.find(s=>s.botId===created.id);assert.ok(screen);const secondaryPort=9200+Number(screen.screenId.slice(7));
let homeReady=false;const homeEnd=Date.now()+60000;
while(Date.now()<homeEnd&&!homeReady){
 try{
  const pages=await(await fetch('http://127.0.0.1:'+secondaryPort+'/json/list')).json();const page=pages.find(p=>p.type==='page'&&(p.title==='Home'||p.title===uiName));
  if(page){const probe=scope.socket(new WebSocket(page.webSocketDebuggerUrl));try{await waitForOpen(probe,3000);homeReady=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Home renderer timeout')),3000);probe.once('message',raw=>{clearTimeout(timer);const value=JSON.parse(String(raw));resolve(value.result?.result?.value===true);});probe.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'document.readyState==="complete" && !!document.querySelector("iframe")',returnByValue:true}}));});}finally{probe.terminate();}}
 }catch{}
 if(!homeReady)await new Promise(r=>setTimeout(r,200));
}
assert.ok(homeReady,'secondary native Home renderer complete');ok('secondary Chrome Home complete and renderer responds');
await capture('ui-secondary-watch','temporary bot, live authenticated noVNC watch');
assert.ok(await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('.viewer button')).find(e=>e.textContent.trim()==='Take control');if(!e)return false;e.click();return true})()`));await wait('!!document.querySelector(".screen--stage.is-live.is-driving canvas")','live control');await capture('ui-secondary-control','temporary bot, live authenticated noVNC control');
await click('.screen__handback');await wait('!!document.querySelector(".screen--stage.is-live:not(.is-driving) canvas")','handback to watch');await click('[aria-label="Close computer"]');
await click('.pinned__tile');await openViewer();await capture('ui-primary-watch','primary bot, live authenticated noVNC watch');await click('[aria-label="Close computer"]');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await capture('ui-mobile-roster','primary selected, mobile viewport');await call('Emulation.clearDeviceMetricsOverride');
assert.deepEqual(errors,[]);ok('no uncaught UI runtime exceptions');
const bots=await (await api('/bots','GET',undefined,cookie)).json();const secondary=bots.bots.find(b=>b.name===uiName);assert.ok(secondary);await api('/bots/'+secondary.id,'DELETE',undefined,cookie);ok('only temporary UI bot removed; primary retained');
await call('Page.navigate',{url:'chrome://newtab/'});fs.writeFileSync(out+'/ui-runtime.json',JSON.stringify({tool:'CDP attached to app-managed Chromium on own display 100; no new test browser',origin,checks,uncaughtExceptions:errors},null,2));

} finally {try{await returnHome();}finally{await scope.cleanup();}}
