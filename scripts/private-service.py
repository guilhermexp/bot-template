#!/usr/bin/env python3
"""Start/stop only the dedicated app or primary Hermes, with verified PID identity."""
import os,sys,json,time,subprocess,secrets,fcntl
from pathlib import Path
action=sys.argv[1] if len(sys.argv)>1 else ''
if action not in ['start','stop']:sys.exit('Unknown action; use start or stop')
root=Path(os.environ['HQ_ROOT']).resolve()
if not (root/'OWNED-BY-BOT-TEMPLATE').is_file() or (root/'OWNED-BY-BOT-TEMPLATE').is_symlink():sys.exit('HQ_ROOT needs OWNED-BY-BOT-TEMPLATE marker')
sys.path.insert(0,str(root/'app/server/box'))
import importlib.util
spec=importlib.util.spec_from_file_location('registry',root/'app/server/box/screen-registry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
name=sys.argv[2] if len(sys.argv)>2 else 'app'
if name not in ['app','primary']:sys.exit('Unknown private service')
state=root/'services'/f'{name}.json';state.parent.mkdir(exist_ok=True,mode=0o700)
lock=open(state.with_suffix('.lock'),'a');fcntl.flock(lock,fcntl.LOCK_EX)
rec=json.loads(state.read_text()) if state.exists() else None
config={}
if name=='primary' and action=='start':
 parser="import fs from 'node:fs';import {parseEnv} from 'node:util';const e=parseEnv(fs.readFileSync(process.env.HQ_ROOT+'/config/app.env','utf8'));console.log(JSON.stringify({HERMES_BIN:e.HERMES_BIN}));"
 try:config=json.loads(subprocess.check_output([str(root/'runtime/node'),'--input-type=module','-e',parser],stderr=subprocess.PIPE))
 except (OSError,subprocess.CalledProcessError,ValueError):sys.exit('Cannot parse dedicated app.env with private Node runtime')
hermes=Path(config.get('HERMES_BIN',str(root/'runtime/hermes/bin/hermes'))).resolve()
if name=='primary' and not str(hermes).startswith(str(root/'runtime')+'/'):sys.exit('Hermes runtime must belong to HQ_ROOT/runtime')
cmd=[str(root/'runtime/node'),'--env-file='+str(root/'config/daytona.env'),'--env-file='+str(root/'config/app.env'),str(root/'app/server/dist/index.js')] if name=='app' else [str(hermes),'gateway','run','--no-supervise']
if action=='stop':
 if rec:
  if m.alive(rec['pid']) and not m.service_matches(rec):sys.exit('Identity changed; refusing cleanup')
  m.stop_session(rec);state.unlink()
 print(name,'stopped');sys.exit(0)
if rec and m.service_matches(rec):print(name,'already running',rec['pid']);sys.exit(0)
if rec and m.alive(rec['pid']):sys.exit('Live service identity changed; refusing replacement')
if rec:m.stop_session(rec)
if state.exists():state.unlink()
service_path=os.environ.get('PATH','/usr/bin:/bin')
if name=='primary':service_path=str(hermes.parent)+':'+service_path
env={'PATH':service_path,'HOME':str(root/'home'),'HQ_ROOT':str(root),'LANG':'C.UTF-8','XDG_CONFIG_HOME':str(root/'home/.config'),'XDG_CACHE_HOME':str(root/'home/.cache'),'XDG_DATA_HOME':str(root/'home/.local/share')}
if name=='primary':env.update({'HERMES_HOME':str(root/'hermes-primary'),'HERMES_GATEWAY_LOCK_DIR':str(root/'hermes-primary/locks'),'DISPLAY':':100','XAUTHORITY':str(root/'screens/100/Xauthority'),'BH_HOME':str(root/'hermes-primary/browser-harness')})
(root/'logs').mkdir(exist_ok=True)
env['HQ_SERVICE_TOKEN']=secrets.token_hex(24)
with open(root/'logs'/f'{name}.log','ab') as log:p=subprocess.Popen(cmd,cwd=root/'app',env=env,stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
def cleanup_failed_start():
 try:
  records=[]
  for entry in Path('/proc').iterdir():
   if not entry.name.isdigit():continue
   try:
    fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
    if int(fields[3])!=p.pid:continue
    if ('HQ_SERVICE_TOKEN='+env['HQ_SERVICE_TOKEN']).encode() not in (entry/'environ').read_bytes().split(b'\0'):continue
    records.append(m.identity(int(entry.name)))
   except (OSError,ValueError):continue
  for rec in reversed(records):
   if m.service_matches(rec):m.stop(rec)
 finally:
  # The unreaped Popen child remains ours even if /proc identity reads failed.
  if p.poll() is None:
   p.terminate()
   try:p.wait(timeout=1)
   except subprocess.TimeoutExpired:p.kill();p.wait()
try:
 launched=m.service_identity(p.pid)
 time.sleep(.5)
 if p.poll() is not None:raise RuntimeError('Private service exited; inspect its private log')
 m.private_write(state,json.dumps(launched).encode());print(name,'started',p.pid)
except Exception:
 cleanup_failed_start()
 sys.exit('Private service startup failed; owned workers cleaned; inspect private log')
