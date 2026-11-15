import {fileURLToPath} from 'node:url';
import {expectRejectedUpgrade,waitForOpen,cdpClient} from './proof-transport.mjs';
import {ProofScope} from './proof-resources.mjs';
/** Real guest-only proof. No model request, SaaS, fake credentials or lifecycle operations. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {WebSocket} from 'ws';
import {spawn} from 'node:child_process';import {processIdentity,sameProcess} from '../../server/dist/lib/process-owner.js';import {commandEnv} from '../../server/dist/computer-provider.js';
import {box} from '../../server/dist/box.js';import {screenFor,readyScreen} from '../../server/dist/computer.js';import {computerProvider} from '../../server/dist/computer-provider.js';import {TOOLS} from '../../server/dist/agent/tools.js';
const scope=new ProofScope();
const root=process.env.HQ_ROOT,base='http://127.0.0.1:'+process.env.PORT;
assert.equal(process.env.HQ_LOCAL,'1');assert.ok(root?.endsWith('/bot-template-private'));
const evidence=process.env.HQ_PROOF_DIR ?? path.join(root,'proof');fs.mkdirSync(evidence,{recursive:true});
const checks=[];function ok(name,data={}){checks.push({name,...data});console.log(JSON.stringify({ok:name,...data}));}
async function request(p,{cookie,body,method='GET',auth}={}) {return fetch(base+'/api'+p,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});}
const owner=crypto.createHmac('sha256',process.env.SESSION_SECRET).update('owner-login').digest('hex');
try {
let r=await request('/auth/owner',{method:'POST',auth:owner,body:{email:'operator@bot-hq.invalid',name:'Private computer operator'}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
r=await request('/auth/me',{cookie});const user=(await r.json()).user;
r=await request('/bots',{cookie});let bots=(await r.json()).bots;const primary=bots.find(b=>b.isPrimary);assert.ok(primary);
r=await request('/bots',{cookie,method:'POST',body:{name:'Computer proof '+scope.nonce,label:'Temporary computer verification',avatarColor:'orange'}});assert.equal(r.status,200);const secondary=(await r.json()).bot;
scope.defer(async()=>{const response=await request(`/bots/${secondary.id}`,{cookie,method:'DELETE'});assert.ok([200,404].includes(response.status));});
assert.ok(secondary?.id);ok('owner login and primary/temporary bots');
const a=await readyScreen(user.id,primary.id);let b=await readyScreen(user.id,secondary.id);
// Exercise recovery through the same module/cache used by the product, only on our temporary bot.
const leased=await computerProvider.getScreen(process.env.DAYTONA_SANDBOX_ID,b.screenId);
assert.equal(leased.owner,secondary.id);const xvfb=leased.processes?.[0];assert.ok(xvfb&&path.basename(xvfb.command[0])==='Xvfb'&&xvfb.command[1]===leased.display&&sameProcess(xvfb),'verified temporary Xvfb');
process.kill(xvfb.pid,'SIGKILL');await new Promise(r=>setTimeout(r,5100));
b=await readyScreen(user.id,secondary.id);assert.ok(b.revision>leased.revision,'recovery must advance screen revision');
const pages=await(await fetch(`http://127.0.0.1:${9200+Number(b.screenId.slice(7))}/json/list`,{signal:AbortSignal.timeout(10000)})).json();const home=pages.find(p=>p.type==='page'&&p.title==='Home');assert.ok(home,'recovered bot Chrome Home');
const probe=scope.socket(new WebSocket(home.webSocketDebuggerUrl));try{await waitForOpen(probe);const client=cdpClient(probe);let complete=false;for(let n=0;n<50;n++){const result=await client.call('Runtime.evaluate',{expression:'document.readyState==="complete" && !!document.querySelector("iframe")',returnByValue:true});if(result.result?.value===true){complete=true;break;}await new Promise(r=>setTimeout(r,100));}assert.equal(complete,true);}finally{probe.terminate();}
ok('temporary Xvfb SIGKILL recovery advances revision and redresses native Chrome Home');
for(const screen of [a,b]) {const port=9200+Number(screen.screenId.slice(7));const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);}
assert.notEqual(a.screenId,b.screenId);assert.ok(/^screen-10[0-3]$/.test(a.screenId));ok('two real independent app screens',{screens:[a.screenId,b.screenId]});
const ds=[];
for(const [bot,s] of [[primary,a],[secondary,b]]){
 const result=await box.bash('printf "%s" "$DISPLAY"',10,s.screenId);assert.equal(result.exit_code,0);ds.push(result.output);
 const fail=await box.bash('exit 9',10,s.screenId);assert.equal(fail.exit_code,9);
 const shot=await computerProvider.screenshot(process.env.DAYTONA_SANDBOX_ID,s.screenId);const bytes=Buffer.from(shot.image,'base64');assert.equal(shot.mime_type,'image/png');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),shot.width);assert.equal(bytes.readUInt32BE(20),shot.height);fs.writeFileSync(path.join(evidence,s.screenId+'.png'),bytes);const httpShot=await request(`/bots/${bot.id}/screenshot`,{cookie});assert.equal(httpShot.status,200);assert.equal(httpShot.headers.get('content-type'),'image/png');const httpBytes=Buffer.from(await httpShot.arrayBuffer());assert.equal(httpBytes.readUInt32BE(16),1024);assert.equal(httpBytes.readUInt32BE(20),768);ok('app HTTP screenshot per bot',{screen:s.screenId,mime:'image/png',width:1024,height:768});ok('screenshot actual PNG',{screen:s.screenId,width:shot.width,height:shot.height,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
assert.notEqual(ds[0],ds[1]);ok('exec DISPLAY and exit codes',{displays:ds});
const lib=path.join(root,'files',primary.id);const proofFile=scope.file(lib,'computer-proof.txt');const filename=path.basename(proofFile);
const save=TOOLS.find(t=>t.name==='save_file');const text='private-computer-runtime-proof\n';await save.impl({filename,content:text},{userId:user.id,botId:primary.id,depth:0,enqueueBotMessage(){throw new Error('No model activity allowed');}});
r=await request(`/bots/${primary.id}/files`,{cookie});assert.equal(r.status,200);assert.ok((await r.json()).files.some(f=>f.name===filename));
r=await request(`/bots/${primary.id}/files/download`,{cookie,method:'POST',body:{path:filename}});assert.equal(r.status,200);const url=(await r.json()).url;assert.ok(url.startsWith('/api/'));
r=await fetch(base+url,{headers:{cookie}});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.toString(),text);const hash=crypto.createHash('sha256').update(bytes).digest('hex');ok('save tool, Library list and authenticated download hash',{sha256:hash});
const escape=scope.symlink('/etc/passwd',lib);
for(const rel of ['../config/daytona.env',path.basename(escape)]){r=await request(`/bots/${primary.id}/files/raw?path=${encodeURIComponent(rel)}`,{cookie});assert.ok([400,404].includes(r.status));}
r=await request(`/bots/${primary.id}/files/raw?path=${encodeURIComponent(filename)}`);assert.equal(r.status,401);
r=await request(`/bots/${primary.id}/screenshot`);assert.equal(r.status,401);
r=await request('/auth/owner',{method:'POST',body:{email:'unauthorized@example.invalid'}});assert.equal(r.status,403);
// A second real session cannot read the first user's bot resources.
r=await request('/auth/owner',{method:'POST',auth:owner,body:{email:'proof-other-'+scope.nonce+'@bot-hq.invalid'}});assert.equal(r.status,200);const foreign=r.headers.get('set-cookie').split(';')[0];scope.defer(async()=>{const response=await request('/bots',{cookie:foreign});assert.equal(response.status,200);for(const bot of (await response.json()).bots){const removed=await request(`/bots/${bot.id}`,{cookie:foreign,method:'DELETE'});assert.ok([200,404].includes(removed.status));}});
for(const p of [`/bots/${primary.id}/screenshot`,`/bots/${primary.id}/files`,`/bots/${primary.id}/files/raw?path=${encodeURIComponent(filename)}`]){r=await request(p,{cookie:foreign});assert.equal(r.status,404);}ok('HTTP negatives: unauthenticated 401, invalid owner 403, foreign bot 404, traversal/symlink denied');
class Queue {buf=Buffer.alloc(0);waiters=[];push(b){this.buf=Buffer.concat([this.buf,b]);this.drain();}drain(){while(this.waiters.length&&this.buf.length>=this.waiters[0].n){const w=this.waiters.shift();const b=this.buf.subarray(0,w.n);this.buf=this.buf.subarray(w.n);w.resolve(b);}}read(n){return Promise.race([new Promise(resolve=>{this.waiters.push({n,resolve});this.drain();}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('RFB read timeout')),15000).unref())]);}}
async function connect(mode){const ws=scope.socket(new WebSocket(base.replace('http','ws')+`/api/bots/${primary.id}/screen?mode=${mode}`,['binary'],{headers:{cookie}}));const q=new Queue();ws.on('message',b=>q.push(Buffer.from(b)));await waitForOpen(ws);assert.match((await q.read(12)).toString(),/RFB/);console.log(JSON.stringify({rfb:mode,stage:'version'}));ws.send(Buffer.from('RFB 003.008\n'));assert.deepEqual([...await q.read(2)],[1,1]);console.log(JSON.stringify({rfb:mode,stage:'security'}));ws.send(Buffer.from([1]));assert.equal((await q.read(4)).readUInt32BE(),0);ws.send(Buffer.from([1]));const head=await q.read(24);await q.read(head.readUInt32BE(20));assert.equal(head.readUInt16BE(0),1024);
const w=head.readUInt16BE(0),h=head.readUInt16BE(2),bpp=head[4];assert.ok([8,16,32].includes(bpp));
ws.send(Buffer.from([3,0,0,0,0,0,w>>8,w&255,h>>8,h&255]));
let type;for(let n=0;n<10;n++){type=(await q.read(1))[0];if(type===0)break;if(type===2)continue;if(type===3){const clip=await q.read(7);const len=clip.readUInt32BE(3);assert.ok(len<=1024*1024);await q.read(len);continue;}throw Error('Unexpected RFB server message');}
assert.equal(type,0);const update=await q.read(3);const count=update.readUInt16BE(1);assert.ok(count>0&&count<=16);
for(let n=0;n<count;n++){const rect=await q.read(12);assert.equal(rect.readInt32BE(8),0);const pixels=rect.readUInt16BE(4)*rect.readUInt16BE(6);assert.ok(pixels>0&&pixels<=w*h);await q.read(pixels*(bpp/8));}
console.log(JSON.stringify({rfb:mode,stage:'initial-frame-received'}));return ws;}
const loc=async()=>{const r=await box.bash('xdotool getmouselocation --shell',10,a.screenId);assert.equal(r.exit_code,0);return r.output.match(/X=(\d+)\nY=(\d+)/).slice(1).map(Number);};
const observerFile=path.join(evidence,'input-effects.json');try{fs.unlinkSync(observerFile);}catch{}
const observer=spawn('/usr/bin/python3',[fileURLToPath(new URL('./input-observer.py',import.meta.url)),observerFile],{env:commandEnv(a.screenId),stdio:['ignore','ignore','inherit']});
await new Promise((resolve,reject)=>{observer.once('spawn',resolve);observer.once('error',reject);});
const observerIdentity=processIdentity(observer.pid);
try {
 for(let i=0;!fs.existsSync(observerFile)&&i<100;i++)await new Promise(r=>setTimeout(r,100));assert.ok(fs.existsSync(observerFile),'real input observer ready');
 const focus=await box.bash("xdotool search --name '^HQInputProof$' windowactivate --sync",15,a.screenId);assert.equal(focus.exit_code,0);
 const before=await loc();const target=[before[0]===222?333:222,234];const mouse=Buffer.from([5,0,target[0]>>8,target[0]&255,target[1]>>8,target[1]&255]);
 const key=Buffer.from([4,1,0,0,0,0,0,65,4,0,0,0,0,0,0,65]);const clipText='RFB_PROOF_'+crypto.randomBytes(4).toString('hex');const clip=Buffer.concat([Buffer.from([6,0,0,0,0,0,0,clipText.length]),Buffer.from(clipText)]);
 for(let i=0;i<100;i++){if(JSON.parse(fs.readFileSync(observerFile)).clipboardReady)break;await new Promise(r=>setTimeout(r,100));}
 const initial=JSON.parse(fs.readFileSync(observerFile));assert.equal(initial.clipboardReady,true);
 let ws=await connect('watch');for(const byte of Buffer.concat([key,mouse,clip]))ws.send(Buffer.from([byte]));await new Promise(r=>setTimeout(r,500));assert.deepEqual(await loc(),before);assert.deepEqual(JSON.parse(fs.readFileSync(observerFile)),initial);ws.close();ok('real RFB watch suppresses fragmented key, pointer and clipboard effects');
 ws=await connect('control');for(const byte of Buffer.concat([key,mouse,clip]))ws.send(Buffer.from([byte]));
 for(let i=0;i<150;i++){const effects=JSON.parse(fs.readFileSync(observerFile));if(effects.text==='A'&&effects.clipboard===clipText)break;await new Promise(r=>setTimeout(r,100));}
 assert.deepEqual(await loc(),target);const effects=JSON.parse(fs.readFileSync(observerFile));assert.equal(effects.text,'A');assert.equal(effects.clipboard,clipText);assert.ok(effects.keys>0);ws.close();ok('real RFB control forwards fragmented key, pointer and clipboard effects');
} finally {if(observerIdentity&&sameProcess(observerIdentity)){const exited=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned observer exit timeout')),3000);observer.once('exit',()=>{clearTimeout(timer);resolve();});});observer.kill();await exited;}}
await computerProvider.ensureScreen(process.env.DAYTONA_SANDBOX_ID,a.screenId);
for(const badCookie of [undefined,foreign])await expectRejectedUpgrade(()=>scope.socket(new WebSocket(base.replace('http','ws')+`/api/bots/${primary.id}/screen`,{headers:badCookie?{cookie:badCookie}:{}})));ok('RFB session absent/foreign denied before upstream');
r=await request(`/bots/${secondary.id}`,{cookie,method:'DELETE'});assert.equal(r.status,200);
// Foreign session's automatically created primary is temporary and gets only its own cleanup.
r=await request('/bots',{cookie:foreign});for(const bot of (await r.json()).bots){r=await request(`/bots/${bot.id}`,{cookie:foreign,method:'DELETE'});assert.equal(r.status,200);}
fs.unlinkSync(proofFile);ok('temporary bots and proof Library file removed; primary retained');
const final=await screenFor(user.id,primary.id);assert.equal(final.screenId,a.screenId);fs.writeFileSync(path.join(evidence,'runtime.json'),JSON.stringify({time:new Date().toISOString(),checks,primaryBotId:primary.id,primaryScreen:a.screenId},null,2));
console.log(JSON.stringify({tests:checks.length,fail:0,skip:0}));

} finally {await scope.cleanup();}
