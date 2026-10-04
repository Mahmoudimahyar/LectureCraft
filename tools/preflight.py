#!/usr/bin/env python3
"""Read-only environment summary. No installs, auth reads, source reads or native dispatch."""
from pathlib import Path
import argparse, importlib.metadata, json, os, platform, shutil, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]

def summary(root:Path=ROOT,run_versions=False):
    root=root.resolve();parts={p.casefold() for p in root.parts}
    warnings=[]
    if root.drive.casefold()=='g:' or {'onedrive','my drive','google drive'}&parts:
        warnings.append('Move the active code checkout to a nonsynced local directory before building.')
    if any((root/p).exists() for p in ['course.yaml','planner-config.yaml','learning/attempts']):
        warnings.append('This looks like an academic data root, not the separate code checkout. Do not initialize or build here.')
    tools={}
    for name in ['git','node','npm','claude','codex']:
        path=shutil.which(name);item={'available':bool(path),'version':'NOT_CHECKED'}
        if path and run_versions:
            # Native executables only; do not shell-fallback for .cmd/.bat launchers.
            if os.name=='nt' and Path(path).suffix.lower() in {'.cmd','.bat'}:item['version']='CHECK_MANUALLY_SHELL_SHIM'
            else:
                try:
                    out=subprocess.run([path,'--version'],cwd=root,capture_output=True,text=True,timeout=10)
                    item['version']=out.stdout.strip()[:250] if out.returncode==0 else 'UNAVAILABLE'
                except (OSError,subprocess.TimeoutExpired):item['version']='UNAVAILABLE'
        tools[name]=item
    dependencies={}
    for name in ['jsonschema','referencing']:
        try:dependencies[name]=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:dependencies[name]='NOT_INSTALLED'
    return {'status':'WRONG_WORKSPACE' if warnings else 'INSPECTED','python':platform.python_version(),
       'platform':platform.system(),'code_root':str(root),'tools':tools,'check_dependencies':dependencies,
       'warnings':warnings,'course_roots':'Not read; resolve the existing planner binding only after allowed read.',
       'native_auth_permissions_roundtrip':'NOT_CHECKED','drive_grants':'NOT_CHECKED',
       'seed_source':'Present' if (root/'.local/seed-source/seed-repo').is_dir() else 'Not imported',
       'note':'Readiness facts only. This performs no install, login, app restart, session lookup, live write or global setting change.'}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--versions',action='store_true');a=p.parse_args()
    result=summary(run_versions=a.versions);print(json.dumps(result,indent=2));raise SystemExit(2 if result['warnings'] else 0)
