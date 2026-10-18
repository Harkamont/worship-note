# 설치형 프로그램 빌드

배포된 Mac 실행 파일은 Python과 Node.js를 포함합니다. 사용하는 분은 개발 도구를 설치할 필요가 없습니다. 이 문서는 소스에서 같은 프로그램을 만드는 개발자를 위한 설명입니다.

현재 배포본은 Apple Silicon 및 macOS 15 이상을 요구합니다. 포함한 Tesseract·Leptonica 바이너리의 최소 버전이 macOS 15이기 때문입니다. 실제 실행 검증은 이 작업에 사용한 Mac 한 대에서 했습니다. 현재 검증한 빌드 환경은 Apple Silicon Mac, Python 3.12.14, Node.js 24.22.0, PyInstaller 6.22.3입니다. Windows 실행 파일은 Windows에서 같은 Python 절차로 따로 빌드해야 합니다. 이 저장소에 Windows에서 실행해 검증한 바이너리는 포함하지 않습니다. Mac 가사·코드 로컬 인식은 Apple Vision과 Tesseract를 사용합니다. Windows 빌드에서는 이 부가 기능을 비활성으로 표시하며 HOMR 음표 인식과 선택한 AI 연결을 사용할 수 있습니다.

## 필요한 도구

- Python 3.12 및 가상 환경 기능
- Node.js 24 및 npm
- Git
- Mac: Xcode Command Line Tools (`xcode-select --install`, C++와 Swift 빌드에 사용)
- Windows 빌드: Visual Studio Build Tools의 C++ 도구와 Windows SDK, 해당 개발자 명령 프롬프트
- 처음 빌드할 때 공개 패키지·모델을 받기 위한 인터넷 연결

HOMR의 고정 커밋, CPU 모델 세 개, Mac OCR 라이브러리와 언어 데이터의 원본 주소·SHA-256은 `desktop/runtime-sources.json`에 있습니다. Python 의존성은 `desktop/runtime-requirements.txt`에 고정했습니다. OpenCV는 공개 wheel의 불필요한 동영상·음성 코덱을 포함하지 않도록 4.13.0 소스에서 core·imgproc·imgcodecs·Python 모듈만 정적으로 빌드합니다. FFmpeg·GStreamer·videoio는 사용하지 않습니다. 최소 모듈 빌드에서 생성되지 않는 cv2.typing에는 HOMR의 형식 표시에 필요한 MatLike·Rect·RotatedRect 세 별칭만 추가합니다. OpenCV의 이미지 처리 함수를 변경하지 않습니다. OpenCV와 GEOS의 정확한 원본 소스 압축도 함께 받으며 배포 폴더의 source에 넣습니다. 준비 스크립트가 먼저 이 로컬 OpenCV 패키지를 설치한 뒤 나머지 의존성을 설치합니다. 이 준비 과정은 Codex·개발자의 캐시·개인 설정 파일을 읽지 않습니다. 공식 PyPI·GitHub·Maven Central·OSGeo·Node.js 배포소에서 지정한 자료를 받고 모델·자료의 해시를 확인합니다.

프로젝트 최상위 폴더에서 실행합니다.

```sh
npm ci
npm run test
npm run test:desktop
npm run build:desktop
python3 scripts/desktop/prepare-runtime.py --directory ../work/desktop-build
../work/desktop-build/python-build/bin/python scripts/desktop/build-runtime.py --homr-source ../work/desktop-build/homr-source --runtime-root ../work/desktop-build/ocr-runtime --work-dir ../work/desktop-build/pyinstaller --dist-dir ../work/desktop-build/frozen
python3 scripts/desktop/package-release.py --frozen-dir ../work/desktop-build/frozen/ChanyangScoreStudio --destination ../work/desktop-build/ChanyangScoreStudio-macos-arm64 --cache-dir ../work/desktop-build/downloads --homr-source ../work/desktop-build/homr-source --native-source-dir ../work/desktop-build/redistribution-sources
../work/desktop-build/python-build/bin/python scripts/desktop/collect-notices.py ../work/desktop-build/ChanyangScoreStudio-macos-arm64/notices
../work/desktop-build/ChanyangScoreStudio-macos-arm64/ChanyangScoreStudio --smoke-test --no-browser
```

Windows에서는 `python3` 대신 `py -3.12`, 가상 환경의 `bin/python` 대신 `Scripts/python.exe`, 실행 파일 이름은 `ChanyangScoreStudio.exe`를 사용합니다. 배포 폴더 이름도 Windows용 이름으로 지정합니다. 이 공통 빌드 경로의 Windows 실행은 아직 검증하지 않았습니다.

`build:desktop`은 지정된 소스 폴더만 임시 폴더에 복사한 후 빌드합니다. `.env*`, `.openai`, 사용자가 올린 악보 및 기존 `work` 폴더는 빌드 입력에 포함하지 않습니다. 웹 배포는 기존 `npm run build` 절차를 사용합니다.

`package-release.py`는 공식 Node.js 배포 파일의 SHA-256을 확인합니다. Python 실행 환경은 PyInstaller가 실제 인터프리터와 필요한 라이브러리를 모은 결과를 사용합니다. 외부 폴더를 가리키는 심볼릭 링크가 있으면 패키징을 중단합니다. 준비용 가상 환경을 배포 폴더에 복사하지 않습니다.

## 배포 전 확인

`--smoke-test`는 포함된 Python에서 CPU 모델 세 개를 로드하고, 두 로컬 서버를 시작한 뒤 준비 응답을 확인하고 모두 종료합니다. 실제 악보 한 장도 인식해 MusicXML을 얻고 검토해야 합니다. 기본 테스트는 API 비용이 들지 않습니다.

Mac 시작 파일은 `워십노트 시작.command`, Windows 시작 파일은 `워십노트 시작.cmd`입니다. 브라우저 주소는 `http://127.0.0.1:3210`이고 음표 인식 서버는 `127.0.0.1:3211`에서만 듣습니다. 실행 창을 닫거나 Control+C를 누르면 두 서버와 처리 중인 인식 작업을 종료합니다. 개인 AI 설정과 임시 작업은 운영체제의 사용자 앱 데이터 폴더에 저장합니다.

현재 Mac 바이너리는 개발자 인증서 서명과 Apple 공증을 받지 않은 시험 배포본입니다. 실제 확인한 Mac 외의 운영체제·기기 호환성을 보장하는 정식 배포로 표시하지 마세요. 배포에는 앱 소스 압축, 정확한 HOMR 커밋의 소스, 앱과 의존성의 저작권·라이선스 고지를 함께 넣어야 합니다. `package-release.py --app-source-archive ... --homr-source ...`로 추가할 수 있습니다.
