"""Implementation-control tests only; not tests of the future learning application."""
from pathlib import Path
import json, os, sys, tempfile, unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import build_board as board

class BoardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve()
        (self.root/'config').mkdir()
        self.plan={'version':1,'tasks':[{'id':'LL001','title':'one','dependencies':[]},{'id':'LL002','title':'two','dependencies':['LL001']},{'id':'LL003','title':'three','dependencies':[]}]}
        self.save();(self.root/'app.py').write_text('value=1\n')
    def save(self): (self.root/'config/implementation-plan.json').write_text(json.dumps(self.plan))
    def test_status_is_read_only(self):
        s=board.status(self.root);self.assertEqual(s['runnable'],['LL001','LL003']);self.assertFalse((self.root/'.local').exists())
    def test_no_false_application_completion(self):
        self.assertEqual(board.status(self.root)['application_acceptance'],'NOT_ESTABLISHED')
    def test_unknown_dependencies_fail(self):
        self.plan['tasks'][1]['dependencies']=['NOPE'];self.save()
        with self.assertRaises(ValueError):board.plan(self.root)
    def test_cycle_fails(self):
        self.plan['tasks'][0]['dependencies']=['LL002'];self.save()
        with self.assertRaises(ValueError):board.plan(self.root)
    def test_duplicate_tasks_fail(self):
        self.plan['tasks'].append(self.plan['tasks'][0]);self.save()
        with self.assertRaises(ValueError):board.plan(self.root)
    def test_blocked_does_not_stop_independent_work(self):
        board.update(self.root,'LL001','BLOCKED','Need an actual owner schema; independent work continues')
        self.assertEqual(board.status(self.root)['runnable'],['LL003'])
    def test_blocked_requires_reason(self):
        with self.assertRaises(ValueError):board.update(self.root,'LL001','BLOCKED','')
    def test_start_requires_dependencies(self):
        with self.assertRaises(ValueError):board.update(self.root,'LL002','IN_PROGRESS','working')
    def test_test_pass_records_command_not_app(self):
        receipt=board.run_test(self.root,'LL001',[sys.executable,'-c','assert 1+1==2'],timeout=5)
        self.assertEqual(receipt['status'],'PASS')
        self.assertEqual(board.status(self.root)['tasks']['LL001']['state'],'LOCAL_TESTED')
        self.assertIn('LL002',board.status(self.root)['runnable'])
    def test_failed_command_does_not_finish_task(self):
        r=board.run_test(self.root,'LL001',[sys.executable,'-c','raise SystemExit(1)'],timeout=5)
        self.assertEqual(r['status'],'FAIL');self.assertNotEqual(board.status(self.root)['tasks']['LL001']['state'],'LOCAL_TESTED')
    def test_code_mutation_during_tests_blocks_receipt(self):
        r=board.run_test(self.root,'LL001',[sys.executable,'-c','from pathlib import Path;Path("app.py").write_text("x=2")'],timeout=5)
        self.assertEqual(r['status'],'BLOCKED')
    def test_changed_code_exposes_old_test_evidence(self):
        board.run_test(self.root,'LL001',[sys.executable,'-c','pass'],timeout=5)
        (self.root/'app.py').write_text('x=3')
        self.assertEqual(board.status(self.root)['tasks']['LL001']['test_freshness'],'STALE')
    def test_no_direct_tested_transition(self):
        with self.assertRaises(ValueError):board.update(self.root,'LL001','LOCAL_TESTED','pretend')
    def test_unknown_task(self):
        with self.assertRaises(ValueError):board.update(self.root,'LL999','IN_PROGRESS','x')
    def test_no_outside_path(self):
        for p in ['../secret','/tmp/a','a/../../x','a\\b','C:/test']:
            with self.subTest(p=p),self.assertRaises(ValueError):board.safe(self.root,p)
    def test_source_digest_ignores_runtime_and_secrets(self):
        h=board.fingerprint(self.root);(self.root/'.local').mkdir();(self.root/'.local/log.txt').write_text('x');(self.root/'.env').write_text('SECRET=example')
        self.assertEqual(h,board.fingerprint(self.root))
    def test_invalid_state_cannot_be_ignored(self):
        (self.root/'.local/build').mkdir(parents=True);(self.root/'.local/build/state.json').write_text('{bad')
        with self.assertRaises(ValueError):board.status(self.root)
    def test_plan_change_does_not_destroy_history(self):
        board.update(self.root,'LL001','IN_PROGRESS','x');self.plan['tasks'][0]['title']='new';self.save()
        with self.assertRaisesRegex(ValueError,'plan'):board.status(self.root)
    def test_stop_prevents_start(self):
        (self.root/'.local').mkdir();(self.root/'.local/STOP').touch()
        r=board.run_test(self.root,'LL001',[sys.executable,'-c','raise SystemExit(9)'],timeout=5)
        self.assertEqual(r['execution_status'],'STOPPED')
    def test_timeout_stops_only_own_process(self):
        r=board.run_test(self.root,'LL001',[sys.executable,'-c','import time;time.sleep(10)'],timeout=.1)
        self.assertEqual(r['execution_status'],'TIMEOUT')
    def test_new_tasks_no_initial_claims(self):
        self.assertTrue(all(t['state']=='TODO' for t in board.status(self.root)['tasks'].values()))
    def test_event_receipts_exist(self):
        board.update(self.root,'LL001','IN_PROGRESS','start')
        self.assertEqual(len(list((self.root/'.local/build/events').glob('*.json'))),1)
    @unittest.skipUnless(os.name=='posix','POSIX symlink fixture')
    def test_runtime_symlink_rejected(self):
        external=self.root.parent/(self.root.name+'-else');external.mkdir();self.addCleanup(external.rmdir)
        (self.root/'.local').symlink_to(external,target_is_directory=True)
        with self.assertRaises(ValueError):board.update(self.root,'LL001','IN_PROGRESS','x')
    def test_recorded_json_tampering_rejected(self):
        board.run_test(self.root,'LL001',[sys.executable,'-c','pass'],timeout=5)
        p=next((self.root/'.local/build/checks').glob('*.json'));d=json.loads(p.read_text());d['status']='FAIL';p.write_text(json.dumps(d))
        self.assertEqual(board.status(self.root)['tasks']['LL001']['test_freshness'],'INVALID')

if __name__=='__main__':unittest.main()
