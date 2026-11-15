import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
Object.assign(process.env,{SESSION_SECRET:'unit',DAYTONA_API_KEY:'unit',DAYTONA_API_URL:'https://computer.example/api',DAYTONA_SANDBOX_ID:'unit',HQ_ROOT:fs.mkdtempSync(os.tmpdir()+'/hq-life-')});
test('ensure never starts a stopped computer and reports recoverable state',async()=>{
 const {db}=await import('../../server/src/db.js');db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('u','u@example.invalid','u',Date.now());
 const {computerProvider:p}=await import('../../server/src/computer-provider.js');p.getComputer=async()=>({id:'unit',name:'unit',status:'stopped'});
 const {ensureComputer,computerState}=await import('../../server/src/computer.js');await assert.rejects(ensureComputer('u'),/unavailable|stopped/i);assert.equal(computerState('u').status,'error');db.close();
});
