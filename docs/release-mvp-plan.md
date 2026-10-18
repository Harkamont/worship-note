# 찬양노트 Local MVP Release Plan

> Agent workers: use subagent-driven development with isolated file ownership. Preserve all prior work and user projects. No publication, paid AI, credentials in artifacts, or unrequested commits.

**Goal:** Produce a reviewable local release candidate for nontechnical Korean pastors: open the app, recognize a provided PNG/JPG without a key, retain original and editable draft, arrange sections and song form, save/reopen, and export XML/PNG/TXT. Verify on this Mac; distinguish Windows build support from an actually tested Windows release.

**Architecture:** Keep the tested React/TypeScript music editor and recognition handlers. Add a desktop standalone Node server rather than rewrite music validation in Python. A common Python launcher manages local resources and starts/stops Node and HOMR; desktop distribution must not depend on the developer's virtualenv paths. Local-only settings are supplied by the desktop environment adapter; web builds do not gain file access. AI stays optional and explicit.

**Release criteria:** Fresh app without API keys is usable; full XML/source image/derived melody survive close/reload/JSON backup; changing projects clears unrelated review; imported measures can be assigned Verse/Chorus ranges without losing notes; local configuration works through UI; release packaging excludes keys, personal scores, work folders and caches; licenses and source notices included; automated checks and real UI workflow pass.

User refinements during implementation: installed apps must write projects to their own local app-data files, with browser storage only as a website fallback. The supplied dense score must fit its notation, chords and lyrics before viewport zoom is applied; maximum measures per row must not force overcrowded bars. These requirements are included below.

## 1. Durable project review data
- [x] Add validated optional review workspace to project format, retaining backwards-compatible v1 imports.
- [x] Save source XML/image/receipt and selected melody XML/selection/warnings; regenerate review/Score on restore rather than trust saved analyses.
- [x] Lift extraction selection/result to parent-controlled state; closing review retains it.
- [x] Clear unrelated workspace on project replacement; preserve it explicitly when importing that workspace's melody.
- [x] Validate IndexedDB data and serialize writes; show unsaved/failed state immediately; flush pending save when hidden.
- [x] Prefer a desktop-only filesystem GET/PUT backend with private atomic writes and a previous-file backup. Migrate existing browser work only when the disk store is empty; do not fall back or overwrite on disk read errors.
- [x] Regression tests for original/derived metadata, damaged backup, old formats and cross-project reset; browser reload and JSON restore checks.

## 2. Measure-range sections
- [x] Add pure section-range assignment preserving measure/note/chord IDs, musical sequence and form references.
- [x] Add Korean start/end measure, label and type UI; split selected section into before/range/after and expand form occurrences without losing repeats.
- [x] Test full/partial/single measure ranges, invalid ranges, repeated song forms, undo and text export.

## 2a. Dense notation layout
- [x] Measure notation, lyrics, chord text and clef/key/time width before placing bars. Treat the selected bars-per-row value as a maximum, wrap automatically, and preserve beat anchors and all musical data.
- [x] Give exceptional wide bars horizontal space instead of clipping or shrinking notation. Report actual SVG width to the viewport; PNG uses the same viewBox.
- [x] Check the real supplied 소원 score at multiple viewport zoom levels and verify note/chord bounds, selected-bar hitboxes and exported PNG.

## 3. Desktop runtime and local AI setup
- [x] Build separate standalone runtime using current framework support; remove Cloudflare/connector dependencies from desktop execution only.
- [x] Stable loopback origin; single launch lifecycle and actual health checks; user-data directory outside source and versioned bundles.
- [x] Local-only settings handler with bounded provider/model/key configuration, private disk storage and key-free public status; preserve existing credentials if key field left blank.
- [x] UI optional-AI form and local runtime readiness/help. Configuration presence is distinct from successful live authentication; saving must not make a paid request.
- [x] Common Python launcher, Mac launch entry and Windows entry; portable packaging cannot copy this machine's venv symlinks.
- [x] Build and test a Mac release artifact; record any native signing or external-device verification still missing.

## 4. Public-source release hygiene
- [x] Add license and third-party notices, including HOMR source/models and renderer/fonts. Keep provided copyrighted sheets and benchmark outputs out of repository/archive.
- [x] Short Korean first-run guide, honest recognition limits, troubleshooting, project backup and optional AI costs.
- [x] Allowlist source package creation and CI for domain checks, Python launcher checks and desktop build. No .env, private paths or user artifacts.

## 5. Release verification
- [x] Run all TypeScript/Python tests, typecheck, lint, desktop production build and packaging validation.
- [x] Smoke-test production loopback server with no AI settings.
- [x] Browser: new local recognition, hymn extraction, close/reopen/reload, project backup/restore, section assignment, songform/TXT/XML/PNG downloads; preserve and restore the user's prior work.
- [x] Independent specification review then code-quality review; fix reproducible blockers.
- [x] Deliver release archive/app, source archive and concise validation report under ../outputs. No public publication unless requested.

Final archive relocation and output handoff are recorded in the accompanying release validation report; no public publication is part of this run.
