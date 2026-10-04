#!/usr/bin/env python3
"""Validate an explicitly local Seed ZIP, optionally copy it under .local/seed-source.
No downloads, execution, Git history merge, source overwrite or invented provenance.
"""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, os, re, shutil, stat, tempfile, zipfile
from build_board import safe, write, lock, ROOT
VERSION='0.5.0-rc.1'

def validate_zip(path:Path):
    if path.is_symlink() or not path.is_file():raise ValueError('Expected an existing regular local archive')
    if path.stat().st_size>32_000_000:raise ValueError('Archive too large')
    with zipfile.ZipFile(path) as z:
        members=z.infolist()
        if len(members)>5000 or sum(m.file_size for m in members)>64_000_000:raise ValueError('Archive bounds exceeded')
        files={};seen=set()
        for m in members:
            p=PurePosixPath(m.filename)
            if p.as_posix() != m.filename.rstrip('/') or p.is_absolute() or '\\' in m.filename or ':' in m.filename or '..' in p.parts or not p.parts or p.parts[0]!='seed-repo':raise ValueError('Unsafe archive path')
            if m.filename.casefold() in seen:raise ValueError('Duplicate/colliding archive member')
            seen.add(m.filename.casefold())
            if stat.S_IFMT(m.external_attr>>16)==stat.S_IFLNK:raise ValueError('Archive symlink rejected')
            if m.is_dir():continue
            rel=PurePosixPath(*p.parts[1:]).as_posix()
            if not rel or rel=='.' or any(x in {'.git','.codex','.seed-local','node_modules'} for x in p.parts):raise ValueError('Private/runtime archive path')
            if p.name in {'.env','credentials.json','.mcp.json'} or p.suffix.lower() in {'.exe','.dll','.ttf','.otf','.woff','.woff2','.key','.pem'}:raise ValueError('Unexpected private/binary payload')
            files[rel]=z.read(m)
        for needed in ['MANIFEST.sha256','VERSION','seed.json','AGENTS.md','LICENSE','scripts/seed.py']:
            if needed not in files:raise ValueError('Missing Seed identity: '+needed)
        if files['VERSION'].decode().strip()!=VERSION:raise ValueError('Unreviewed Seed version')
        state=json.loads(files['seed.json'])
        if state.get('distribution_version')!=VERSION:raise ValueError('Seed version metadata mismatch')
        names=set()
        for line in files['MANIFEST.sha256'].decode().splitlines():
            h,n=line.split('  ',1)
            if n in names or not re.fullmatch('[a-f0-9]{64}',h) or n not in files or hashlib.sha256(files[n]).hexdigest()!=h:raise ValueError('Source manifest mismatch')
            names.add(n)
        if names!=set(files)-{'MANIFEST.sha256'}:raise ValueError('Manifest file set mismatch')
    return files,{'version':VERSION,'archive_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'files':len(files),'trust':'Integrity only, not signed author identity or a security review'}

def install(path:Path,root:Path=ROOT,commit=False):
    files,record=validate_zip(path)
    destination=safe(root,'.local/seed-source/seed-repo')
    if destination.exists():raise ValueError('Existing Seed source preserved; refuse overwrite')
    if not commit:return {'status':'PREVIEW','identity':record,'destination':str(destination)}
    with lock(root):
        parent=safe(root,'.local/seed-source');parent.mkdir(parents=True,exist_ok=True)
        # Unique temp and exclusive destination check; operator must not concurrently import.
        with tempfile.TemporaryDirectory(prefix='import-',dir=parent) as temp:
            stage=Path(temp)/'seed-repo';stage.mkdir()
            for name,data in files.items():
                target=safe(stage,name);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
            if destination.exists():raise ValueError('Destination appeared during import')
            os.rename(stage,destination)
        write(safe(root,'.local/seed-source/identity.json'),record)
    return {'status':'IMPORTED_NOT_EXECUTED','identity':record,'destination':str(destination)}

def discover():
    path=Path.home()/'Downloads'/('seed-repo-'+VERSION+'.zip')
    return path if path.is_file() and not path.is_symlink() else None

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path);p.add_argument('--write',action='store_true');a=p.parse_args()
    try:
        path=a.source or discover()
        result=install(path,commit=a.write) if path else {'status':'SOURCE_NOT_FOUND','note':'Only the exact release filename in Downloads was checked. Continue independent app work; no fake Seed source/tests.'}
        print(json.dumps(result,indent=2));raise SystemExit(0 if result['status']!='SOURCE_NOT_FOUND' else 2)
    except (OSError,ValueError,zipfile.BadZipFile,KeyError) as exc:print(json.dumps({'status':'BLOCKED','reason':str(exc)}));raise SystemExit(2)
