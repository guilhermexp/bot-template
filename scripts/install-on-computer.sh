#!/usr/bin/env bash
# Run in the existing guest after API upload of built artifact + private config.
# No Node/npm builds here. No system supervisor, lifecycle operations or global credentials.
set -euo pipefail
umask 077
: "${HQ_ROOT:?Set an exclusive absolute HQ_ROOT}"
case "$HQ_ROOT" in /*/bot-template-private) ;; *) echo 'HQ_ROOT must end in /bot-template-private'; exit 1;; esac
[ ! -L "$HQ_ROOT" ] || { echo 'HQ_ROOT must not be a symlink'; exit 1; }
if [ -d "$HQ_ROOT" ] && { [ ! -f "$HQ_ROOT/OWNED-BY-BOT-TEMPLATE" ] || [ -L "$HQ_ROOT/OWNED-BY-BOT-TEMPLATE" ]; }; then echo 'Refusing an existing unowned root'; exit 1; fi
mkdir -p "$HQ_ROOT"/{config,home,logs,runtime,services,hermes-primary,engines,files,profiles,incoming}
chmod 700 "$HQ_ROOT" "$HQ_ROOT/config"
touch "$HQ_ROOT/OWNED-BY-BOT-TEMPLATE"
if [ "${1:-}" = --prepare ]; then echo 'Private root prepared; upload artifact/runtime and private config now'; exit 0; fi
[ -f "$HQ_ROOT/config/daytona.env" ] || { echo 'Upload dedicated private daytona.env first'; exit 1; }
# Artifact is prepared on the agent box; config arrives separately by API files/upload.
staging=$(mktemp -d "$HQ_ROOT/incoming/app-stage-XXXXXXXX")
trap 'test ! -d "$staging" || rmdir "$staging" 2>/dev/null || true' EXIT
tar -xzf "${1:?built app archive required}" -C "$staging"
# Rename the complete old unit, preserving stale files only in the rollback copy.
if [ -e "$HQ_ROOT/app" ]; then
  backup=$(mktemp -d "$HQ_ROOT/incoming/app-before-XXXXXXXX")
  rmdir "$backup"
  mv "$HQ_ROOT/app" "$backup"
fi
mv "$staging" "$HQ_ROOT/app"
chmod 600 "$HQ_ROOT/config/daytona.env"
if [ ! -f "$HQ_ROOT/config/app.env" ]; then
python3 - <<'PY'
from pathlib import Path
import os,secrets
r=Path(os.environ['HQ_ROOT'])
p=r/'config/app.env'
p.write_text('\n'.join(['HQ_ROOT='+str(r),'HQ_LOCAL=1','PORT=8787','APP_URL=http://127.0.0.1:8787','SERVER_URL=http://127.0.0.1:8787','SESSION_SECRET='+secrets.token_hex(32),'DEV_LOGIN=0','HERMES_URL=http://127.0.0.1:18642','ENGINE_PORT_BASE=18650','GROKBOT_NO_SCHEDULER=1'])+'\n');p.chmod(0o600)
PY
fi
# Generate the default MCP entry without exposing its credential in argv/stdout.
"$HQ_ROOT/runtime/node" --input-type=module <<'JS_MCP'
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {parseEnv} from 'node:util';import crypto from 'node:crypto';
const root=process.env.HQ_ROOT, folder=path.join(root,'config');
const vars=parseEnv(fs.readFileSync(path.join(folder,'app.env'),'utf8'));
if(!vars.SESSION_SECRET)throw Error('Dedicated app.env requires SESSION_SECRET');
const key=crypto.createHmac('sha256',vars.SESSION_SECRET).update('mcp:primary').digest('hex');
const entry={url:'http://127.0.0.1:'+(vars.PORT||'8787')+'/mcp/primary',headers:{Authorization:'Bearer '+key},timeout:1800,connect_timeout:30};
const target=path.join(folder,'hermes-mcp-hq.yaml'),text='  hq: '+JSON.stringify(entry)+'\n';
if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){
 if(fs.existsSync(target))execFileSync('cp',['-p','--',target,target+'.before-'+crypto.randomUUID()]);
 const temp=target+'.'+crypto.randomUUID();try{fs.writeFileSync(temp,text,{mode:0o600,flag:'wx'});fs.renameSync(temp,target);}finally{fs.rmSync(temp,{force:true});}
}
JS_MCP
# No service is restarted implicitly. Operator uses the own service manager.
echo 'Private files installed; start with HQ_ROOT set: python3 app/scripts/private-service.py start app'
