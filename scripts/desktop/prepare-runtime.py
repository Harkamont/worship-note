#!/usr/bin/env python3
"""Download pinned public build resources; no Codex folders are required."""
import argparse,hashlib,json,subprocess,sys,urllib.request,zipfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--skip-python-install',action='store_true');args=parser.parse_args()
project=Path(__file__).resolve().parents[2];manifest=json.loads((project/'desktop/runtime-sources.json').read_text())
root=args.directory.resolve();root.mkdir(parents=True,exist_ok=True)
source=root/'homr-source'
if not source.exists():subprocess.run(['git','clone','https://github.com/liebharc/homr.git',str(source)],check=True)
subprocess.run(['git','-C',str(source),'checkout','--detach',manifest['homrCommit']],check=True)
actual=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
if actual!=manifest['homrCommit']:raise SystemExit('HOMR source revision mismatch')
venv=root/'python-build'
if not venv.exists():subprocess.run([sys.executable,'-m','venv',str(venv)],check=True)
python=venv/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
if not args.skip_python_install:
    subprocess.run([str(python),'-m','pip','install','--index-url','https://pypi.org/simple','cmake==4.3.2','ninja==1.13.0','numpy==2.5.4'],check=True)
    subprocess.run([str(python),str(project/'scripts/desktop/build-opencv.py'),'--directory',str(root/'opencv-build')],check=True)
    subprocess.run([str(python),'-m','pip','install','--index-url','https://pypi.org/simple','-r',str(project/'desktop/runtime-requirements.txt')],check=True)

def checked_download(asset,destination,archive_member=None):
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest()==asset['sha256']:return
    print('Downloading '+destination.name,flush=True)
    data=urllib.request.urlopen(asset['url'],timeout=60).read()
    if archive_member:
        import io
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members=[name for name in archive.namelist() if Path(name).name==archive_member]
            if len(members)!=1:raise SystemExit('Unexpected archive member')
            data=archive.read(members[0])
    if hashlib.sha256(data).hexdigest()!=asset['sha256']:raise SystemExit('Checksum mismatch: '+destination.name)
    destination.write_bytes(data)
for asset in manifest['models']:checked_download(asset,source/asset['path'],Path(asset['path']).name)
ocr=root/'ocr-runtime'
if sys.platform=='darwin':
    import platform
    if platform.machine()!='arm64':raise SystemExit('This Mac OCR resource set is for Apple Silicon. Build other architectures separately.')
    for asset in manifest['macOCRArchives']:
        destination=ocr/'downloads'/asset['filename'];checked_download(asset,destination)
        with zipfile.ZipFile(destination) as archive:
            target=ocr/'user/.javacpp/cache'/asset['filename']/asset['member'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(asset['member']))
    for asset in manifest['traineddata']:checked_download(asset,ocr/'tessdata'/asset['filename'])
redistribution=root/'redistribution-sources'
for asset in manifest.get('nativeSources',[]):checked_download(asset,redistribution/asset['filename'])
checked_download(manifest['opencvSource'],redistribution/'opencv-4.13.0.tar.gz')
print(json.dumps({'python':str(python),'homrSource':str(source),'ocrRuntime':str(ocr),'nativeSourceDir':str(redistribution)},indent=2))
