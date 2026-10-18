#!/usr/bin/env python3
"""Copy installed runtime license texts and metadata without installed code or paths."""
from importlib.metadata import distribution
import argparse,json,platform,shutil,sys
from pathlib import Path
import urllib.request
parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path);args=parser.parse_args()
destination=args.destination.resolve();destination.mkdir(parents=True,exist_ok=True)
packages=['altgraph','certifi','charset-normalizer','colorlog','flatbuffers','homr','idna','macholib','musicxml','numpy','omegaconf','onnxruntime','opencv-python-headless','packaging','pillow','protobuf','pyclipper','pyinstaller','pyinstaller-hooks-contrib','pypdfium2','PyYAML','rapidocr','requests','setuptools','shapely','six','tqdm','typing_extensions','urllib3']
metadata=[]
for name in packages:
    try:dist=distribution(name)
    except Exception:continue
    target=destination/'python-packages'/name;target.mkdir(parents=True,exist_ok=True)
    for file in dist.files or []:
        parts=[part.lower() for part in file.parts]
        if not any(part in ['licenses','license'] for part in parts) and not any(word in file.name.lower() for word in ['license','copying','notice']):continue
        if file.suffix.lower() in ['.py','.pyc','.so','.dylib','.xml']:continue
        source=Path(dist.locate_file(file))
        if source.is_file():
            # Keep nested relative names to preserve third-party sub-licenses.
            relative=Path(*[part for part in file.parts if part not in ['..','.']]);out=target/relative;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,out)
    metadata.append({'name':dist.metadata['Name'],'version':dist.version,'license':dist.metadata.get('License-Expression') or dist.metadata.get('License'),'projectURLs':dist.metadata.get_all('Project-URL') or [],'homepage':dist.metadata.get('Home-page')})
license=Path(sys.base_prefix)/'lib'/f'python{sys.version_info.major}.{sys.version_info.minor}'/'LICENSE.txt'
if license.exists():shutil.copy2(license,destination/'PYTHON-LICENSE.txt')
else:(destination/'PYTHON-LICENSE.txt').write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/python/cpython/v{platform.python_version()}/LICENSE').read())
for name,url in [
 ('TESSERACT-LICENSE.txt','https://raw.githubusercontent.com/tesseract-ocr/tesseract/5.5.2/LICENSE'),
 ('LEPTONICA-LICENSE.txt','https://raw.githubusercontent.com/DanBloomberg/leptonica/1.87.0/leptonica-license.txt'),
 ('TESSDATA-LICENSE.txt','https://raw.githubusercontent.com/tesseract-ocr/tessdata/ced78752cc61322fb554c280d13360b35b8684e4/LICENSE'),
]:
    (destination/name).write_bytes(urllib.request.urlopen(url).read())
(destination/'python-dependencies.json').write_text(json.dumps({'python':platform.python_version(),'packages':metadata},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
