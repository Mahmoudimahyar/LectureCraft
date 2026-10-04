#!/usr/bin/env python3
"""Bound ONE authorized native Claude /goal process. Preview by default; no custom retry loop.
Claude owns continuation; this wrapper only checks version/auth, isolates MCP configuration,
retains its exact session ID, and bounds its own process tree. No credential copying or API.
"""
from __future__ import annotations
import argparse, json, os, re, shutil, subprocess, uuid
from pathlib import Path
from build_board import ROOT, dump, execute, safe, write
MINIMUM=(2,1,259) # --permission-prompts none is documented from this version.

def banner_version(text):
    m=re.search(r'\b(\d+)\.(\d+)\.(\d+)\b',text)
    if not m:raise ValueError('Unrecognized installed Claude version')
    if tuple(map(int,m.groups()))<MINIMUM:raise ValueError('Launcher needs Claude Code 2.1.259+; use a reviewed Code session instead. No auto-update.')
    return '.'.join(m.groups())

def argv_for(executable,root,session,max_turns,prompt):
    args=[str(executable),'-p','--output-format','json','--permission-mode','auto','--permission-prompts','none',
          '--strict-mcp-config','--mcp-config',str(root/'config/claude-build-mcp.json'),
          '--settings',str(root/'config/claude-build-settings.example.json')]
    if max_turns:args+=['--max-turns',str(max_turns)]
    if session:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',session):raise ValueError('Invalid resume identifier')
        args+=['--resume',session]
    return args+[prompt]

def terminal(text):
    obj=json.loads(text)
    if not isinstance(obj,dict) or obj.get('type')!='result':raise ValueError('No recognized terminal result; reconcile before resubmitting')
    if obj.get('is_error') is not False or obj.get('subtype')!='success':raise ValueError('Native non-success; do not auto-retry auth/quota/permission/turn limits')
    sid=obj.get('session_id')
    if not isinstance(sid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',sid):raise ValueError('Missing exact session ID')
    if obj.get('permission_denials'):raise ValueError('Permission denied; no automatic permission broadening')
    return sid

def run(root,executable,hours,max_turns=0,execute_requested=False):
    if not 0<hours<=8 or isinstance(max_turns,bool) or not 0<=max_turns<=1000:raise ValueError('Invalid bounds: up to 8 hours; 0 means no extra per-process turn cap')
    if not execute_requested:
        return {'status':'PREVIEW','maximum_hours':hours,'max_turns':max_turns or 'native default',
          'permission_mode':'auto','continuation':'native /goal','prompt':str(root/'PROMPTS/START_WITH_GOAL.txt'),
          'note':'No native process, auth, build or tool settings changed. Read the charter before --execute.'}
    binary=Path(executable) if executable else Path(shutil.which('claude') or '')
    if not binary.is_file() or binary.suffix.lower() in {'.cmd','.bat'}:raise ValueError('Reviewed native Claude executable required; no shell shim or auto-install')
    if safe(root,'.local/STOP').exists():return {'status':'STOPPED','note':'Remove the inspected stop file yourself before a new build.'}
    overrides=['ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']
    if any(os.environ.get(k) for k in overrides):raise ValueError('Possible API/third-party billing override; inspect auth privately first')
    version=subprocess.run([str(binary),'--version'],cwd=root,capture_output=True,text=True,timeout=15,check=True)
    observed=banner_version(version.stdout)
    auth=subprocess.run([str(binary),'auth','status'],cwd=root,capture_output=True,text=True,timeout=20,check=True)
    if json.loads(auth.stdout).get('authMethod')!='claude.ai':raise ValueError('Managed claude.ai sign-in not established; sign in through the supported client yourself')
    prompt=(root/'PROMPTS/START_WITH_GOAL.txt').read_text()
    if not prompt.startswith('/goal ') or len(prompt)>4000:raise ValueError('Invalid native goal prompt')
    lock=safe(root,'.local/build/claude-launch.lock');lock.parent.mkdir(parents=True,exist_ok=True)
    try:fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError as exc:raise ValueError('Build may be running; inspect before recovery') from exc
    with os.fdopen(fd,'w') as f:f.write(str(os.getpid()))
    rid=uuid.uuid4().hex;log=safe(root,f'.local/build/claude/{rid}.json-output.log')
    summary={'run_id':rid,'claude_version':observed,'status':'STARTING','continuation':'native /goal','scope':'Local implementation only, not course-thread dispatch or live writes.'}
    try:
        result=execute(argv_for(binary,root,None,max_turns,prompt),root,log,hours*3600,safe(root,'.local/STOP'),max_bytes=16_000_000)
        summary['execution']=result;summary['output']=log.relative_to(root).as_posix()
        if result['status']!='PASS':summary['status']='STOPPED_ON_NATIVE_FAILURE'
        else:
            sid=terminal(log.read_text(encoding='utf8'));summary.update(status='SESSION_ENDED_REVIEW_REPORTS',session_id=sid)
            write(safe(root,'.local/build/claude/latest-session.json'),{'session_id':sid,'run_id':rid,'code_root':str(root),'scope':'Implementation only'})
    except (OSError,ValueError,KeyError) as exc:summary.update(status='RECONCILIATION_REQUIRED',reason=str(exc))
    finally:
        summary['application_acceptance']='NOT_ESTABLISHED: inspect actual local/live tests and original release gates.'
        write(safe(root,f'.local/build/claude/{rid}-summary.json'),summary)
        safe(root,'.local/build/claude-launch.lock').unlink(missing_ok=True)
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--execute',action='store_true');p.add_argument('--executable');p.add_argument('--hours',type=float,default=8);p.add_argument('--max-turns',type=int,default=0);a=p.parse_args()
    try:r=run(ROOT,a.executable,a.hours,a.max_turns,a.execute);print(dump(r),end='');raise SystemExit(0 if r['status'] in {'PREVIEW','SESSION_ENDED_REVIEW_REPORTS'} else 2)
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as exc:print(dump({'status':'BLOCKED','reason':str(exc)}),end='');raise SystemExit(2)
