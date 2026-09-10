# 성남 문화홍보 AI PD 구현 명세

앞선 개발 프롬프트와 개발 시작 요청을 승인된 범위로 삼는다. 기획 원문은 [주제 기획서](project-topic.md)다.

## 사용자 흐름과 수용 기준

판교박물관/청소년/카드 4장 요청 → 실행 → 근거 수집 → 작성 → 검수와 분기 → 렌더링 → 담당자 승인 → ZIP 다운로드. 준비된 응답 모드는 API 없이 동작하며 화면과 파일에 fixture임을 밝힌다. live는 Anthropic 모델 설정 및 비용 설정이 있어야 실행 가능하다. 두 모드의 상태와 성능을 혼합하지 않는다.

출력은 1080×1080 PNG 4장, 대본, 출처 및 검수 JSON, ZIP이다. 사실 주장에 근거가 있고 모든 미해결 문제가 없으며 렌더링한 버전과 검수 버전이 일치할 때 ready_for_approval이다. 담당자 승인만 approved로 전환한다. 수정은 새 버전을 생성하고 이전 검수와 승인을 무효화한다.

## 구조

Next.js Node 서버 / TypeScript / Node 24 내장 SQLite / HTML 카드와 Playwright 렌더러. SQLite JSON 실행 스냅샷은 전체 근거·수정·이벤트 이력을 보존한다. 로컬 단일 프로세스 MVP에서 전역 작업 관리자가 HTTP 요청과 독립적으로 실행한다. 서버 재시작 시 진행 중 실행을 중단 처리한다. 외부 프로덕션 배포는 범위 밖이다.

API: POST /api/runs, GET /api/runs, GET /api/runs/:id, POST /api/runs/:id/{cancel,approve,edit,retry}, GET /api/runs/:id/files/:name, GET /api/config. 생성 요청은 {brief, mode, strategy, scenario, requestId}. edit는 {version, cardId, title, body}, approve는 {version, reviewer}. 상태 충돌은 409, 잘못된 입력은 400, live 미설정은 503.

## 상태와 판단

queued → running → ready_for_approval / needs_review / failed / cancelled. ready_for_approval → approved. 수정 후 needs_review → 재검수 실행. 모델 결정은 도구 4개와 종료/담당자 전달 중 선택하며 서버가 전이·상한·완료를 강제한다. fixture는 저장된 시나리오와 검수 결과에 반응하는 결정적 테스트 더블이고 실제 LLM 성능으로 간주하지 않는다.

## 구현 순서와 검증

1. 공유 타입·설정 및 fixture 전체 경로. 의미 있는 검수·상태 테스트를 먼저 실패 확인한다.
2. 순수 에이전트와 SQLite/API, 카드 렌더러와 화면을 독립 구현하고 통합한다.
3. 모델 JSON 검증, 공식 자료 수집, 예산과 종료, 수정/승인을 검증한다.
4. Vitest, 타입 검사, ESLint, production build, Playwright E2E, 이미지 육안 검사를 통과한다.
5. baseline/agent 동일 fixture 자료 비교와 3분 시연 문서를 제공한다. live 키가 없으면 검증 불가를 명시한다.

## 시각 설계

문화 콘텐츠를 편집하는 밝은 작업실. 흰색 #FFFFFF, 종이 회색 #F3F5F8, 먹색 #182236, 박물관 청색 #244CC5, 문화 공간 녹색 #176A59, 상상 보라색 #7854AF. Noto Sans KR를 로컬 패키지로 제공한다. 왼쪽 제작 요청, 중앙 넓은 카드 미리보기, 오른쪽/아래 근거와 수정 내역. 카드의 시대 연결을 단순 도형으로 표현하며 실제 유물 사진처럼 오인시키지 않는다.

## 명시적인 제약

실시간 공개 검색은 공식 출처 목록에서 원문을 다시 수집하는 범위로 한정한다. 외부 검색 API와 임의 웹 탐색은 구현하지 않는다. 이미지 재사용 권리가 확인되지 않아 자체 도형과 타이포그래피로 제작한다. 계정 기능 없는 로컬 전용 앱이며 승인은 인증된 신원 증명이 아닌 담당자 입력 기록이다.
