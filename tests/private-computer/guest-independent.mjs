import {expectRejectedUpgrade,expectRfbGreeting} from './proof-transport.mjs';
import {ProofScope} from './proof-resources.mjs';
/** Independent guest proof when configured API origin cannot be reached from inside the guest.
 * This intentionally does NOT claim screenFor/readyScreen or authorized app viewer success.
 */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {WebSocket} from 'ws';
import {db} from '../../server/dist/db.js';import {box} from '../../server/dist/box.js';import {computerProvider as provider} from '../../server/dist/computer-provider.js';import {TOOLS} from '../../server/dist/agent/tools.js';
const scope=new ProofScope();
const root=process.env.HQ_ROOT,base='http://127.0.0.1:'+process.env.PORT,sandbox=process.env.DAYTONA_SANDBOX_ID;
assert.equal(process.env.HQ_LOCAL,'1');const out=root+'/proof';fs.mkdirSync(out,{recursive:true});const checks=[];function ok(name,data={}){checks.push({name,...data});console.log(JSON.stringify({ok:name,...data}));}
const auth=crypto.createHmac('sha256',process.env.SESSION_SECRET).update('owner-login').digest('hex');
async function request(p,{cookie,body,method='GET',owner=false}={}){return fetch(base+'/api'+p,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(owner?{Authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});}
try {
let r=await request('/auth/owner',{owner:true,method:'POST',body:{email:'operator@bot-hq.invalid'}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
r=await request('/bots',{cookie});const bots=(await r.json()).bots;const primary=bots.find(b=>b.isPrimary);r=await request('/bots',{cookie,method:'POST',body:{name:'Computer proof '+scope.nonce,label:'Temporary proof'}});assert.equal(r.status,200);const secondary=(await r.json()).bot;scope.defer(async()=>{await provider.releaseScreen(sandbox,secondary.id);const response=await request(`/bots/${secondary.id}`,{cookie,method:'DELETE'});assert.ok([200,404].includes(response.status));});assert.ok(primary&&secondary);ok('real app HTTP login and two bots persisted');
const screens=await Promise.all([provider.leaseScreen(sandbox,primary.id,true),provider.leaseScreen(sandbox,secondary.id)]);assert.notEqual(screens[0].id,screens[1].id);
for(let i=0;i<screens.length;i++){
 const s=await provider.ensureScreen(sandbox,screens[i].id);const exec=await box.bash(`xsetroot -solid '${i?'#be602f':'#2669ab'}'; printf '%s' "$DISPLAY"`,15,s.id);assert.equal(exec.exit_code,0);assert.equal(exec.output,s.display);const fail=await box.bash('exit 7',10,s.id);assert.equal(fail.exit_code,7);
 const shot=await provider.screenshot(sandbox,s.id),bytes=Buffer.from(shot.image,'base64');assert.equal(shot.mime_type,'image/png');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),shot.width);assert.equal(bytes.readUInt32BE(20),shot.height);fs.writeFileSync(out+'/'+s.id+'.png',bytes);ok('real helper display/exec/screenshot',{screen:s.id,display:s.display,width:shot.width,height:shot.height,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
const hashes=screens.map(s=>crypto.createHash('sha256').update(fs.readFileSync(out+'/'+s.id+'.png')).digest('hex'));assert.notEqual(...hashes);ok('two distinct real framebuffer captures');
const dir=root+'/files/'+primary.id;const proofFile=scope.file(dir,'computer-proof.txt');const filename=path.basename(proofFile);
const text='private-computer-actual-file-proof\n',save=TOOLS.find(x=>x.name==='save_file');await save.impl({filename,content:text},{botId:primary.id,userId:(db.prepare('SELECT user_id FROM bots WHERE id=?').get(primary.id)).user_id,depth:0,enqueueBotMessage(){throw Error('No models');}});
r=await request(`/bots/${primary.id}/files`,{cookie});assert.equal(r.status,200);assert.ok((await r.json()).files.some(f=>f.name===filename));
r=await request(`/bots/${primary.id}/files/download`,{cookie,method:'POST',body:{path:filename}});assert.equal(r.status,200);const url=(await r.json()).url;r=await fetch(base+url,{headers:{cookie}});assert.equal(r.status,200);assert.equal(await r.text(),text);ok('real app save tool/Library/list/download',{sha256:crypto.createHash('sha256').update(text).digest('hex')});
const escape=scope.symlink('/etc/passwd',dir);for(const rel of ['../config/daytona.env',path.basename(escape)]){r=await request(`/bots/${primary.id}/files/raw?path=${encodeURIComponent(rel)}`,{cookie});assert.ok([400,404].includes(r.status));}
for(const p of [`/bots/${primary.id}/files`,`/bots/${primary.id}/screenshot`]){r=await request(p);assert.equal(r.status,401);}r=await request('/auth/owner',{method:'POST',body:{email:'denied@example.invalid'}});assert.equal(r.status,403);
r=await request('/auth/owner',{owner:true,method:'POST',body:{email:'proof-other-'+scope.nonce+'@bot-hq.invalid'}});assert.equal(r.status,200);const foreign=r.headers.get('set-cookie').split(';')[0];scope.defer(async()=>{const response=await request('/bots',{cookie:foreign});assert.equal(response.status,200);for(const bot of (await response.json()).bots){const removed=await request(`/bots/${bot.id}`,{cookie:foreign,method:'DELETE'});assert.ok([200,404].includes(removed.status));}});for(const p of [`/bots/${primary.id}/files`,`/bots/${primary.id}/screenshot`]){r=await request(p,{cookie:foreign});assert.equal(r.status,404);}ok('real HTTP 401/403, foreign 404 and traversal/symlink denial');
for(const badCookie of [undefined,foreign])await expectRejectedUpgrade(()=>scope.socket(new WebSocket(base.replace('http','ws')+`/api/bots/${primary.id}/screen`,{headers:badCookie?{cookie:badCookie}:{}})));ok('real app WebSocket absent/foreign session refused');
// Real upstream RFB version from each owned websockify, separately from app relay.
for(const s of screens)await expectRfbGreeting(scope.socket(new WebSocket('ws://127.0.0.1:'+s.wsPort)));ok('two real owned upstream RFB servers; authenticated app relay remains blocked');
await provider.releaseScreen(sandbox,secondary.id);r=await request(`/bots/${secondary.id}`,{cookie,method:'DELETE'});assert.equal(r.status,200);r=await request('/bots',{cookie:foreign});for(const bot of (await r.json()).bots){r=await request(`/bots/${bot.id}`,{cookie:foreign,method:'DELETE'});assert.equal(r.status,200);}fs.unlinkSync(proofFile);ok('own temporary screen/bots/file cleaned; primary helper retained');
fs.writeFileSync(out+'/independent.json',JSON.stringify({time:new Date().toISOString(),checks,primaryBotId:primary.id,screen:screens[0].id,integrationBlocked:'configured API origin times out from guest; screenFor/readyScreen and authorized app relay not approved'},null,2));console.log(JSON.stringify({tests:checks.length,fail:0,skip:0,blocked:['guest-to-API','authorized-app-relay','LLM']}));db.close();

} finally {await scope.cleanup();}
