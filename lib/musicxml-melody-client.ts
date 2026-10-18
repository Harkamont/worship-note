import { analyzeMusicXML } from './musicxml-review.ts';
import { parseMusicXML } from './musicxml-import.ts';
import type { MusicXMLRecognitionResult } from './recognition.ts';

/** Local derived review: retain the source recognition receipt and never claim
 * that an earlier paid recognition was free merely because extraction is local.
 */
export function reviewExtractedMelody(source: MusicXMLRecognitionResult, extracted: { xml: string; warnings: string[] }, options: { reviewDraft?: boolean } = {}): MusicXMLRecognitionResult {
  const document = analyzeMusicXML(extracted.xml);
  for (const message of extracted.warnings) document.issues.push({ severity: 'warning', code: 'MELODY_EXTRACTION_NOTICE', message });
  let score: MusicXMLRecognitionResult['score'] = null;
  let editorIssue: string | null = null;
  try {
    if (!options.reviewDraft && document.issues.some(issue => issue.severity === 'error')) throw new Error('단선 악보의 구조 검사 항목을 먼저 확인해 주세요.');
    score = parseMusicXML(extracted.xml, options);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '현재 편집기가 지원하지 않는 악보 구성이 있습니다.';
    editorIssue = message.length > 8000 ? message.slice(0, 8000) + '\n자세한 내용은 원본 XML을 확인해 주세요.' : message;
  }
  return { ...source, document, score, editorIssue };
}
