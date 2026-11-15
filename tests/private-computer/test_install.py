import unittest,tempfile,subprocess,os,tarfile,json,hmac,hashlib,shutil
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
class InstallTests(unittest.TestCase):
 def test_uploaded_owned_root_gets_default_mcp_entry_and_preserves_config(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp)/'bot-template-private';(r/'config').mkdir(parents=True);(r/'OWNED-BY-BOT-TEMPLATE').touch();(r/'config/daytona.env').write_text('');(r/'config/app.env').write_text('SESSION_SECRET=fixture\nPORT=9123\n')
   (r/'runtime').mkdir();(r/'runtime/node').symlink_to(shutil.which('node'))
   archive=Path(tmp)/'app.tgz'
   with tarfile.open(archive,'w:gz'):pass
   result=subprocess.run(['bash',str(REPO/'scripts/install-on-computer.sh'),str(archive)],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
   entry=r/'config/hermes-mcp-hq.yaml';self.assertTrue(entry.exists(),'installer must generate the default MCP entry');cfg=json.loads(entry.read_text().strip()[4:]);self.assertEqual(cfg['url'],'http://127.0.0.1:9123/mcp/primary');self.assertEqual(cfg['headers']['Authorization'],'Bearer '+hmac.new(b'fixture',b'mcp:primary',hashlib.sha256).hexdigest());self.assertEqual(entry.stat().st_mode&511,0o600)
   (r/'hermes-primary/config.yaml').write_text('model: untouched\nmcp_servers:\n  other:\n    url: http://localhost:1\n')
   result=subprocess.run(['python3',str(REPO/'scripts/add-hq-to-hermes.py')],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr);self.assertIn('model: untouched',(r/'hermes-primary/config.yaml').read_text());self.assertIn('  other:',(r/'hermes-primary/config.yaml').read_text());self.assertTrue(list((r/'hermes-primary').glob('config.yaml.before-hq-*')))
 def test_existing_unmarked_upload_root_is_not_adopted(self):
  with tempfile.TemporaryDirectory() as tmp:
   r=Path(tmp)/'bot-template-private';r.mkdir();result=subprocess.run(['bash',str(REPO/'scripts/install-on-computer.sh'),'unused'],env=dict(os.environ,HQ_ROOT=str(r)),capture_output=True,text=True);self.assertNotEqual(result.returncode,0);self.assertFalse((r/'OWNED-BY-BOT-TEMPLATE').exists())
