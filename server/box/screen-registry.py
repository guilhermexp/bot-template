#!/usr/bin/env python3
"""Four app-owned lazy screens; locked durable leases and verified process identities.
No sandbox lifecycle, global DISPLAY, desktop :0/:99, or foreign process cleanup.
"""
import os,json,fcntl,socket,subprocess,time,signal,uuid,sys,base64,io,contextlib,secrets,struct,tempfile,threading,stat,shutil
_CAPTURE_ENV=threading.Lock()
from pathlib import Path

def number(value):
 if value not in ['screen-'+str(n) for n in range(100,104)]:raise ValueError('Unknown app screen')
 return int(value[7:])
def identity(pid):
 p=Path('/proc')/str(pid)
 if (p/'stat').read_text().rsplit(')',1)[1].split()[0]=='Z':raise ProcessLookupError('Process exited')
 return {'pid':pid,'starttime':(p/'stat').read_text().rsplit(')',1)[1].split()[19],'command':(p/'cmdline').read_bytes().decode().split('\0')[:-1]}
def matches(rec):
 try:return identity(rec['pid'])==rec
 except (OSError,KeyError,ValueError):return False
def alive(pid):
 try:identity(pid);return True
 except (FileNotFoundError,ProcessLookupError):return False
def stop(rec):
 if not alive(rec['pid']):return
 if not matches(rec):raise RuntimeError('Ownership identity changed; refusing cleanup')
 os.kill(rec['pid'],signal.SIGTERM)
 for _ in range(30):
  if not matches(rec):return
  time.sleep(.1)
 if matches(rec):os.kill(rec['pid'],signal.SIGKILL)
def service_identity(pid):
 rec=identity(pid);fields=(Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()
 return {**rec,'uid':(Path('/proc')/str(pid)).stat().st_uid,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'sessionId':int(fields[3])}
def service_matches(rec):
 try:
  if 'bootId' not in rec:return matches(rec)
  current=service_identity(rec['pid'])
  return all(current[k]==rec[k] for k in ['pid','starttime','uid','bootId','sessionId'])
 except (OSError,ValueError,KeyError):return False
def stop_session(rec):
 if alive(rec['pid']):
  if not service_matches(rec):raise RuntimeError('Service identity changed; refusing session cleanup')
  rec=service_identity(rec['pid'])
 elif not rec.get('bootId'):
  # Legacy receipts cannot attest a dead leader across boots; retain evidence if a session remains.
  for entry in Path('/proc').iterdir():
   if not entry.name.isdigit():continue
   try:
    fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
    if fields[0]!='Z' and int(fields[3])==rec['pid']:raise RuntimeError('Legacy service workers require migration; retaining receipt')
   except (OSError,ValueError):continue
  return
 if rec.get('sessionId')!=rec['pid'] or rec.get('uid')!=os.getuid() or rec.get('bootId')!=Path('/proc/sys/kernel/random/boot_id').read_text().strip():raise RuntimeError('Unverified service session')
 def members():
  try:leader=service_identity(rec['pid'])
  except OSError:leader=None
  if leader and any(leader[k]!=rec[k] for k in ['pid','starttime','uid','bootId','sessionId']):raise RuntimeError('Service leader PID reused; refusing cleanup')
  found=[]
  for entry in Path('/proc').iterdir():
   if not entry.name.isdigit():continue
   try:
    current=service_identity(int(entry.name))
    if current['sessionId']==rec['pid'] and current['uid']==rec['uid'] and int(current['starttime'])>=int(rec['starttime']):found.append(current)
   except (OSError,ValueError):continue
  return found
 for sig,attempts in [(signal.SIGTERM,30),(signal.SIGKILL,20)]:
  for current in members():
   if service_matches(current):
    try:os.kill(current['pid'],sig)
    except ProcessLookupError:pass
  for _ in range(attempts):
   if not members():return
   time.sleep(.05)
 if members():raise RuntimeError('Owned service workers remain; retaining receipt')

def port_free(port):
 with socket.socket() as s:
  try:s.bind(('127.0.0.1',port));return True
  except OSError:return False
def private_write(path,data):
 fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.auth-')
 try:
  with os.fdopen(fd,'wb') as f:f.write(data)
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

class Registry:
 def __init__(self,root):
  self.root=Path(root).resolve();self.folder=self.root/'leases';self.folder.mkdir(parents=True,exist_ok=True,mode=0o700)
 def xsocket(self,n):return '/tmp/.X11-unix/X'+str(n)
 def xlock(self,n):return '/tmp/.X'+str(n)+'-lock'
 @contextlib.contextmanager
 def locked(self):
  with open(self.folder/'registry.lock','a') as f:
   fcntl.flock(f,fcntl.LOCK_EX);yield
 def read(self):
  p=self.folder/'registry.json';return json.loads(p.read_text()) if p.exists() else []
 def save(self,rows):
  p=self.folder/'registry.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(rows));os.chmod(tmp,0o600);os.replace(tmp,p)
 def list(self):
  with self.locked():return self.read()
 def lease(self,owner,primary=False):
  if not owner or len(owner)>100 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in owner):raise ValueError('Invalid screen owner')
  with self.locked():
   rows=self.read()
   for r in rows:
    if r['owner']==owner:return r
   if len(rows)>=4:raise RuntimeError('Screen capacity reached (4)')
   for n in ([100] if primary else range(101,104)):
    if any(r['display']==':'+str(n) for r in rows):continue
    if os.path.exists(self.xsocket(n)) or os.path.exists(self.xlock(n)) or not all(port_free(p) for p in [6100+n-100,7100+n-100,9200+n]):continue
    r={'id':'screen-'+str(n),'display':':'+str(n),'owner':owner,'generation':uuid.uuid4().hex,'vncPort':6100+n-100,'wsPort':7100+n-100,'width':1024,'height':768,'default':False,'processes':[]}
    rows.append(r);self.save(rows);return r
   raise RuntimeError('Screen display/port collision; no free app slot')
 def get(self,sid):
  number(sid)
  for r in self.list():
   if r['id']==sid:return r
  raise RuntimeError('App screen lease missing')
 def ready(self,r):
  if len(r['processes'])!=4 or not all(matches(p) for p in r['processes']):return False
  if not os.path.exists(self.xsocket(number(r['id']))):return False
  for port in [r['vncPort'],r['wsPort']]:
   try:
    with socket.create_connection(('127.0.0.1',port),timeout=.2):pass
   except OSError:return False
  return True
 def pending_processes(self,r):
  pending=r.get('pending')
  if not pending:return []
  command=pending['command'];records=[]
  for entry in Path('/proc').iterdir():
   if not entry.name.isdigit():continue
   try:
    if entry.stat().st_uid!=os.getuid():continue
    rec=identity(int(entry.name));args=rec['command']
    if not any(Path(arg).name==Path(command[0]).name and args[i+1:]==command[1:] for i,arg in enumerate(args)):continue
    fields=(entry/'stat').read_text().rsplit(')',1)[1].split()
    if int(fields[3])!=rec['pid']:continue
    # Inspect environment only after exact launch command, UID and detached session match.
    values=(entry/'environ').read_bytes().split(b'\0')
    expected={'HQ_ROOT':str(self.root),'DISPLAY':r['display'],'HQ_GENERATION':r['generation'],'HQ_LAUNCH_TOKEN':pending['token']}
    if all((key+'='+value).encode() in values for key,value in expected.items()):records.append(rec)
   except (OSError,ValueError):continue
  return records
 def remember_x_artifacts(self,r,records):
  if r.get('xArtifacts'):return
  xvfb=next((rec for rec in records if any(Path(arg).name=='Xvfb' and rec['command'][i+1:i+2]==[r['display']] for i,arg in enumerate(rec['command']))),None)
  if not xvfb or not matches(xvfb):return
  paths={'socket':Path(self.xsocket(number(r['id']))),'lock':Path(self.xlock(number(r['id'])))}
  if not all(p.exists() for p in paths.values()):return
  proof={'pid':xvfb['pid']}
  for name,path in paths.items():
   st=path.lstat();kind=stat.S_IFSOCK if name=='socket' else stat.S_IFREG
   if st.st_uid!=os.getuid() or stat.S_IFMT(st.st_mode)!=kind:raise RuntimeError('X11 artifact ownership/type changed')
   proof[name]={'dev':st.st_dev,'ino':st.st_ino,'uid':st.st_uid,'mode':stat.S_IFMT(st.st_mode)}
  if paths['lock'].read_text().strip()!=str(xvfb['pid']):raise RuntimeError('X11 artifact PID does not match owned Xvfb')
  r['xArtifacts']=proof
 def reconcile_x_artifacts(self,r,records):
  paths={'socket':Path(self.xsocket(number(r['id']))),'lock':Path(self.xlock(number(r['id'])))};proof=r.get('xArtifacts');present=[]
  for name,path in paths.items():
   if not path.exists() and not path.is_symlink():continue
   if not proof or not any(rec['pid']==proof['pid'] for rec in records):raise RuntimeError('X11 artifact lacks ownership evidence; retaining lease')
   st=path.lstat();current={'dev':st.st_dev,'ino':st.st_ino,'uid':st.st_uid,'mode':stat.S_IFMT(st.st_mode)}
   if current!=proof.get(name) or st.st_uid!=os.getuid():raise RuntimeError('X11 artifact changed; retaining lease')
   if name=='lock' and path.read_text().strip()!=str(proof['pid']):raise RuntimeError('X11 artifact PID changed; retaining lease')
   present.append(path)
  if present:
   with socket.socket(socket.AF_UNIX) as probe:
    probe.settimeout(.2)
    try:probe.connect(str(paths['socket']))
    except OSError:pass
    else:raise RuntimeError('X11 artifact still serves a live X server; retaining lease')
   for path in present:path.unlink()
  r.pop('xArtifacts',None)
 def recover(self,r,rows):
  records=r['processes']+self.pending_processes(r)
  for rec in records:
   if alive(rec['pid']) and not matches(rec):raise RuntimeError('Ownership identity changed; refusing recovery')
  self.remember_x_artifacts(r,records);self.save(rows)
  for rec in reversed(records):stop(rec)
  self.reconcile_x_artifacts(r,records)
  r['processes']=[];r.pop('pending',None);self.save(rows)
 def ensure(self,sid,owner=None):
  number(sid)
  with self.locked():return self._ensure_locked(sid,owner)
 def _ensure_locked(self,sid,owner=None):
   rows=self.read();r=next((r for r in rows if r['id']==sid),None)
   if not r:raise RuntimeError('App screen lease missing')
   if owner is not None and r['owner']!=owner:raise RuntimeError('Screen ownership changed; refusing ensure')
   if r['processes'] or r.get('pending'):
    if not (self.root/'screens'/str(number(sid))/'Xauthority').is_file() or not (self.root/'screens'/str(number(sid))/'rfbauth').is_file():raise RuntimeError('Owned screen requires secure restart; release only its verified resources')
    if not r.get('pending') and self.ready(r):
     if not r.get('xArtifacts'):self.remember_x_artifacts(r,r['processes']);self.save(rows)
     return r
    self.recover(r,rows)
   n=number(sid)
   if os.path.exists(self.xsocket(n)) or os.path.exists(self.xlock(n)) or not all(port_free(p) for p in [r['vncPort'],r['wsPort']]):raise RuntimeError('Screen collision before start')
   home=self.root/'screens'/str(n)/'home';home.mkdir(parents=True,exist_ok=True)
   home.parent.chmod(0o700)
   auth=home.parent/'Xauthority'
   refresh_auth=not all((home.parent/name).is_file() for name in ['Xauthority','vnc-password','rfbauth'])
   if refresh_auth:
    existing=[home.parent/name for name in ['Xauthority','vnc-password','rfbauth'] if (home.parent/name).exists()]
    if existing:
     backup=home.parent/('auth-before-'+uuid.uuid4().hex);backup.mkdir(mode=0o700)
     for path in existing:shutil.copy2(path,backup/path.name)
    cookie=secrets.token_bytes(16)
    fields=[socket.gethostname().encode(),str(n).encode(),b'MIT-MAGIC-COOKIE-1',cookie]
    private_write(auth,struct.pack('!H',256)+b''.join(struct.pack('!H',len(f))+f for f in fields))
    password=secrets.token_urlsafe(6)
    private_write(home.parent/'vnc-password',password.encode())
   password=(home.parent/'vnc-password').read_text()
   # Dedicated Xvfb has no login manager; initialize selection ownership immediately.
   env={'X11VNC_AVOID_WINDOWS':'never','X11VNC_SENDEVENT_SYNC':'1','XAUTHORITY':str(auth),'PATH':str(self.root/'runtime/x11/usr/bin')+':'+os.environ.get('PATH','/usr/bin:/bin'),'LD_LIBRARY_PATH':str(self.root/'runtime/x11/usr/lib/x86_64-linux-gnu'),'HOME':str(home),'DISPLAY':r['display'],'HQ_ROOT':str(self.root),'HQ_GENERATION':r['generation'],'XDG_CONFIG_HOME':str(home/'.config'),'XDG_CACHE_HOME':str(home/'.cache'),'XDG_DATA_HOME':str(home/'.local/share'),'LANG':'C.UTF-8','NO_AT_BRIDGE':'1'}
   dest=home.parent/'rfbauth'
   if refresh_auth or not dest.exists():
    fd,tmp=tempfile.mkstemp(dir=home.parent,prefix='.rfbauth-');os.close(fd)
    try:
     result=subprocess.run(['x11vnc','-storepasswd',tmp],input=(password+'\n'+password+'\ny\n').encode(),env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
     if result.returncode or Path(tmp).stat().st_size!=8:raise RuntimeError('Private VNC password setup failed')
     os.chmod(tmp,0o600);os.replace(tmp,dest)
    finally:
     if os.path.exists(tmp):os.unlink(tmp)
   logs=self.root/'logs';logs.mkdir(exist_ok=True)
   children=[]
   def launch(argv):
    token=secrets.token_hex(16);r['pending']={'command':argv,'token':token};self.save(rows)
    with open(logs/(sid+'.log'),'ab') as log:
     p=subprocess.Popen(argv,env={**env,'HQ_LAUNCH_TOKEN':token},stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
    children.append(p)
    rec=identity(p.pid);r['processes'].append(rec);r.pop('pending',None);self.save(rows)
    time.sleep(.08)
    if p.poll() is not None:raise RuntimeError('Screen service failed; inspect private app log')
   try:
    launch(['Xvfb',r['display'],'-screen','0','1024x768x24','-nolisten','tcp','-auth',str(auth)])
    for _ in range(100):
     if os.path.exists(self.xsocket(n)):break
     time.sleep(.05)
    self.remember_x_artifacts(r,r['processes']);self.save(rows)
    launch(['xfwm4','--sm-client-disable','--compositor=off'])
    launch(['x11vnc','-display',r['display'],'-rfbport',str(r['vncPort']),'-localhost','-no6','-forever','-shared','-rfbauth',str(dest),'-quiet'])
    launch(['websockify','127.0.0.1:'+str(r['wsPort']),'127.0.0.1:'+str(r['vncPort'])])
    for _ in range(100):
     if self.ready(r):
      r['revision']=r.get('revision',0)+1;self.save(rows);return r
     time.sleep(.05)
    raise RuntimeError('Screen services did not become ready')
   except Exception:
    for child in children:
     if child.poll() is None:
      child.terminate()
      try:child.wait(timeout=1)
      except subprocess.TimeoutExpired:child.kill();child.wait()
    for rec in reversed(r['processes']):
     if matches(rec):stop(rec)
    self.reconcile_x_artifacts(r,r['processes'])
    r['processes']=[];r.pop('pending',None);self.save(rows);raise
 def release(self,owner):
  with self.locked():
   rows=self.read();r=next((r for r in rows if r['owner']==owner),None)
   if not r:return
   records=r['processes']+self.pending_processes(r)
   for rec in records:
    if alive(rec['pid']) and not matches(rec):raise RuntimeError('Ownership identity changed; refusing cleanup')
   self.remember_x_artifacts(r,records);self.save(rows)
   for rec in reversed(records):stop(rec)
   self.reconcile_x_artifacts(r,records)
   self.save([x for x in rows if x['owner']!=owner])
 def capture(self,sid):
  number(sid)
  with self.locked():
   r=self._ensure_locked(sid)
   from PIL import ImageGrab
   with _CAPTURE_ENV:
    old=os.environ.get('XAUTHORITY');os.environ['XAUTHORITY']=str(self.root/'screens'/str(number(sid))/'Xauthority')
    try:im=ImageGrab.grab(xdisplay=r['display'])
    finally:
     if old is None:os.environ.pop('XAUTHORITY',None)
     else:os.environ['XAUTHORITY']=old
   b=io.BytesIO();im.save(b,format='PNG')
   return {'image':base64.b64encode(b.getvalue()).decode(),'mime_type':'image/png','width':im.width,'height':im.height}
if __name__=='__main__':
 try:
  reg=Registry(os.environ['HQ_ROOT']);action=sys.argv[1];args=sys.argv[2:]
  if action=='lease':result=reg.lease(args[0],len(args)>1 and args[1]=='primary')
  elif action=='list':result=reg.list()
  elif action=='get':result=reg.get(args[0])
  elif action=='ensure':result=reg.ensure(args[0],args[1] if len(args)>1 else None)
  elif action=='release':reg.release(args[0]);result={'ok':True}
  elif action=='capture':result=reg.capture(args[0])
  else:raise ValueError('Unknown screen command')
  print(json.dumps(result))
 except Exception as e:
  print(json.dumps({'error':str(e)}));sys.exit(1)
