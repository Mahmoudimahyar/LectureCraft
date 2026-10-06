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


def _token(**changes):
    """A small synthetic token file in the shape of docs/project/design-tokens.json (version 2)."""
    palette={'background':'#FFFFFF','surface':'#F0F0F0','surface_raised':'#E0E0E0','text':'#000000','tint':'#DDEEFF','faint':'#FAFAFA'}
    token={'light':dict(palette),'dark':dict(palette),
           'wash_pct':{'ink':'text','light':{'pad':5,'none':0,'full':100},'dark':{'pad':7,'none':0,'full':100}},
           'contrast_pairs':[{'fg':['text'],'bg':['background','pad@*'],'min':4.5}],
           'typography':{'scale_from_px':[0,900,1440,1920,2400],'scale_px':{
               'micro':{'size':[12,12,12,12,13],'line':[16,16,16,16,18]},
               'ui':{'size':[14,14,14,15,16],'line':[20,20,20,22,24]},
               'read':{'size':[16,16,16,17,18],'line':[24,24,24,26,28]}}}}
    token.update(changes)
    return token


class DeclaredContrastPairs(unittest.TestCase):
    """The pairs a token file declares for itself: derived colours and translucent washes (design spec 3.5, 3.6)."""
    def test_a_wash_of_nothing_is_its_ground_and_a_full_wash_is_the_ink(self):
        self.assertEqual(b.composite('#15213A',0,'#F2F4F8'),'#F2F4F8')
        self.assertEqual(b.composite('#15213A',100,'#F2F4F8'),'#15213A')
    def test_a_wash_is_mixed_per_channel(self):
        self.assertEqual(b.composite('#000000',50,'#FFFFFF'),'#808080')
        self.assertEqual(b.resolve(_token(),'light','none@surface'),'#F0F0F0')
        self.assertEqual(b.resolve(_token(),'light','full@surface'),'#000000')
    def test_a_wash_over_every_ground_expands_to_the_three_grounds_and_a_plain_key_stays(self):
        self.assertEqual(b.expand_pairs(_token()),[('text','background',4.5),('text','pad@background',4.5),('text','pad@surface',4.5),('text','pad@surface_raised',4.5)])
    def test_every_declared_pair_is_measured_in_both_themes(self):
        rows=b.declared_pair_ratios(_token(),b.contrast)
        self.assertEqual(len(rows),8)
        self.assertEqual({x['theme'] for x in rows},{'light','dark'})
        self.assertTrue(all(x['ratio']>=x['minimum'] for x in rows))
        self.assertAlmostEqual(next(x for x in rows if x['theme']=='light' and x['bg']=='background')['ratio'],21)
    def test_a_pair_under_its_floor_is_reported_with_its_theme_and_names(self):
        rows=b.declared_pair_ratios(_token(contrast_pairs=[{'fg':['faint'],'bg':['background'],'min':4.5}]),b.contrast)
        failed=[x for x in rows if x['ratio']<x['minimum']]
        self.assertEqual([(x['theme'],x['fg'],x['bg'],x['minimum']) for x in failed],[('light','faint','background',4.5),('dark','faint','background',4.5)])
    def test_a_pair_naming_a_colour_that_is_not_opaque_hex_is_refused(self):
        token=_token(contrast_pairs=[{'fg':['text'],'bg':['tint'],'min':4.5}]);token['dark']['tint']='rgb(0 0 0 / 0.1)'
        with self.assertRaises(ValueError):b.declared_pair_ratios(token,b.contrast)
    def test_a_pair_naming_an_undeclared_key_is_refused(self):
        with self.assertRaises(KeyError):b.declared_pair_ratios(_token(contrast_pairs=[{'fg':['absent'],'bg':['background'],'min':3}]),b.contrast)


class DeclaredTypeScale(unittest.TestCase):
    """The declared type scale stays inside the bounds of design-system R2 (R2-V7)."""
    def scale(self,role,**row):
        token=_token();token['typography']['scale_px'][role]={**token['typography']['scale_px'].get(role,{}),**row};return token
    def test_a_complete_scale_has_no_problems(self):
        self.assertEqual(b.scale_problems(_token()),[])
    def test_a_reading_size_of_fifteen_is_reported(self):
        self.assertIn('read must be 16-18 px with a line height of at least 1.45',b.scale_problems(self.scale('read',size=[15,16,16,17,18])))
    def test_a_reading_line_height_under_the_floor_is_reported(self):
        self.assertIn('read must be 16-18 px with a line height of at least 1.45',b.scale_problems(self.scale('read',line=[23,24,24,26,28])))
    def test_a_size_under_twelve_is_reported(self):
        self.assertIn('micro goes under 12 px',b.scale_problems(self.scale('micro',size=[11,12,12,12,13])))
    def test_an_eighth_size_at_one_width_is_reported(self):
        token=_token()
        for index,size in enumerate((19,20,21,22,23)):token['typography']['scale_px'][f'extra{index}']={'size':[size,14,14,15,16],'line':[size+6,20,20,22,24]}
        self.assertEqual(b.scale_problems(token),['more than seven sizes from 0 px'])
    def test_a_row_with_four_values_is_reported(self):
        self.assertIn('ui.size needs one whole-pixel value per breakpoint',b.scale_problems(self.scale('ui',size=[14,14,15,16])))
    def test_a_fractional_size_is_reported(self):
        self.assertIn('ui.size needs one whole-pixel value per breakpoint',b.scale_problems(self.scale('ui',size=[14,14,14,15.5,16])))
    def test_breakpoints_must_start_at_zero_and_rise(self):
        token=_token();token['typography']['scale_from_px']=[0,1440,900,1920,2400]
        self.assertIn('scale_from_px must start at 0 and rise',b.scale_problems(token))

if __name__=='__main__':unittest.main()
