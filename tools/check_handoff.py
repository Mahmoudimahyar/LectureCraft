#!/usr/bin/env python3
"""Read-only consistency checks for the implementation handoff, not the unbuilt app."""
from pathlib import Path
import hashlib,json
import build_board as board
from check_baseline import relative_links
ROOT=Path(__file__).resolve().parents[1]

def audit(root=ROOT):
    result=[]
    def c(name,value,detail=None):result.append({'check':name,'passed':bool(value),'detail':detail})
    src=json.loads((root/'docs/delivery/backlog.json').read_text())['tasks']
    tasks=board.plan(root)[0]['tasks'];ids={t['id'] for t in tasks}
    c('All 38 original tasks retained',len(tasks)==38 and ids=={t['id'] for t in src})
    old={t['id']:t for t in src}
    c('Original release requirements not removed',all(t['original_release_gates']==old[t['id']]['required_gates'] for t in tasks))
    c('All 64 stories still assigned',set().union(*(set(t['stories']) for t in src))=={f'US{x:03}' for x in range(1,65)})
    c('Live proofs still gate original whole-product release','LL035' in old['LL038']['dependencies'])
    c('No baseline activation grant forged',all(g['state']=='NOT_CLEARED' for g in json.loads((root/'docs/delivery/activation-gates.json').read_text())['gates']))
    marker=json.loads((root/'IMPLEMENTATION.json').read_text())
    c('Artifact and product versions distinct',marker['package_version']=='0.10.0' and marker['specification_baseline']=='0.9.0' and marker['app_version'] is None)
    c('Unavailable Seed provenance explicit',marker['foundation']['status']=='RAW_ARCHIVE_UNAVAILABLE_IN_THIS_EXPORT')
    text=(root/'PROMPTS/START_WITH_GOAL.txt').read_text()
    c('Native goal explicit and within documented limit',text.startswith('/goal ') and len(text)<=4000,{'characters':len(text)})
    c('Native prompt does not enable bypass','--dangerously-skip-permissions' not in text and 'no bypass' in text)
    c('Launcher MCP surface empty',json.loads((root/'config/claude-build-mcp.json').read_text())=={'mcpServers':{}})
    c('No active session/startup hooks installed',not (root/'.claude/settings.json').exists() and not (root/'.mcp.json').exists())
    c('Required handoff files present',all((root/n).is_file() for n in ['CLAUDE.md','AGENTS.md','START_IMPLEMENTATION.md','PROMPTS/IMPLEMENT_ALL.md','PROMPTS/CONTINUE.md','docs/implementation/execution-charter.md','docs/operations/native-setup-report.md']))
    c('Both original visual references preserved',all((root/'assets/design'/n).is_file() for n in ['light-dark-workspace-reference.png','source-first-layout-reference.png']))
    preserved=json.loads((root/'docs/engineering/experience-input-digests.json').read_text())['files']
    c('Accepted experience/workflow/memory inputs unchanged',all(hashlib.sha256((root/n).read_bytes()).hexdigest()==h for n,h in preserved.items()))
    count,broken=relative_links(root);c('Local document links resolve',not broken,{'links':count,'broken':broken})
    c('Source/data placement specified','nonsynced' in (root/'docs/implementation/placement.md').read_text())
    return {'status':'PASS' if all(x['passed'] for x in result) else 'FAIL','checks':len(result),'results':result,'boundary':'Document/task/provenance consistency only. No native session, application, Drive or academic writer invoked.'}
if __name__=='__main__':
    try:r=audit()
    except (OSError,ValueError,KeyError) as exc:r={'status':'FAIL','reason':str(exc)}
    print(json.dumps(r,indent=2));raise SystemExit(0 if r['status']=='PASS' else 1)
