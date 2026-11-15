import importlib.util,unittest,tempfile,concurrent.futures,subprocess,os,json,socket
from pathlib import Path
SPEC=importlib.util.spec_from_file_location('registry',Path(__file__).resolve().parents[2]/'server/box/screen-registry.py')
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
class RegistryTests(unittest.TestCase):
 def setUp(self): self.tmp=tempfile.TemporaryDirectory();self.r=m.Registry(self.tmp.name)
 def tearDown(self): self.tmp.cleanup()
 def test_four_concurrent_distinct_leases_and_capacity(self):
  with concurrent.futures.ThreadPoolExecutor(4) as pool: leases=list(pool.map(lambda owner:self.r.lease(owner,owner=='a'),['a','b','c','d']))
  self.assertEqual(len({x['id'] for x in leases}),4)
  self.assertEqual({x['display'] for x in leases},{':100',':101',':102',':103'})
  self.assertEqual(self.r.lease('a')['id'],next(x['id'] for x in leases if x['owner']=='a'))
  with self.assertRaisesRegex(RuntimeError,'capacity'): self.r.lease('fifth')
  self.assertEqual(len(m.Registry(self.tmp.name).list()),4)
 def test_primary_slot_is_reserved_even_when_secondary_requests_first(self):
  self.assertEqual(self.r.lease('secondary')['display'],':101')
  self.assertEqual(self.r.lease('primary',True)['display'],':100')
 def test_foreign_socket_collision_never_touched(self):
  sock=socket.socket(socket.AF_UNIX); p=self.tmp.name+'/foreign';sock.bind(p)
  try:
   self.r.xsocket=lambda n:p
   with self.assertRaisesRegex(RuntimeError,'collision'): self.r.lease('a')
   self.assertTrue(os.path.exists(p));self.assertEqual(self.r.list(),[])
  finally:sock.close()
 def test_cleanup_refuses_pid_reuse_and_preserves_foreign_process(self):
  p=subprocess.Popen(['sleep','60'])
  try:
   rec=m.identity(p.pid);self.assertTrue(m.matches(rec));rec['starttime']='invalid';self.assertFalse(m.matches(rec))
   self.r.lease('a');self.r.release('a');self.assertEqual(self.r.list(),[]);self.assertIsNone(p.poll())
  finally:p.terminate();p.wait()
 def test_repeated_release_is_idempotent(self):
  self.r.lease('repeat');self.r.release('repeat');self.r.release('repeat');self.assertEqual(self.r.list(),[])
 def test_untrusted_display_rejected(self):
  for value in ['default',':0',':99','screen-999','100;kill 1']:
   with self.assertRaises(ValueError):m.number(value)

class RecoveryTests(unittest.TestCase):
 def test_dead_owned_service_does_not_block_release(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);r.lease('dead');p=subprocess.Popen(['sleep','60']);rec=m.identity(p.pid);rows=r.list();rows[0]['processes']=[rec];r.save(rows);p.terminate();p.wait();r.release('dead');self.assertEqual(r.list(),[])
 def test_live_reused_identity_blocks_release(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);r.lease('reuse');p=subprocess.Popen(['sleep','60'])
   try:
    rec=m.identity(p.pid);rec['starttime']='wrong';rows=r.list();rows[0]['processes']=[rec];r.save(rows)
    with self.assertRaises(RuntimeError):r.release('reuse')
    self.assertIsNone(p.poll());self.assertEqual(len(r.list()),1)
   finally:p.terminate();p.wait()

class CaptureTests(unittest.TestCase):
 def test_capture_holds_lease_until_pixels_are_read(self):
  import threading,types,sys
  from concurrent.futures import ThreadPoolExecutor
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('capture');entered=threading.Event();finish=threading.Event();released=threading.Event()
   class Image:
    width=1;height=1
    def save(self,b,format):b.write(b'png')
   def grab(**kw):entered.set();finish.wait(2);return Image()
   with patch.object(r,'ensure',return_value=row),patch.object(r,'_ensure_locked',return_value=row,create=True),patch.dict(sys.modules,{'PIL':types.SimpleNamespace(ImageGrab=types.SimpleNamespace(grab=grab))}):
    with ThreadPoolExecutor(2) as pool:
     captured=pool.submit(r.capture,row['id']);self.assertTrue(entered.wait(1))
     def release():r.release('capture');released.set()
     stopped=pool.submit(release)
     errors=[]
     try:self.assertFalse(released.wait(.1),'release raced with capture')
     finally:
      finish.set()
      for future in [captured,stopped]:
       try:future.result(timeout=2)
       except Exception as error:errors.append(error)
      if errors:raise ExceptionGroup('capture/release workers failed',errors)
     self.assertTrue(released.is_set(),'release must finish after capture')
     self.assertEqual(captured.result()['width'],1)

class ScreenEnvironmentTests(unittest.TestCase):
 def test_screen_children_receive_owned_binary_and_library_search_paths(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);lease=r.lease('env');seen=[]
   def launch(*args,**kw):seen.append(kw['env']);raise RuntimeError('probe launch stopped')
   def store(argv,**kw):
    from types import SimpleNamespace
    Path(argv[-1]).write_bytes(b'ciphered');return SimpleNamespace(returncode=0)
   with patch.object(m.subprocess,'run',side_effect=store),patch.object(m.subprocess,'Popen',side_effect=launch):
    with self.assertRaisesRegex(RuntimeError,'probe launch'):r.ensure(lease['id'])
   self.assertEqual(seen[0]['PATH'].split(':')[0],tmp+'/runtime/x11/usr/bin');self.assertEqual(seen[0]['LD_LIBRARY_PATH'],tmp+'/runtime/x11/usr/lib/x86_64-linux-gnu');self.assertEqual(seen[0].get('X11VNC_SENDEVENT_SYNC'),'1');self.assertEqual(seen[0].get('X11VNC_AVOID_WINDOWS'),'never')

class WorkerFailureTests(unittest.TestCase):
 def test_capture_and_release_errors_fail_the_concurrency_test(self):
  from unittest.mock import patch
  for name in ['capture','release']:
   with self.subTest(worker=name):
    original=getattr(m.Registry,name)
    def fail(reg,arg,original=original):original(reg,arg);raise RuntimeError('injected '+name+' failure')
    with patch.object(m.Registry,name,fail):
     with self.assertRaises(ExceptionGroup) as caught:CaptureTests('test_capture_holds_lease_until_pixels_are_read').test_capture_holds_lease_until_pixels_are_read()
     self.assertIn('injected',str(caught.exception.exceptions[0]))

class ScreenAuthTests(unittest.TestCase):
 def test_x_and_vnc_require_private_credentials_without_secret_arguments(self):
  from unittest.mock import patch
  import types
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);lease=r.lease('auth');launches=[];stores=[]
   def store(argv,**kw):
    stores.append((argv,kw));Path(argv[-1]).write_bytes(b'ciphered');return types.SimpleNamespace(returncode=0)
   def launch(argv,**kw):launches.append((argv,kw));raise RuntimeError('probe launch stopped')
   with patch.object(m.subprocess,'run',side_effect=store),patch.object(m.subprocess,'Popen',side_effect=launch):
    with self.assertRaisesRegex(RuntimeError,'probe launch'):r.ensure(lease['id'])
   argv,kw=launches[0];self.assertNotIn('-ac',argv);self.assertIn('-auth',argv);auth=Path(kw['env']['XAUTHORITY']);self.assertEqual(auth.stat().st_mode&511,0o600);self.assertTrue(b'MIT-MAGIC-COOKIE-1' in auth.read_bytes(),'Xauthority mechanism missing');pw=auth.parent/'vnc-password';self.assertEqual(pw.stat().st_mode&511,0o600);self.assertTrue(stores);self.assertFalse(any(pw.read_text() in arg for arg in stores[0][0]),'secret must not enter argv');self.assertTrue(pw.read_text().encode() in stores[0][1]['input'],'password must use stdin')

class StartupRecoveryTests(unittest.TestCase):
 def test_ensure_checks_expected_owner_under_lock(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('other')
   with self.assertRaisesRegex(RuntimeError,'ownership'):r.ensure(row['id'],'expected')
 def recovery(self,dead=False):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('recover');folder=Path(tmp)/'screens/101';folder.mkdir(parents=True)
   for name in ['Xauthority','vnc-password','rfbauth']:(folder/name).write_bytes(b'fixture!')
   old=subprocess.Popen(['sleep','30'],start_new_session=True);children=[];rows=r.list();rows[0]['processes']=[m.identity(old.pid)];r.save(rows)
   if dead:old.terminate();old.wait()
   original=m.subprocess.Popen
   def launch(argv,**kw):
    p=original(['sleep','30'],start_new_session=True,env=kw['env']);children.append(p);return p
   def store(argv,**kw):Path(argv[-1]).write_bytes(b'ciphered');return SimpleNamespace(returncode=0)
   try:
    with patch.object(m.subprocess,'Popen',side_effect=launch),patch.object(m.subprocess,'run',side_effect=store),patch.object(m.os.path,'exists',return_value=False),patch.object(m.time,'sleep'),patch.object(r,'ready',side_effect=lambda row:len(row['processes'])==4,create=True):
     result=r.ensure(row['id']);self.assertEqual(len(result['processes']),4);self.assertFalse(m.alive(old.pid));self.assertEqual(result['owner'],'recover')
   finally:
    for child in [old]+children:
     if child.poll() is None:child.kill()
     child.wait()
 def test_partial_one_process_start_is_recovered(self):self.recovery()
 def test_crashed_screen_restarts_without_releasing_owner(self):self.recovery(True)
 def test_identity_failure_after_spawn_does_not_orphan_child(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('journal');children=[];original=m.subprocess.Popen
   def launch(argv,**kw):p=original(['sleep','30'],start_new_session=True,env=kw['env']);children.append(p);return p
   def store(argv,**kw):Path(argv[-1]).write_bytes(b'ciphered');return SimpleNamespace(returncode=0)
   try:
    with patch.object(m.subprocess,'Popen',side_effect=launch),patch.object(m.subprocess,'run',side_effect=store),patch.object(m,'identity',side_effect=OSError('injected identity read failure')):
     with self.assertRaises(OSError):r.ensure(row['id'])
    self.assertTrue(children);self.assertTrue(all(p.poll() is not None for p in children),'spawned child survived identity failure')
   finally:
    for p in children:
     if p.poll() is None:p.kill()
     p.wait()
 def test_persisted_pre_spawn_journal_recovers_unrecorded_service(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('journal');command=['sleep','30'];token='fixture-launch-token';env=dict(os.environ,HQ_ROOT=str(r.root),DISPLAY=row['display'],HQ_GENERATION=row['generation'],HQ_LAUNCH_TOKEN=token);child=subprocess.Popen(command,env=env,start_new_session=True)
   try:
    rows=r.list();rows[0]['pending']={'command':command,'token':token};r.save(rows);r.release('journal');self.assertFalse(m.alive(child.pid),'unrecorded journalled service survived release');self.assertEqual(r.list(),[])
   finally:
    if child.poll() is None:child.kill()
    child.wait()

class XArtifactTests(unittest.TestCase):
 def reconcile(self,foreign=False):
  import stat
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('artifact');xs=Path(tmp)/'X101';lock=Path(tmp)/'X101-lock';r.xsocket=lambda n:str(xs);r.xlock=lambda n:str(lock);sock=socket.socket(socket.AF_UNIX);sock.bind(str(xs));sock.close();child=subprocess.Popen(['sleep','30'])
   try:
    rec=m.identity(child.pid);lock.write_text(str(child.pid));fields=lambda p:{'dev':p.lstat().st_dev,'ino':p.lstat().st_ino,'uid':p.lstat().st_uid,'mode':stat.S_IFMT(p.lstat().st_mode)};rows=r.read();row=rows[0];row['processes']=[rec];row['xArtifacts']={'pid':child.pid,'socket':fields(xs),'lock':fields(lock)};r.save(rows);child.kill();child.wait()
    if foreign:
     # Keep the old inode allocated so replacement cannot coincidentally reuse it.
     lock.rename(Path(tmp)/'saved-lock');lock.write_text('foreign')
     with self.assertRaisesRegex(RuntimeError,'artifact'):r.recover(row,rows)
     self.assertTrue(xs.exists());self.assertEqual(lock.read_text(),'foreign');self.assertTrue(r.read()[0]['processes'],'ownership evidence must remain')
    else:r.recover(row,rows);self.assertFalse(xs.exists(),'owned stale X socket survived');self.assertFalse(lock.exists());self.assertEqual(r.read()[0]['processes'],[])
   finally:
    if child.poll() is None:child.kill()
    child.wait()
 def test_owned_artifacts_after_crash_are_reconciled(self):self.reconcile()
 def test_replaced_artifact_is_not_removed_and_receipt_is_retained(self):self.reconcile(True)
 def test_missing_password_regenerates_ciphertext_as_one_backed_up_unit(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as tmp:
   r=m.Registry(tmp);row=r.lease('password');folder=Path(tmp)/'screens/101';folder.mkdir(parents=True);(folder/'Xauthority').write_bytes(b'old-auth');(folder/'rfbauth').write_bytes(b'old-enc!');stores=[]
   def store(argv,**kw):stores.append(kw['input']);Path(argv[-1]).write_bytes(b'new-enc!');return SimpleNamespace(returncode=0)
   with patch.object(m.subprocess,'run',side_effect=store),patch.object(m.subprocess,'Popen',side_effect=RuntimeError('probe stopped')):
    with self.assertRaisesRegex(RuntimeError,'probe stopped'):r.ensure(row['id'])
   self.assertEqual(len(stores),1,'new password requires new rfbauth');self.assertTrue(stores[0].startswith((folder/'vnc-password').read_bytes()+b'\n'));self.assertEqual((folder/'rfbauth').read_bytes(),b'new-enc!');backups=list(folder.glob('auth-before-*'));self.assertEqual(len(backups),1);self.assertEqual((backups[0]/'rfbauth').read_bytes(),b'old-enc!');self.assertEqual((backups[0]/'Xauthority').read_bytes(),b'old-auth')

if __name__=='__main__':unittest.main()
