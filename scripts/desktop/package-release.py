#!/usr/bin/env python3
"""Assemble only explicit, public runtime resources; never copy a checkout or .env."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import subprocess
import shutil
import tarfile
import urllib.request
import zipfile

parser=argparse.ArgumentParser()
parser.add_argument('--frozen-dir',type=Path,required=True)
parser.add_argument('--destination',type=Path,required=True)
parser.add_argument('--cache-dir',type=Path,required=True)
parser.add_argument('--node-version',default='v24.22.0')
parser.add_argument('--app-source-archive',type=Path)
parser.add_argument('--homr-source',type=Path)
parser.add_argument('--notices-dir',type=Path)
parser.add_argument('--native-source-dir',type=Path)
args=parser.parse_args()
project=Path(__file__).resolve().parents[2]
arch={'arm64':'arm64','aarch64':'arm64','AMD64':'x64','x86_64':'x64'}[platform.machine()]
os_name={'Darwin':'darwin','Windows':'win','Linux':'linux'}[platform.system()]
filename=f'node-{args.node_version}-{os_name}-{arch}'+('.zip' if os_name=='win' else '.tar.gz')
cache=args.cache_dir.resolve();cache.mkdir(parents=True,exist_ok=True)
url=f'https://nodejs.org/dist/{args.node_version}/'
sums=urllib.request.urlopen(url+'SHASUMS256.txt').read().decode()
expected=next(line.split()[0] for line in sums.splitlines() if line.split()[-1]==filename)
archive=cache/filename
if not archive.exists():
    with urllib.request.urlopen(url+filename) as response,archive.open('wb') as out:shutil.copyfileobj(response,out)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Official Node.js archive checksum mismatch')
extract=cache/f'node-{args.node_version}-{os_name}-{arch}'
if not extract.exists():
    if os_name=='win':
        with zipfile.ZipFile(archive) as source:source.extractall(cache)
    else:
        with tarfile.open(archive) as source:source.extractall(cache,filter='data')
frozen_executable=args.frozen_dir/('ChanyangScoreStudio.exe' if os_name=='win' else 'ChanyangScoreStudio')
runtime_info=json.loads(subprocess.check_output([str(frozen_executable.resolve()),'--runtime-check'],text=True,stderr=subprocess.DEVNULL))
if not runtime_info.get('ready'):raise SystemExit('Frozen runtime is not ready')
destination=args.destination.resolve()
if destination.exists():raise SystemExit('Destination already exists; choose a new output folder')
shutil.copytree(args.frozen_dir,destination,symlinks=True)
node=destination/'node';node.mkdir()
if os_name=='win':shutil.copy2(extract/'node.exe',node/'node.exe')
else:(node/'bin').mkdir();shutil.copy2(extract/'bin'/'node',node/'bin'/'node')
shutil.copy2(extract/'LICENSE',node/'LICENSE')
shutil.copytree(project/'dist'/'standalone',destination/'app',symlinks=False)
support=destination/'support';support.mkdir()
for source,target in [(project/'scripts'/'omr-companion.mjs','omr-companion.mjs'),(project/'desktop'/'node-host.mjs','node-host.mjs')]:shutil.copy2(source,support/target)
if os_name=='darwin':
    launcher=destination/'워십노트 시작.command'
    launcher.write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n./ChanyangScoreStudio\nresult=$?\nif [ "$result" -ne 0 ]; then printf "\\n창을 닫기 전에 위 안내를 확인해 주세요.\\n"; read -r answer; fi\nexit "$result"\n',encoding='utf8');launcher.chmod(0o755)
if os_name=='win':(destination/'워십노트 시작.cmd').write_text('@echo off\r\ncd /d "%~dp0"\r\nChanyangScoreStudio.exe\r\nif errorlevel 1 pause\r\n',encoding='utf8')
for name in ['LICENSE','THIRD_PARTY_NOTICES.md','README.md']:
    if (project/name).is_file():shutil.copy2(project/name,destination/name)
if (project/'public/notices').is_dir():shutil.copytree(project/'public/notices',destination/'notices',dirs_exist_ok=True)
if args.notices_dir:shutil.copytree(args.notices_dir,destination/'notices',dirs_exist_ok=True)
if args.app_source_archive:
    (destination/'source').mkdir(exist_ok=True);shutil.copy2(args.app_source_archive,destination/'source'/args.app_source_archive.name)
if args.homr_source:
    (destination/'source').mkdir(exist_ok=True)
    revision='ab369ac54277afab582afa4725441f7cbba76593'
    with (destination/'source'/'HOMR-ab369ac-source.tar.gz').open('wb') as output:
        subprocess.run(['git','-C',str(args.homr_source.resolve()),'archive','--format=tar.gz','--prefix=homr-ab369ac/',revision],stdout=output,check=True)
runtime_sources=json.loads((project/'desktop/runtime-sources.json').read_text())
if args.native_source_dir:
    (destination/'source').mkdir(exist_ok=True)
    entries=[*runtime_sources.get('nativeSources',[]),{**runtime_sources['opencvSource'],'filename':'opencv-4.13.0.tar.gz'}]
    for asset in entries:
        file=args.native_source_dir/asset['filename']
        if hashlib.sha256(file.read_bytes()).hexdigest()!=asset['sha256']:raise SystemExit('Native source checksum mismatch')
        shutil.copy2(file,destination/'source'/asset['filename'])
shutil.copy2(project/'desktop/runtime-sources.json',destination/'runtime-sources.json')
manifest={'version':json.loads((project/'package.json').read_text())['version'],'python':runtime_info['python'],'homrCommit':'ab369ac54277afab582afa4725441f7cbba76593','runtimeModelCount':runtime_info['models'],'platform':os_name,'architecture':arch,'node':args.node_version,'nodeArchiveSHA256':expected,'pythonPackaging':'PyInstaller native onedir','listen':'127.0.0.1','appPort':3210,'omrPort':3211,'opencv':{'version':'4.13.0','build':'static image modules only','videoCodecs':False},'minimumMacOS':'15.0' if os_name=='darwin' else None,'codeSigning':'ad-hoc, not notarized' if os_name=='darwin' else 'unsigned'}
(destination/'runtime-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
# Absolute symlinks would depend on the builder's machine and are never releasable.
for path in destination.rglob('*'):
    if path.is_symlink():
        target=path.resolve()
        if not target.is_relative_to(destination):raise SystemExit('External symlink in bundle: '+str(path.relative_to(destination)))
    if path.is_file() and (path.name.startswith('.env')):
        raise SystemExit('Unexpected user/config image in runtime: '+str(path.relative_to(destination)))
print(destination)
