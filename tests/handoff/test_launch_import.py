from pathlib import Path
import hashlib,json,os,sys,tempfile,unittest,zipfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools'))
import run_claude as launcher
import import_seed as importer
import preflight

class LaunchTests(unittest.TestCase):
    def test_preview_never_starts_native_process(self):
        with patch('subprocess.run',side_effect=AssertionError('called')):
            result=launcher.run(ROOT,None,8,100,False)
        self.assertEqual(result['status'],'PREVIEW')
    def test_budget_bounds(self):
        for hours,turns in [(0,100),(25,100),(8,-1),(8,1001)]:
            with self.assertRaises(ValueError):launcher.run(ROOT,None,hours,turns)
    def test_supported_banner(self):self.assertEqual(launcher.banner_version('2.1.285 (Claude Code)'),'2.1.285')
    def test_old_banner_rejected(self):
        with self.assertRaises(ValueError):launcher.banner_version('2.1.100')
    def test_unknown_banner_rejected(self):
        with self.assertRaises(ValueError):launcher.banner_version('newest')
    def test_safe_native_arguments(self):
        args=launcher.argv_for('claude',ROOT,'id-123',100,'prompt')
        self.assertNotIn('--dangerously-skip-permissions',args)
        self.assertNotIn('--continue',args);self.assertIn('--resume',args)
        self.assertIn('--permission-prompts',args);self.assertIn('none',args)
        self.assertIn('--strict-mcp-config',args)
    def test_bad_session_id(self):
        with self.assertRaises(ValueError):launcher.argv_for('claude',ROOT,'../else',100,'p')
    def test_terminal_result_success(self):
        self.assertEqual(launcher.terminal(json.dumps({'type':'result','subtype':'success','is_error':False,'session_id':'id-1'})),'id-1')
    def test_quota_or_error_not_retried(self):
        with self.assertRaises(ValueError):launcher.terminal(json.dumps({'type':'result','subtype':'error_max_turns','is_error':True,'session_id':'id-1'}))
    def test_permission_denial_not_silently_ignored(self):
        with self.assertRaises(ValueError):launcher.terminal(json.dumps({'type':'result','subtype':'success','is_error':False,'session_id':'id-1','permission_denials':['x']}))
    def test_nonterminal_unknown_completion(self):
        with self.assertRaises(ValueError):launcher.terminal('{"type":"progress"}')
    def test_no_session_id_no_resume(self):
        with self.assertRaises(ValueError):launcher.terminal('{"type":"result","subtype":"success","is_error":false}')
    def test_preflight_no_native_process_by_default(self):
        with patch('subprocess.run',side_effect=AssertionError('called')):
            self.assertEqual(preflight.summary(ROOT)['native_auth_permissions_roundtrip'],'NOT_CHECKED')

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.src=self.root/'source.zip';self.dst=self.root/'app';self.dst.mkdir()
    def make(self,extra=None,version='0.5.0-rc.1',tamper=False):
        files={'VERSION':version+'\n','seed.json':json.dumps({'distribution_version':version}),'AGENTS.md':'Synthetic fixture, not real Seed','LICENSE':'Fixture only','scripts/seed.py':'# never executed\n'}
        if extra:files.update(extra)
        files['MANIFEST.sha256']=''.join(hashlib.sha256(v.encode()).hexdigest()+'  '+k+'\n' for k,v in files.items())
        if tamper:files['AGENTS.md']='different'
        with zipfile.ZipFile(self.src,'w') as z:
            for k,v in files.items():z.writestr('seed-repo/'+k,v)
    def test_preview_no_writes(self):
        self.make();self.assertEqual(importer.install(self.src,self.dst)['status'],'PREVIEW');self.assertEqual(list(self.dst.iterdir()),[])
    def test_import_no_execute(self):
        self.make();r=importer.install(self.src,self.dst,True)
        self.assertEqual(r['status'],'IMPORTED_NOT_EXECUTED');self.assertTrue((self.dst/'.local/seed-source/seed-repo/scripts/seed.py').exists())
    def test_existing_import_preserved(self):
        self.make();importer.install(self.src,self.dst,True)
        with self.assertRaises(ValueError):importer.install(self.src,self.dst,True)
    def test_source_tamper_rejected(self):
        self.make(tamper=True)
        with self.assertRaises(ValueError):importer.validate_zip(self.src)
    def test_wrong_version(self):
        self.make(version='9.0')
        with self.assertRaises(ValueError):importer.validate_zip(self.src)
    def test_zip_slip(self):
        self.make(extra={'../escape':'bad'})
        with self.assertRaises(ValueError):importer.validate_zip(self.src)
    def test_secret_rejected(self):
        self.make(extra={'.env':'not a secret but forbidden'})
        with self.assertRaises(ValueError):importer.validate_zip(self.src)
    def test_unknown_payload_not_in_manifest(self):
        self.make()
        with zipfile.ZipFile(self.src,'a') as z:z.writestr('seed-repo/unlisted.md','x')
        with self.assertRaises(ValueError):importer.validate_zip(self.src)
    def test_no_discovery_other_folders(self):
        with patch('pathlib.Path.home',return_value=self.root):self.assertIsNone(importer.discover())
    def test_missing_file(self):
        with self.assertRaises(ValueError):importer.validate_zip(self.root/'missing')

if __name__=='__main__':unittest.main()
