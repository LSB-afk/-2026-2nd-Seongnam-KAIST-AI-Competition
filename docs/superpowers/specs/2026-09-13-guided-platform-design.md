# 성남 타임스토리 탐색·제작 안내 고도화

2026-09-13 새 사용자 구현 지시. 명확한 구현·검증은 승인 대기 없이 진행한다. 기존 9bc901f 위에서 확장한다.

## 확인한 문제와 해결

| 문제 | 사용자 영향 | 수정 | 검증 |
| --- | --- | --- | --- |
| OSM 지도는 현재 HTTP200·콘솔 오류0이나 재마운트 시 전국 줌으로 초기화 | 메뉴 왕복 후 위치 잃음 | NAVER 공식 JS SDK + 외부 viewport 상태·resize·destroy | 모의 SDK 수명/인증/마커/resize, 키 있으면 실제 연결 |
| 2개 터치는 확대가 아닌 드래그로 처리 | 모바일 조작 예측 불가 | SDK의 공식 터치 조작과 모바일 목록/지도 선택 | 터치 입력과 페이지 스크롤, 조작 안내 |
| 새로고침 시 dashboard로 초기화, URL 상태 없음 | 장소/입력/작업 잃음 | 검증한 URL 탐색 상태, 로컬 초안·저장 장소, 서버 run ID 재조회 | reload/popstate/stale 응답/손상 저장소 |
| 홈페이지에 목적·주제·저장 장소 흐름 없음 | 첫 사용자가 제작 순서 찾기 어려움 | 사진 중심 소개→주제→지역→검수한 데모→목적→이어가기 | 모든 CTA의 실제 상태 전달 |
| 안내자·튜토리얼 없음 | 검수/승인 전제조건 이해 어려움 | 타미·DOM 대상·실제 상태/행동 기반8단계 | 유료생성/승인자동실행0, 종료/재개/키보드/복원 |

기존 지도 진단 원본: outputs/guided-map-before-diagnostics.json. 실제 네트워크 확인은 처음 전국 보기이고 이후 반복·터치 검증은 모의 타일이다. 1440px 지도850×708,390px360×538. SDK 교체가 과거 타일 서비스 장애를 입증하는 것은 아니다.

## 구조와 계약

기존 Next16.3/React19.3/TS/SQLite/Playwright/Noto Sans KR400·500·600·700을 유지하고 npm 의존성을 추가하지 않는다. 지도는 공식 NAVER script `oapi.map.naver.com`을 탐색 시에만 로드한다. NCP_MAPS_CLIENT_ID는 공개용 식별자이며 config.map으로 제공한다. 서버 비밀키를 클라이언트에 보내지 않는다. SDK키 부재·인증·timeout·network 오류를 구분하고 목록과 상세는 항상 남긴다. 전국 보기·성남 기본보기, 좌표 마커·겹침묶음, 필터·선택 연동은 기존 계약을 유지한다.

화면 상태는 dashboard/explore/saved/studio/history. ExploreState는 query/district/category/theme/selectedId/mobileView/mapView를 가진다. 검색은 등록 관광지8곳 범위다. 주제는 history/nature/art/market, 별도 인기도를 만들지 않는다. savedIds는 검증한 등록ID만 브라우저 로컬에 저장한다. URL은 화면·선택·필터·run 식별자만 저장하고 작성문구/비밀값을 담지 않는다. 현재 서버Run과 아직 제작하지 않은 로컬Brief를 분리하고 문구 미저장 초안은 runId/version/cardId에 묶는다. 늦은 응답은 최신 대상과 요청 순서를 확인해 적용한다. 비용 발생 요청은 재시도여부를 사용자 행동으로 정하고 중복 in-flight 실행을 잠근다.

Brief.purpose는 선택적인 place_intro/visit_guide/youth_story이며 과거 작업은 기존 동작을 유지한다. UI 목적 선택은 실제 brief/goal/audience에 반영하고 fixture도 목적별 준비된 문구로 구분한다. Live prompt가 해당목적을 사용한다. 4장+마지막 상상·사실검수·문구보호·사진권리·이미지변경버전·재검수·승인·PNG ZIP은 불변이다.

타미는 친근한 로봇에 지도 핀·시간·문화책 모티브를 반영한다. 첨부 이미지가 메시지에 없어 설명 기반 독자 디자인이며 특정 첨부를 확인했다고 기록하지 않는다. idle/greeting/guiding/working/success/error는 실제 앱 상태에 연결한다. 플로팅72px/56px, 최소화·애니메이션설정은 로컬 보관한다. 모델 호출 없는 안내만 제공한다.

튜토리얼8단계는 탐색화면→장소선택→공식정보→제작이동→대상목적/사용자직접생성→카드확인편집→검수확인→사용자직접승인/다운로드. data-tour 식별자를 찾고 보이는지 확인한 뒤 강조한다. 고정좌표와 자동 타이머 진행, 자동 유료생성, 자동승인을 금한다. 이전·다음·건너뛰기·종료·이어하기·재시작과 상태에 맞는 복원을 제공한다. DOM 요소가 준비되지 않으면 필요한 화면/전제조건으로 안내한다. 모바일 상세나 승인·다운로드를 플로팅패널이 가리지 않으며 Escape/포커스복귀/reduced-motion을 지원한다.

## 디자인

Apple 공식 화면 직접관찰은 docs/apple-design-reference.md에 분리한다. 사진/문구/브랜드는 성남 콘텐츠만 사용한다. palette background #F5F5F7, surface #FFFFFF, ink #1D1D1F, muted #61656C, brand #244CC5, nature #176A59. 홈 대표제목64px(모바일40),작업36px(모바일32),섹션28/24,소제목20/18,본문16/15,보조13/12. 홈은 큰실제사진과 여백, 지도·작업실은 밀도 유지. 토큰으로border/shadow/radius/space 관리. 홈 버튼 모두 탐색필터·목적·실제기록에 연결. 예시는 실제fixture생성/검수/PNG 렌더 결과를 정적자산으로보관하고 데모와확인정보를 명시한다.

## 완료

npm test/typecheck/lint/build/test:e2e. 새 지도SDK mock와 실제연결을분리. 1440/1024/390 before/after,초기방문타미/저장/복원/제작/사진문구수정/재검수/승인/ZIP/튜토리얼재개를검증. 목적계약변경에 따른fixture평가 실행. 최신PNG 직접확인. API키없으면실제SDK/모델품질미검증과정확한설정만보고하고나머지구현검증완료후Goal종료.
