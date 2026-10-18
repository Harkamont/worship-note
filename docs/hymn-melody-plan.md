# Hymn soprano extraction

User-requested scope: take a four-part hymn and retain a selected soprano melody with printed chord labels. Local processing only, no new harmony generation or paid AI call.

- [x] Implement explicit part/staff/voice candidate listing and source-preserving extraction with tests for chord-top lyrics, rests, held notes, timing, tuplets, pickups, keys and printed chords.
- [x] Add a separate extraction preview, XML/TXT downloads and explicit editor import; retain the original full score and original recognition costs.
- [x] Test the supplied hymn against independent soprano first-line reference, report OMR voice-assignment errors separately from extraction behavior.
- [x] Verify original/compatible output, actual browser controls/downloads, full app tests, typecheck, lint, build and independent review.

The first version selects a fixed voice. It must not silently combine changing source voice IDs or turn a moving lower part into melody during a sustained soprano note. An uncertain recommendation needs source comparison and manual source choice. No claim that the OMR's voice numbers are a verified SATB transcription.

Verified 2026-10-18: 255/255 tests, typecheck and build pass; lint has no errors and three existing image warnings. Independent review repros fixed: scoped octave directions, wholly omitted lyric verses, exact integer time moves, and lyrics attached to middle tones of the same chord. Actual browser local image recognition finished in 6.8 seconds with reported API cost $0. Cached annotated hymn XML retained 35 harmonies and three lyric verses while reducing 297 note/rest elements to 78 across 21 measures. Downloaded UI XML matches the independently validated extraction hash and passes offline MusicXML 4 XSD. Editor project export retains all numbered lyric verses. The user's prior 24-measure G project was restored after the import test. Independent first-five-measure accuracy remains 14/19 before and after extraction; source recognition errors are unresolved.
