# 찬양노트 Implementation Plan

> For agentic workers: use subagent-driven-development for the isolated domain and API tasks. Keep secrets out of all files except an explicitly approved ignored environment file.

**Goal:** 이미지 악보를 편집·전조하고 송폼에 따라 PNG와 가사 TXT를 출력하는 실제 사용 가능한 첫 앱.

**Architecture:** Vinext React 화면과 서버 API. 도메인 데이터는 TypeScript 공용 모듈, 악보는 SVG로 렌더링. 브라우저 저장과 파일 다운로드는 클라이언트에서 수행. 인식은 공급자별 서버 어댑터로 분리.

**Tech Stack:** React 19, TypeScript, Vinext, VexFlow, Node test, Sites private hosting.

## 1. 도메인 데이터·전조·송폼
- [ ] `lib/score-types.ts`: Score, Section, Measure, Note, Chord, FormEntry 타입 정의.
- [ ] `tests/music.test.ts`: C/E→D/F#, 조표에 맞는 음이름, 단조, 코드 품질 유지, 가사 반복·누락, 악보 검증 실패를 먼저 검증.
- [ ] `lib/music.ts`, `lib/sample.ts`: 전조, TXT, MusicXML, 원본 연습곡 및 유효성 검사 구현.
- [ ] `node --experimental-strip-types --test tests/music.test.ts`가 통과하는지 확인.

## 2. 악보 표시·이미지 출력
- [ ] `components/score-view.tsx`: 단선율, 박자, 조표, 코드, 가사, 구간, 마디 선택을 SVG로 표시.
- [ ] 원본 연습곡을 렌더링하고 PNG로 변환한 이미지의 크기와 파일 서명을 확인.

## 3. 교체 가능한 인식 API
- [ ] 공식 문서에서 luna API 모델과 이미지 입력·JSON 출력 규격을 확인.
- [ ] `tests/recognition.test.ts`: 미설정, 비지원 이미지, 악성 응답 구조, 인식 오류 경로를 실패 테스트로 고정.
- [ ] `lib/recognition.ts`, `app/api/config/route.ts`, `app/api/recognize/route.ts`: 서버 설정, 모델, 제한, 타임아웃, 사용량 및 공급자 어댑터 구현.
- [ ] `.env.example`: 키 값 없이 변수명과 기본값만 문서화.

## 4. 편집 화면과 저장
- [ ] `app/page.tsx`, `app/globals.css`: 이미지 업로드, 샘플, 키 변경, 음표·코드·가사 교정, 구간 생성·이름 변경, 송폼 순서·반복, TXT 미리보기, 다운로드, 작업 복원 연결.
- [ ] 업로드 파일 검증과 인식 전후 원본 보존, 취소, 오류 안내 확인.

## 5. 검증과 게시
- [ ] 도메인·서버 테스트와 타입 검사 수행.
- [ ] 로컬 브라우저에서 실제 버튼, 모바일, 저장 복원, 이미지 업로드와 다운로드 확인.
- [ ] 독립된 사양 검토 후 코드 품질 검토 및 필요한 수정.
- [ ] Sites 소스 동기화·빌드·비공개 게시. 결과 URL과 남은 실제 AI 연결 제한을 보고.
