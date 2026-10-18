import { BookOpen, FileJson, FileText, Image as ImageIcon, Music2 } from 'lucide-react';

export default function GettingStartedHelp({ onClose }: { onClose: () => void }) {
  return <>
    <div className="help-list">
      <div><span>01</span><section><h3>악보를 올리고 읽어 보세요</h3><p>PNG·JPG 파일을 올리거나 복사한 이미지를 붙여넣으세요. 기본 음표 인식은 무료이며 AI 연결이 필요 없습니다. 읽기를 마치면 원본과 나란히 비교할 수 있습니다.</p></section></div>
      <div><span>02</span><section><h3>우리 팀에 맞게 다듬으세요</h3><p>키를 바꾸면 멜로디와 코드가 함께 바뀝니다. 악보의 마디를 누르면 음표·가사·코드를 직접 고칠 수 있습니다. 4부 찬송가는 원본 비교 화면에서 부를 멜로디만 남길 수 있습니다.</p></section></div>
      <div><span>03</span><section><h3>절·후렴을 나누고 부를 순서를 정하세요</h3><p>마디를 골라 1절·후렴 등의 이름을 붙이세요. 원하는 구간을 순서에 넣고 반복 횟수를 정하세요. 악보 이미지에는 구간별 악보와 부를 순서가 표시되고, 가사 TXT와 편집용 XML은 순서·반복대로 저장됩니다.</p></section></div>
    </div>
    <details className="help-guide-detail"><summary>어떤 파일로 저장하면 좋을까요?</summary><div className="help-file-list">
      <div><ImageIcon size={18}/><p><strong>악보 이미지 · PNG</strong><span>현재 편집한 악보를 이미지로 저장합니다.</span></p></div>
      <div><FileText size={18}/><p><strong>가사 · TXT</strong><span>선택한 절의 가사를 부를 순서와 반복 횟수에 맞춰 저장합니다.</span></p></div>
      <div><Music2 size={18}/><p><strong>편집용 악보 · MusicXML</strong><span>다른 악보 프로그램에서 음표·코드·가사를 이어서 편집할 때 사용합니다.</span></p></div>
      <div><FileJson size={18}/><p><strong>작업 파일 · JSON</strong><span>원본 이미지와 편집 내용을 함께 보관합니다. 다른 컴퓨터로 옮기거나 나중에 다시 작업할 때 선택하세요.</span></p></div>
    </div></details>
    <details className="help-guide-detail"><summary>AI는 언제 사용하나요?</summary><p>가사·코드를 추가하거나, 잘못 읽은 마디를 다시 읽을 때 선택할 수 있습니다. AI 버튼에는 ‘유료’라고 표시합니다. 원본에서 고칠 1~4마디를 직접 고르고, 수정안을 확인한 뒤 적용하세요. AI도 잘못 읽을 수 있으며 실패한 요청에도 사용료가 발생할 수 있습니다.</p></details>
    <details className="help-guide-detail"><summary>이미 있는 악보 파일도 열 수 있나요?</summary><p>‘악보 파일 불러오기’에서 MusicXML·XML·MXL 파일을 여세요. 여러 성부가 있는 악보는 멜로디를 먼저 고를 수 있습니다. 박자가 맞지 않는 마디는 확인 표시를 보고 수정하세요.</p></details>
    <button className="button primary full-width" onClick={onClose}><BookOpen size={16}/>악보 준비하기</button>
  </>;
}
