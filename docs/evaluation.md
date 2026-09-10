# 검증 및 비교 평가

평가는 세 경로로 구분한다. 준비된 응답 회귀, 실제 모델의 원자 주장 분류, 실제 모델을 사용하는 작업 전체 비교다. 어느 경로에서도 승인 대기를 사람의 승인으로 계산하지 않는다.

| 경로 | 명령 | 측정 범위 |
| --- | --- | --- |
| fixture 회귀 | `npm run eval` | 준비된 응답과 실제 PNG·ZIP 렌더러의 상태 전이 |
| 데이터 검사 | `npm run eval:claims -- --validate` | 36개 평가 입력과 초안 정답의 스키마·연결 |
| 실제 주장 분류 | `npm run eval:claims -- --dev` / `--holdout` | 실제 API의 판정과 초안 정답 간 일치도 |
| 실제 smoke | `npm run eval:smoke` | 정상 제작과 의도적 오류 수정, 각각 baseline/agent 한 쌍 |
| 실제 작업 비교 | `npm run eval:live` | 자연 발생 과제 2개와 오류 주입 과제 1개, 총 6회 |
| 공식 사이트 통합 확인 | `npm run sources:probe -- 판교박물관 관람료` | 개관일 검색 이후 재검색의 신규 원문 인용 수집, 모델 호출 없음 |

## 공통 실행 조건

Node 24와 설치된 Playwright Chromium이 필요하다. 일반 검증은 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`로 실행한다. 외부 웹사이트의 현재 내용에 의존하는 통합 확인은 이 고정 자료 평가와 별도로 수행한다.

live 설정은 `.env.local` 또는 현재 셸에 둔다. npm의 live 평가 명령은 Node의 `--env-file-if-exists=.env.local`로 설정을 읽는다. 직접 실행할 때도 같은 옵션을 사용한다.

```bash
node --env-file-if-exists=.env.local --import tsx scripts/evaluate-claims.ts --validate
node --env-file-if-exists=.env.local --import tsx scripts/evaluate-claims.ts --dev
node --env-file-if-exists=.env.local --import tsx scripts/evaluate-claims.ts --holdout
node --env-file-if-exists=.env.local --import tsx scripts/evaluate-live.ts --smoke
node --env-file-if-exists=.env.local --import tsx scripts/evaluate-live.ts
```

필수 설정은 `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_INPUT_USD_PER_MILLION`, `ANTHROPIC_OUTPUT_USD_PER_MILLION`, `MAX_COST_USD`, `EVAL_MAX_COST_USD`다. 모델에 맞는 실제 단가를 확인해서 입력한다. `MAX_COST_USD`는 작업 한 번의 상한, `EVAL_MAX_COST_USD`는 주장 평가와 작업 비교를 합한 총 상한이다. `EVAL_CLAIM_MAX_COST_USD`는 주장 한 건의 예약 상한이며 생략하면 `MAX_COST_USD`와 0.1 중 작은 값을 사용한다. 이는 단가 예측이 아니라 호출을 허용할 예산이다.

설정이 없으면 live 명령은 API를 호출하지 않고 `not_run_missing_configuration`, `apiCalls: 0`을 기록한 뒤 종료 코드 2로 끝난다. `--validate`는 설정과 무관하게 데이터를 검사하며 실제 평가 지표는 `null`이다. fixture로 자동 전환하지 않는다.

## 1. 기존 fixture 회귀

`scripts/evaluate.ts`는 기존 6개 시나리오를 두 정책으로 실행하고 실제 카드 파일을 검사한다. `outputs/evaluation/results.json`과 `results.csv`에 기록한다.

| 사례 | 기대 결과 |
| --- | --- |
| normal | 검수 통과 및 카드 파일 생성 |
| causal | 근거 없는 역사적 계승 표현을 수정하고 재검사 |
| future | 확정 사업 표현을 수정하고 상상 표시 |
| mismatch | 출처와 문장의 불일치를 발견하고 수정 |
| unavailable | 근거 부재를 표시하고 담당자 검토로 전달 |
| persistent | 상한 안에서 멈추고 미해결 항목 표시 |

2026-09-10 이번 변경 후 12회 실행에서도 두 정책 모두 6개 중 4개가 승인 대기에 도달했다. 원문 접근 실패와 지속 오류는 모두 담당자 검토로 종료했다. 실제 PNG·ZIP 무결성 검사도 통과했다. 이는 최초 MVP와 같은 승인 대기 결과이며 에이전트 우위를 입증하지 않는다. fixture 결과는 실제 AI 정확도나 업무 시간 절감의 증거가 아니다. 결과에는 `mode: fixture`, `liveModelQualityMeasured: false`를 기록하고 실제 run 필드에서 호출·비용·수정 횟수를 읽는다.

| 시나리오 | baseline 도구 호출 | agent 도구 호출 | 종료 |
| --- | ---: | ---: | --- |
| normal | 6 | 4 | 두 방식 승인 대기 |
| causal / future / mismatch | 각각 6 | 각각 7 | 두 방식 승인 대기 |
| unavailable | 1 | 1 | 두 방식 검토 필요 |
| persistent | 5 | 9 | 두 방식 검토 필요 |

모델/API 호출과 API 비용은 모든 fixture 실행에서 0이다. 시간은 로컬 렌더러 실행 시간이며 업무 처리 시간으로 해석하지 않는다.

## 2. 원자 주장 평가 데이터

`tests/fixtures/evaluation/claim-inputs.json`에 36개 입력을, `claim-labels.draft.json`에 판정과 이유를 분리했다. 판정마다 12개씩이며 dev와 holdout은 각각 supported/contradicted/insufficient 6개씩, 총 18개다. 제목·본문·대본 위치도 판정별로 균형을 맞췄다.

입력은 통제 가능한 **합성 평가 자료**다. 실제 박물관 운영 사실을 주장하거나 콘텐츠 제작 자료로 쓰지 않는다. 개관일, 발굴 기간, 인과관계, 다른 시설의 자료, 부분 지지·최초 주장, 과거 운영 안내, 상상 속 사실, 자료 충돌, 수량, 행사, 접근성, 예약 정보를 포함한다. `origin: synthetic_evaluation`을 근거마다 표시한다.

같은 근거의 바꿔 쓴 문장이 양쪽 세트에 걸치지 않도록 근거 계열 전체를 dev 또는 holdout에 배정했다. 프롬프트 조정은 dev로 하고 최종 확인은 holdout으로 한다. 작성자가 보지 않은 블라인드 자료나 독립된 전문가 정답이라는 뜻은 아니다. 모든 정답은 `status: draft`, `humanReviewed: false`이며 사람이 확인하기 전까지 **초안 정답에 대한 일치도**로만 해석한다.

평가 모델에는 `asOf`, `field`, `claim`, `evidence`만 명시적으로 새 객체로 구성해 보낸다. 정답, 설명, split, 계열, 평가 ID를 전달하지 않는다. 앱과 같은 `ATOMIC_REVIEW_RULES`를 사용하되, 전체 카드 검수와 구분되는 단일 주장 분류 계약을 사용한다. 모델 응답의 근거 ID도 입력에 존재하는지 검사한다.

`outputs/evaluation/claims-dev.json` 또는 `claims-holdout.json`과 CSV에 다음을 기록한다.

- 판정별 혼동행렬, 전체 정답 수/전체 사례 수, 응답한 사례만의 정확도, 응답 커버리지. 실패·미완료도 전체 분모에 남는다.
- `falseBlockRate`: supported 초안 정답 중 다른 판정으로 응답한 비율.
- `unsupportedAcceptedRate`: contradicted/insufficient 초안 정답 중 supported로 통과시킨 비율.
- 모델 응답, 실패 이유, 모델·프롬프트 버전, 데이터 해시, 호출·토큰·시간·설정 단가 기준 추정 비용.

응답이 없을 때 모델의 판정을 추측하지 않는다. 혼동행렬에는 실제 판정만 넣으며, 누락은 `unanswered`와 커버리지에 따로 드러낸다. 사람이 검토하지 않은 비용 외 업무 지표는 만들지 않는다.

## 3. 실제 작업 전체 비교

`museum-corpus.json`은 기존 MVP에서 확보한 공식 FAQ·건립배경 발췌를 고정한 자료다. 원문 URL, 수집 시각, 본문과 SHA-256, 인용문과 문자 위치를 보존한다. 평가 시작 시 해시와 인용 위치를 검사한다. 이 명령은 원문을 다시 가져오거나 현재 웹을 탐색하지 않는다.

각 비교 쌍은 같은 빈 초기 근거 상태, 요청, 모델, 자료 모음, 검색·렌더링 도구, 최대 12회 도구·30회 모델·3회 자동 수정·180초·설정 비용 상한을 사용한다. 기존 baseline은 조사 → 작성 → 검수 → 정해진 수정 1회 → 재검수 → 출력 정책이다. agent는 결과에 따라 다음 도구를 선택한다. baseline에서 필요한 최초 조사를 생략하지 않도록 두 방식 모두 근거가 없는 상태로 시작한다.

이 작은 고정 자료 모음은 최초 검색에서 모두 반환한다. 따라서 추가 검색의 신규 근거 확보율은 0일 수 있으며, 목적 기반 탐색의 성능을 평가하기에 충분한 자료 모음은 아니다. 더 많은 고정 공식 문서로 확장하기 전까지 이 비교를 재검색 우위의 증거로 사용하지 않는다. 실제 탐색기가 새 문서·근거를 찾는 동작은 별도 고정 HTML 회귀와 공식 사이트 통합 확인으로 검증한다.

자연 발생 과제는 초안 없이 시작한다. 오류 주입 과제는 두 방식에 같은 초안을 주고, “이 문화유산의 기술이 오늘날 판교 AI 산업으로 이어졌다.”라는 오류를 의도적으로 넣었다고 기록한다. 이 초기 초안만 fixture 생성기를 사용하고 이후 판단·작성·검수는 모두 실제 API다. 오류 주입 결과를 자연 발생 오류 수정률로 합치지 않는다. smoke는 정상 과제와 오류 주입 과제를 각각 두 정책으로 실행하므로 최대 4회다.

작업 결과는 `outputs/evaluation/live-smoke.json` 또는 `live-paired.json`과 CSV에 남긴다.

- 상태, 실제 파일 검증, 도구·모델·API 호출, 토큰, 자동 수정 횟수, 시간·비용.
- 자연/주입 및 baseline/agent별 승인 대기율, 중단·보류·실패율, 평균 비용·시간·호출 수.
- 추가 검색에서 신규 근거가 나온 비율과 개수. 기존 근거를 다시 반환한 것은 신규 근거로 세지 않는다.
- `modelReportedUnsupportedFinalRate`: 현재 버전을 검수한 모델이 보고한 미지원 원자 주장의 비율. 독립적인 사실 정확도 지표가 아니다.
- `injectedTextRemoved`, `injectedRecoveryPassedReview`: 알려진 오류 문구의 제거 및 현재 검수·파일 통과 여부. 표현만 바꾼 같은 오류까지 독립적으로 입증한 정답 점수는 아니다.

자연 발생 오류의 참 수정 성공률과 독립적인 최종 미지원 주장률은 별도 정답 검토가 없으므로 `null`로 남긴다. 자동 검수 결과를 다시 정답으로 쓰지 않는다. 실제 사람 측정이 없는 `humanApproved`, `humanEdits`, `humanReviewTimeMs`도 JSON에서는 `null`, CSV에서는 빈 셀이다.

## 4. 총 예산과 재시작

모든 live 평가 명령은 `outputs/evaluation/live-budget.json` 하나를 공유한다. 병렬 실행을 잠금으로 막고 순차 실행한다. 작업 비교는 **두 실행의 최대 예산 전체를 먼저 함께 예약**하고, 주장 평가는 호출 전에 해당 건의 최대 예산을 예약한다. 예약·체크포인트는 임시 파일, fsync, 원자적 이름 변경으로 저장한다. 각 모델 호출의 예약과 정산도 네트워크 진입 전후 콜백에서 체크포인트한다.

정상적으로 끝난 실행은 실제 토큰 사용량과 설정 단가로 계산한 비용으로 정산한다. 사용량을 확인하지 못한 호출은 공급자 경계에서 유지한 예약 비용을 보존한다. 프로세스가 중단된 작업은 **전체 실행 예약을 해제하지 않는다**. 재실행해도 기존 완료 결과를 재사용하며, 미완료 항목을 조용히 다시 호출하지 않는다. 코드·모델·자료·프롬프트 지문이 바뀌어 새 항목이 생겨도 기존 원장의 총 상한을 공유한다.

원장의 예산과 다른 `EVAL_MAX_COST_USD`로 재개하면 거부한다. 잠금 소유 프로세스가 살아 있으면 두 번째 평가를 거부하고, 종료된 프로세스의 잠금만 회수한다. 과거 비용을 잊기 위해 원장을 자동 삭제하거나 실패를 숨겨 재시도하지 않는다. 원장은 공급자의 실제 청구서가 아니라 설정 단가로 추적한 보수적 평가 예산 기록이다.

## 현재 확인한 결과

2026-09-10 최종 통합 검증은 단위·통합 테스트 138개, production E2E 5개, 타입 검사, ESLint, production build를 모두 통과했다. E2E는 오류 복구·승인·ZIP, 오래된 버전 충돌, 담당자 편집 보호→제안→직접 저장→재검수, 모바일 가로 넘침을 확인했다. 렌더러의 글자 잘림 검사와 생성 PNG·데스크톱·모바일 스크린샷 육안 확인도 수행했다.

2026-09-10 평가 전용 회귀 9개와 해당 파일 ESLint를 통과했다. 36개 데이터 검사는 실행했고 holdout 18개·초안 라벨·API 호출 0회를 확인했다. 실제 smoke 명령은 API 키, 모델, 단가, 비용 설정 부재를 명시하고 종료 코드 2로 끝났다. 실제 주장 분류 정확도, 실제 모델 간 작업 성과, 사람 검토 성과는 **미측정**이다. 이후 실행 결과는 출력 JSON의 시각·지문·실행 상태와 함께 해석한다.

같은 날 공식 사이트 probe는 개관일 검색으로 인용 2개를 확보한 뒤 관람료를 재검색했다. 후속 검색에서 8페이지를 방문해 새로운 후보 인용 2개를 추가했고 기존 스냅샷을 유지했다. 그중 하나는 무료 주차 안내이므로 관람료의 지지 근거로 단정하지 않는다. 페이지/깊이 상한 도달도 결과에 기록했다. `outputs/evaluation/source-probe.json`의 `mode: source_probe`, `apiCalls: 0`, `modelJudgement: not_run`은 실제 웹 수집만 확인했다는 뜻이다. 모델 판단·현재 운영 정보의 사실성을 검증한 결과는 아니다.
