#!/usr/bin/env python3
"""Small local build ledger over the full product backlog; never a live-course scheduler.

A command exit is recorded evidence, not proof that a task is implemented adequately.
Review code and run whole-app acceptance independently. This is not the Seed task runner,
a permission sandbox, a human approval service or a replacement for an available Seed.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib, json, os
from pathlib import Path
import re, signal, subprocess, sys, time, uuid
ROOT=Path(__file__).resolve().parents[1]
IGNORE={'.git','.local','.seed-local','.venv','node_modules','__pycache__','.pytest_cache','dist','coverage','.next','test-results','playwright-report'}
STATES={'TODO','IN_PROGRESS','IMPLEMENTED_UNVERIFIED','LOCAL_TESTED','BLOCKED'}

def dump(value):return json.dumps(value,sort_keys=True,indent=2,allow_nan=False)+'\n'
def digest(data):return hashlib.sha256(data).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()

def safe(root:Path,name:str)->Path:
    root=root.resolve()
    if not isinstance(name,str) or not name or '\\' in name or ':' in name or name.startswith('/') or any(x in {'','.','..'} for x in name.split('/')):
        raise ValueError('Unsafe relative path')
    p=root
    for part in name.split('/'):
        p=p/part
        if p.is_symlink():raise ValueError('Symlink path is not allowed')
    if not p.resolve().is_relative_to(root):raise ValueError('Outside project root')
    return p

def read(path:Path):
    if path.stat().st_size>8_000_000:raise ValueError('Metadata exceeds limit')
    return json.loads(path.read_text(encoding='utf8'))

def write(path:Path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with tmp.open('x',encoding='utf8',newline='\n') as f:f.write(dump(obj))
        os.replace(tmp,path)
    finally:tmp.unlink(missing_ok=True)

def fingerprint(root:Path)->str:
    entries={}
    for parent,dirs,files in os.walk(root,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in IGNORE and not (Path(parent)/d).is_symlink())
        for name in sorted(files):
            p=Path(parent)/name
            if p.is_symlink():continue
            if (name.startswith('.env') and name!='.env.example') or name.endswith(('.pyc','.log','.sqlite','.db')):continue
            if p.stat().st_size>32_000_000:raise ValueError('Large build input; keep media/dependency cache outside source')
            entries[p.relative_to(root).as_posix()]=digest(p.read_bytes())
    return digest(dump(entries).encode())

def plan(root:Path):
    value=read(safe(root,'config/implementation-plan.json'))
    tasks=value['tasks']; ids=[t['id'] for t in tasks]
    if not ids or len(set(ids))!=len(ids) or any(not re.fullmatch(r'LL\d{3}',x) for x in ids):raise ValueError('Invalid or duplicate task IDs')
    pending={t['id']:set(t['dependencies']) for t in tasks}
    if any(d-set(ids) for d in pending.values()):raise ValueError('Unknown dependency')
    while pending:
        ready={x for x,d in pending.items() if not d}
        if not ready:raise ValueError('Cyclic dependency graph')
        pending={x:d-ready for x,d in pending.items() if x not in ready}
    return value,digest(dump(value).encode())

def load_state(root:Path):
    p,h=plan(root); path=safe(root,'.local/build/state.json')
    if not path.exists():return p,{'version':1,'plan_sha256':h,'tasks':{t['id']:{'state':'TODO','note':'','receipt':None} for t in p['tasks']}}
    s=read(path)
    if s.get('version')!=1 or s.get('plan_sha256')!=h:raise ValueError('Build plan changed; preserve and explicitly reconcile the ledger before continuing')
    if set(s.get('tasks',{}))!={t['id'] for t in p['tasks']}:raise ValueError('Ledger task set differs from plan')
    if any(v.get('state') not in STATES for v in s['tasks'].values()):raise ValueError('Invalid ledger state')
    return p,s

@contextmanager
def lock(root:Path):
    p=safe(root,'.local/build/write.lock');p.parent.mkdir(parents=True,exist_ok=True)
    try:fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError as exc:raise ValueError('Build ledger locked; do not delete a live lock') from exc
    try:
        with os.fdopen(fd,'w') as f:f.write(str(os.getpid()))
        yield
    finally:safe(root,'.local/build/write.lock').unlink(missing_ok=True)

def status(root:Path):
    p,s=load_state(root);current=fingerprint(root);tasks={k:dict(v) for k,v in s['tasks'].items()}
    for item in tasks.values():
        item['test_freshness']='NOT_RUN'
        if item.get('receipt'):
            try:
                ref=item['receipt'];receipt=read(safe(root,ref['path']))
                if digest(dump(receipt).encode())!=ref['sha256']:raise ValueError('Receipt changed')
                item['test_freshness']='CURRENT' if receipt['source_sha256']==current else 'STALE'
            except (OSError,ValueError,KeyError):item['test_freshness']='INVALID'
    implemented={k for k,v in tasks.items() if v['state'] in {'LOCAL_TESTED','IMPLEMENTED_UNVERIFIED'}}
    runnable=[t['id'] for t in p['tasks'] if tasks[t['id']]['state'] in {'TODO','IN_PROGRESS'} and set(t['dependencies'])<=implemented]
    return {'status':'WORK_REMAINS' if runnable else 'NO_RUNNABLE_LOCAL_TASKS','tasks':tasks,'runnable':runnable,
      'counts':{k:sum(t['state']==k for t in tasks.values()) for k in sorted(STATES)},
      'application_acceptance':'NOT_ESTABLISHED',
      'note':'Local task ledger only. Stale checks require rerun. An implemented claim, zero runnable tasks, or all green local tests does not establish live acceptance.'}

def _change(root,task,state,note,receipt=None):
    p,s=load_state(root)
    if task not in s['tasks']:raise ValueError('Unknown task')
    if state not in STATES:raise ValueError('Invalid state')
    if not isinstance(note,str) or not note.strip():raise ValueError('A meaningful note/reason is required')
    deps=next(t['dependencies'] for t in p['tasks'] if t['id']==task)
    if state=='IN_PROGRESS' and any(s['tasks'][d]['state'] not in {'LOCAL_TESTED','IMPLEMENTED_UNVERIFIED'} for d in deps):raise ValueError('Build dependencies incomplete')
    s['tasks'][task]={'state':state,'note':note,'receipt':receipt,'updated_at':now()}
    event={'task':task,'state':state,'note':note,'receipt':receipt,'at':now(),'plan_sha256':s['plan_sha256']}
    write(safe(root,'.local/build/events/'+uuid.uuid4().hex+'.json'),event)
    write(safe(root,'.local/build/state.json'),s)
    return s['tasks'][task]

def update(root,task,state,note):
    if state=='LOCAL_TESTED':raise ValueError('Use test to attach actual executed-command evidence')
    with lock(root):return _change(root,task,state,note)

def execute(argv,cwd,log_path,timeout,stop_file,max_bytes=12_000_000):
    """Run a trusted argv without a shell; terminate only this process tree on limit.
    Escaped/detached descendants and filesystem/network containment need an OS boundary.
    """
    if not argv or any(not isinstance(a,str) or '\x00' in a for a in argv):raise ValueError('Expected explicit command argv')
    if isinstance(timeout,bool) or not isinstance(timeout,(int,float)) or not 0<timeout<=36_000:raise ValueError('Invalid timeout')
    if stop_file.exists():return {'status':'STOPPED','exit_code':None,'seconds':0}
    log_path.parent.mkdir(parents=True,exist_ok=True);start=time.monotonic()
    opts={'start_new_session':True} if os.name!='nt' else {'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP}
    with log_path.open('xb') as log:
        try:p=subprocess.Popen(argv,cwd=cwd,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,**opts)
        except OSError as exc:return {'status':'UNAVAILABLE','exit_code':None,'seconds':round(time.monotonic()-start,3),'reason':str(exc)}
        result=None
        try:
            while p.poll() is None:
                result=('STOPPED' if stop_file.exists() else 'TIMEOUT' if time.monotonic()-start>=timeout else 'OUTPUT_LIMIT' if log_path.stat().st_size>max_bytes else None)
                if result:break
                time.sleep(.05)
        finally:
            if p.poll() is None:
                if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15,check=False)
                else:
                    try:os.killpg(p.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    try:p.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        try:os.killpg(p.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                p.wait(timeout=15)
    if log_path.stat().st_size>max_bytes:result='OUTPUT_LIMIT'
    return {'status':result or ('PASS' if p.returncode==0 else 'FAIL'),'exit_code':p.returncode,'seconds':round(time.monotonic()-start,3)}

def run_test(root,task,argv,timeout=600):
    with lock(root):
        p,s=load_state(root)
        if task not in s['tasks']:raise ValueError('Unknown task')
        before=fingerprint(root);rid=uuid.uuid4().hex
        log=safe(root,'.local/build/checks/'+rid+'.log')
        result=execute(argv,root,log,timeout,safe(root,'.local/STOP'))
        unchanged=before==fingerprint(root)
        state='PASS' if result['status']=='PASS' and unchanged else 'BLOCKED' if result['status'] in {'PASS','STOPPED','UNAVAILABLE'} else 'FAIL'
        receipt={'kind':'trusted-local-command','id':rid,'task':task,'status':state,'execution_status':result['status'],'execution':result,
          'command':argv,'source_sha256':before,'source_unchanged':unchanged,'at':now(),'log':log.relative_to(root).as_posix(),
          'scope':'This command only. Not semantic task adequacy, live integration or human approval.'}
        path=safe(root,'.local/build/checks/'+rid+'.json');write(path,receipt)
        ref={'path':path.relative_to(root).as_posix(),'sha256':digest(dump(receipt).encode())}
        _change(root,task,'LOCAL_TESTED' if state=='PASS' else 'IN_PROGRESS', 'Executed command '+state+'; review test adequacy independently.',ref)
        return receipt

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='cmd',required=True)
    s.add_parser('status');s.add_parser('next')
    u=s.add_parser('update');u.add_argument('task');u.add_argument('state',choices=sorted(STATES-{'LOCAL_TESTED'}));u.add_argument('--note',required=True)
    t=s.add_parser('test');t.add_argument('task');t.add_argument('--timeout',type=float,default=600);t.add_argument('argv',nargs=argparse.REMAINDER)
    a=p.parse_args()
    try:
        if a.cmd=='status':r=status(ROOT)
        elif a.cmd=='next':
            current=status(ROOT);mapping={t['id']:t for t in plan(ROOT)[0]['tasks']};r={'tasks':[mapping[k] for k in current['runnable']], 'application_acceptance':'NOT_ESTABLISHED'}
        elif a.cmd=='update':r=update(ROOT,a.task,a.state,a.note)
        else:
            argv=a.argv[1:] if a.argv[:1]==['--'] else a.argv
            argv=[sys.executable if x=='{python}' else x for x in argv]
            r=run_test(ROOT,a.task,argv,a.timeout)
        print(dump(r),end='');return 0 if r.get('status') not in {'FAIL','BLOCKED'} else 2
    except (OSError,ValueError,TypeError,KeyError) as exc:print(dump({'status':'BLOCKED','reason':str(exc)}),end='');return 2
if __name__=='__main__':raise SystemExit(main())
