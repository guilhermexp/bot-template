import unittest,tempfile,subprocess,os,shutil,json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
class ServiceTests(unittest.TestCase):
 def test_primary_uses_configured_owned_runtime_and_stops_only_its_identity(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box')
   for d in ['config','home','runtime/version/bin']: (r/d).mkdir(parents=True)
   binary=r/'runtime/version/bin/hermes';binary.write_text('#!/bin/sh\nexec sleep 30\n');binary.chmod(0o755);(r/'runtime/node').symlink_to(shutil.which('node'));(r/'config/app.env').write_text('HERMES_BIN="'+str(binary)+'" # comment\n')
   env=dict(os.environ,HQ_ROOT=str(r));script=str(REPO/'scripts/private-service.py')
   p=subprocess.run(['python3',script,'start','primary'],env=env,capture_output=True,text=True)
   self.assertEqual(p.returncode,0,p.stderr)
   try:self.assertTrue((r/'services/primary.json').exists())
   finally:
    p=subprocess.run(['python3',script,'stop','primary'],env=env,capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr)

class AppPathTests(unittest.TestCase):
 def test_app_does_not_shadow_capture_python_with_failed_hermes_venv(self):
  import shlex
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box')
   for d in ['config','home','runtime']: (r/d).mkdir(exist_ok=True)
   (r/'config/app.env').write_text('');node=r/'runtime/node';dest=r/'path.txt';node.write_text('#!/bin/sh\nprintf \'%s\' "$PATH" > '+shlex.quote(str(dest))+'\nexec sleep 30\n');node.chmod(0o755)
   script=str(REPO/'scripts/private-service.py');env=dict(os.environ,HQ_ROOT=str(r));p=subprocess.run(['python3',script,'start','app'],env=env,capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr)
   try:self.assertNotIn(str(r/'runtime/hermes/bin'),dest.read_text())
   finally:
    p=subprocess.run(['python3',script,'stop','app'],env=env,capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr)


class ServiceRecoveryTests(unittest.TestCase):
 def test_stopping_dead_service_clears_state(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box');(r/'config').mkdir();(r/'config/app.env').write_text('');(r/'services').mkdir()
   p=subprocess.Popen(['sleep','60']);
   import importlib.util
   spec=importlib.util.spec_from_file_location('registry_recovery',REPO/'server/box/screen-registry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);rec=m.identity(p.pid);p.terminate();p.wait();(r/'services/app.json').write_text(json.dumps(rec))
   result=subprocess.run(['python3',str(REPO/'scripts/private-service.py'),'stop','app'],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr);self.assertFalse((r/'services/app.json').exists())

class FailedStartupTests(unittest.TestCase):
 def test_failed_detached_start_does_not_leave_worker(self):
  import time,signal
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box')
   for d in ['config','runtime','home']:(r/d).mkdir()
   (r/'config/app.env').write_text('');node=r/'runtime/node';node.write_text('#!/usr/bin/python3\nimport os,time\nfrom pathlib import Path\np=os.fork()\nif p:\n Path(os.environ["HQ_ROOT"]+"/worker.pid").write_text(str(p));os._exit(1)\ntime.sleep(60)\n');node.chmod(0o755)
   result=subprocess.run(['python3',str(REPO/'scripts/private-service.py'),'start','app'],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True);self.assertNotEqual(result.returncode,0);pid=int((r/'worker.pid').read_text())
   def alive():
    try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[0]!='Z'
    except FileNotFoundError:return False
   try:
    for _ in range(20):
     if not alive():break
     time.sleep(.025)
    self.assertFalse(alive(),'failed service left an owned detached worker')
   finally:
    if alive():os.kill(pid,signal.SIGKILL)

class ServiceSessionTests(unittest.TestCase):
 def check_session(self,concurrent):
  import time,signal
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box')
   for d in ['config','runtime','home']:(r/d).mkdir()
   (r/'config/app.env').write_text('');node=r/'runtime/node';node.write_text('#!/usr/bin/python3\nimport os,time,signal\nfrom pathlib import Path\nr=Path(os.environ["HQ_ROOT"])\nwith open(r/"starts","a") as f:f.write("start\\n")\np=os.fork()\nif not p:\n os.setpgid(0,0);signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)\nelse:\n (r/"worker").write_text(str(p));time.sleep(30)\n');node.chmod(0o755);env=dict(os.environ,HQ_ROOT=str(r));cmd=['python3',str(REPO/'scripts/private-service.py')];calls=[];worker=0
   try:
    calls=[subprocess.Popen(cmd+['start','app'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(2 if concurrent else 1)]
    for call in calls:_,err=call.communicate(timeout=5);self.assertEqual(call.returncode,0,err.decode())
    worker=int((r/'worker').read_text());self.assertEqual((r/'starts').read_text().splitlines(),['start'])
    result=subprocess.run(cmd+['stop','app'],env=env,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
    for _ in range(40):
     try:live=Path('/proc/'+str(worker)+'/stat').read_text().rsplit(')',1)[1].split()[0]!='Z'
     except FileNotFoundError:live=False
     if not live:break
     time.sleep(.025)
    self.assertFalse(live,'normal stop left a service worker in another process group')
   finally:
    subprocess.run(cmd+['stop','app'],env=env,capture_output=True)
    for entry in Path('/proc').iterdir():
     if not entry.name.isdigit():continue
     try:
      if ('HQ_ROOT='+str(r)).encode() in (entry/'environ').read_bytes().split(b'\0') and entry.stat().st_uid==os.getuid():os.kill(int(entry.name),signal.SIGKILL)
     except (OSError,ValueError):pass

 def test_concurrent_start_is_serialized(self):self.check_session(True)
 def test_normal_stop_removes_other_process_group_worker(self):self.check_session(False)

class LegacyOrphanTests(unittest.TestCase):
 def test_dead_legacy_leader_with_surviving_workers_retains_receipt_for_migration(self):
  import importlib.util,time
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box');(r/'config').mkdir();(r/'config/app.env').write_text('');(r/'services').mkdir();spec=importlib.util.spec_from_file_location('legacy_test_registry',REPO/'server/box/screen-registry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
   child=subprocess.Popen(['python3','-c','import os,time\np=os.fork()\nif not p:time.sleep(30)\nelse:print(p,flush=True);time.sleep(30)'],start_new_session=True,stdout=subprocess.PIPE)
   try:
    worker=int(child.stdout.readline());rec=m.identity(child.pid);trusted=m.service_identity(child.pid);child.terminate();child.wait();(r/'services/app.json').write_text(json.dumps(rec));result=subprocess.run(['python3',str(REPO/'scripts/private-service.py'),'stop','app'],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True);self.assertNotEqual(result.returncode,0);self.assertIn('migration',result.stderr);self.assertTrue((r/'services/app.json').exists());self.assertTrue(m.alive(worker))
   finally:
    if child.poll() is None:child.kill();child.wait()
    if 'trusted' in locals():m.stop_session(trusted)
    child.stdout.close()

class FailedPersistenceTests(unittest.TestCase):
 def check_failure(self,kind):
  import time,signal
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'app/server/box').mkdir(parents=True);shutil.copy2(REPO/'server/box/screen-registry.py',r/'app/server/box')
   for d in ['config','runtime','home']:(r/d).mkdir()
   (r/'config/app.env').write_text('');node=r/'runtime/node';node.write_text('#!/bin/sh\nexec sleep 30\n');node.chmod(0o755)
   injected="""import os,subprocess
from pathlib import Path
r=Path(os.environ['HQ_ROOT']);original=subprocess.Popen
class Remember(original):
 def __init__(self,*a,**kw):
  super().__init__(*a,**kw);(r/'launched-pid').write_text(str(self.pid))
subprocess.Popen=Remember
"""
   if kind=='cleanup':injected+="""import sys
previous_init=Remember.__init__
def init(self,*a,**kw):
 previous_init(self,*a,**kw);module=sys.modules['__main__'].m
 def fail_identity(pid):raise OSError('injected identity capture failure')
 def fail_stop(rec):raise RuntimeError('injected worker cleanup failure')
 module.service_identity=fail_identity;module.stop=fail_stop
Remember.__init__=init
"""
   elif kind=='identity':injected+="""original_read=Path.read_text
def read(self,*a,**kw):
 if self.name=='stat' and self.parent.name.isdigit() and int(self.parent.name)!=os.getpid():raise OSError('injected stat failure')
 return original_read(self,*a,**kw)
Path.read_text=read
"""
   else:injected+="""original_write=Path.write_text;original_replace=os.replace
def write(self,*a,**kw):
 if self.name=='app.json' and self.parent.name=='services':original_write(self,'{');raise OSError('injected partial write')
 return original_write(self,*a,**kw)
def replace(src,dst):
 if Path(dst).name=='app.json':raise OSError('injected atomic replace failure')
 return original_replace(src,dst)
Path.write_text=write;os.replace=replace
"""
   (r/'sitecustomize.py').write_text(injected);env=dict(os.environ,HQ_ROOT=str(r));cmd=['python3',str(REPO/'scripts/private-service.py')];result=subprocess.run(cmd+['start','app'],env={**env,'PYTHONPATH':str(r)},capture_output=True,text=True);self.assertNotEqual(result.returncode,0);pid=int((r/'launched-pid').read_text())
   def live():
    try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[0]!='Z'
    except FileNotFoundError:return False
   try:
    self.assertFalse(live(),'launched service survived failed startup');self.assertFalse((r/'services/app.json').exists(),'failed write left corrupt state');self.assertFalse(list((r/'services').glob('.auth-*')));retry=subprocess.run(cmd+['start','app'],env=env,capture_output=True,text=True);self.assertEqual(retry.returncode,0,retry.stderr)
   finally:
    subprocess.run(cmd+['stop','app'],env=env,capture_output=True)
    if live():os.kill(pid,signal.SIGKILL)
 def test_identity_failure_stops_launched_process(self):self.check_failure('identity')
 def test_worker_cleanup_error_still_stops_direct_child(self):self.check_failure('cleanup')
 def test_state_write_failure_is_atomic_and_retryable(self):self.check_failure('state')
 def test_worker_identity_is_compatible_with_service_matches(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('worker_identity',REPO/'server/box/screen-registry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);p=subprocess.Popen(['sleep','30'])
  try:
   rec=m.identity(p.pid);self.assertTrue(m.service_matches(rec));rec['starttime']='invalid';self.assertFalse(m.service_matches(rec))
  finally:p.terminate();p.wait()

class StopExitRaceTests(unittest.TestCase):
 def test_leader_exiting_between_checks_is_not_reported_as_pid_reuse(self):
  import importlib.util,signal
  from unittest.mock import patch
  spec=importlib.util.spec_from_file_location('exit_race',REPO/'server/box/screen-registry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);child=subprocess.Popen(['sleep','30'],start_new_session=True);rec=m.service_identity(child.pid);original_kill=os.kill;original_alive=m.alive;sent=False
  def kill(pid,sig):
   nonlocal sent
   original_kill(pid,sig)
   if pid==child.pid and sig==signal.SIGTERM:child.wait(timeout=2);sent=True
  def stale_alive(pid):return True if sent and pid==child.pid else original_alive(pid)
  try:
   with patch.object(m.os,'kill',side_effect=kill),patch.object(m,'alive',side_effect=stale_alive):m.stop_session(rec)
  finally:
   if child.poll() is None:child.kill()
   child.wait()

if __name__=='__main__':unittest.main()
