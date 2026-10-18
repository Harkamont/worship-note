#!/usr/bin/env python3
"""Freeze the allowlisted local engine using native PyInstaller (build on target OS)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser=argparse.ArgumentParser()
parser.add_argument('--homr-source',type=Path,required=True)
parser.add_argument('--runtime-root',type=Path,required=True)
parser.add_argument('--work-dir',type=Path,required=True)
parser.add_argument('--dist-dir',type=Path,required=True)
args=parser.parse_args()
project=Path(__file__).resolve().parents[2]
source=args.homr_source.resolve();runtime=args.runtime_root.resolve();work=args.work_dir.resolve();dist=args.dist_dir.resolve()
for path in (work,dist):path.mkdir(parents=True,exist_ok=True)
manifest=json.loads((project/'desktop/runtime-sources.json').read_text())
actual=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
if actual!=manifest['homrCommit']:raise SystemExit('HOMR source revision mismatch')
subprocess.run(['git','-C',str(source),'diff','--exit-code','HEAD'],check=True,stdout=subprocess.DEVNULL)
model_hashes={entry['path']:entry['sha256'] for entry in manifest['models']}
models=[
 'homr/segmentation/segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx',
 'homr/transformer/encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx',
 'homr/transformer/decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx',
]
command=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','ChanyangScoreStudio','--distpath',str(dist),'--workpath',str(work/'build'),'--specpath',str(work),'--paths',str(source),'--paths',str(project/'scripts'),'--collect-submodules','homr','--hidden-import','local_tesseract','--hidden-import','local_text_processing','--collect-data','rapidocr','--collect-binaries','onnxruntime','--collect-binaries','pypdfium2_raw']
for model in models:
    path=source/model
    if not path.is_file():raise SystemExit('Missing allowlisted model: '+model)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=model_hashes[model]:raise SystemExit('Model checksum mismatch: '+model)
    command+=['--add-data',str(path)+':'+str(Path(model).parent)]
for path in sorted((source/'homr'/'transformer').glob('tokenizer_*.json')):command+=['--add-data',str(path)+':homr/transformer']
for name in ['local-text-ocr.py','local_tesseract.py','local_text_processing.py']:
    command+=['--add-data',str(project/'scripts'/name)+':scripts']
if sys.platform=='darwin':
    vision=project/'scripts'/'vision-ocr'
    subprocess.run(['xcrun','swiftc','-target','arm64-apple-macos13.0','-O',str(project/'scripts'/'vision-ocr.swift'),'-o',str(vision)],check=True)
    command+=['--add-binary',str(vision)+':scripts']
    dependencies=[('tesseract-5.5.2-1.5.13-macosx-arm64.jar/org/bytedeco/tesseract/macosx-arm64/libtesseract.5.5.dylib','ocr'),('leptonica-1.87.0-1.5.13-macosx-arm64.jar/org/bytedeco/leptonica/macosx-arm64/libleptonica.6.dylib','ocr')]
    for path,destination in dependencies:command+=['--add-binary',str(runtime/'user'/'.javacpp'/'cache'/path)+':'+destination]
    for name in ['eng','kor']:command+=['--add-data',str(runtime/'tessdata'/(name+'.traineddata'))+':ocr/tessdata']
command.append(str(project/'desktop'/'launcher.py'))
subprocess.run(command,check=True)
