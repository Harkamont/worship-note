# Third-party software and models

워십노트의 배포 소스는 루트 `LICENSE`의 AGPL-3.0 조건을 따릅니다. 각 제3자 구성 요소의 원래 저작권·라이선스도 유지합니다. 사용자가 불러온 악보와 가사는 이 소프트웨어 라이선스에 포함되지 않으며 배포 샘플에 포함하지 않습니다.

## HOMR

- Source: <https://github.com/liebharc/homr/tree/ab369ac54277afab582afa4725441f7cbba76593>
- Source revision: `ab369ac54277afab582afa4725441f7cbba76593`
- Code and model weights: AGPL-3.0 as published upstream.
- Full upstream license: `public/notices/HOMR-LICENSE.txt`
- Upstream model/training-data explanation, retained verbatim: `public/notices/HOMR-LICENSE-FAQ.md`
- Runtime distributions must include the pinned HOMR source and notices, as well as the app source archive or instructions for obtaining the exact corresponding source. Model file hashes belong in the runtime manifest.

HOMR의 원문 고지는 일부 학습 데이터의 이용 조건이 불명확하거나 비상업 조건으로 표시된 자료가 있음을 설명합니다. 코드·가중치의 AGPL 표기와 학습 데이터에 대한 설명을 함께 보존합니다. 모델이나 악보에 대한 추가 권리를 이 앱이 부여하지 않습니다.

## Rendering and fonts

| Component | Version / license | Retained notice |
| --- | --- | --- |
| OpenSheetMusicDisplay | 2.2.1, BSD-3-Clause; copyright PhonicScore | `public/notices/OSMD-LICENSE.txt` |
| VexFlow | 5.0.0, MIT | `public/vexflow-license.txt` |
| Bravura | SIL Open Font License | `public/bravura-license.txt` |
| Academico | SIL Open Font License | `public/academico-license.txt` |
| Worship Note Serif Semibold | Noto Serif KR 기반, SIL Open Font License 1.1 | `public/notices/NotoSerifKR-OFL.txt`, `public/notices/WorshipNoteSerif-SOURCE.txt` |

## Runtime and other dependencies

Node, Python, React, Vinext, NumPy, OpenCV, ONNX Runtime, Pillow, RapidOCR and other bundled dependencies retain their original licenses. A runtime release includes their package metadata/notices; the source release contains the JavaScript dependency lockfile and pinned Python build inputs. PyInstaller's bootloader exception is retained in its notices when used for packaging. The app license does not replace any of these licenses.

## Provided sheet music and credentials

User PNG/JPG/XML files, benchmark transcriptions, API keys, local configuration, logs and the parent workspace's `work`/`outputs` folders are excluded from release source archives. Only the app's original practice score is included as a built-in sample. Distributing this program does not authorize copying or distributing a user's sheet music.
