#!/usr/bin/env python3
"""Read-only structural checks for this design baseline, not the unbuilt application."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit
sys.dont_write_bytecode=True
from jsonschema import Draft202012Validator
from check_contracts import ROOT, load, validate


def topological_order(tasks: list[dict]) -> list[str]:
    ids=[t['id'] for t in tasks]
    if len(set(ids))!=len(ids):raise ValueError('Duplicate task ID')
    pending={t['id']:set(t['dependencies']) for t in tasks}
    if any(deps-set(ids) for deps in pending.values()):raise ValueError('Unknown task dependency')
    order=[]
    while pending:
        ready=sorted(k for k,v in pending.items() if not v)
        if not ready:raise ValueError('Cyclic task dependencies')
        order+=ready
        for k in ready:del pending[k]
        for deps in pending.values():deps.difference_update(ready)
    return order


def contrast(a: str,b: str) -> float:
    """sRGB luminance contrast, WCAG 2.2. Only these solid token pairs are measured."""
    def luminance(value):
        if not re.fullmatch(r'#[a-fA-F0-9]{6}',value):raise ValueError('Expected opaque sRGB hex token')
        channels=[int(value[i:i+2],16)/255 for i in (1,3,5)]
        linear=[x/12.92 if x<=0.04045 else ((x+.055)/1.055)**2.4 for x in channels]
        return sum(x*w for x,w in zip(linear,(.2126,.7152,.0722)))
    x,y=sorted((luminance(a),luminance(b)))
    return (y+.05)/(x+.05)


def relative_links(root: Path) -> tuple[int,list[str]]:
    errors=[];count=0
    for path in root.rglob('*.md'):
        if any(part.startswith('__') or part in {'.git','.local','.seed-local','.venv','node_modules','dist','coverage','test-results','playwright-report'} for part in path.parts):continue
        text=re.sub(r'```.*?```','',path.read_text(encoding='utf-8'),flags=re.S)
        for match in re.finditer(r'\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)',text):
            target=match[1].strip().strip('<>')
            if not target or target.startswith('#'):continue
            if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',target):continue
            if ' "' in target:target=target.split(' "',1)[0]
            name=unquote(urlsplit(target).path)
            if not name:continue
            resolved=(path.parent/name).resolve();count+=1
            if not resolved.is_relative_to(root.resolve()) or not resolved.exists():
                errors.append(path.relative_to(root).as_posix()+' → '+target)
    return count,errors


def audit(root:Path=ROOT,check_manifest=False):
    results=[]
    def check(name,condition,detail=None):
        results.append({'check':name,'passed':bool(condition),'detail':detail})
    def unique(items,key='id'):return len(items)==len({x[key] for x in items})
    def read(name):return load(root/name)
    all_files=[p for p in root.rglob('*') if p.is_file() and not any(x in {'__pycache__','.pytest_cache','.git','.local','.seed-local','.venv','node_modules','dist','coverage','test-results','playwright-report'} for x in p.parts)]
    parsed=[];syntax=[]
    for path in all_files:
        if path.suffix=='.json':
            try:load(path);parsed.append(path)
            except (ValueError,OSError) as exc:syntax.append(path.relative_to(root).as_posix()+': '+str(exc))
        elif path.suffix=='.py':
            try:ast.parse(path.read_text(encoding='utf-8'))
            except SyntaxError as exc:syntax.append(path.name+': '+str(exc))
    check('JSON uniqueness/finite numbers and Python syntax',not syntax,syntax)
    baseline=read('BASELINE.json');experience=read('docs/project/experience-spec.json')
    flows,stories,screens=experience['flows'],experience['stories'],experience['screens']
    workflows=read('docs/project/workflow-catalog.json')['workflows']
    memories=read('docs/project/memory-workflow-fit.json')['memories']
    tasks=read('docs/delivery/backlog.json')['tasks'];gates=read('docs/delivery/activation-gates.json')['gates']
    checks=read('docs/project/workflow-acceptance.json')['cases'];global_cases=read('docs/project/ui-global-acceptance.json')['cases']
    story_cases=[case for story in stories for case in story['acceptance']]
    sets={name:{x['id'] for x in data} for name,data in [('flow',flows),('story',stories),('screen',screens),('workflow',workflows),('memory',memories),('task',tasks),('gate',gates)]}
    for name,items,expected in [('flows',flows,32),('stories',stories,64),('screens',screens,18),('workflows',workflows,12),('memory',memories,15),('tasks',tasks,38),('workflow cases',checks,76),('UI global cases',global_cases,24),('story cases',story_cases,192)]:
        check('Unique and complete '+name,unique(items) and len(items)==expected,{'actual':len(items),'expected':expected})
    check('Unique namespaced requirement IDs',unique(stories,'requirement_id'))
    check('All flow/workflow/memory/screen/story references resolve',all(
        set(f['workflow_ids'])<=sets['workflow'] and set(f['memory_ids'])<=sets['memory'] and
        set(f['screen_ids'])<=sets['screen'] and set(f['story_ids'])<=sets['story'] for f in flows))
    check('Story flow/feature and reverse story linkage agree',all(
        s['flow_id'] in sets['flow'] and any(f['id']==s['flow_id'] and f['feature']==s['feature'] and s['id'] in f['story_ids'] for f in flows) for s in stories))
    try:order=topological_order(tasks);check('Task graph acyclic and dependencies exist',True)
    except ValueError as exc:order=[];check('Task graph acyclic and dependencies exist',False,str(exc))
    check('Task cross-references resolve',all(set(t['flows'])<=sets['flow'] and set(t['stories'])<=sets['story'] and set(t['workflows'])<=sets['workflow'] and set(t['required_gates'])<=sets['gate'] for t in tasks))
    check('All task records retain explicit ownership/scope/checks',all(t['owner_role'] and t['planned_edit_roots'] and t['acceptance'] and t['completion_requires'] for t in tasks))
    check('Tasks are not falsely marked executed',all(t['state']=='PLANNED_NOT_EXECUTED' for t in tasks))
    check('Every flow has a specific implementation consumer',all(any(f['id'] in t['flows'] for t in tasks if t['id'] not in {'LL034','LL035','LL038'}) for f in flows))
    mapping=read('docs/delivery/requirement-task-map.json')['records']
    check('One task mapping for every story',unique(mapping,'story_id') and {x['story_id'] for x in mapping}==sets['story'])
    check('Trace mappings refer to actual assigned task/story pairs',all(
        set(m['implementation_tasks'])<=sets['task'] and m['implementation_tasks'] and
        all(any(t['id']==tid and m['story_id'] in t['stories'] for t in tasks) for tid in m['implementation_tasks']) and
        any(s['id']==m['story_id'] and s['requirement_id']==m['requirement_id'] for s in stories) for m in mapping))
    check('Runtime tests and gate grants are not fabricated',all(x['status']=='NOT_RUN' for x in checks+global_cases+story_cases) and all(g['state']=='NOT_CLEARED' and not g['evidence'] for g in gates) and all(not m['runtime_test_ids'] for m in mapping))
    check('Six milestones and preserved all-lecture scope',{t['milestone'] for t in tasks}=={'R0','R1','R2','R3','R4','R5'} and experience['all_lecture_scope'] is True)
    feature_ids={f['feature'] for f in flows}
    check('Six feature packets complete',len(feature_ids)==6 and all((root/'docs/features'/f/name).is_file() for f in feature_ids for name in ['requirements.md','ui-flow.md','test-plan.md','plan.md']))
    roadmap=(root/'docs/delivery/roadmap.md').read_text()
    check('Roadmap generated task rows match authoritative backlog',all(f"| {t['id']} | {t['milestone']} | {t['title']} | {', '.join(t['dependencies']) or 'none'} |" in roadmap for t in tasks))
    for feature in sorted(feature_ids):
        text=(root/'docs/features'/feature/'plan.md').read_text()
        check('Feature plan references its implementation tasks: '+feature,all(t['id'] in text for t in tasks if feature in t['features']))
    cindex=read('contracts/index.json');schema_errors=[]
    for path in (root/'contracts/v1').glob('*.schema.json'):
        try:Draft202012Validator.check_schema(load(path))
        except Exception as exc:schema_errors.append(path.name+': '+str(exc))
    check('Draft 2020-12 schema definitions',not schema_errors,schema_errors)
    check('Schema index complete',{x['path'] for x in cindex['schemas']}|{cindex['shared']}=={p.relative_to(root).as_posix() for p in (root/'contracts/v1').glob('*.schema.json')})
    actions=read('contracts/v1/request.schema.json')['properties']['action']['enum']
    check('Every accepted action has an exact local payload schema',set(actions)==set(cindex['action_payloads']) and set(cindex['action_payloads'].values())<={x['name'] for x in cindex['schemas']})
    cases=read('fixtures/contracts/cases.json')['cases'];fail=[]
    for item in cases:
        errors=validate(item['schema'],read(item['fixture']))
        if (not errors)!=item['expected_valid']:fail.append(item['id'])
    check('All synthetic contract case outcomes match',not fail,{'cases':len(cases),'failed':fail})
    check('Every record type has positive and negative examples',all(any(c['schema']==s['name'] and c['expected_valid'] is valid for c in cases) for s in cindex['schemas'] for valid in (True,False)))
    defaults=read('config/defaults.json')
    check('Selected defaults disable live writes/dispatch and paid inference',not defaults['native_dispatch_enabled'] and not defaults['course_writes_enabled'] and defaults['additional_paid_inference_budget_usd']==0 and not defaults['public_pc_listener'])
    check('No automatic evidence deletion or unknown-result retry',defaults['referenced_evidence_ttl_days'] is None and not defaults['retry_after_unknown_native_completion'] and not defaults['source_publisher_replaced'])
    check('Baseline distinguishes app and spec version',baseline['baseline_version']=='0.9.0' and baseline['app_version'] is None and baseline['permissions']['application_scope_approved'] is False and baseline['runtime_tests']=='NOT_RUN')
    preserved=read('docs/engineering/experience-input-digests.json')
    check('Prior accepted experience/workflow bytes preserved',all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in preserved['files'].items()))
    sources=read('docs/research/build-source-register.json')['sources']
    packages=read('docs/engineering/component-selection.json')['packages']
    check('Selected components have primary-source references',unique(sources) and all(p['reference'] in {x['id'] for x in sources} for p in packages))
    token=read('docs/project/design-tokens.json');ratios=[]
    for theme in ('light','dark'):
        t=token[theme]
        for background in ('background','surface','surface_raised'):
            for foreground in ('text','muted_text','success','caution','danger','unassessed'):
                value=contrast(t[foreground],t[background]);ratios.append({'theme':theme,'fg':foreground,'bg':background,'ratio':value,'minimum':4.5})
            for foreground in ('focus','border'):
                value=contrast(t[foreground],t[background]);ratios.append({'theme':theme,'fg':foreground,'bg':background,'ratio':value,'minimum':3})
        ratios.append({'theme':theme,'fg':'on_accent','bg':'accent','ratio':contrast(t['on_accent'],t['accent']),'minimum':4.5})
    check('Declared solid theme color pairs meet selected contrast floors',all(x['ratio']>=x['minimum'] for x in ratios),{'pairs':len(ratios),'failed':[x for x in ratios if x['ratio']<x['minimum']]})
    check('Both themes/reduced motion/source fidelity remain',token['default']=='system' and token['motion']['reduced_motion_ms']==0 and defaults['autoplay'] is False)
    links,broken=relative_links(root);check('Local Markdown file targets resolve',not broken,{'checked':links,'broken':broken})
    forbidden=[p.relative_to(root).as_posix() for p in all_files if p.suffix.lower() in {'.ttf','.otf','.woff','.woff2','.exe','.dll','.db','.sqlite','.key','.pem'} or p.name in {'.env','credentials.json'}]
    check('No added font/binary/database/credential files',not forbidden,forbidden)
    if check_manifest:
        lines=(root/'MANIFEST.sha256').read_text().splitlines();wanted={};bad=[]
        for line in lines:
            digest,name=line.split('  ',1)
            if name in wanted or not (root/name).resolve().is_relative_to(root.resolve()):bad.append(name);continue
            wanted[name]=digest
            if not (root/name).is_file() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest:bad.append(name)
        actual={p.relative_to(root).as_posix() for p in all_files if p.name!='MANIFEST.sha256'}
        check('Exact distribution file set and hashes',not bad and set(wanted)==actual,{'entries':len(wanted),'bad':bad,'unexpected':sorted(actual-set(wanted)),'missing':sorted(set(wanted)-actual)})
    return {'status':'PASS' if all(x['passed'] for x in results) else 'FAIL','checks':len(results),'results':results,
            'counts':{'json':len(parsed),'python':sum(p.suffix=='.py' for p in all_files),'schemas':len(cindex['schemas'])+1,'contract_examples':len(cases),'tasks':len(tasks),'milestones':6,'flows':len(flows),'stories':len(stories),'story_cases':len(story_cases),'global_ui_cases':len(global_cases),'workflow_cases':len(checks)},
            'topological_task_order':order,'boundary':'Local design, schema, synthetic fixture and declared color-token checks only. No app/browser/Drive/native/academic-writer/cryptographic authorization or learning-quality validation.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',action='store_true');args=parser.parse_args()
    try:result=audit(ROOT,args.manifest)
    except (OSError,ValueError,KeyError,TypeError) as exc:result={'status':'FAIL','reason':str(exc)}
    print(json.dumps(result,indent=2));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
