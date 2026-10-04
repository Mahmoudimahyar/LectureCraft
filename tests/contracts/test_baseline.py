"""Offline build-plan/document logic. These are not future application acceptance tests."""
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import check_baseline as b

class BaselineChecks(unittest.TestCase):
    def test_current_spec_is_internally_consistent(self):
        result=b.audit(ROOT)
        self.assertEqual(result['status'],'PASS',[x for x in result['results'] if not x['passed']])
    def test_dependency_order(self):
        self.assertEqual(b.topological_order([{'id':'b','dependencies':['a']},{'id':'a','dependencies':[]}]),['a','b'])
    def test_cycle_is_not_a_runnable_plan(self):
        with self.assertRaises(ValueError):b.topological_order([{'id':'a','dependencies':['b']},{'id':'b','dependencies':['a']}])
    def test_duplicate_tasks_rejected(self):
        with self.assertRaises(ValueError):b.topological_order([{'id':'a','dependencies':[]},{'id':'a','dependencies':[]}])
    def test_unknown_dependency_rejected(self):
        with self.assertRaises(ValueError):b.topological_order([{'id':'a','dependencies':['missing']}])
    def test_black_white_contrast(self):self.assertAlmostEqual(b.contrast('#000000','#FFFFFF'),21)
    def test_same_color_contrast(self):self.assertEqual(b.contrast('#ABCDEF','#ABCDEF'),1)
    def test_unsupported_color_format_rejected(self):
        with self.assertRaises(ValueError):b.contrast('white','#000000')
    def test_missing_local_doc_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'README.md').write_text('[missing](absent.md)')
            count,errors=b.relative_links(root);self.assertEqual(count,1);self.assertEqual(len(errors),1)
    def test_external_links_are_not_downloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'README.md').write_text('[source](https://example.invalid/)')
            self.assertEqual(b.relative_links(root),(0,[]))

if __name__=='__main__':unittest.main()
