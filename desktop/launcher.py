#!/usr/bin/env python3
"""One launcher for source checkouts and native PyInstaller distributions."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

PORT=3210
OMR_PORT=3211
PROVIDERS={
    'openrouter':('https://openrouter.ai/api/v1','openai/gpt-6.1-sol'),
    'openai':('https://api.openai.com/v1','gpt-6.1-sol'),
    'zai':('https://api.z.ai/api/paas/v4','glm-4.6v-flash'),
}
class LaunchError(Exception):pass

def data_directory(platform=None,home=None,environment=None):
    platform=platform or sys.platform;home=home or Path.home();environment=environment if environment is not None else os.environ
    if environment.get('CHANYANG_DATA_DIR'):return Path(environment['CHANYANG_DATA_DIR']).expanduser().resolve()
    if platform=='darwin':return home/'Library'/'Application Support'/'ChanyangScoreStudio'
    if platform=='win32':return Path(environment.get('LOCALAPPDATA',str(home/'AppData'/'Local')))/'ChanyangScoreStudio'
    return Path(environment.get('XDG_DATA_HOME',str(home/'.local'/'share')))/'ChanyangScoreStudio'

def child_environment(directory,source=None):
    source=source if source is not None else os.environ
    permitted=('PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','TEMP','TMP','LANG','LC_ALL','LOCALAPPDATA','APPDATA')
    env={key:source[key] for key in permitted if key in source}
    env.update(HOST='127.0.0.1',PORT=str(PORT),CHANYANG_PORT=str(PORT),CHANYANG_DESKTOP='1',CHANYANG_DATA_DIR=str(directory),NODE_ENV='production',OMP_NUM_THREADS='1',AI_API_KEY='')
    env.update(AI_PROVIDER='openai-compatible',AI_BASE_URL=PROVIDERS['openrouter'][0])
    for name in ('AI_MODEL','AI_MUSICXML_MODEL','AI_XML_ANNOTATION_MODEL','AI_ANNOTATION_MODEL'):env[name]=PROVIDERS['openrouter'][1]
    settings=directory/'settings.json'
    if settings.is_symlink():raise LaunchError('AI 설정 파일을 확인할 수 없습니다. 앱 데이터 폴더의 settings.json을 확인해 주세요.')
    if settings.exists():
        try:
            if settings.stat().st_size>16*1024:raise ValueError()
            value=json.loads(settings.read_text(encoding='utf8'))
            provider=value['provider'];model=value['model'];key=value['apiKey']
            if provider not in PROVIDERS or not isinstance(model,str) or not 0<len(model)<=200 or any(ord(c)<=32 or ord(c)==127 for c in model):raise ValueError()
            if not isinstance(key,str) or len(key)>4096 or any(ord(c)<32 or ord(c)==127 for c in key):raise ValueError()
        except (KeyError,ValueError,OSError,TypeError):raise LaunchError('저장된 AI 설정을 읽을 수 없습니다. 앱 데이터 폴더의 settings.json을 확인해 주세요.') from None
        env.update(AI_PROVIDER='openai' if provider=='openai' else 'openai-compatible',AI_BASE_URL=PROVIDERS[provider][0],AI_API_KEY=key)
        for name in ('AI_MODEL','AI_MUSICXML_MODEL','AI_XML_ANNOTATION_MODEL','AI_ANNOTATION_MODEL'):env[name]=model
    return env

def stop_children(children):
    for child in reversed(children):
        if child.poll() is None:
            try:child.terminate()
            except OSError:pass
    for child in reversed(children):
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)

def resource_root():
    return Path(sys.executable).resolve().parent if getattr(sys,'frozen',False) else Path(__file__).resolve().parents[1]

def runtime_check():
    if not getattr(sys,'frozen',False):sys.path.insert(0,str(resource_root().parent/'work'/'homr-source'))
    import cv2
    import onnxruntime as ort
    import homr.main  # Import the full engine so missing native/type modules fail at startup.
    from homr.segmentation.config import segnet_path_onnx
    from homr.transformer.configs import default_config
    files=(segnet_path_onnx,default_config.filepaths.encoder_path,default_config.filepaths.decoder_path)
    for name in files:
        if not Path(name).is_file():raise LaunchError('악보 인식 모델 파일이 없습니다. 배포 파일을 다시 풀어 주세요.')
        session=ort.InferenceSession(name,providers=['CPUExecutionProvider']);del session
    print(json.dumps({'ready':True,'models':len(files),'python':sys.version.split()[0],'engine':'HOMR','opencv':cv2.__version__}))

def run_omr(arguments):
    if not getattr(sys,'frozen',False):sys.path.insert(0,str(resource_root().parent/'work'/'homr-source'))
    # Disable HOMR title OCR downloads. Lyrics and chords use a separate local pass.
    from homr.main import main
    sys.argv=['homr','--no-title','--gpu','no',*arguments];main()

def run_text(arguments):
    import runpy
    import homr.onnx_providers as providers
    providers.coreml_available=lambda:False
    providers.cuda_available=lambda:False
    providers.rocm_available=lambda:False
    root=Path(getattr(sys,'_MEIPASS',resource_root()))
    scripts=root/'scripts' if getattr(sys,'frozen',False) else resource_root()/'scripts'
    sys.path.insert(0,str(scripts))
    import local_tesseract
    if getattr(sys,'frozen',False):
        local_tesseract.TESSERACT_LIB=root/'ocr'/'libtesseract.5.5.dylib'
        local_tesseract.LEPTONICA_LIB=root/'ocr'/'libleptonica.6.dylib'
        local_tesseract.TESSDATA=root/'ocr'/'tessdata'
    sys.argv=[str(scripts/'local-text-ocr.py'),*arguments]
    runpy.run_path(sys.argv[0],run_name='__main__')

def available(port):
    with socket.socket() as sock:
        if sys.platform!='win32':sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        try:sock.bind(('127.0.0.1',port))
        except OSError:return False
    return True

def request_json(url,token=None):
    headers={'Authorization':'Bearer '+token} if token else {}
    request=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(request,timeout=2) as response:return json.load(response)

def await_ready(url,children,token=None,timeout=40):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if any(child.poll() is not None for child in children):raise LaunchError('앱 실행이 중단되었습니다. 앱 데이터 폴더의 실행 기록을 확인해 주세요.')
        try:
            result=request_json(url,token)
            if result.get('desktop') or result.get('capabilities',{}).get('recognize'):return result
        except (OSError,ValueError,urllib.error.URLError):pass
        time.sleep(.2)
    raise LaunchError('앱을 시작하는 데 시간이 너무 오래 걸립니다. 앱을 닫은 뒤 다시 실행해 주세요.')

def launch(no_browser=False,smoke=False):
    root=resource_root();frozen=getattr(sys,'frozen',False)
    app=root/'app' if frozen else root/'dist'/'standalone'
    node=root/'node'/'node.exe' if sys.platform=='win32' else root/'node'/'bin'/'node'
    if not frozen:
        import shutil
        node=Path(shutil.which('node') or '')
    if not node.is_file() or not (app/'server.js').is_file():raise LaunchError('실행 파일이 없습니다. 배포 압축을 모두 푼 폴더에서 시작해 주세요.')
    for port in (PORT,OMR_PORT):
        if not available(port):raise LaunchError(f'앱이 사용할 {port}번 연결을 다른 프로그램이 사용하고 있습니다. 이미 실행 중인 워십노트를 닫아 주세요.')
    directory=data_directory()
    if directory.is_symlink():raise LaunchError('앱 데이터 폴더를 확인할 수 없습니다.')
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    if sys.platform!='win32':directory.chmod(0o700)
    env=child_environment(directory);token=secrets.token_urlsafe(32)
    env.update(OMR_AUTH_TOKEN=token,OMR_PORT=str(OMR_PORT),OMR_BASE_URL=f'http://127.0.0.1:{OMR_PORT}',OMR_JOBS_DIR=str(directory/'jobs'))
    command=[sys.executable] if frozen else [sys.executable,str(Path(__file__).resolve())]
    # This checks all three ONNX graphs using the bundled interpreter before opening the browser.
    check=subprocess.run([*command,'--runtime-check'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
    if check.returncode:raise LaunchError('로컬 악보 인식 엔진을 시작할 수 없습니다. 배포 파일을 다시 풀어 주세요.')
    try:
        if not json.loads(check.stdout).get('ready'):raise ValueError()
    except ValueError:raise LaunchError('로컬 악보 인식 엔진 확인 결과를 읽을 수 없습니다.') from None
    env.update(OMR_EXECUTABLE=sys.executable if frozen else '',OMR_PYTHON=sys.executable,OMR_SOURCE=str(root.parent/'work'/'homr-source'),OMR_RUNTIME_VERIFIED='1',OMR_TEXT_SCRIPT=str((Path(getattr(sys,'_MEIPASS',root))/'scripts'/'local-text-ocr.py') if frozen else root/'scripts'/'local-text-ocr.py'),OMR_VISION_BINARY=str((Path(getattr(sys,'_MEIPASS',root))/'scripts'/'vision-ocr') if frozen else root/'scripts'/'vision-ocr'))
    companion=root/'support'/'omr-companion.mjs' if frozen else root/'scripts'/'omr-companion.mjs'
    host=root/'support'/'node-host.mjs' if frozen else root/'desktop'/'node-host.mjs'
    log=directory/'runtime.log';children=[]
    def close(_signum,_frame):raise KeyboardInterrupt()
    for name in ('SIGINT','SIGTERM','SIGHUP'):
        if hasattr(signal,name):signal.signal(getattr(signal,name),close)
    try:
        with log.open('w',encoding='utf8') as output:
            if sys.platform!='win32':log.chmod(0o600)
            children.append(subprocess.Popen([str(node),str(companion)],cwd=app,env=env,stdout=output,stderr=output))
            await_ready(f'http://127.0.0.1:{OMR_PORT}/capabilities',children,token)
            children.append(subprocess.Popen([str(node),str(host),str(app)],cwd=app,env=env,stdout=output,stderr=output))
            settings=await_ready(f'http://127.0.0.1:{PORT}/api/local-settings',children)
            print('워십노트를 시작했습니다.\n종료하려면 이 창에서 Control+C를 누르거나 창을 닫아 주세요.',flush=True)
            if smoke:
                print(json.dumps({'ready':True,'desktop':settings.get('desktop'),'localOMR':True,'url':f'http://127.0.0.1:{PORT}'}));return
            if not no_browser:webbrowser.open(f'http://127.0.0.1:{PORT}')
            while True:
                if any(child.poll() is not None for child in children):raise LaunchError('앱 연결이 종료되었습니다. 이 창을 닫고 다시 실행해 주세요.')
                time.sleep(.5)
    except KeyboardInterrupt:pass
    finally:stop_children(children)

def main():
    arguments=sys.argv[1:]
    if arguments and arguments[0]=='--runtime-check':runtime_check();return
    if arguments and arguments[0]=='--omr':run_omr(arguments[1:]);return
    if arguments and arguments[0]=='--text-ocr':run_text(arguments[1:]);return
    parser=argparse.ArgumentParser(description='워십노트 실행')
    parser.add_argument('--no-browser',action='store_true');parser.add_argument('--smoke-test',action='store_true');args=parser.parse_args()
    try:launch(args.no_browser,args.smoke_test)
    except (LaunchError,subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error,LaunchError) else '로컬 악보 인식 엔진 확인 시간이 초과되었습니다. 앱을 다시 실행해 주세요.',file=sys.stderr);raise SystemExit(1)

if __name__=='__main__':main()
