# 성남 타임스토리 — 성남 문화홍보 AI PD

지역문화 자료를 조사하고, 사실과 상상을 구분하며, 홍보물을 제작·수정하는 AI 에이전트입니다.
2026 제2회 성남×KAIST AI 경진대회 예선 MVP로, **판교박물관을 소개하는 카드뉴스 4장**을 제작합니다.

[주제 기획서](docs/project-topic.md) · [구현 명세](docs/implementation-spec.md) · [판단·검수 규칙](docs/agent-rules.md) · [평가 계획](docs/evaluation.md) · [3분 시연 대본](docs/demo.md)

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

- 공식 자료 근거 수집 → 장별 문구 작성 → 검수 결과에 따른 재검색·수정 → 파일 출력
- 사실·비유·상상 구분, 문장별 원문·출처 확인
- 수정 전후 비교, 직접 편집, 버전 변경 시 이전 검수·승인 무효화
- 담당자 승인과 PNG·대본·출처·검수 JSON·ZIP 다운로드
- 반복·시간·비용 상한, 취소, 서버 재시작 시 중단 작업 복구
- 파일 해시·검수 버전 확인 및 한글 폰트·텍스트 잘림 검사

## 데모와 실제 AI

| 모드 | 동작 | 검증 범위 |
| --- | --- | --- |
| fixture / 데모 | 확인한 원문 발췌와 준비된 청소년용 응답, 결정적 도구 선택 | API 없이 전체 흐름·실제 파일 생성 검증 |
| live / 실제 AI | 공식 페이지 재조회, Anthropic 모델의 판단·작성·별도 검수 | 연결 코드와 모의 API 응답 테스트 구현; 실제 모델 호출은 미검증 |

데모는 자유 입력 목표에 맞춰 새 콘텐츠를 생성하지 않습니다. 실제 AI 모드는 입력을 모델에 전달합니다.
자료 수집은 등록된 공식 박물관 **두 페이지**를 다시 조회하고 근거를 확인하는 범위입니다.
검색엔진이나 성남 전체 자료 탐색은 아직 구현하지 않았습니다.

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
| `ANTHROPIC_WORKSPACE_ID` | 필요한 경우에만 워크스페이스 ID |

키·모델·양수 가격·비용 상한이 없으면 실제 AI 실행을 차단합니다. 네트워크 실패 시 데모로 몰래 전환하지 않습니다. 표시 비용은 설정 단가와 API 사용량에 따른 추정값이며, 사용량을 확인할 수 없는 호출은 사전 예약액을 유지합니다.

## 검증

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run eval
```

E2E는 별도 로컬 포트 `43187`, `.next-e2e/`, `data/e2e.sqlite`를 사용합니다.
배포용 빌드를 생성한 뒤 실제 브라우저에서 오류 복구·승인·ZIP 다운로드·수정 후 재검수와 모바일 화면을 확인합니다.
비교 결과는 `outputs/evaluation/`에 저장하며, fixture 결과를 실제 AI 성능으로 해석하지 않습니다.

## 파일 구조

```text
src/app/           # 제작실 화면과 API
src/lib/           # 에이전트, 검수, 모델 호출, 근거 수집, 저장, 렌더링
scripts/           # 비교 평가 실행
tests/            # 단위·통합·브라우저 테스트
docs/              # 기획, 명세, 평가, 시연
data/             # 로컬 SQLite (Git 제외)
outputs/          # 실행별 카드·대본·ZIP, 평가 결과 (Git 제외)
```

Next.js, TypeScript, Node 내장 SQLite, Playwright를 사용합니다. 한글 폰트는 로컬 패키지에 포함하며,
카드 시각 요소는 자체 도형입니다. 공식 박물관 이미지의 재사용 권한을 가정하지 않습니다.

## 확인한 공식 자료

- [판교박물관 자주하는 질문](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=57&fboard=board_faq): 개관일, 전시 내용, 소장자료 이용 안내
- [판교박물관 건립배경](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=64): 발굴조사 및 이전 배경

자료와 실시간 수집 연결은 2026-09-10 확인했습니다. 자동 검수도 틀릴 수 있으므로 담당자가 원문과 최종 결과를 확인해야 합니다.

## 작업 공간과 GitHub

[GitHub 저장소](https://github.com/LSB-afk/-2026-2nd-Seongnam-KAIST-AI-Competition)

`seongnam-kaist.code-workspace`로 편집기에서 열 수 있습니다.
`data/`, `outputs/`, `submissions/`, `.omx/`, `.env*`는 로컬 보관하며 비밀값과 생성물을 커밋하지 않습니다.
커밋 메시지는 변경 이유를 첫 줄에 쓰고 필요한 Lore 트레일러로 검증과 제약을 기록합니다.
