import unittest,importlib.util,os,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'server/box'
os.environ.setdefault('HQ_ROOT',tempfile.mkdtemp(prefix='hq-desk-'))
sys.path.insert(0,str(ROOT));import hqlib
spec=importlib.util.spec_from_file_location('desk',ROOT/'hq-screen.py');desk=importlib.util.module_from_spec(spec);spec.loader.exec_module(desk)
class DeskTests(unittest.TestCase):
 def test_00_base_stubs_are_scoped(self):
  originals={name:getattr(hqlib,name) for name in ['all_pids','cmdline','stop_pids']}
  self.test_base_never_changes_global_policy_or_kills_foreign_shell()
  for name,original in originals.items():self.assertIs(getattr(hqlib,name),original,name+' stub leaked')
 def test_paths_and_environment_are_private(self):
  self.assertEqual(hqlib.ROOT,os.environ['HQ_ROOT']+'/desktop')
  self.assertEqual(hqlib.PROFILES,os.environ['HQ_ROOT']+'/profiles')
  e=hqlib.base_env(100);self.assertTrue(e['HOME'].startswith(os.environ['HQ_ROOT']+'/'));self.assertTrue(e['XDG_CONFIG_HOME'].startswith(os.environ['HQ_ROOT']+'/'))
  with self.assertRaises(ValueError):hqlib.base_env(0)
 def test_base_never_changes_global_policy_or_kills_foreign_shell(self):
  from unittest.mock import patch
  from contextlib import ExitStack
  def forbidden(*a,**k):raise AssertionError('global write or foreign process kill')
  with ExitStack() as stack:
   for name,value in {'install_packages':lambda w:[], 'gtk_works':lambda:False, 'build_extension':lambda w:{}, 'start_home':lambda **k:True, 'write_policy':forbidden, 'write_gtk_settings':lambda w:None}.items():stack.enter_context(patch.object(desk,name,value,create=True))
   for name,value in {'all_pids':lambda:[12345], 'cmdline':lambda p:['python3','/foreign/hq-shell.py','100'], 'stop_pids':forbidden}.items():stack.enter_context(patch.object(hqlib,name,value))
   desk.do_base('unit',[])
 def test_reset_does_not_close_unowned_windows_on_our_display(self):
  from unittest.mock import patch
  foreign={'id':'0x123','pid':12345,'cls':'Foreign'}
  def forbidden(*a,**k):raise AssertionError('unowned window close')
  with patch.object(hqlib,'windows',return_value=[foreign]),patch.object(hqlib,'is_desktop_piece',return_value=False),patch.object(hqlib,'owned',return_value=False),patch.object(desk.shutil,'which',return_value='/usr/bin/wmctrl'),patch.object(hqlib,'run',side_effect=forbidden):
   self.assertEqual(desk.close_windows(100,False),0)
if __name__=='__main__':unittest.main()
