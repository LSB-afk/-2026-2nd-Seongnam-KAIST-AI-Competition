# 성남 타임스토리 — 성남 문화홍보 AI PD

지역문화 자료를 조사하고, 사실과 상상을 구분하며, 홍보물을 제작·수정하는 AI 에이전트입니다.
2026 제2회 성남×KAIST AI 경진대회 예선 MVP로, **판교박물관을 소개하는 카드뉴스 4장**을 제작합니다.

[주제 기획서](docs/project-topic.md) · [구현 명세](docs/implementation-spec.md) · [판단·검수 규칙](docs/agent-rules.md) · [평가](docs/evaluation.md) · [3분 시연 대본](docs/demo.md) · [개발 재개 프롬프트](docs/prompts/development.md)

## 실행

Node.js **24 이상**이 필요합니다. 초기 검증 환경은 Node 24.11.1이며, 이 버전의 내장 SQLite는 experimental 경고를 출력합니다.

```bash
npm ci
npx playwright install chromium
npm run dev
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)을 열고 **카드뉴스 제작하기**를 누릅니다.
기본 데모는 의도적인 역사적 연결 오류를 검수·수정한 뒤 PNG 4장과 ZIP을 만듭니다.
API 키가 없어도 실행할 수 있습니다.

최적화한 로컬 실행:

```bash
npm run build
npm start
```

서버는 로컬 주소에만 바인딩합니다. 계정·외부 게시·공개 배포는 현재 범위 밖입니다.

## 구현한 흐름

- 검색 목적과 부족한 정보를 받아 공식 사이트의 관련 페이지·본문 인용 탐색
- 제목·본문·대본의 원자 주장 검수: 근거 지지 / 근거와 충돌 / 근거 부족 구분
- 주장 → 인용 위치 → 원문 스냅샷 → 수정·재검수 이력 연결
- 문제 있는 카드만 수정하고 담당자 편집은 보호; 변경이 필요하면 적용 전 제안 제공
- 직접 편집 시 새 버전 생성 및 이전 검수·승인 무효화, 과거 자료·검수 이력 보존
- 담당자 승인과 PNG·대본·출처·검수 JSON·ZIP 다운로드
- 반복·시간·비용 상한, 호출 전 예약 저장, 취소·재시작 이후 사용량 보존
- 모델·프롬프트 버전과 실제 API 시도·토큰·추정 비용 표시
- 파일 해시·검수 버전 확인 및 한글 폰트·텍스트 잘림 검사

## 데모와 실제 AI

| 모드 | 동작 | 검증 범위 |
| --- | --- | --- |
| fixture / 데모 | 확인한 원문 발췌와 준비된 청소년용 응답, 결정적 도구 선택 | API 없이 전체 흐름·실제 파일 생성 검증 |
| live / 실제 AI | 목적에 따른 공식 페이지 탐색, Anthropic 모델의 판단·작성·별도 원자 검수 | 모의 API 응답 회귀 구현; 실제 모델 호출은 미검증 |

데모는 자유 입력 목표에 맞춰 새 콘텐츠를 생성하지 않습니다. 실제 AI 모드는 입력을 모델에 전달합니다.
실제 자료 탐색은 FAQ·건립배경을 시작점으로 공식 판교박물관의 허용된 읽기 전용 페이지를 따라갑니다. 검색 한 번에 **최대 8페이지·깊이 2·12초**, 응답 2MB·신규 인용 32개로 제한합니다. 등록되지 않은 문장도 본문에서 추출하며 같은 URL이 바뀌면 별도 스냅샷으로 보존합니다. 수집한 문장은 검수 후보이므로 해당 주장을 지지하는지는 다시 확인합니다.

fixture의 역사적 연결 오류 시연은 처음 근거 3개를 불러오고 재검색에서 신규 근거 0개를 기록합니다. 인과관계를 뒷받침할 자료를 찾은 것처럼 표시하지 않고 확인된 발굴 설명으로 수정합니다. 일반 검색엔진·성남 전체 탐색과 기록 재생 모드는 구현하지 않았습니다.

실제 AI 설정:

```bash
cp .env.example .env.local
```

`.env.local`에 아래 값을 설정하고 서버를 재시작합니다.

| 환경변수 | 의미 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 서버 전용 API 키 |
| `ANTHROPIC_MODEL` | 사용할 모델 ID. Structured outputs 지원 필요 |
| `ANTHROPIC_INPUT_USD_PER_MILLION` | 모델 입력 100만 토큰당 USD 가격 |
| `ANTHROPIC_OUTPUT_USD_PER_MILLION` | 모델 출력 100만 토큰당 USD 가격 |
| `MAX_COST_USD` | 실행별 누적 비용 상한 |
| `EVAL_MAX_COST_USD` | 실제 주장·작업 평가를 합한 디스크 원장 기준 총 비용 상한 |
| `EVAL_CLAIM_MAX_COST_USD` | 선택: 주장 평가 한 건의 예약 상한 |
| `ANTHROPIC_WORKSPACE_ID` | 필요한 경우에만 워크스페이스 ID |

키·모델·양수 가격·비용 상한이 없으면 실제 AI 실행을 차단합니다. 네트워크 실패 시 데모로 몰래 전환하지 않습니다. 표시 비용은 설정 단가와 API 사용량에 따른 추정값이며, 사용량을 확인할 수 없는 호출은 사전 예약액을 유지합니다.

데모·실제 AI 버튼은 모드를 선택하는 버튼입니다. 실제 AI 설정이 없어도 선택하면 연결 안내가 펼쳐집니다. 설정 전에는 제작 실행만 제한하며 데모로 돌아가 바로 제작할 수 있습니다.

현재 검증 환경에는 API 키·모델·단가·실행 비용 설정이 없어 **실제 모델 생성·수정은 미검증**입니다. 공식 사이트 접근과 실제 AI 호출을 구분합니다.

## 검증

2026-09-10 변경 후 단위·통합 테스트 138개, production E2E 5개, 타입·린트·빌드를 통과했습니다. 실제 모델 호출은 설정 부재로 미검증입니다. 측정 수치와 한계는 [평가 기록](docs/evaluation.md)에 있습니다.

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run eval
npm run eval:claims -- --validate
npm run sources:probe -- 판교박물관 관람료
```

E2E는 별도 로컬 포트 `43187`, `.next-e2e/`, `data/e2e.sqlite`를 사용합니다.
배포용 빌드를 생성한 뒤 실제 브라우저에서 오류 복구·승인·ZIP 다운로드·수정 후 재검수와 모바일 화면을 확인합니다.
비교 결과는 `outputs/evaluation/`에 저장하며, fixture 결과를 실제 AI 성능으로 해석하지 않습니다.

`sources:probe`는 모델을 호출하지 않고 현재 공식 사이트를 두 차례 탐색합니다. 2026-09-10 실행에서 먼저 개관일 질의로 인용 2개를 확보하고, 관람료 재검색에서 8페이지를 방문해 새 후보 2개를 추가해 총 4개를 보존했습니다. 추가 후보에는 무료 관람과 무료 주차 문장이 각각 포함됐으며, 주차 안내를 입장료 근거로 간주하지 않습니다. 실제 웹 재검색으로 새 인용이 누적된 결과이고 모델의 의미 판단은 수행하지 않았습니다. 결과는 `outputs/evaluation/source-probe.json`에 남고 웹 내용에 따라 달라집니다.

실제 모델 설정과 전체 평가 예산을 갖춘 뒤 다음을 실행합니다.

```bash
npm run eval:smoke
npm run eval:claims -- --dev
npm run eval:claims -- --holdout
npm run eval:live
```

주장 평가는 균형 잡힌 합성 사례 36개와 별도 초안 정답을 사용합니다. 작업 비교는 동일한 고정 공식 발췌·모델·도구·상한을 사용하고 자연 발생 과제와 오류 주입 과제를 분리합니다. 전체 예산은 `outputs/evaluation/live-budget.json`에 먼저 예약하고 재시작 후에도 유지합니다. 사람 승인·수정·검토 시간은 측정 전 `null`입니다. 현재 실제 평가 결과는 없으며 자세한 범위와 한계는 [평가 문서](docs/evaluation.md)에 있습니다.

최신 fixture 비교에서도 두 방식 모두 6개 중 4개가 승인 대기에 도달했습니다. 이 결과로 실제 AI 품질이나 에이전트의 우위를 주장하지 않습니다.

## 개발 목표와 프롬프트

[개발 재개 프롬프트](docs/prompts/development.md)는 요청한 개선의 목표·종료 조건을 Codex Goal로 추적하고 구현·검증까지 이어가는 절차입니다. 활성 목표가 있으면 중복 생성하지 않습니다. 이는 개발 작업 관리이며 앱에 별도 목표 관리 화면을 추가한 것은 아닙니다. 앱의 홍보 목표는 기존 `brief.goal`로 판단·작성·검수에 전달됩니다.

실제 모델의 판단·작성·검수 지시는 [src/lib/prompts.ts](src/lib/prompts.ts)에 분리되어 있으며 [모델 프롬프트 계약](docs/prompts/model-prompts.md)에 설명했습니다. 프롬프트와 검수 규칙 버전을 실행 기록에 남깁니다.

## 파일 구조

```text
src/app/           # 제작실 화면과 API
src/lib/           # 에이전트, 검수, 모델 호출, 근거 수집, 저장, 렌더링
scripts/           # fixture/live 평가와 공식 자료 수집 probe
tests/            # 단위·통합·브라우저 테스트
tests/fixtures/   # 고정 검증 자료와 분리된 평가 입력·초안 정답
docs/              # 기획, 명세, 평가, 시연
data/             # 로컬 SQLite (Git 제외)
outputs/          # 실행별 카드·대본·ZIP, 평가 결과 (Git 제외)
```

Next.js, TypeScript, Node 내장 SQLite, Playwright를 사용합니다. 한글 폰트는 로컬 패키지에 포함하며,
카드 시각 요소는 자체 도형입니다. 공식 박물관 이미지의 재사용 권한을 가정하지 않습니다.

## 확인한 공식 자료

- [판교박물관 자주하는 질문](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57&fboard=board_faq): 개관일, 전시 내용, 소장자료 이용 안내
- [판교박물관 건립배경](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64): 발굴조사 및 이전 배경

자료 수집 연결은 2026-09-10 별도 probe로 확인했습니다. 이는 실제 모델의 의미 판단 검증을 뜻하지 않습니다. 자동 검수도 틀릴 수 있으므로 담당자가 원문과 최종 결과를 확인해야 합니다.

## 작업 공간과 GitHub

[GitHub 저장소](https://github.com/LSB-afk/-2026-2nd-Seongnam-KAIST-AI-Competition)

`seongnam-kaist.code-workspace`로 편집기에서 열 수 있습니다.
`data/`, `outputs/`, `submissions/`, `.omx/`, `.env*`는 로컬 보관하며 비밀값과 생성물을 커밋하지 않습니다.
커밋 메시지는 변경 이유를 첫 줄에 쓰고 필요한 Lore 트레일러로 검증과 제약을 기록합니다.
