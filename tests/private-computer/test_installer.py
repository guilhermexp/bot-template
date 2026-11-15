import unittest,tempfile,subprocess,os,tarfile,json,hmac,hashlib,shutil
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
class InstallerTests(unittest.TestCase):
 def fixture(self,tmp):
  root=Path(tmp)/'bot-template-private';root.mkdir();(root/'OWNED-BY-BOT-TEMPLATE').touch();(root/'config').mkdir();(root/'runtime').mkdir();(root/'runtime/node').symlink_to(shutil.which('node'));(root/'config/daytona.env').write_text('DAYTONA_API_KEY=fixture\n');(root/'config/app.env').write_text('SESSION_SECRET="fixture parsed secret" # comment\nPORT="8787"\n')
  payload=Path(tmp)/'payload';payload.mkdir();(payload/'current').write_text('new');archive=Path(tmp)/'app.tgz'
  with tarfile.open(archive,'w:gz') as tar:tar.add(payload/'current',arcname='current')
  return root,archive
 def run_install(self,root,arg):return subprocess.run(['bash',str(REPO/'scripts/install-on-computer.sh'),str(arg)],env=dict(os.environ,HQ_ROOT=str(root)),capture_output=True,text=True)
 def test_prepare_creates_marker_before_upload_and_rejects_unowned_root(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'bot-template-private';result=self.run_install(root,'--prepare');self.assertEqual(result.returncode,0,result.stderr);self.assertTrue((root/'OWNED-BY-BOT-TEMPLATE').is_file());self.assertTrue((root/'config').is_dir());self.assertFalse((root/'app').exists())
   foreign=Path(tmp)/'foreign/bot-template-private';foreign.mkdir(parents=True);result=self.run_install(foreign,'--prepare');self.assertNotEqual(result.returncode,0);self.assertFalse((foreign/'OWNED-BY-BOT-TEMPLATE').exists())
 def test_upgrade_retains_old_whole_app_without_leaving_stale_live_files(self):
  with tempfile.TemporaryDirectory() as tmp:
   root,archive=self.fixture(tmp);(root/'app').mkdir();old=root/'app/obsolete';old.write_text('old');old.chmod(0o640);before=old.stat();result=self.run_install(root,archive);self.assertEqual(result.returncode,0,result.stderr);self.assertFalse((root/'app/obsolete').exists());saved=list((root/'incoming').rglob('obsolete'));self.assertEqual(len(saved),1);self.assertEqual(saved[0].read_text(),'old');self.assertEqual(saved[0].stat().st_mode,before.st_mode);self.assertEqual(saved[0].stat().st_mtime_ns,before.st_mtime_ns)
 def test_mcp_uses_node_parsed_secret_and_inline_entry_updates_and_removes(self):
  import yaml
  with tempfile.TemporaryDirectory() as tmp:
   root,archive=self.fixture(tmp);result=self.run_install(root,archive);self.assertEqual(result.returncode,0,result.stderr);entry=yaml.safe_load((root/'config/hermes-mcp-hq.yaml').read_text());expected=hmac.new(b'fixture parsed secret',b'mcp:primary',hashlib.sha256).hexdigest();self.assertTrue(entry['hq']['headers']['Authorization']=='Bearer '+expected,'MCP token must match parsed secret')
   cfg=root/'hermes-primary/config.yaml';cfg.write_text('model: fixture\nmcp_servers:\n  other: {url: https://example.invalid}\n'+(root/'config/hermes-mcp-hq.yaml').read_text());env=dict(os.environ,HQ_ROOT=str(root));script=REPO/'scripts/add-hq-to-hermes.py'
   for args in [[],['--remove']]:
    result=subprocess.run(['python3',str(script),*args],env=env,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
   doc=yaml.safe_load(cfg.read_text());self.assertNotIn('hq',doc['mcp_servers']);self.assertEqual(doc['model'],'fixture');self.assertIn('other',doc['mcp_servers'])
 def test_mcp_backup_retains_metadata_of_complete_previous_entry(self):
  with tempfile.TemporaryDirectory() as tmp:
   root,archive=self.fixture(tmp);entry=root/'config/hermes-mcp-hq.yaml';entry.write_text('old complete entry');entry.chmod(0o640);os.utime(entry,ns=(1700000000123456789,1700000000123456789));old=entry.stat();result=self.run_install(root,archive);self.assertEqual(result.returncode,0,result.stderr);saved=list(entry.parent.glob('hermes-mcp-hq.yaml.before-*'));self.assertEqual(len(saved),1);self.assertEqual(saved[0].read_text(),'old complete entry');self.assertEqual(saved[0].stat().st_mtime_ns,old.st_mtime_ns);self.assertEqual(saved[0].stat().st_mode,old.st_mode)

 def test_inline_mcp_add_twice_and_remove_preserves_other_settings(self):
  import yaml
  with tempfile.TemporaryDirectory() as tmp:
   root,archive=self.fixture(tmp);(root/'hermes-primary').mkdir();entry=root/'config/hermes-mcp-hq.yaml';entry.write_text('  hq: {"url":"http://127.0.0.1:8787/mcp/primary","headers":{"Authorization":"Bearer fixture"}}\n');cfg=root/'hermes-primary/config.yaml';cfg.write_text('model: fixture\nmcp_servers:\n  other: {url: https://example.invalid}\n'+entry.read_text());env=dict(os.environ,HQ_ROOT=str(root))
   for args in [[],[],['--remove']]:
    result=subprocess.run(['python3',str(REPO/'scripts/add-hq-to-hermes.py'),*args],env=env,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
    if not args:self.assertEqual(cfg.read_text().count('  hq:'),1)
   doc=yaml.safe_load(cfg.read_text());self.assertNotIn('hq',doc['mcp_servers']);self.assertIn('other',doc['mcp_servers']);self.assertEqual(doc['model'],'fixture')

 def test_missing_private_config_fails_before_live_app_swap(self):
  with tempfile.TemporaryDirectory() as tmp:
   root,archive=self.fixture(tmp);(root/'config/daytona.env').unlink();(root/'app').mkdir();old=root/'app/live';old.write_text('keep');st=old.stat();result=self.run_install(root,archive);self.assertNotEqual(result.returncode,0);self.assertTrue(old.exists(),'live app was swapped before config validation');self.assertEqual(old.stat().st_ino,st.st_ino);self.assertFalse(list((root/'incoming').glob('app-before-*')))

if __name__=='__main__':unittest.main()
