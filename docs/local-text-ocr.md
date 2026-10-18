# Mac 로컬 가사·코드 텍스트 초안

2026-10-18, 사용자가 제공한 7종 악보로 실행했다. 자동 출력은 수동 정답을 읽지 않는다. 이 경로는 Score를 생성하거나 기존 음표·코드·송폼을 덮어쓰지 않는다.

## 실행 준비

현재 작업 폴더의 HOMR 소스·모델·Python 환경과 Audiveris 준비 과정에서 받은 Tesseract 5.5.2/Leptonica/kor·eng 모델을 사용한다. 이 자원은 앱 저장소에 포함돼 있지 않다. 새 컴퓨터의 설치가 자동 완료된다는 뜻은 아니다.

Mac에서 앱 폴더를 기준으로 Swift 실행 파일을 만든다.

```sh
xcrun swiftc -O scripts/vision-ocr.swift -o scripts/vision-ocr
node scripts/omr-companion.mjs
```

Companion은 기존 `.env.local`의 OMR 인증 설정을 사용한다. API 키는 새 OCR 경로에 전달하지 않는다. 기존 Companion이 실행 중이었다면 새 경로를 사용하려면 해당 프로세스를 재시작한다. 앱을 새로고침하면 인증된 capability 확인 후 이미지 업로드 모달에 **이 기기에서 가사·코드만 읽기**가 표시된다.

생성한 초안을 원본과 대조하고 수정한 뒤 TXT로 받을 수 있다. 가사 여러 절과 위쪽 대체 코드행을 인쇄 순서대로 표시한다. 자동으로 음표나 박에 붙이거나 반복 연주 순서를 해석하지 않는다.

## 처리

- HOMR는 오선 좌표만 검출한다. 자동 자르기·크기 변경을 되돌려 원본 이미지 좌표로 변환한다. 찬송가의 상하 오선은 텍스트 영역을 따로 정하는 데 사용한다.
- Apple Vision이 전체 페이지 1배/3배와 가사·코드 영역을 읽는다. Tesseract가 코드와 다성부 찬송가의 가사를 보조한다.
- 코드 후보는 이미지 위치로 중복을 합치고 두 엔진이 같은 기호를 읽은 경우를 우선한다. 단독 엔진 후보도 남을 수 있다. 가사는 같은 물리적 행의 후보 중 글자 수가 많은 쪽을 선택하므로 잡글자가 추가될 수 있다.
- 보조 OCR가 실행되지 않으면 가능한 Vision 결과를 사용하고 경고한다. 입력 이미지는 임시 복사본만 정규화한다.

현재 로컬 실험 입력은 4MP·한 변 2500px 이하이며, 새 7장은 모두 해당한다. Companion은 10MiB 입력·2MiB 출력·한 번에 한 작업·실행 제한·인증·임시 파일 정리를 적용한다. 게시 사이트에 Mac 실행 환경을 올리지는 않았다.

## 검증

```sh
npm test
npm run typecheck
npm run lint
npm run build
../work/homr-runtime/bin/python -m unittest discover -s tests -p 'test_local_text*.py'
```

7장 모두 실제 CLI를 실행하고 별도의 원본 전사와 비교했다. 측정 자료는 작업 폴더 `work/local-ocr-benchmark/production/`와 `results/evaluation-final.json`, 독립 검산은 `audit_final.py`에 있다. 가사 문자 오류율과 코드 기호+원본 이미지 위치를 평가했으며 음표·리듬·박·송폼 정확도는 측정하지 않았다. 7장은 개발 표본이므로 새 악보에 대한 일반 성능으로 해석하지 않는다.
