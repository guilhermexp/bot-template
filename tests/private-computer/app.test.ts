// Never inherit optional provider credentials into unit tests.
delete process.env.XAI_API_KEY;delete process.env.COMPOSIO_API_KEY;
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hq-app-test-'));
Object.assign(process.env,{SESSION_SECRET:'fixture-session',DAYTONA_API_KEY:'fixture-private',DAYTONA_API_URL:'https://computer.example/api',DAYTONA_SANDBOX_ID:'unit',HQ_ROOT:root,DB_PATH:root+'/data/hq.db',HQ_LOCAL:'1',DEV_LOGIN:'1'});
test('app imports without optional clients; unavailable features are explicit',async()=>{
 (await import('../../server/src/agent/rooms.js')).initRooms();
 (await import('../../server/src/agent/subagents.js')).initSubagents();
 const {api}=await import('../../server/src/routes.js');
 assert.equal(process.env.XAI_API_KEY,undefined);assert.equal(process.env.COMPOSIO_API_KEY,undefined);
 let r=await api.request('/auth/dev',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'unit@example.invalid'})});assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie')!.split(';')[0];
 r=await api.request('/apps',{headers:{cookie}});assert.equal(r.status,503);assert.match(await r.text(),/COMPOSIO_API_KEY/);
 r=await api.request('/voice/preview',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,503);
 const {configApi}=await import('../../server/src/routes-config.js');
 r=await api.request('/bots',{headers:{cookie}});const bot=(await r.json()).bots[0];
 const lib=path.join(root,'files',bot.id);fs.mkdirSync(lib,{recursive:true});fs.writeFileSync(path.join(lib,'proof.txt'),'real fixture');fs.symlinkSync('/etc/passwd',path.join(lib,'escape'));
 r=await configApi.request(`/bots/${bot.id}/files/raw?path=proof.txt`,{headers:{cookie}});assert.equal(r.status,200);assert.equal(await r.text(),'real fixture');
 for(const rel of ['escape','../proof.txt']) {r=await configApi.request(`/bots/${bot.id}/files/raw?path=${encodeURIComponent(rel)}`,{headers:{cookie}});assert.ok([400,404].includes(r.status));}
 r=await configApi.request(`/bots/${bot.id}/files/raw?path=proof.txt`);assert.equal(r.status,401);
 r=await api.request('/auth/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
 const {userFromCookieHeader}=await import('../../server/src/lib/auth.js');
 assert.doesNotThrow(()=>userFromCookieHeader('grokbot_session=%'));
 assert.equal(userFromCookieHeader('grokbot_session=%'),null);
 const {db}=await import('../../server/src/db.js');db.close();
});
