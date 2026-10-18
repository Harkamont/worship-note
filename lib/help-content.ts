import { recognitionOptions } from './recognition-options.ts';

/** Contextual help is kept here so the same feature uses the same Korean wording. */
export const helpContent = {
  'musicxml-local': { label: recognitionOptions['musicxml-local'].label, title: recognitionOptions['musicxml-local'].label, body: recognitionOptions['musicxml-local'].effect + ' ' + recognitionOptions['musicxml-local'].limit },
  'musicxml-hybrid': { label: recognitionOptions['musicxml-hybrid'].label, title: recognitionOptions['musicxml-hybrid'].label, body: recognitionOptions['musicxml-hybrid'].effect + ' ' + recognitionOptions['musicxml-hybrid'].limit },
  'musicxml': { label: recognitionOptions['musicxml'].label, title: recognitionOptions['musicxml'].label, body: recognitionOptions['musicxml'].effect + ' ' + recognitionOptions['musicxml'].limit },
  'annotations': { label: recognitionOptions['annotations'].label, title: recognitionOptions['annotations'].label, body: recognitionOptions['annotations'].effect + ' ' + recognitionOptions['annotations'].limit },
  'omr': { label: recognitionOptions['omr'].label, title: recognitionOptions['omr'].label, body: recognitionOptions['omr'].effect + ' ' + recognitionOptions['omr'].limit },
  'hybrid': { label: recognitionOptions['hybrid'].label, title: recognitionOptions['hybrid'].label, body: recognitionOptions['hybrid'].effect + ' ' + recognitionOptions['hybrid'].limit },
  'full': { label: recognitionOptions['full'].label, title: recognitionOptions['full'].label, body: recognitionOptions['full'].effect + ' ' + recognitionOptions['full'].limit },
  imageInput: {
    label: '악보 이미지 올리기',
    title: '이미지를 올리는 방법',
    body: 'PNG·JPG 파일을 올리거나 화면으로 끌어다 놓으세요. 악보 이미지를 복사했다면 입력 칸 밖을 누르고 Mac은 ⌘V, Windows는 Ctrl+V로 붙여넣을 수 있습니다.',
  },
  localRead: {
    label: '무료 악보 읽기',
    title: '이 기기에서 무료로 읽기',
    body: '이 기기에서 음표를 읽어 편집할 악보를 만듭니다. API 키와 AI 사용료는 필요하지 않습니다. 가사·코드는 빠질 수 있으므로 원본을 보며 직접 입력하거나 AI로 추가할 수 있습니다.',
  },
  localTextRead: {
    label: '가사·코드 글자 읽기',
    title: '가사와 코드의 글자만 무료로 읽기',
    body: '이 기기에서 한글 가사와 코드의 글자를 무료로 읽고, 고친 뒤 TXT로 저장할 수 있습니다. 음표는 읽지 않으며, 가사를 음표 아래에 붙이거나 코드를 박자에 맞춰 배치하지는 않습니다.',
  },
  aiRead: {
    label: 'AI 악보 읽기',
    title: 'AI로 읽으면 무엇이 달라지나요?',
    body: '‘가사·코드 추가’는 읽은 음표를 유지하고 글자와 코드를 붙이며, ‘AI 전체 읽기’는 음표까지 다시 읽습니다. 이미지는 연결한 AI 서비스에 전송되고 별도 사용료가 청구되며, 실패하거나 취소한 요청도 요금이 발생할 수 있습니다. AI 전체 읽기가 더 정확하다고 보장하지 않으니 적용 전에 원본과 비교해 주세요.',
  },
  aiConnection: {
    label: 'AI 연결 설정',
    title: 'AI를 쓸 때만 연결하세요',
    body: 'API 키는 AI 서비스를 사용할 때 필요한 비밀번호로, 이 컴퓨터의 앱 설정에 저장하며 악보·작업 파일에는 넣지 않습니다. 설정을 저장하는 것만으로 요금이 나오지는 않으며, 실제 인증 성공은 악보를 요청할 때 확인됩니다. AI 사용료는 ChatGPT 구독료와 별도이며, 모델의 이미지 지원 여부와 요금은 해당 서비스에서 확인하세요.',
  },
  transpose: {
    label: '전조',
    title: '우리 팀이 부를 키로 바꾸기',
    body: '키를 고르면 편집 악보의 멜로디와 코드가 함께 전조됩니다. 장조는 장조로, 단조는 단조로 바꿀 수 있습니다. 원본 이미지는 바뀌지 않으며, 잘못 읽은 음표는 별도로 고쳐야 합니다.',
  },
  tempo: {
    label: '빠르기',
    title: '빠르기 숫자 읽는 법',
    body: '4분음표를 1분에 몇 번 연주할지 나타냅니다. 예를 들어 80은 1분에 80번이며, 숫자가 클수록 빠릅니다. 이 값은 악보의 빠르기 표시와 내보낼 파일에 반영됩니다.',
  },
  scoreZoom: {
    label: '악보 확대·축소',
    title: '화면에서 보기 편한 크기로',
    body: '화면에 보이는 악보만 확대하거나 축소합니다. 다운로드할 악보의 가사 크기와 한 줄의 마디 수는 ‘출력 모양’에서 조절하세요.',
  },
  measuresPerLine: {
    label: '한 줄의 마디 수',
    title: '빽빽한 악보를 읽기 편하게',
    body: '한 줄에 넣을 최대 마디 수입니다. 음표·가사·코드가 많으면 설정한 수보다 적게 배치합니다. 한 마디가 아주 길면 악보를 넓게 표시하므로 가로로 이동해 보세요.',
  },
  sectionRange: {
    label: '마디 구간 지정',
    title: '몇 마디를 절·후렴으로 묶기',
    body: '‘나눌 부분’에서 구간을 고르고 시작·끝 마디에 ‘1절’, ‘후렴’ 같은 이름을 붙입니다. 마디 번호는 편집 악보 전체의 첫 마디부터 셉니다. 나눈 뒤에는 남은 부분을 골라 계속 나눌 수 있으며, 기존 부를 순서도 함께 조정됩니다.',
  },
  songForm: {
    label: '부를 순서',
    title: '이번 예배의 순서 정하기',
    body: '‘곡의 구간’에서 이름을 누르면 부를 순서 끝에 추가됩니다. 끌어놓거나 화살표로 순서를 바꾸고 반복 횟수를 정하세요. 선택한 순서와 반복은 가사 TXT에도 반영됩니다.',
  },
  lyricExport: {
    label: '가사 TXT',
    title: '자막 담당자에게 전할 가사',
    body: '부를 순서와 반복 횟수, 선택한 절을 반영해 텍스트 파일로 저장합니다. 가사 없이 길이만 나타내는 ‘－’ 표시는 빼고 저장합니다. 단어 사이의 띄어쓰기는 인식 결과를 확인해 주세요.',
  },
  sourceLyrics: {
    label: '악보에서 읽은 가사',
    title: '원본 파일에 담긴 가사',
    body: '읽은 악보 파일에 담긴 가사를 파트·절별로 모아 보여 줍니다. 편집 화면에서 정한 부를 순서와 반복 횟수는 반영하지 않습니다. 예배 순서에 맞춘 TXT는 편집 화면의 ‘가사’ 탭에서 저장하세요.',
  },
  lyricVerse: {
    label: '출력할 절',
    title: '여러 절 중 필요한 가사만',
    body: '‘기본 가사’는 각 구간의 첫 가사를, ‘모든 절’은 읽어 둔 절을 차례로 출력합니다. 특정 절을 고르면 그 절의 가사만 사용하며, 해당 가사가 없는 구간을 다른 절로 대신 채우지는 않습니다.',
  },
  musicxmlExport: {
    label: '악보 파일 XML',
    title: '다른 악보 앱에서 이어서 편집',
    body: '현재 편집한 음표·가사·코드를 MusicXML 파일로 저장합니다. MuseScore 등 MusicXML을 지원하는 앱에서 열 수 있지만, 글꼴과 줄 배치는 앱마다 달라질 수 있습니다. 파일 저장이 인식 정확도를 보장하지는 않습니다.',
  },
  projectBackup: {
    label: '작업 파일 보관',
    title: '다음에 이어서 작업하려면',
    body: '작업 파일(JSON)은 원본 이미지와 편집한 악보, 부를 순서, 보관 중인 인식 결과를 담습니다. 다른 컴퓨터로 옮기거나 따로 백업할 때 저장하세요. 이 앱의 ‘작업 파일 불러오기’로 다시 열 수 있습니다.',
  },
  melody: {
    label: '멜로디만 남기기',
    title: '4부 찬송가를 한 줄 악보로',
    body: '고른 오선에서 동시에 시작하는 음 중 가장 높은 음을 남기고, 이미 들어 있는 코드·가사도 함께 가져옵니다. 소프라노를 정확히 찾았다는 뜻은 아니므로 원본을 보며 남길 성부를 골라 주세요. 없는 코드를 만들거나 잘못 읽은 음표를 고치는 기능은 아닙니다.',
  },
  measureRepair: {
    label: '선택 마디 AI 수정',
    title: '고칠 마디만 골라 AI에 요청하기',
    body: '같은 파트에서 연속 1~4마디와 원본 이미지의 같은 부분을 직접 고릅니다. ‘번째’는 파일 안의 순서라 인쇄된 마디 번호와 다를 수 있으며, 미리 보기는 무료이고 유료 버튼을 눌러야 AI에 요청합니다. 수정안은 확인한 뒤 적용하며, 사용료 정보가 없다는 표시는 무료라는 뜻이 아닙니다.',
  },
  measureRepairImage: {
    label: 'AI에 보낼 이미지',
    title: '선택한 마디가 온전히 보이게',
    body: '고칠 마디의 코드·오선·가사가 빠지지 않게 표시하세요. 4배 확대를 켜면 선택 영역의 긴 쪽이 512px보다 작을 때만 확대하며, 원본에 없는 내용이 새로 생기지는 않습니다. 실제 사용료는 이미지 크기뿐 아니라 모델과 출력량에 따라 달라집니다.',
  },
  repairHistoryCost: {
    label: '마디 수정 사용료 합계',
    title: '이 합계에 포함되는 비용',
    body: '처음 인식과 지금까지 적용한 마디 수정 요청의 사용료를 더한 값입니다. 적용하지 않은 수정안과 실패한 요청의 요금은 포함하지 않습니다. 전체 청구액은 연결한 AI 서비스에서 확인하세요.',
  },
  saveLocation: {
    label: '작업 저장 위치',
    title: '지금 작업은 어디에 저장되나요?',
    body: '설치한 앱은 원본과 편집 내용을 이 기기의 앱 전용 폴더에 저장합니다. 웹으로 열었을 때는 현재 브라우저에 저장하므로 브라우저 데이터를 지우기 전에 작업 파일(JSON)을 보관하세요. 다른 컴퓨터로 옮길 때도 작업 파일이 필요합니다.',
  },
  originalReview: {
    label: '원본과 인식 결과 확인',
    title: '적용 전에 원본과 비교하세요',
    body: '원본 이미지와 읽은 악보를 마디별로 비교하세요. 자동 검사는 파일 구성과 박자를 확인하지만, 음높이·가사·코드가 맞는지까지 판별하지는 못합니다. 처음 인식한 파일과 적용한 수정안은 작업 파일에 함께 보관합니다.',
  },
  fileFormats: {
    label: '불러올 파일 종류',
    title: '어떤 파일을 열면 되나요?',
    body: 'PNG·JPG는 악보를 읽을 때, MusicXML·XML·MXL은 다른 악보 앱에서 만든 악보를 열 때 사용합니다. 이전에 이 앱에서 저장한 작업을 이어 하려면 작업 파일(JSON)을 불러오세요.',
  },
  exportFormats: {
    label: '다운로드 파일 종류',
    title: '필요한 형식으로 저장하세요',
    body: '악보 이미지(PNG)는 지금 편집한 악보를, 가사(TXT)는 부를 순서대로 정리한 글을 저장합니다. 악보 파일(XML)은 다른 악보 앱에서 편집할 때, 작업 파일(JSON)은 원본과 작업 내용을 보관하거나 이 앱에서 다시 열 때 사용합니다.',
  },
  draftImport: {
    label: '검토용 악보 열기',
    title: '확인할 오류가 있어도 열고 고치기',
    body: '박자 등 확인할 내용이 남은 악보를 검토용으로 엽니다. 자동 검사를 통과한 결과가 아니므로 표시된 마디를 원본과 비교해 고쳐 주세요. 가져오면 현재 편집 중인 악보를 교체하며, 처음 인식한 파일은 계속 보관합니다.',
  },
  rhythmReview: {
    label: '박자 확인',
    title: '음표 길이의 합을 확인하세요',
    body: '마디의 실제 길이와 음표·쉼표 길이의 합이 다르면 확인 표시가 붙습니다. 못갖춘마디라면 먼저 ‘이 마디의 길이’를 맞추세요. 합이 맞아도 음높이나 리듬이 원본과 같다는 뜻은 아닙니다.',
  },
  shortMeasure: {
    label: '짧은 마디',
    title: '첫 마디가 짧을 때',
    body: '4분음표 1개를 1박으로 세어 이 마디의 실제 길이를 고르세요. 예를 들어 4/4박자 곡의 첫 마디에 4분음표 한 개만 있으면 1박을 선택합니다. 마디 길이만 바꾸므로 음표는 직접 확인해야 합니다.',
  },
  noteEntry: {
    label: '음표 입력',
    title: '음이름·길이·가사 고치기',
    body: '음이름은 C4(가온 도), F#4(파♯), Bb4(시♭)처럼 입력하며 숫자는 옥타브입니다. 음이름을 비우면 쉼표가 됩니다. 오른쪽 칸에서 음표 길이와 그 음에 붙일 가사를 고치세요.',
  },
  scoreEditing: {
    label: '악보 편집',
    title: '마디를 누르면 고칠 수 있어요',
    body: '편집 악보에서 고칠 마디를 누르면 음표·코드·가사 입력 칸이 열립니다. 음표를 바꾼 뒤에는 원본과 비교하고, 박자 확인 표시가 생기면 길이의 합도 확인하세요.',
  },
  chordPosition: {
    label: '코드 위치',
    title: '코드를 몇 박째에 넣을까요?',
    body: '4분음표 1개를 1박으로 세며, 마디의 첫 박은 1입니다. 4/4박자에서 3박째에 코드를 바꾸려면 3을, 첫 박과 둘째 박 사이면 1.5를 입력하세요.',
  },
} as const;

export type HelpKey = keyof typeof helpContent;
