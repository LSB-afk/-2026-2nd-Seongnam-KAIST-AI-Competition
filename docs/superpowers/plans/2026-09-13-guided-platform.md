# Guided Platform Implementation Plan

> **For agentic workers:** Use role-scoped native subagents; root integrates and verifies the final result. User explicitly authorizes reversible implementation without additional approval.

**Goal:** First visitors complete place discovery, creation, review and download with a working official SDK integration and contextual guide.
**Architecture:** Keep server Run lifecycle; add validated browser workspace persistence, SDK boundary and guide state machine. Home and exploration consume shared navigation actions.
**Tech Stack:** Existing Next16.3/React19.3/TS/SQLite/Playwright, NAVER official script, local Noto Sans KR. No npm additions.
**Spec:** ../specs/2026-09-13-guided-platform-design.md

## Global constraints

8 official places, four Korean cards and final imagination, protected edits, review/approval/download invariants. No automatic paid generation or approval. Credentials absent => configured:false and usable lists. 1440/1024/390 evidence and actual PNG required.

### 1. SDK boundary (renderer)
Files: src/lib/naver-maps.ts, src/components/tourism-map.tsx, tests/naver-maps.test.ts, tests/fixtures/naver-maps-mock.js. Preserve current props and add optional viewport/onViewportChange. Server config is root-owned.
- [x] RED: absent config, concurrent load once, failed script retry, authFailure, timeout, zero-sized container, event cleanup, overlapping markers and selected marker.
- [x] Implement official load callback, resource cleanup, marker rebuild on stable IDs/idle, remembered viewport, retry/error UI. Verify scope lint/tests.

### 2. Purpose and verified example (agent_core)
Files: src/lib/types.ts (Brief purpose only), src/lib/purposes.ts, service brief schema, fixture/prompts, tests/purpose.test.ts, public/examples, scripts/build-example.ts.
Contract: CreationPurpose='place_intro'|'visit_guide'|'youth_story'; PURPOSES catalog; goalForPurpose(place,purpose); optional Brief.purpose. No break for omitted purpose.
- [x] RED: distinct goal/card composition by purpose, preserve canonical place and 4th imagination, invalid-purpose400/idempotency.
- [x] Wire purpose into actual run and prompt/fixture; run canonical fixture review+real rendering and persist example assets/metadata with zero model calls. Verify generated PNG and source rights.

### 3. Browser workspace and exploration (root)
Files: src/lib/workspace-state.ts, src/hooks/use-workspace.ts, src/components/place-explorer.tsx, src/app/page.tsx, tests/workspace-state.test.ts, tests/e2e.spec.ts.
- [x] RED: URL parse/serialize allowed view/place/filter, invalid stored data fallback, savedIDs dedupe, exact-version edit draft binding.
- [x] Persist drafts/savedIDs and navigate via history push/replace/popstate; guard request races and restore latest server Run. Controlled explorer search/selection/theme/saved views with official-link tutorial targets.
- [x] Route home purposes/filter shortcuts and sidebar/help to real actions; default fixture normal, deliberate error scenarios remain available.

### 4. Home, history and design (frontend)
Files: src/components/platform-home.tsx, src/app/globals.css only. Parent props preserved plus onExplore(filters?), onCreate(place,purpose?), savedIds/onSaved/onHelp. ROOT integrates imports/page.
- [x] Build actual photo hero and six requested content groups, theme/district filters, demo example and purpose CTAs, saved/recent/needs-review data.
- [x] Search/status-filter RunHistory; empty/failure/retry semantics preserved. CSS tokens and density distinction, five-item mobile nav; verify screenshot and no overflow.

### 5. Tami guide (image_provider)
Files: src/components/tami-guide.tsx, src/lib/guide.ts, tests/guide.test.ts, public/tami, docs/tami-design.md. Own CSS file src/components/tami-guide.css to avoid global conflicts.
Context: view,selectedPlace,draftPlace,run,busy,error,tab,selectedCardId. Actions: navigate(view),openStudio(),openReview(cardId?),openEditor(),resumeRun(),showApprove(),showDownload(). Actions only navigate/focus; no model/approve calls.
Targets: nav-explore,place-results,place-detail,official-source,create-from-place,brief-fields,create-run,cards,review-panel,approve-panel,download.
- [x] RED: step guards, mismatch/reload recovery, backward/skip/resume, no event timer advancement or automatic paid/approval actions.
- [x] Create original robot art and six actual state presentations; guide actions/current advice, source/selection/run events, DOM positioning, accessibility, local preferences.

### 6. Integration, evidence, delivery (root)
- [x] npm test; typecheck; lint; build; test:e2e. Fix regressions then rerun affected scopes.
- [x] Browser mock SDK workflow + absent/auth/network states, reload/back/saved/history/draft/guide and versioned image/text edits → review → approval → ZIP.
- [x] 1440/1024/390 screenshots/PNG direct review and motion/loading measurement. Real SDK only if usable config; report separately.
- [x] Update README/design/evaluation/settings.
Delivery gate: commit Lore and push under standing authorization, verify remote HEAD, then complete Goal.

## Verification evidence

2026-09-13: 290 unit/integration tests (21 files), 19 production E2E, typecheck, lint and build passed. Browser evidence at 1440/1024/390 is recorded in `docs/evaluation.md` and `outputs/guided-final-browser.json`. Actual NAVER credentials and text/image model configuration are absent; official SDK integration is mock-tested, and live service quality remains unverified.
