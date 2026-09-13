# Tourism platform implementation plan

**Goal:** 공식 성남 관광지 탐색부터 사진 기반 카드뉴스 편집·승인·다운로드까지 완성한다.
**Architecture:** 기존 Run과 SQLite를 유지하며 Place 카탈로그, 안전한 이미지 저장·생성, 지도 탐색 UI를 연결한다. 공유 타입과 서비스 상태 전이는 리더가 통합한다.
**Tech Stack:** 설치된 Next.js/React/TypeScript, Node SQLite, Playwright, OpenStreetMap 타일, 기존 fetch. 신규 패키지 없음.
**Spec:** ../specs/2026-09-13-tourism-platform-design.md

- [x] 공식 장소 8개 이상의 이름·주소·좌표·사진 라이선스 확인 및 로컬 자산 확보 (`places.ts`, `public/places`, 출처 문서).
- [x] `Brief.placeId` 연결, 등록 장소 입력 검증, 장소별 fixture/프롬프트/수집/검수 회귀 (`service`, `sources`, `fixture`, `prompts`, `verifier`). 다른 장소 내용 혼입·미등록 장소·ID 불일치를 거부한다.
- [x] 이미지 계약과 안전한 raster 저장/읽기·API 연결 구현. 허용 MIME·최대 바이트·해상도·SHA·경로 검증, 외부 응답 크기 제한, 키 없는 실패, 예약 비용과 취소를 검증한다.
- [x] 이미지 변경 서비스로 버전 증가·승인 무효화·문구/다른 카드 보호를 검증. 작업 중 중복·stale 버전 거부, 취소 이후 결과 적용 방지.
- [x] 추상 SVG를 실제 자산 기반 1080 PNG 출력으로 교체. 같은 crop/초점/zoom으로 브라우저 미리보기와 파일을 생성, 이미지 출처 JSON/ZIP 포함, 긴 제목·본문 및 잘림 검증.
- [x] 사이드바·실제 대시보드·기록·탐색·제작 흐름 구현. 실제 지도 이동/확대·클러스터·선택·필터·실패 복구·모바일 조작 검증.
- [x] 공식 레퍼런스의 직접 확인과 추론을 구분해 기록. README/규칙/프롬프트/설정/평가를 최종 동작으로 갱신.
- [x] 전체 test/typecheck/lint/build/e2e 및 fixture 평가. 1440/1024/390 브라우저와 실제 다운로드 PNG를 확인하고 문제 수정 후 필요한 검증 반복.

독립 파일 소유: research=카탈로그/사진, agent_core=장소별 에이전트/검수, renderer=이미지 저장·출력, frontend=페이지/CSS/지도/편집 UI, review=공식 레퍼런스, leader=공유 타입/서비스/API/통합 검증. 각 구현은 관련 동작 테스트를 먼저 추가하고 최종 증거를 보고한다.

완료 검증: [평가 기록](../../evaluation.md)의 2026-09-13 항목. API 미설정으로 실제 텍스트·이미지 생성 품질은 미검증이며, 연결·오류 처리와 사진 기반 전체 흐름을 검증했다.
