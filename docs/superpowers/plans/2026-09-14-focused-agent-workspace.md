# Focused agent workspace implementation plan

**Goal:** Preserve Seongnam place discovery → four source-backed cards → review → human approval → download, while making assistance and evidence understandable.

**Approved scope:** The development prompt accepted in this conversation on 2026-09-14. No booking, payments, nationwide catalogue, publishing, or general chatbot. No new dependencies. Preserve user edits, images, versions, budgets, and fixture/live distinctions.

**Architecture:** Reuse Run events, sources, assessments, and the existing production pipeline. Add an agent view to the existing workspace navigation. Extend Brief with an optional reading style and safely re-use versioned generation/review for explicit simplification. Keep navigation and review UI changes separate from backend work.

## Implementation and verification

- [x] Baseline: run existing unit tests and inspect desktop/mobile pages; document existing map/drag behavior and configuration limits.
- [x] Reading style (`types`, `http`, `prompts`, `fixture`, `service` and tests): test default compatibility, actual easy-style output, version checks, edit/image protection, re-review, and cancellation before implementation. Initial requests accept `readingStyle: standard | easy`; existing runs use explicit version-bound simplification.
- [x] Evidence UI (`review-trace.tsx`, scoped CSS and tests): connect statements to citations, distinguish current/historical review, expose actionable results and dates; retain existing component interfaces.
- [x] Agent center (`agent-center.tsx`, scoped CSS, workspace/guide/page): show only real supported capabilities and run events. Tests cover route/storage/back restoration, draft preservation, real event rendering and empty state. Never equate finish with human approval.
- [x] Integrate easy-style form and explicit simplification action; preserve unsaved edits and show protected-card/fixture limits.
- [x] Polish existing sidebar typography, navigation icons and assist links; preserve map/drag and photo renderer. Verify 390/1024/1440 widths, focus, reduced motion and downloadable PNGs.
- [x] Run unit tests, typecheck, lint, production build/E2E and fixture evaluation. Inspect actual PNG and ZIP. Real APIs without configuration remain explicitly unverified.
- [x] Update README/evaluation with actual evidence and remaining limitations; report concise results without invented performance claims.

## Initial inspection

- Present: 8 places, NAVER + OSM embed fallback, draggable Tami, source/atomic review, edit protection, approvals and exports.
- Needs implementation: agent navigation/view, persisted easy-reading option and explicit existing-run transformation.
- Needs usability work: source/statement selection, clearer review provenance and consistent navigation.
- External settings: existing README records live NAVER/text/image calls as unverified; keys will never be printed or replaced.

Visual review uses browser screenshots and recorded verdict JSON; a standalone `visual-verdict` skill was not found in installed skill directories.

## Completion evidence — 2026-09-15

- Baseline: 301 unit/integration tests passed. Final: 332 tests across 25 files passed.
- Production E2E: 32 passed in 54.5 seconds; typecheck, ESLint, final isolated production build and diff check passed.
- Fixture comparison: all 12 scenarios completed with expected ready/needs-review outcomes. Claim dataset: 36 inputs validated, no model calls or measured accuracy.
- Independent review findings resolved: hide nonfunctional script edit button; do not show stale claim support as current verification.
- Directly inspected final agent pages at 1440/1024/390, mobile review, and all four approved 1080 PNGs from the downloaded ZIP.
- Actual OpenStreetMap: 15 successful tile responses. Live NAVER/text/image model configuration remains unavailable.
- Detailed evidence and limits: `docs/evaluation.md`, `outputs/focused-agent/verification.json`, `.omx/state/focused-agent/ralph-progress.json`.
