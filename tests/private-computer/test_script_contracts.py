import unittest,tempfile,subprocess,os,re,importlib.util
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
class ScriptContracts(unittest.TestCase):
 def test_unknown_service_action_is_rejected_before_loading_or_starting(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'OWNED-BY-BOT-TEMPLATE').touch()
   result=subprocess.run(['python3',str(REPO/'scripts/private-service.py'),'stopp','app'],env=dict(os.environ,HQ_ROOT=str(root)),capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertIn('Unknown action',result.stderr);self.assertNotIn('Traceback',result.stderr)
 def test_service_rejects_unmarked_root_even_with_the_expected_name(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'bot-template-private';root.mkdir()
   for marker in [False,True]:
    if marker:(root/'OWNED-BY-BOT-TEMPLATE').mkdir()
    result=subprocess.run(['python3',str(REPO/'scripts/private-service.py'),'start','app'],env=dict(os.environ,HQ_ROOT=str(root)),capture_output=True,text=True)
    self.assertNotEqual(result.returncode,0);self.assertIn('OWNED-BY-BOT-TEMPLATE',result.stderr);self.assertNotIn('Traceback',result.stderr)
 def test_mcp_help_without_root_and_actionable_missing_root_error(self):
  env=dict(os.environ);env.pop('HQ_ROOT',None)
  help_result=subprocess.run(['python3',str(REPO/'scripts/add-hq-to-hermes.py'),'--help'],env=env,capture_output=True,text=True);self.assertEqual(help_result.returncode,0,help_result.stderr);self.assertIn('--entry',help_result.stdout)
  result=subprocess.run(['python3',str(REPO/'scripts/add-hq-to-hermes.py')],env=env,capture_output=True,text=True);self.assertNotEqual(result.returncode,0);self.assertIn('Set HQ_ROOT',result.stderr);self.assertNotIn('Traceback',result.stderr)
 def test_direct_test_entrypoints_run_every_discovered_class(self):
  for name in ['test_registry','test_service']:
   with self.subTest(name=name):
    file=REPO/'tests/private-computer'/(name+'.py');spec=importlib.util.spec_from_file_location('entry_'+name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);expected=unittest.defaultTestLoader.loadTestsFromModule(module).countTestCases()
    result=subprocess.run(['python3',str(file)],capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr);match=re.search(r'Ran (\d+) tests?',result.stderr);self.assertIsNotNone(match);self.assertEqual(int(match[1]),expected,name+' omitted later classes')
if __name__=='__main__':unittest.main()
