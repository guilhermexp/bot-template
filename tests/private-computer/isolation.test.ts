import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hq-isolation-'));
Object.assign(process.env,{SESSION_SECRET:'fixture-session',DAYTONA_API_KEY:'fixture-private',DAYTONA_API_URL:'https://computer.example/api',DAYTONA_SANDBOX_ID:'unit',HQ_ROOT:root,HQ_LOCAL:'1'});
test('display mapper admits only the four owned slots, default is app display 100',async()=>{
 const {displayFor}=await import('../../server/src/box.js');assert.equal(displayFor('default'),':100');assert.equal(displayFor('screen-103'),':103');
 for(const id of ['screen-99','screen-0','screen-104','100;id','screen-100;id'])assert.throws(()=>displayFor(id),/screen/i);
});
test('shell uses private HOME and selected DISPLAY without backend secrets',async()=>{
 const {box}=await import('../../server/src/box.js');
 const r=await box.bash('printf "%s|%s|%s" "$HOME" "$DISPLAY" "${DAYTONA_API_KEY-unset}"',10,'screen-101');assert.equal(r.exit_code,0);assert.equal(r.output,`${root}/home|:101|unset`);
 const fail=await box.bash('exit 7',10,'screen-101');assert.equal(fail.exit_code,7);
});
test('remote shell also prepends the owned bundled runtime PATH',async()=>{
 const {env}=await import('../../server/src/env.js');const {daytona,execute}=await import('../../server/src/computer-provider.js');const {execFileSync}=await import('node:child_process');
 const bin=path.join(root,'runtime/x11/usr/bin');fs.mkdirSync(bin,{recursive:true});fs.writeFileSync(bin+'/hq-runtime-probe','#!/bin/sh\nprintf bundled');fs.chmodSync(bin+'/hq-runtime-probe',0o755);
 const saved=daytona.execute;env.localBox=false;
 daytona.execute=async(command:string)=>({exitCode:0,result:execFileSync('bash',['-c',command],{encoding:'utf8'})});
 try{assert.equal((await execute('hq-runtime-probe')).output,'bundled');}finally{env.localBox=true;daytona.execute=saved;}
});
