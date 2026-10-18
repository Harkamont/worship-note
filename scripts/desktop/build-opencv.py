#!/usr/bin/env python3
"""Build only OpenCV image operations; do not package video/audio codecs."""
import argparse,hashlib,json,os,re,shutil,subprocess,sys,tarfile,urllib.request
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--directory',type=Path,required=True);parser.add_argument('--jobs',type=int,default=6);args=parser.parse_args()
project=Path(__file__).resolve().parents[2];manifest=json.loads((project/'desktop/runtime-sources.json').read_text());asset=manifest['opencvSource']
root=args.directory.resolve();root.mkdir(parents=True,exist_ok=True)
archive=root/'opencv-4.13.0.tar.gz'
if not archive.exists():
    with urllib.request.urlopen(asset['url']) as response,archive.open('wb') as out:shutil.copyfileobj(response,out)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=asset['sha256']:raise SystemExit('OpenCV source checksum mismatch')
source=root/'opencv-4.13.0'
if not source.exists():
    with tarfile.open(archive) as package:package.extractall(root,filter='data')
cmake=Path(sys.executable).with_name('cmake.exe' if sys.platform=='win32' else 'cmake')
ninja=Path(sys.executable).with_name('ninja.exe' if sys.platform=='win32' else 'ninja')
import sysconfig
site=Path(sysconfig.get_path('platlib'))
python_include=Path(sysconfig.get_path('include'))
python_library=Path(sys.base_prefix)/'lib'/(sysconfig.get_config_var('LDLIBRARY') or 'libpython3.12.dylib')
if sys.platform=='win32':python_library=Path(sys.base_prefix)/'libs'/f'python{sys.version_info.major}{sys.version_info.minor}.lib'
configuration=[str(cmake),'-UPYTHON3*','-S',str(source),'-B',str(root/'build'),'-G','Ninja',f'-DCMAKE_MAKE_PROGRAM={ninja}',f'-DCMAKE_INSTALL_PREFIX={root/"install"}',f'-DPYTHON3_EXECUTABLE={sys.executable}',f'-DPYTHON3_INCLUDE_DIR={python_include}',f'-DPYTHON3_LIBRARY={python_library}',f'-DOPENCV_PYTHON3_INSTALL_PATH={site}','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0','-DBUILD_LIST=core,imgproc,imgcodecs,python3,python_bindings_generator','-DBUILD_SHARED_LIBS=OFF','-DBUILD_opencv_python3=ON','-DBUILD_opencv_python2=OFF','-DBUILD_JAVA=OFF','-DBUILD_TESTS=OFF','-DBUILD_PERF_TESTS=OFF','-DBUILD_EXAMPLES=OFF','-DBUILD_DOCS=OFF','-DBUILD_opencv_apps=OFF','-DBUILD_ZLIB=ON','-DBUILD_JPEG=ON','-DBUILD_PNG=ON','-DWITH_FFMPEG=OFF','-DWITH_GSTREAMER=OFF','-DWITH_AVFOUNDATION=OFF','-DWITH_OPENCL=OFF','-DWITH_IPP=OFF','-DWITH_ITT=OFF','-DWITH_OPENEXR=OFF','-DWITH_PROTOBUF=OFF','-DWITH_QUIRC=OFF','-DWITH_WEBP=OFF','-DWITH_TIFF=OFF','-DWITH_JPEG=ON','-DWITH_PNG=ON','-DWITH_JPEGXL=OFF','-DWITH_AVIF=OFF','-DWITH_OBSENSOR=OFF','-DWITH_OPENVX=OFF','-DWITH_LAPACK=OFF','-DWITH_ADE=OFF','-DWITH_SIMD=OFF']
subprocess.run(configuration,check=True)
subprocess.run([str(cmake),'--build',str(root/'build'),'--parallel',str(args.jobs)],check=True)
subprocess.run([str(cmake),'--install',str(root/'build')],check=True)
# OpenCV's generated loader uses the build prefix by default. Make both lookup
# lists relative so the frozen package can run on another computer.
python_tag=f'{sys.version_info.major}.{sys.version_info.minor}'
(site/f'cv2/config-{python_tag}.py').write_text(f"PYTHON_EXTENSIONS_PATHS = [os.path.join(LOADER_DIR, 'python-{python_tag}')] + PYTHON_EXTENSIONS_PATHS\n")
(site/'cv2/config.py').write_text("BINARIES_PATHS = [] + BINARIES_PATHS\n")
if not (site/'cv2/typing/__init__.py').exists():
    (site/'cv2/typing').mkdir(exist_ok=True)
    shutil.copy2(project/'desktop/cv2-typing-compat.py',site/'cv2/typing/__init__.py')
metadata=site/'opencv_python_headless-4.13.0.92+chanyang1.dist-info';metadata.mkdir(exist_ok=True)
(metadata/'METADATA').write_text('Metadata-Version: 2.1\nName: opencv-python-headless\nVersion: 4.13.0.92+chanyang1\nLicense: Apache-2.0\nHome-page: https://github.com/opencv/opencv\nSummary: Minimal image-only OpenCV build for Chanyang Score Studio\n')
shutil.copy2(source/'LICENSE',metadata/'LICENSE')
for base in [source/'3rdparty',source/'hal',root/'build/3rdparty']:
    if base.exists():
        for path in base.rglob('*'):
            if path.is_file() and any(token in path.name.lower() for token in ['license','copying','copyright']):
                destination=metadata/'licenses'/base.name/path.relative_to(base)
                destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,destination)
# Metadata RECORD lists the actual local package and licenses for the notice copier.
files=list((site/'cv2').rglob('*'))+list(metadata.rglob('*'))
(metadata/'RECORD').write_text(''.join(str(path.relative_to(site))+',,\n' for path in files if path.is_file()))
(root/'build-recipe.json').write_text(json.dumps({'source':asset,'command':configuration,'python':sys.version.split()[0],'jobs':args.jobs},indent=2)+'\n')
import cv2
assert not re.search(r'(FFMPEG|GStreamer):\s+YES',cv2.getBuildInformation())
assert all(hasattr(cv2,name) for name in ['imread','resize','findContours','cvtColor'])
print(cv2.__version__,cv2.__file__)
