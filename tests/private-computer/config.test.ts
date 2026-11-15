// Never inherit optional provider credentials into unit tests.
delete process.env.XAI_API_KEY;delete process.env.COMPOSIO_API_KEY;
import test from 'node:test';import assert from 'node:assert/strict';
process.env.SESSION_SECRET='unit-session';process.env.DAYTONA_API_KEY='unit-private';process.env.DAYTONA_API_URL='https://computer.example/api';process.env.DAYTONA_SANDBOX_ID='unit';process.env.HQ_ROOT='/tmp/hq-unit';
test('computer-only config boots without optional keys and uses dedicated paths',async()=>{
 const {env}=await import('../../server/src/env.js');
 assert.equal(env.xaiKey,'');assert.equal(env.composioKey,'');assert.equal(env.hermesHome,'/tmp/hq-unit/hermes-primary');assert.equal(env.orgoComputerId,'unit');assert.equal((env as any).hqRoot,'/tmp/hq-unit');
});

test('dedicated homes reject traversal and existing symlinks outside HQ_ROOT',async()=>{
 const {spawnSync}=await import('node:child_process');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hq-confinement-'));const outside=fs.mkdtempSync(path.join(os.tmpdir(),'hq-other-'));fs.symlinkSync(outside,path.join(root,'linked'));
 for(const home of [root+'/../shared',root+'/linked',root+'/linked/not-created/nested']){
  const r=spawnSync(process.execPath,['--import','tsx','-e',"import('./server/src/env.ts')"],{env:{...process.env,HQ_ROOT:root,HERMES_HOME_PRIMARY:home},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/must belong to HQ_ROOT/);
 }
});
test('an existing legacy default database requires explicit DB_PATH before any new database',async()=>{
 const {spawnSync}=await import('node:child_process');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');const project=fs.mkdtempSync(path.join(os.tmpdir(),'hq-upgrade-'));fs.writeFileSync(path.join(project,'package.json'),'{"type":"module"}');const target=path.join(project,'server/src/env.ts');fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync('server/src/env.ts',target);fs.mkdirSync(path.join(project,'data'));const legacy=path.join(project,'data/grokbot.db');fs.writeFileSync(legacy,'legacy fixture; do not modify');const owned=path.join(project,'bot-template-private');const vars={...process.env,HQ_ROOT:owned};delete vars.DB_PATH;
 try{
  let r=spawnSync(process.execPath,['--import','tsx','-e',`import(${JSON.stringify(target)})`],{env:vars,encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/DB_PATH.*legacy|legacy.*DB_PATH/i);assert.equal(fs.existsSync(path.join(owned,'data/hq.db')),false);
  r=spawnSync(process.execPath,['--import','tsx','-e',`import(${JSON.stringify(target)}).then(({env})=>console.log(env.dbPath))`],{env:{...vars,DB_PATH:legacy},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),legacy);assert.equal(fs.readFileSync(legacy,'utf8'),'legacy fixture; do not modify');
 }finally{fs.rmSync(project,{recursive:true});}
});
test('missing root under an existing symlink ancestor has consistent canonical containment',async()=>{
 const {spawnSync}=await import('node:child_process');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hq-alias-'));fs.mkdirSync(tmp+'/real');fs.symlinkSync(tmp+'/real',tmp+'/alias');const root=tmp+'/alias/missing-private';
 try{const vars={...process.env,HQ_ROOT:root};delete vars.HERMES_HOME_PRIMARY;delete vars.ENGINES_DIR;const r=spawnSync(process.execPath,['--import','tsx','-e',"import('./server/src/env.ts')"],{env:vars,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(fs.existsSync(root),false);}finally{fs.rmSync(tmp,{recursive:true});}
});
