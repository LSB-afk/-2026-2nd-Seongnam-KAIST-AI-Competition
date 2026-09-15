# City story platform implementation

User approved development of the five connected city experiences and recognizable tourism/food discovery on 2026-09-15. Execute directly with bounded native-agent lanes; no runtime-mode transition or new dependency.

1. Root: shared strict story/camera contract, persisted draft, read-only approved story snapshot API, app/workspace integration, full browser verification.
2. Core executor: optional Brief.story; one run, 4 cards, server-owned card-stop-place mapping and place-scoped evidence/search/image/rendering. Existing single-place approval and budget behavior remain covered.
3. Story UI executor: collection editor, 2–3 ordered stops, photo/source/memo/camera choices, playback controls and reviewable sharing UI.
4. Experience executor: dated time lens, evidence detective report, local consented/reviewed memory records and photo input.
5. Renderer executor: actual photo identifiers, food categories, story order line, camera snapshot/apply without changing gesture behavior.
6. Researcher: primary-source food selections and dated archive records with provenance. No invented rankings or opening status.

Shared contract lives in src/lib/city-story.ts. StoryStop has id, placeId, optional note, photoChoice (place|none), optional registered officialUrls, optional camera (position/target tuples and zoom relative to fitted view). CityStoryBrief has title, 2–3 unique stops and four cardStopIds; first three cards cover every stop and the fourth is imagination at a chosen stop. No arbitrary source URL is accepted.

Private drafts stay in browser storage. Shared stories store an immutable projection of a currently approved run version, containing public card content, source citations, place IDs and saved camera views. No private notes, full source snapshots or approval identity are published. Shared UI clearly describes local-server access. Camera numbers, identifiers and payload sizes are validated at every persistence boundary.

Time lens uses real dated records where available and a truthful empty state elsewhere. Current-map mode never changes the capture date of a historic photo. Future mode opens existing AI card creation with an explicit imagination prompt. Detective answers are checked against curated official evidence and produce a downloadable report. Memory submissions require rights/consent confirmation; draft/reviewed status, withdrawal and deletion work locally; only reviewed, consented memories may be added as personal story notes.

Acceptance: complete collection → studio → per-place evidence review → approve → story playback/share; camera round trip; manual input cancels playback; snapshot survives run mutation and leaks no notes; time lens source/date; detective report evidence; memory consent/review/delete; actual photo landmarks and sourced food markers. Validate targeted regressions, full unit suite, lint/typecheck/build, existing and new WebGL E2E, desktop/tablet/mobile screenshots. Do not commit/push/deploy without an applicable request.

Completed 2026-09-15: 861 unit/integration tests across 42 files, 67 production Chromium E2E cases, lint, TypeScript and production build passed. Independent review approved the fixes for public-viewer isolation, crop preservation, malformed-draft recovery and all 59 selectable source URLs. Manual visual pass covered desktop/tablet/mobile editor/food plus desktop/mobile shared playback and mobile time/memory panels. Local memory storage and local sharing are the delivered first-version boundaries; public community hosting and paid AI generation quality were not exercised. See `docs/diorama.md` for reproducible validation and limitations.
