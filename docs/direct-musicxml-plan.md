# Direct MusicXML and lyric preservation — implementation plan

**Goal:** Compare direct image-to-MusicXML transcription fairly while retaining lyric syllables, verses, and extensions, including XML that the simple editor cannot represent.

**Approved basis:** The user accepted the proposed image → AI MusicXML → structural checks → source comparison → editing/export flow on 2026-10-18 and requested implementation. Existing unsaved work stays in this checkout; no deployment or secret output.

## Decisions

- Keep the existing HOMR and inexpensive local text OCR paths for comparison.
- Add a separately configured direct MusicXML model. Verify the exact requested GPT-6.1 Sol identifier; never silently substitute another model.
- Retain the AI's complete XML even if the simple score editor rejects its voices, tuplets, pickup, or key changes. Display and download that document with the original image and specific issues.
- Structural validity is not recognition accuracy. Report both separately.
- Preserve lyric text, verse, syllabic, extension, and explicit line endings. TXT omits notation-only continuation markers without deleting punctuation inside real words.
- Do not guess natural Korean spacing, missing notes, chords, or song form. Keep uncertain content reviewable.

## Tasks

- [x] Verify model availability, image support and price from official sources and the configured provider.
- [x] Add failing regressions for multi-verse lyric import/export, melismas, TXT and legacy project compatibility; implement the smallest backward-compatible extension.
- [x] Add a bounded MusicXML review parser and tests for durations/onsets, backup/forward, simultaneous notes, pickup, tuplets, lyric verses, and unsafe XML.
- [x] Add a direct XML request mode using existing origin, upload, cancellation, locking, credential, error and usage handling. Test raw XML, truncation, invalid XML, and editor-incompatible XML preservation.
- [x] Add source/result comparison and downloadable XML/TXT in the upload workflow. Import to the simple editor only after successful conversion and explicit user action.
- [x] Test all seven supplied formats with bounded paid requests, save raw outputs and usage; compare exact printed lyrics/chords and clearly defined note samples against independent references. Include failed requests in cost.
- [x] Run tests, typecheck, lint, production build, actual browser preview/export, independent code review, and final evidence report.

## Completion evidence

Meaningful red/green regression runs; bounded API receipts with no keys; all seven documents evaluated without treating parser rejection as zero-cost success; browser source/result comparison and downloads; outputs report with measured results and limitations.

## Measured adaptation

Direct XML was not consistently the best note recognizer. Added a separate raw-HOMR XML + AI-only lyric/chord route, with immutable melody checks and recoverable first-stage drafts. The shared five-image comparison, all failed requests and unresolved billing appear in the output report. Original XML is retained; a separate compatible download reorders only known MusicXML containers and preserves musical content. Six compatible samples passed offline XSD; the real browser download matched its verified file hash. Final verification: 231/231 app tests, typecheck, lint (0 errors, 3 existing image warnings), production build, independent review and actual UI upload/preview/TXT/compatible XML downloads.
