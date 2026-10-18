import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('launcher',Path(__file__).with_name('launcher.py'))
launcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_platform_data_paths(self):
        self.assertEqual(launcher.data_directory('darwin',Path('/home/person'),{}),Path('/home/person/Library/Application Support/ChanyangScoreStudio'))
        self.assertEqual(launcher.data_directory('win32',Path('C:/Users/person'),{'LOCALAPPDATA':'C:/Local'}),Path('C:/Local/ChanyangScoreStudio'))
    def test_settings_allowlist_and_no_legacy_environment(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            environment=launcher.child_environment(directory,{'AI_API_KEY':'wrong-legacy','OTHER_SECRET':'discard','PATH':'/bin'})
            self.assertNotIn('OTHER_SECRET',environment)
            self.assertEqual(environment['AI_API_KEY'],'')
            self.assertEqual(environment['AI_BASE_URL'],'https://openrouter.ai/api/v1')
            self.assertEqual(environment['AI_MODEL'],'openai/gpt-6.1-sol')
            self.assertEqual(environment['HOST'],'127.0.0.1')
            (directory/'settings.json').write_text('{"provider":"openai","model":"gpt-6.1-sol","apiKey":"saved-private"}')
            environment=launcher.child_environment(directory,{'PATH':'/bin'})
            self.assertEqual(environment['AI_API_KEY'],'saved-private')
            self.assertEqual(environment['AI_BASE_URL'],'https://api.openai.com/v1')
    def test_invalid_settings_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            settings=directory/'settings.json'
            settings.write_text('{"provider":"other","model":"ok","apiKey":"secret"}')
            with self.assertRaises(launcher.LaunchError):launcher.child_environment(directory,{})
            settings.unlink();settings.symlink_to(directory/'missing')
            with self.assertRaises(launcher.LaunchError):launcher.child_environment(directory,{})
    def test_port_is_available_after_previous_app_closed(self):
        import socket
        server=socket.socket();server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind(('127.0.0.1',0));server.listen()
        port=server.getsockname()[1];client=socket.create_connection(('127.0.0.1',port));connection,_=server.accept()
        connection.close();client.close();server.close()
        self.assertTrue(launcher.available(port))
    def test_stop_children_stops_only_children_owned_by_launcher(self):
        import subprocess,sys
        child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
        launcher.stop_children([child]);self.assertIsNotNone(child.poll())

if __name__=='__main__':unittest.main()
