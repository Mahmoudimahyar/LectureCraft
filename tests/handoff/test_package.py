from pathlib import Path
import json,sys,unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools'))
import build_board

class PackageTests(unittest.TestCase):
    def test_every_original_task_has_build_facet(self):
        a=json.loads((ROOT/'docs/delivery/backlog.json').read_text())['tasks']
        b=build_board.plan(ROOT)[0]['tasks']
        self.assertEqual({t['id'] for t in a},{t['id'] for t in b});self.assertEqual(len(b),38)
    def test_release_gates_preserved(self):
        a={t['id']:t for t in json.loads((ROOT/'docs/delivery/backlog.json').read_text())['tasks']}
        for t in build_board.plan(ROOT)[0]['tasks']:self.assertEqual(t['original_release_gates'],a[t['id']]['required_gates'])
    def test_unverified_live_proofs_do_not_block_local_coordinator(self):
        t=next(t for t in build_board.plan(ROOT)[0]['tasks'] if t['id']=='LL021')
        self.assertNotIn('LL019',t['dependencies']);self.assertNotIn('LL020',t['dependencies'])
    def test_original_final_acceptance_keeps_live_requirement(self):
        a={t['id']:t for t in json.loads((ROOT/'docs/delivery/backlog.json').read_text())['tasks']}
        self.assertIn('LL035',a['LL038']['dependencies'])
    def test_goal_under_documented_limit(self):
        text=(ROOT/'PROMPTS/START_WITH_GOAL.txt').read_text()
        self.assertTrue(text.startswith('/goal '));self.assertLessEqual(len(text),4000)
    def test_full_scope_not_old_slice(self):
        text=(ROOT/'PROMPTS/IMPLEMENT_ALL.md').read_text()
        self.assertIn('all 38 task',text);self.assertIn('not just\nLL-S01',text)
    def test_no_copy_credentials_as_setup(self):
        text=(ROOT/'docs/operations/native-setup-report.md').read_text()
        self.assertIn('No speculative toggle', (ROOT/'docs/implementation/reports.md').read_text())
        self.assertIn('No global',text);self.assertIn('token',text)
    def test_actual_seed_absence_is_explicit(self):
        state=json.loads((ROOT/'IMPLEMENTATION.json').read_text())
        self.assertEqual(state['foundation']['status'],'RAW_ARCHIVE_UNAVAILABLE_IN_THIS_EXPORT')
        self.assertFalse((ROOT/'scripts/seed.py').exists())
    def test_native_launcher_inherits_no_mcp(self):
        self.assertEqual(json.loads((ROOT/'config/claude-build-mcp.json').read_text()),{'mcpServers':{}})
    def test_theme_refs_available(self):
        self.assertTrue((ROOT/'assets/design/light-dark-workspace-reference.png').exists())
        self.assertTrue((ROOT/'assets/design/source-first-layout-reference.png').exists())
    def test_original_live_gate_not_self_approved(self):
        gates=json.loads((ROOT/'docs/delivery/activation-gates.json').read_text())['gates']
        self.assertTrue(all(x['state']=='NOT_CLEARED' for x in gates))
    def test_source_snapshot_not_production(self):
        state=json.loads((ROOT/'BASELINE.json').read_text());self.assertIsNone(state['app_version'])

if __name__=='__main__':unittest.main()
