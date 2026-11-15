import unittest,sys,os,tempfile
from pathlib import Path
from unittest.mock import patch
os.environ.setdefault('HQ_ROOT',tempfile.mkdtemp(prefix='hq-chrome-'))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/box'));import hqlib
class ChromeTests(unittest.TestCase):
 def test_private_browser_argv_limits_background_processes_and_retains_profile(self):
  args=hqlib.browser_argv(100,'bot_test','/usr/bin/chromium')
  for flag in ['--disable-gpu','--disable-background-networking','--renderer-process-limit=1','--no-zygote'] :self.assertIn(flag,args)
  self.assertIn('--user-data-dir='+hqlib.profile_dir('bot_test'),args);self.assertIn('--remote-debugging-address=127.0.0.1',args)
 def test_exec_transition_is_adopted_only_with_same_starttime_and_own_profile(self):
  old={'pid':50,'starttime':'77','command':['/bin/sh','/usr/bin/chromium']}
  current={'pid':50,'starttime':'77','command':['/usr/lib/chromium/chromium','--user-data-dir='+hqlib.profile_dir('bot_test'),'--hq-screen=100']}
  with patch.object(hqlib,'read_json',return_value=old),patch.object(hqlib,'process_identity',return_value=current),patch.object(hqlib,'write_json') as write:
   self.assertTrue(hqlib.refresh_browser_identity(50,'bot_test',100));self.assertEqual(write.call_args.args[1],current)
   current['starttime']='88';self.assertFalse(hqlib.refresh_browser_identity(50,'bot_test',100));self.assertEqual(write.call_count,1)

 def test_unpacked_home_is_detected_via_running_browser_not_crx_install_directory(self):
  from unittest.mock import patch
  warnings=[];clock=iter(range(0,1000,10))
  with patch.object(hqlib,'extension_id',return_value='public-extension-id'),patch.object(hqlib.os.path,'isdir',return_value=False),patch.object(hqlib.time,'time',side_effect=lambda:next(clock)),patch.object(hqlib.time,'sleep'),patch.object(hqlib,'look_for',return_value={'bot':{'name':'Doug'}}),patch.object(hqlib,'cdp',return_value=[{'type':'page','id':'tab','title':'Doug','url':'chrome://newtab/'}]):
   hqlib._show_home(100,'bot_test',warnings,lambda *a:None)
   self.assertEqual(warnings,[])

 def test_plain_tab_close_reads_raw_cdp_response(self):
  pages=iter([[{'type':'page','id':'plain','title':'New Tab','url':'chrome://newtab/'}],[{'type':'page','id':'home','title':'Home','url':'chrome://newtab/'}]])
  def cdp(n,path,method='GET'):
   if path=='/json/list':return next(pages)
   if path.startswith('/json/close/'):raise ValueError('close response is not JSON')
   return {'id':'home'}
  warnings=[]
  with patch.object(hqlib,'look_for',return_value={'bot':{'name':'Doug'}}),patch.object(hqlib,'cdp',side_effect=cdp),patch.object(hqlib.time,'sleep'),patch.object(hqlib.urllib.request,'urlopen') as opened:
   hqlib._show_home(100,'bot_test',warnings,lambda *a:None)
   self.assertEqual(warnings,[]);self.assertTrue(opened.called)
