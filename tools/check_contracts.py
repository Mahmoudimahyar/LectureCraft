#!/usr/bin/env python3
"""Offline reference checks for the NEW design contracts and synthetic fixtures.

Not a dispatcher, native client, authorizer, canonical writer, or replacement for
course-learning-v1. Runtime file races and adversarial processes need OS controls.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import hashlib
import json
import math
import re
import sys
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT=Path(__file__).resolve().parents[1]
MAX_JSON_BYTES=4_000_000
RESERVED={'con','nul','prn','aux',*(f'com{x}' for x in range(1,10)),*(f'lpt{x}' for x in range(1,10))}

def parse(raw: str):
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate JSON property: '+key)
            result[key]=value
        return result
    def invalid(value):raise ValueError('Non-finite JSON value: '+value)
    def finite(value):
        number=float(value)
        if not math.isfinite(number): raise ValueError('Non-finite JSON number')
        return number
    return json.loads(raw,object_pairs_hook=unique,parse_constant=invalid,parse_float=finite)

def load(path: Path):
    if path.stat().st_size>MAX_JSON_BYTES:raise ValueError('JSON size limit')
    return parse(path.read_text(encoding='utf-8'))

def _schemas():
    docs=[load(p) for p in (ROOT/'contracts/v1').glob('*.schema.json')]
    return {s['$id'].rsplit('/',1)[-1].removesuffix('.schema.json'):s for s in docs}, Registry().with_resources((s['$id'],Resource.from_contents(s)) for s in docs)
SCHEMAS, REGISTRY=_schemas()

def walk(value):
    yield value
    if isinstance(value,dict):
        for v in value.values():yield from walk(v)
    elif isinstance(value,list):
        for v in value:yield from walk(v)

def safe_relative(name: str)->bool:
    if not isinstance(name,str) or not name or name.startswith('/') or any(c in name for c in '\\:') or any(ord(c)<32 or ord(c)==127 for c in name):return False
    return all(p not in {'','.','..'} and not p.endswith((' ','.')) and p.split('.')[0].lower() not in RESERVED for p in name.split('/'))

def semantic(name: str,v: dict)->list[str]:
    errors=[]
    for node in walk(v):
        if not isinstance(node,dict):continue
        if 'path' in node and not safe_relative(node['path']):errors.append('Unsafe portable relative artifact path')
        if node.get('kind')=='media' and node['end_ms']<=node['start_ms']:errors.append('Media interval must be nonempty and ordered')
        if node.get('kind')=='lines' and node['end']<node['start']:errors.append('Line range must be ordered')
        if node.get('kind')=='figure':
            x,y,w,h=node['xywh']
            if w<=0 or h<=0 or x+w>1 or y+h>1:errors.append('Figure box outside page or empty')
    if name=='request' and v['expires_at'] is not None:
        if datetime.fromisoformat(v['expires_at'])<=datetime.fromisoformat(v['submitted_at']):errors.append('Request expires before submission')
    if name=='bundle':
        names=[a['path'] for a in v['files']]
        if len({p.casefold() for p in names})!=len(names):errors.append('Duplicate/case-colliding bundle paths')
        if v['record_path'] not in names:errors.append('Entry record missing from manifest')
        if any(p in {'ready.json','ready.sig.json'} for p in names):errors.append('Manifest/signature cannot hash themselves')
        if sum(a['bytes'] for a in v['files'])>268435456:errors.append('Bundle byte limit exceeded')
    if name in {'submission','review-item'}:
        q=v['question']
        if (q['family_id'] is None)!=(q['family_revision'] is None):errors.append('Family ID/revision must be paired')
    if name=='submission':
        r=v['response']
        if (v['time_basis']=='unknown')!=(v['occurred_at'] is None):errors.append('Unknown occurrence time must remain null')
        if r['text'] is None and not r['attachments']:errors.append('Actual response missing')
        if r['kind']=='attachment' and not r['attachments']:errors.append('Attachment response needs content')
        if r['kind'] in {'text','voice_transcript'} and r['text'] is None:errors.append('Text/transcript response missing text')
        if r['kind']=='voice_transcript' and r['transcription_revision'] is None:errors.append('Transcript needs revision identity')
    if name=='message' and v['role']=='learner_question' and v['assessment_disposition']!='not_assessed':
        errors.append('A submitted help question is not a graded learner attempt')
    if name=='control' and v['command']['kind']=='cancel' and v['command']['target_request_id']==v['request_id']:
        errors.append('Cancellation must target an earlier different request')
    if name=='native-result':
        if v['terminal']!=(v['state']!='completion_unknown'):errors.append('Terminal status inconsistent')
        if v['state']=='completed' and (not v['output_files'] or v['failure_code'] is not None):errors.append('Completed result lacks valid output or carries failure')
        if v['state']=='failed' and v['failure_code'] is None:errors.append('Failure requires reason code')
    if name=='publication':
        saved=v['status'] in {'saved','already_saved'}
        if saved!=(v['canonical_record'] is not None):errors.append('Canonical reference inconsistent with save status')
        if saved and v['kind']=='none':errors.append('Nonassessment action cannot pretend it published evidence')
        if saved and v['kind'] in {'attempt','assessment_revision'} and v['captured_submission'] is None:errors.append('Full input reference required')
        if v['status']=='not_requested' and v['kind']!='none':errors.append('Not-requested publication must be none')
    if name=='annotation':
        if v['review_state']=='confirmed' and v['reviewer_ref'] is None:errors.append('Confirmed annotation requires accountable review')
        if v['relation'] in {'displayed_during','discussed_during'} and v['to']['locator']['kind']!='media':errors.append('Timing relationship requires media target')
        if (v['revision']==1)!=(v['supersedes'] is None):errors.append('Annotation revision predecessor required')
    if name=='review-item':
        if v['selection']=='active' and (v['scheduler_config'] is None or v['question']['family_id'] is None):errors.append('Active assessed item needs family and scheduler')
        if (v['revision']==1)!=(v['supersedes'] is None):errors.append('Review revision predecessor required')
    if name=='review-event':
        if v['apply_schedule'] and (v['attempt'] is None or v['rating'] is None or v['rating_basis']=='unresolved' or v['assistance_before_answer']!='none_reported'):errors.append('No automatic schedule update without supported unassisted observed rating')
        if v['rating_basis']=='unresolved' and v['rating'] is not None:errors.append('Unresolved rating cannot choose score')
    if name=='view':
        paths=[a['path'] for a in v['outputs']]
        if len(paths)!=len(set(paths)):errors.append('Duplicate output')
    return errors

def validate(name:str,value:dict)->list[str]:
    if name not in SCHEMAS or name=='common':raise ValueError('Unknown local schema; network retrieval disabled')
    if any(isinstance(x,float) and not math.isfinite(x) for x in walk(value)):
        return ['Non-finite value in record']
    errors=[e.message for e in Draft202012Validator(SCHEMAS[name],registry=REGISTRY,format_checker=FormatChecker()).iter_errors(value)]
    return errors if errors else semantic(name,value)


def validate_payload(request:dict,payload:dict)->list[str]:
    """Cross-record intent checks only. Bytes, signature, permission and current owner
    revision checks are independent prerequisites before a runtime executes anything.
    """
    errors=validate('request',request)
    if errors:return errors
    target=load(ROOT/'contracts/index.json')['action_payloads'][request['action']]
    errors=validate(target,payload)
    if errors:return errors
    if payload['scope']!=request['scope']: errors.append('Payload course/term differs from request')
    if target=='message':
        if payload['request_id']!=request['request_id'] or payload['thread_key']!=request['thread_key']:
            errors.append('Question request/thread identity mismatch')
        if payload['role']!='learner_question' or payload['assessment_disposition']!='not_assessed':
            errors.append('Ask action requires an unassessed learner question')
    if target=='submission':
        if payload['logical_input_id']!=request['logical_input_id']: errors.append('Logical learner input mismatch')
        required={'explain':'explain_back','practice':'practice','diagnose':'diagnostic_answer','review_answer':'review_answer'}
        if payload['interaction']!=required[request['action']]: errors.append('Response activity differs from request')
    if target=='control':
        if payload['request_id']!=request['request_id']: errors.append('Control request identity mismatch')
        if payload['command']['kind']!=request['action']: errors.append('Control action differs from outer request')
    if target=='resume' and payload['device_id']!=request['device_id']: errors.append('Resume belongs to another device')
    return errors


def artifact(path:Path,relative:str,media_type:str)->dict:
    data=path.read_bytes()
    return {'path':relative,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'media_type':media_type}

def verify_files(root:Path,bundle:dict)->list[str]:
    errors=validate('bundle',bundle)
    if errors:return errors
    if root.is_symlink():return ['Bundle root is a symlink']
    root=root.resolve();listed={f['path'] for f in bundle['files']}
    for entry in bundle['files']:
        path=root
        for part in entry['path'].split('/'):
            path=path/part
            if path.is_symlink():errors.append('Symlink in artifact path');break
        else:
            try:
                if not path.is_file() or path.stat().st_size!=entry['bytes']:errors.append('Missing artifact or length mismatch');continue
                if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:errors.append('Artifact digest mismatch')
            except OSError:errors.append('Unreadable artifact')
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    if actual-{'ready.json','ready.sig.json'}!=listed:errors.append('Bundle contains missing or unlisted files')
    return errors

def main():
    cases=load(ROOT/'fixtures/contracts/cases.json')['cases'];passed=[]
    for item in cases:
        errors=validate(item['schema'],load(ROOT/item['fixture']))
        passed.append({'id':item['id'],'passed':(not errors)==item['expected_valid'],'expected_valid':item['expected_valid'],'errors':errors})
    result={'status':'PASS' if all(c['passed'] for c in passed) else 'FAIL','cases':len(passed),'results':passed,
            'boundary':'Offline synthetic schema/semantic checks only. No real academic writer, signature authorization, native dispatch or Drive tested.'}
    print(json.dumps(result,indent=2));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
