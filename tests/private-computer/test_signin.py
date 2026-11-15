import unittest,tempfile,subprocess,os,json,threading,http.server,shutil,hmac,hashlib
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
class SignInTests(unittest.TestCase):
 def test_signin_is_private_before_writing_and_replaced_atomically(self):
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_POST(self):
    good=self.headers.get('Authorization')=='Bearer '+hmac.new(b'fixture parsed',b'owner-login',hashlib.sha256).hexdigest()
    if not good:self.send_response(403);self.end_headers();return
    self.rfile.read(int(self.headers['Content-Length']));self.send_response(200);self.end_headers();self.wfile.write(b'{"url":"https://fixture.invalid/one-use"}')
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever);thread.start()
  try:
   with tempfile.TemporaryDirectory() as tmp:
    r=Path(tmp);(r/'config').mkdir();(r/'runtime').mkdir();(r/'runtime/node').symlink_to(shutil.which('node'));(r/'config/app.env').write_text('SESSION_SECRET="fixture parsed" # comment\nPORT="'+str(server.server_port)+'" # comment\n');(r/'config/sign-in.json').write_text('old');old=(r/'config/sign-in.json').stat().st_ino
    (r/'sitecustomize.py').write_text('import os\nfrom pathlib import Path\noriginal=os.fdopen\ndef private_fd(fd,*args,**kwargs):\n Path(os.environ["HQ_ROOT"]+"/creation-mode").write_text(str(os.fstat(fd).st_mode&511))\n return original(fd,*args,**kwargs)\nos.fdopen=private_fd\n')
    result=subprocess.run(['bash',str(REPO/'scripts/sign-in-link.sh'),'fixture@example.invalid'],env=dict(os.environ,HQ_ROOT=str(r),PYTHONPATH=str(r)),capture_output=True,text=True,umask=0o022);self.assertEqual(result.returncode,0,result.stderr)
    self.assertTrue((r/'creation-mode').exists(),'sign-in must be written via an already-private descriptor');self.assertEqual((r/'creation-mode').read_text(),'384');self.assertEqual((r/'config/sign-in.json').stat().st_mode&511,0o600);self.assertNotEqual((r/'config/sign-in.json').stat().st_ino,old);self.assertEqual(json.loads((r/'config/sign-in.json').read_text())['url'],'https://fixture.invalid/one-use');self.assertNotIn('https://',result.stdout)
  finally:server.shutdown();thread.join();server.server_close()
