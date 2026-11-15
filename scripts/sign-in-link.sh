#!/usr/bin/env bash
# Store a one-use sign-in URL privately; no secret or URL in argv/stdout.
set -euo pipefail
: "${HQ_ROOT:?dedicated HQ_ROOT required}"
export HQ_SIGNIN_EMAIL="${1:?email required}"
python3 - <<'PYTHON'
import os,json,hmac,hashlib,urllib.request,tempfile,subprocess,sys
from pathlib import Path
r=Path(os.environ['HQ_ROOT'])
parser="import fs from 'node:fs';import {parseEnv} from 'node:util';const e=parseEnv(fs.readFileSync(process.env.HQ_ROOT+'/config/app.env','utf8'));console.log(JSON.stringify({PORT:e.PORT||'8787',SESSION_SECRET:e.SESSION_SECRET}));"
try:e=json.loads(subprocess.check_output([str(r/'runtime/node'),'--input-type=module','-e',parser],stderr=subprocess.PIPE))
except (OSError,subprocess.CalledProcessError,ValueError):sys.exit('Cannot parse dedicated app.env with private Node runtime')
key=hmac.new(e['SESSION_SECRET'].encode(),b'owner-login',hashlib.sha256).hexdigest()
req=urllib.request.Request('http://127.0.0.1:'+e['PORT']+'/api/auth/owner',data=json.dumps({'email':os.environ['HQ_SIGNIN_EMAIL'],'link':True}).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
with urllib.request.urlopen(req) as response: data=json.load(response)
p=r/'config/sign-in.json'
fd,tmp=tempfile.mkstemp(dir=p.parent,prefix='.sign-in-')
try:
 with os.fdopen(fd,'w') as f:f.write(json.dumps(data))
 os.replace(tmp,p)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
print('One-use sign-in stored in private config/sign-in.json (15 minutes)')
PYTHON
