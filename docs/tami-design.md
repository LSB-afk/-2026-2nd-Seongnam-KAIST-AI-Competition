# 타미 안내 로봇

2026-09-13 구현. 타미는 성남의 장소를 찾고, 출처를 확인하고, 카드뉴스를 검수하는 과정을 안내한다. 안내와 튜토리얼에는 모델 호출이 없다.

## 독자 캐릭터와 생성 자산

첨부 이미지는 이 작업에 제공되지 않았다. 특정 첨부를 확인하거나 복제하지 않았으며, 작은 로봇·시간·지도·문화책이라는 설명을 바탕으로 독자 디자인을 만들었다. 특정 캐릭터나 상표를 참조하지 않았다.

- 저장 자산: `public/tami/tami-sprites.png` — 1536×1024 PNG, 알파 채널, 3열×2행의 동일 크기 셀.
- 실제 생성 도구: 기본 제공 `image_gen.imagegen` (`tools.image_gen__imagegen`). 별도 유료 CLI나 API 키 경로로 전환하지 않았다.
- 생성 원본: `/Users/leeseungbo/Library/Application Support/orca/codex-runtime-home/home/generated_images/01a0999e-c46e-7853-b080-a8a89910a3a0/exec-c42b58b9-ba43-423a-b88f-ad7da9c5a706.png`.
- 원본을 그대로 프로젝트에 복사했다. 래스터 재도색, 배경 제거 또는 프레임 재가공은 하지 않았다. CSS `background-size: 300% 200%`로 셀을 표시한다.
- 화면 전송에는 Next.js의 `getImageProps({ src, alt: '', width: 216, height: 144 }).props.src`를 사용한다. 1,773,839바이트 원본을 직접 내려받지 않고 `/_next/image?...&w=640&q=75`의 640×427 WebP 55,766바이트를 사용했다(96.9% 감소). 캐릭터와 로드 실패 확인은 같은 URL을 쓰며 CSS에 원본 이미지 URL을 중복 선언하지 않는다. 원본 파일은 유지한다.
- 브라우저 디코딩으로 크기와 투명도를 확인했다. 총 1,572,864픽셀 중 979,988픽셀은 완전 투명, 592,876픽셀은 부분 알파다. 실제 흰 배경 화면에서 테두리나 배경 상자가 드러나지 않는 것을 확인했다.

아이보리 도자기 몸체, 남색 얼굴 화면, 파란 귀와 발, 초록 지도 핀 안테나, 시계가 그려진 책 모양 가슴 장식이 특징이다. 작은 크기에서도 얼굴과 동작이 읽히도록 형태를 단순하게 구성했다.

| 셀 | 표현 | 실제 화면 조건 |
| --- | --- | --- |
| 위 왼쪽 | idle | 선택하거나 진행 중인 작업이 없는 일반 안내 |
| 위 가운데 | greeting | 홈 첫 방문의 짧은 사용법 초대 |
| 위 오른쪽 | guiding | 장소 선택, 카드 확인, 검수·승인 안내, 튜토리얼 |
| 아래 왼쪽 | working | 실제 실행·이미지 작업 또는 화면 요청 진행 중 |
| 아래 가운데 | success | 현재 버전 승인 및 다운로드 준비 완료 |
| 아래 오른쪽 | error | 실제 오류, 미해결 검수 문제, 중단된 작업 |

### 생성 프롬프트

```text
Use case: stylized-concept. Asset type: production UI mascot sprite sheet for a Korean local tourism web app. Generate ONE PNG sprite sheet with a GENUINELY TRANSPARENT background (alpha, not a checkerboard), exactly 3 columns by 2 rows, six equal square cells on a 1536x1024 canvas. Each cell contains the SAME original tiny friendly robot, full body, centered with consistent scale, baseline and 15% transparent padding; no cell borders. Original design, no existing character or trademark resemblance. A round ivory ceramic body and oversized softly rectangular navy face screen with two expressive cyan eyes, cobalt blue side ears and feet, a small forest green map-pin antenna, and a tiny open-book-shaped chest badge with a simple clock dial mark (no writing). Refined soft 3D clay illustration, softly lit, simple silhouette legible at 72px, clean edge alpha, charming restrained expressions. Cell order, left to right top row: (1) idle, relaxed smile, arms resting; (2) greeting, one hand waving with happy eyes; (3) guiding, pointing one hand toward viewer's upper left while holding a small blank map in the other. Bottom row: (4) working, looking thoughtfully at a small blank open book; (5) success, both hands lifted cheerfully with one small green four-point sparkle; (6) error/help, gentle concerned tilted face with one hand raised, calm and helpful not distressed. Keep same robot identity and styling in all six, each self-contained in its cell, all fully visible including antenna and feet. Absolutely no text, letters, Korean writing, numbers, labels, watermarks, logos, checkerboard pattern, scenery, shadows crossing cell boundaries. Transparent negative space.
```

## 화면 디자인과 접근성

기존 브랜드의 blue `#244CC5`, nature `#176A59`, ink `#1D1D1F`, muted `#61656C`, white `#FFFFFF`를 사용한다. 기존 Noto Sans KR를 상속하고 패널 제목 19px, 본문 14px, 보조 12px로 구성했다. 캐릭터가 시선을 끌고 패널은 읽기와 다음 행동에 집중하도록 색과 장식을 제한했다.

캐릭터는 데스크톱 72px, 모바일 56px이며 사용법 버튼은 이미지 로드에 실패해도 남는다. 첫 초대는 홈에서만 짧게 표시하고 튜토리얼을 자동 시작하지 않는다. 탐색·상세·작업실에서는 첫 초대가 중요한 버튼을 덮지 않는다. 패널과 초대의 실제 높이를 `--tami-reserved-space`로 전달하고 본문 스크롤 영역이 이 여백을 사용한다. 모바일 안내 패널의 하단 간격은 `--tami-guide-bottom`으로 지정할 수 있다.

캐릭터 자체도 ‘안내 로봇 타미’ 버튼으로 눌러 안내를 열 수 있다. 일반 안내 패널에는 현재 화면의 도움말과 함께 ‘장소 찾기’, ‘카드뉴스 만들기 안내’, ‘하던 작업 이어가기’, 8단계 튜토리얼을 제공한다. 각 버튼은 해당 화면과 입력 위치로 이동하며 작성한 대상·목적·기존 실행을 초기화하지 않는다.

데스크톱 튜토리얼은 실제 `data-tour` 대상의 `getBoundingClientRect()`를 기준으로 배치한다. `ResizeObserver`, `MutationObserver`, 스크롤·뷰포트 변경을 관찰한다. 보이지 않는 대상을 강조하지 않고 필요한 화면을 여는 버튼을 제공한다. 모바일은 하단 시트이며 대상은 상단 여유 공간으로 스크롤한다. 긴 목록을 가운데로 스크롤해 중간 장소부터 보이던 첫 검증 결과를 수정하여, 시작 정렬과 스크롤 여백을 사용한다.

모바일 장소 상세가 `aria-modal=true`이면 타미 포털도 그 상세 안으로 이동한다. 기존 모달 포커스 순환에 안내 버튼이 포함된다. 타미 안에서 Escape를 누르면 안내만 닫고 이전 포커스 또는 사용법 버튼으로 돌아간다. 상세 모달 자체의 Escape 동작은 외부 포커스에서 유지된다. 안내는 비모달 `dialog`, 제목·설명 연결, 단계 수의 polite 알림, 표시된 키보드 포커스를 제공한다.

캐릭터는 8초 주기로 최대 4px 부유하고 주기 후반에 좌우 2도만 기울어진다. 드래그·마우스 올림·키보드 포커스·안내 패널 열림 중에는 멈춘다. 시스템 `prefers-reduced-motion`과 사용자의 움직임 끄기 설정에서는 애니메이션을 제거한다. 최소화·움직임·초대 확인·진행 위치는 `timestory:tami-guide:v1`에 저장한다. 저장소 접근 실패나 손상된 JSON이 안내를 막지 않는다.

## 튜토리얼 상태와 실행 경계

`src/lib/guide.ts`가 순수 상태 전이와 복원을 담당하고 `src/components/tami-guide.tsx`가 실제 앱 상태와 DOM 사용자 이벤트를 연결한다. 생성, 재시도, 승인 API 함수는 안내 상태 머신에 없다. 부모 콜백은 사용자가 화면·위치 보기 버튼을 눌렀을 때만 호출한다. 튜토리얼은 실제 제작·승인 버튼을 대신 클릭하지 않는다.

1. 관광 탐색 열기.
2. 목록·지도에서 장소 선택.
3. 해당 장소의 공식 링크를 사용자가 열기.
4. 선택한 장소로 제작 화면 이동.
5. 대상·목적을 정하고 사용자가 직접 제작 실행. 해당 장소의 4장이 완료될 때까지 대기.
6. 카드 확인과 선택적인 편집. 편집 없이 다음으로 이동 가능.
7. 현재 버전의 검수 결과 확인. 미해결 오류나 지난 버전 검수는 진행 차단.
8. 사용자가 직접 승인한 현재 버전의 다운로드 위치 안내. 다운로드 클릭 또는 명시적 사용법 마치기로 종료.

자동 단계 이동은 직전과 다른 실제 화면·선택·제작 상태 또는 공식 링크 이벤트로만 발생한다. 시간 경과로 이동하지 않는다. 이전·재개 직후 조건이 이미 충족되어 있어도 앞으로 튕기지 않는다. 장소를 바꾸면 이전 공식 링크 확인을 지우고, 다른 실행이나 검수 무효화에는 현재 전제조건으로 돌아간다. 새로고침 후에는 자동 재시작하지 않고 일시 중지 상태로 복원한다. 부모는 작업공간과 현재 실행의 초기 복원이 끝난 뒤 타미를 마운트한다.

부모 도움말은 `window.dispatchEvent(new Event('tami:open-guide'))`로 열 수 있다. `GuideContext`, `GuideActions`는 컴포넌트에서 다시 내보낸다.

## 검증 기록

- RED: `tests/guide.test.ts`를 구현 전에 작성하고 미구현 모듈로 실패하는 것을 확인했다. 구현 뒤 18개 테스트가 통과했다. 단계별 전제조건, 실제 변경 이벤트, 뒤로 가기, 공식 출처 분리, 실행 식별자, 검수 버전, 명시적 승인, 종료·재개·손상 복원을 검증한다.
- `npx eslint src/components/tami-guide.tsx src/lib/guide.ts tests/guide.test.ts` 통과.
- `npx tsc --noEmit --pretty false` 통과.
- `tests/tami.e2e.spec.ts`의 Playwright 회귀 4개를 추가하고 개발 서버에서 모두 통과했다. 모바일 8단계 전체 흐름, 1440px·390px 첫 초대의 CTA 비차단, 1024px 재개·키보드·움직임·이미지 실패·설정 복원을 포함한다. 지도는 공식 SDK 경계를 모의하고 전체 카드 제작·승인·ZIP은 실제 fixture 서버 경로를 사용한다.
- 실제 개발 서버 43211, Chromium 390×844에서 8단계를 완료했다. 사용자의 제작 클릭 전 POST 0건, 승인 클릭 전 POST 1건, 완료 시 fixture 제작과 명시적 승인 총 2건만 있었다. `timestory.zip` 다운로드 성공, 콘솔 오류 0건.
- 모바일 공식 링크는 y=230.6, 안내 시트는 y=406부터 배치되어 겹치지 않았다. 승인 뒤 다운로드 버튼도 시트 위에 놓이고 클릭 가능했다.
- 모바일 상세 내부 포털 존재, 안내 Escape 뒤 상세 유지와 사용법 버튼 포커스 복귀를 확인했다.
- 1440px·390px에서 첫 초대를 닫지 않고 탐색→장소 선택→제작 CTA를 클릭해도 차단되지 않았다. 초대 높이를 반영한 예약 여백은 274px이었다.
- 1024px에서 저장된 6단계 이어하기, 5단계로 뒤로 간 뒤 제자리 유지, 이미지 요청 실패 시 사용법 버튼 유지, 최소화·움직임 설정 저장을 확인했다.
- 대상과 목적 문구를 직접 바꾼 뒤 ‘제작 입력 보기’를 눌러도 값과 현재 URL이 보존되고 POST가 발생하지 않는 것을 검증했다. 실제 생성 요청에도 변경한 값이 전달됐다.
- 최적화한 WebP의 6개 셀 모두에 투명 픽셀과 캐릭터 픽셀이 존재하며 72px 표정 화면을 직접 확인했다.
- 지속 검증 산출물: `outputs/tami-journey.json`, `outputs/tami-accessibility.json`, `outputs/tami-asset.json`, `outputs/tami-package.zip`.
- 실제 화면 검토: `outputs/tami-invitation-1440.png`, `outputs/tami-invitation-390.png`, `outputs/tami-mobile-source.png`, `outputs/tami-mobile-approved.png`, `outputs/tami-mobile-complete.png`, `outputs/tami-preferences-1024.png`, `outputs/tami-character-states.png`. 최종 통합 전체 E2E 기록은 리더의 검증 산출물을 따른다.

새 캐릭터 생성은 기본 제공 이미지 도구로 확인했다. 앱의 유료 이미지 생성 API 품질이나 NAVER 실서비스 SDK 연결을 타미 검증으로 확인했다고 주장하지 않는다.

## 2026-09-14 자유 이동과 위치 저장

타미 캐릭터와 사용법 버튼 모두 마우스·터치 포인터 캡처로 자유롭게 이동한다. 최초 누른 지점에서 6px 이상 이동해야 드래그로 인정하고, 이동 뒤 발생하는 클릭은 안내를 열지 않는다. 6px 미만의 흔들림은 기존 클릭으로 처리한다. 최소화해도 사용법 버튼을 잡아 옮길 수 있다. 포인터 취소나 캡처 상실은 드래그 전 위치로 돌아가며 저장값을 바꾸지 않는다.

위치는 `timestory:tami-position:v1`의 `{ version: 1, x, y }`로 별도 저장한다. 좌표는 사용 가능한 화면 안의 0~1 비율이며 JSON·버전·숫자·범위를 검증한다. 이동 중에는 메모리만 갱신하고 정상 드래그 종료나 명시적 키보드 이동에서 저장한다. 창 크기와 `visualViewport`의 크기·오프셋을 다시 측정하므로 작은 창과 모바일 키보드·확대 화면에서 보이는 영역으로 제한한다. 일시적인 화면 변화는 저장 위치를 덮어쓰지 않는다. 저장소 차단이나 손상된 값에도 이동과 안내가 작동한다.

캐릭터와 사용법 버튼에 포커스를 두고 방향키로 12px, Shift+방향키로 40px 이동한다. Home은 기본 우하단 위치로 초기화한다. 안내 설정에는 방향별 이동 버튼과 ‘위치 초기화’ 버튼도 있다. 이동 안내와 저장 결과를 스크린 리더에 제공하며 Enter·Space는 기존 사용법 열기를 유지한다.

옮긴 타미의 첫 초대와 데스크톱 일반 안내는 캐릭터 주변의 화면 안에 배치한다. 기존 튜토리얼은 실제 대상 위치를 계속 따른다. 모바일 안내는 기존 하단 시트로 열려 튜토리얼 대상과 안내의 분리를 유지한다. 이 변경은 카드 제작·승인·이미지 생성 API를 호출하지 않는다.

검증: `tests/tami-position.test.ts`의 화면 경계·비율 복원·키보드 뷰포트·저장 검증·드래그 임계값에서 구현 전 6개 실패를 확인한 뒤 7개를 통과했다. 기존 안내 상태 18개와 합쳐 단위 테스트 25개가 통과했다. `tests/tami-drag.e2e.spec.ts`의 새 브라우저 테스트 4개도 개발 서버 43200에서 통과했다. 실제 Chromium 마우스와 CDP 터치 입력, 터치 취소, 최소화 후 이동, 320px 축소, 새로고침, 짧은 클릭, 키보드·초기화, 움직임 정지 조건, 저장 차단을 검증한다. 기존 8단계 E2E 4개를 포함한 최종 통합 검증은 리더가 별도 격리 데이터베이스에서 수행한다.

캡처: `outputs/tami-drag-desktop.png`, `outputs/tami-drag-desktop-help.png`, `outputs/tami-drag-mobile.png`, `outputs/tami-drag-mobile-invitation.png`. 데스크톱 안내가 옮긴 캐릭터 옆에 있고 모바일 초대도 옮긴 위치를 따라가는 것을 직접 확인했다.


최종 기본 배치는 OpenStreetMap iframe 하단의 출처 표시 영역과 겹칠 때만 그 위로 이동한다. 화면 크기·스크롤에 따라 다시 계산하며, 사용자가 직접 저장한 위치는 덮어쓰지 않는다. 1024px 회귀를 추가해 수정 전 겹침을 확인했고 수정 후 기본 배치 회피·사용자 위치 저장을 검증했다. 최종 production E2E는 타미 이동 5개·기존 안내 4개를 포함해 전체 29개가 통과했다. 단위·통합 301개, 타입 검사와 ESLint도 통과했으며 상세 기록은 [평가](evaluation.md)에 있다.
