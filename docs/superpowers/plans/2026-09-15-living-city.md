# Living Seongnam implementation plan

## User outcome and scope
Expand the eight-place catalog with source-verified Seongnam attractions, make people larger and streets lively with moving people/cars, and replace invented streets/building layouts with actual public map geometry and named shops. Preserve the full-viewport map, tour controls, keyboard access, card creation and all existing place identifiers. No dependencies or paid data services are added.

## Evidence and integrity
Tourism records require official place sources and traceable coordinates. Preserve existing verified records; leave unknown opening/admission/photo fields empty. OSM is a timestamped public snapshot with incomplete coverage, not an exhaustive current business registry. Clearly identify estimated heights, illustrative characters and missing map coverage. Retain attribution and source links.

## Implementation sequence and ownership
1. Researcher collects tourism records; geodata executor fetches and clips OSM roads, footprints and POIs; city-life executor builds bounded instanced animation with independent pause/visibility/resource tests.
2. Root integrates verified catalog, dynamic scenes/cameras and search. Urban geometry executor replaces invented grid with static real geometry, projected road routes and actual POI markers; root integrates shared city model and renderer.
3. Expose traffic, population density and person size controls; add bounded nearest shop/road information and source access. Keep marker collision handling and list access when labels are hidden.
4. Add meaningful regression checks for actual coordinate/geometry provenance, catalog validation, settings fallback, route movement and disposal. Update existing fixed-eight expectations without weakening interaction assertions.
5. Run targeted tests, all unit tests, lint, typecheck, production build and real WebGL E2E. Inspect full city and street detail at desktop/tablet/mobile sizes; persist visual verdict before each following visual edit. Restart only this app's local server after successful validation.

## Completion criteria
All supported verified attractions are selectable, searchable and tourable; source map roads/footprints/shops are represented at their recorded positions; crowds and traffic move on supplied routes with visible size/density controls; responsive panels and creation flows work; all required checks pass with data counts and coverage limits documented. No claim of complete real-world coverage or actual traffic conditions.
