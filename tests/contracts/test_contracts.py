"""Design-contract tests only; no native client, Drive, model or academic writer calls."""
from pathlib import Path
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import check_contracts as c

class ContractExamples(unittest.TestCase):
    def test_declared_examples(self):
        for case in c.load(ROOT/'fixtures/contracts/cases.json')['cases']:
            with self.subTest(case=case['id']):
                errors=c.validate(case['schema'],c.load(ROOT/case['fixture']))
                self.assertEqual(not errors,case['expected_valid'],errors)
    def test_duplicate_json_keys_fail(self):
        with self.assertRaises(ValueError): c.parse('{"x":1,"x":2}')
    def test_non_finite_json_fails(self):
        with self.assertRaises(ValueError): c.parse('{"x":NaN}')
    def test_missing_schema_not_downloaded(self):
        with self.assertRaises(ValueError): c.validate('remote-unknown',{})
    def test_wire_version_not_guessed(self):
        x=c.load(ROOT/'fixtures/contracts/request.valid.json');x['contract']='ll.request/2'
        self.assertTrue(c.validate('request',x))
    def test_notes_response_not_unaided(self):
        x=c.load(ROOT/'fixtures/contracts/submission.valid.json')
        self.assertEqual(x['conditions']['assistance_before_answer'],'unknown')
    def test_same_request_retry_different_dispatch_not_new_input(self):
        x=c.load(ROOT/'fixtures/contracts/request.valid.json')
        self.assertEqual(c.validate('request',x),[])
        self.assertEqual(x['logical_input_id'],'input-fixture')
    def test_windows_reserved_path_fails(self):
        x=c.load(ROOT/'fixtures/contracts/request.valid.json');x['payload']['path']='CON'
        self.assertTrue(c.validate('request',x))
    def test_trailing_space_path_fails(self):
        x=c.load(ROOT/'fixtures/contracts/request.valid.json');x['payload']['path']='x /a.json'
        self.assertTrue(c.validate('request',x))
    def test_reverse_line_range_fails(self):
        x=c.load(ROOT/'fixtures/contracts/message.valid.json');x['sources'][0]['locator']={'kind':'lines','start':8,'end':2}
        self.assertTrue(c.validate('message',x))
    def test_attachment_response_requires_attachment(self):
        x=c.load(ROOT/'fixtures/contracts/submission.valid.json');x['response']['kind']='attachment'
        self.assertTrue(c.validate('submission',x))
    def test_transcript_needs_revision(self):
        x=c.load(ROOT/'fixtures/contracts/submission.valid.json');x['response']['kind']='voice_transcript'
        self.assertTrue(c.validate('submission',x))
    def test_completed_failure_code_forbidden(self):
        x=c.load(ROOT/'fixtures/contracts/native-result.valid.json');x['failure_code']='hidden-error'
        self.assertTrue(c.validate('native-result',x))
    def test_confirmed_link_needs_reviewer(self):
        x=c.load(ROOT/'fixtures/contracts/annotation.valid.json');x['review_state']='confirmed'
        self.assertTrue(c.validate('annotation',x))
    def test_readiness_not_approval(self):
        x=c.load(ROOT/'fixtures/contracts/request.valid.json');x['approved']=True
        self.assertTrue(c.validate('request',x))

class CrossRecordChecks(unittest.TestCase):
    def setUp(self):
        self.req=c.load(ROOT/'fixtures/contracts/request.valid.json')
        self.question=c.load(ROOT/'fixtures/contracts/message.valid.json')
        self.question.update(role='learner_question',assessment_disposition='not_assessed')
    def test_valid_question(self):self.assertEqual(c.validate_payload(self.req,self.question),[])
    def test_wrong_course_fails(self):
        self.question['scope']['course_id']='other-course'
        self.assertTrue(c.validate_payload(self.req,self.question))
    def test_wrong_thread_fails(self):
        self.question['thread_key']='other-thread'
        self.assertTrue(c.validate_payload(self.req,self.question))
    def test_tutor_output_not_learner_input(self):
        self.question['role']='tutor'
        self.assertTrue(c.validate_payload(self.req,self.question))
    def test_help_cannot_claim_canonical_assessment(self):
        self.question['assessment_disposition']='canonical_saved'
        self.assertTrue(c.validate_payload(self.req,self.question))
    def test_submitted_answer_not_help_question(self):
        payload=c.load(ROOT/'fixtures/contracts/submission.valid.json')
        self.assertTrue(c.validate_payload(self.req,payload))
    def test_valid_explanation(self):
        self.req['action']='explain'
        self.assertEqual(c.validate_payload(self.req,c.load(ROOT/'fixtures/contracts/submission.valid.json')),[])
    def test_diagnostic_requires_actual_diagnostic_submission(self):
        self.req['action']='diagnose';p=c.load(ROOT/'fixtures/contracts/submission.valid.json')
        self.assertTrue(c.validate_payload(self.req,p))
        p['interaction']='diagnostic_answer';self.assertEqual(c.validate_payload(self.req,p),[])
    def test_wrong_logical_response_fails(self):
        self.req['action']='explain';p=c.load(ROOT/'fixtures/contracts/submission.valid.json')
        p['logical_input_id']='another-response';self.assertTrue(c.validate_payload(self.req,p))
    def test_control_outer_action_cannot_disagree(self):
        self.req['action']='save_note';p=c.load(ROOT/'fixtures/contracts/control.valid.json')
        self.assertTrue(c.validate_payload(self.req,p))
    def test_valid_note_is_not_a_learning_record(self):
        self.req['action']='save_note';p=c.load(ROOT/'fixtures/contracts/control.note.valid.json')
        self.assertEqual(c.validate_payload(self.req,p),[])
    def test_valid_cancel_is_only_a_request(self):
        self.req['action']='cancel';p=c.load(ROOT/'fixtures/contracts/control.valid.json')
        self.assertEqual(c.validate_payload(self.req,p),[])
    def test_resume_device_mismatch_fails(self):
        self.req['action']='resume';p=c.load(ROOT/'fixtures/contracts/resume.valid.json')
        p['device_id']='other-device';self.assertTrue(c.validate_payload(self.req,p))
    def test_overflow_number_not_admitted(self):
        with self.assertRaises(ValueError):c.parse('{"number":1e9999}')
    def test_direct_nonfinite_data_not_admitted(self):
        p=c.load(ROOT/'fixtures/contracts/request.valid.json');p['sequence']=float('inf')
        self.assertTrue(c.validate('request',p))

class BundleChecks(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
        self.root=Path(self.t.name);self.path=self.root/'payload.json';self.path.write_bytes(b'{"synthetic":true}')
        self.bundle=c.load(ROOT/'fixtures/contracts/bundle.valid.json')
        self.bundle['files']=[c.artifact(self.path,'payload.json','application/json')]
    def test_valid_bytes(self):self.assertEqual(c.verify_files(self.root,self.bundle),[])
    def test_changed_bytes(self):
        self.path.write_bytes(b'{"changed":true}');self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_missing_bytes(self):
        self.path.unlink();self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_length_mismatch(self):
        self.bundle['files'][0]['bytes']+=1;self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_extra_files_not_part_of_payload(self):
        (self.root/'secret').write_text('synthetic-not-in-manifest')
        self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_traversal(self):
        self.bundle['files'][0]['path']='../escape';self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_symlink(self):
        self.path.unlink();self.path.symlink_to(self.root/'missing');self.assertTrue(c.verify_files(self.root,self.bundle))
    def test_same_name_different_case(self):
        self.bundle['files'].append(copy.deepcopy(self.bundle['files'][0]));self.bundle['files'][1]['path']='PAYLOAD.json'
        self.assertTrue(c.validate('bundle',self.bundle))

if __name__=='__main__':unittest.main()
