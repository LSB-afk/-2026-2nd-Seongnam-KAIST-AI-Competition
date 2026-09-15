# Direct map navigation

## Outcome
Make the existing 3D city behave like a map people can grab and move. Keep place identity, source data, tour, creation and full-screen layout. Default to pan; expose rotation, cursor zoom, click-to-center, keyboard movement and a top view. Do not add dependencies or change the separate embedded map provider.

## Evidence and design
Baseline `c7dd808` uses left-drag/one-finger OrbitControls rotation. HTML labels block dragging; a recorded 100×80px drag on the Bundang label produces no movement. `DESIGN.md` defines the new pointer, keyboard, touch and cancellation contract. Three 0.186 MapControls includes ground-intersection mouse pan; use this installed control and keep the two-finger mapping as dolly/pan.

## Work and verification
1. Root adds regression cases for center movement, orientation/zoom preservation, drag/cancel/multi-touch exclusion and selected-place identity before editing the renderer.
2. Root changes navigation controls and gesture handling, with one owner for camera motion and no release inertia. UI executor owns a compact mode/camera toolbar and truthful desktop/mobile help.
3. Verify actual WebGL mouse, label drag, cursor zoom, touch and keyboard behavior, automatic-tour interruption and mode changes on one canvas. Check 1440/1024/390 layouts, panels and recovery.
4. Run relevant tests, full unit/E2E, lint, typecheck and production build. Inspect visual results before further visual edits and update source/usage notes. Restart only this app's localhost server. Stop once navigation is usable and regressions pass.

## Limits
Tests use desktop Chromium and mobile touch emulation; physical phones and Safari remain unverified. Existing city-data completeness limits are unchanged.

## Result
Implemented installed MapControls with ground mouse pan, cursor zoom, shared label/canvas gestures, click-to-center, explicit mode switch, north-up top view and keyboard movement. District polygons are navigation ground; their labels/topbar still select districts. Drag, cancellation and multi-touch never become selection clicks.

Verified: 706 unit/integration tests, lint, TypeScript, production build; 59/60 E2E passed initially. The remaining click case read labels before the next rendered frame; after adding an observable-position wait, all 6 navigation E2E passed on the production build. Desktop 1440/1024 and mobile 390 visual checks passed with clickable camera controls even when settings are open. Read-only review found no further defects. Evidence is in `outputs/seongnam-map-navigation-development/`.
