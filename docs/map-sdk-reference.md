# 지도 SDK 선택과 연결 계약

현재 동작(2026-09-14): NAVER 설정이 없거나 실패하면 OpenStreetMap 공식 임베드 기본 지도를 사용한다. 선택 핀·복원 범위와 제약은 아래 최신 보완 절을 따른다.

SDK 선정 확인일: 2026-09-13. **NAVER Maps 공식 JavaScript SDK를 채택한다.** 등록된 국내 관광지 8곳의 좌표를 표시하고 밀집 마커를 묶는 용도다. 인증 실패 콜백과 지도 제거 API가 명시되어 있어 로딩 오류와 React 재마운트 처리를 분명하게 구현할 수 있다. 이는 공식 API 계약에 근거한 설계 판단이며 React 19.3·Next 16.3에서 실제 키로 연결 검증했다는 뜻은 아니다.

## 비교와 선택 근거

| 항목 | Kakao Maps | NAVER Maps |
| --- | --- | --- |
| 로딩 | 공식 script, JavaScript 키 `appkey`, `autoload=false` 뒤 `kakao.maps.load(callback)` | 공식 script, 공개 Client ID `ncpKeyId`, `callback`으로 준비 완료 |
| 도메인 | JavaScript SDK 도메인 등록. 공식 예제는 `http://localhost:8080`처럼 포트를 포함 | Web 서비스 URL에 호스트 등록. 포트·경로 제외 |
| 인증 오류 | 조사한 공개 Map 계약에서 인증 실패 전용 콜백 확인 못함 | `window.navermap_authFailure` 명시 |
| 크기 변경 | 컨테이너 변경 후 `relayout()` | `setSize(Size)`와 `autoResize()` |
| 제거 | 등록한 함수로 `event.removeListener`, 오버레이 `setMap(null)`; 공개 Map `destroy()` 확인 못함 | `Event.removeListener`, 오버레이 `setMap(null)`, `map.destroy()` 명시 |
| 밀집 마커 | 추가 `clusterer` 라이브러리 공식 지원 | 공식 클러스터 예제는 별도 소스와 jQuery 구문 포함. 이 제품은 SDK 투영·HTML 마커로 자체 묶음 표시 |

근거: [Kakao 시작·키·라이브러리](https://apis.map.kakao.com/web/guide/), [Kakao API 명세](https://apis.map.kakao.com/web/documentation/), [NAVER 시작·비동기 로딩·인증 실패](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html), [NAVER Map 명세](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html), [NAVER 클러스터 예제](https://navermaps.github.io/maps.js.ncp/docs/tutorial-marker-cluster.example.html).

두 후보 모두 서비스 사업자가 제공하는 CDN SDK다. npm 다운로드 수·npm 라이선스를 기준으로 선택하지 않았고, 신규 npm 패키지를 도입하지 않는다. 고정된 npm 버전의 보안 감사를 수행한 것은 아니다. 현재 공식 문서의 서비스 개편·인증 키 안내를 확인했으며, 공급자 CDN 변경은 통제할 수 없으므로 필요한 API만 로컬 TypeScript 인터페이스로 선언하고 로더 경계를 테스트한다. 공식 SDK 자체가 React 컴포넌트라는 주장은 하지 않는다.

NAVER는 애플리케이션 생성 시 API 약관 동의와 Dynamic Map 선택이 필요하며, 계정 종류에 따라 무료 이용량 조건이 다르고 콘솔에서 일·월 사용 한도를 설정할 수 있다. Kakao도 앱의 지도 사용 설정과 계정별 무료 쿼터 조건이 있다. 가격 우위나 무조건 무료를 선택 근거로 사용하지 않았다. [NAVER Application 관리](https://guide.ncloud-docs.com/docs/application-maps-app-vpc), [Kakao 사용 조건](https://developers.kakao.com/docs/ko/kakaomap/common)

## 키와 로컬 도메인

- 서버 환경 변수 `NCP_MAPS_CLIENT_ID`는 브라우저 SDK용 공개 Client ID다. 독립 `GET /api/map-config` 응답은 `{ provider: "naver", configured: boolean, clientId?: string, reason?: string }`이며, 설정된 경우 이 공개 ID만 전달한다. 기존 `/api/config` 응답은 변경하지 않는다.
- Client Secret, 다른 서버 API 키, 전체 환경 변수를 브라우저에 전달하지 않는다. Client ID가 script URL에서 보이는 것은 공식 Web SDK 인증 방식의 결과다.
- 현재 URL은 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...`이다. 오래된 `ncpClientId`, `govClientId`, `finClientId` 예제를 복사하지 않는다. [최신 SDK 로딩 안내](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- 콘솔 Web 서비스 URL에는 `http://127.0.0.1`을 등록한다. `:3000`, 테스트 포트, `/경로`는 붙이지 않는다. `localhost`로도 접속한다면 `http://localhost`를 별도로 등록한다. 공식 문제 해결 문서는 포트·URI를 제거하라고 명시한다. 따라서 동일 호스트의 개발·테스트 포트별 등록은 필요 없다는 해석이다. 이 호스트에서 실제 인증 성공 여부는 키 발급 뒤 확인해야 한다. [도메인·포트 문제 해결](https://guide.ncloud-docs.com/docs/maps-troubleshoot)

위 문제 해결 문서에는 구형 콘솔·파라미터 예시가 함께 남아 있다. 도메인 규칙은 해당 문서에서, SDK 파라미터는 최신 시작 안내에서 확인했다. 현재 Application 안내는 HTTP/HTTPS 미구분, Web 서비스 URL 최대 10개, Dynamic Map의 서비스 환경 필수 입력도 설명한다. [Application 등록](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)

## 로더의 단일 소유권과 실패 처리

아래는 구현 계약이다. script 삽입은 클라이언트에서 한 로더만 담당하며, 지도 컴포넌트마다 삽입하지 않는다.

1. 브라우저 전역 레지스트리에 `{ key, promise, status, error, subscribers }`를 보관한다. React StrictMode와 개발 HMR에서도 같은 키의 같은 Promise를 재사용한다. 다른 키로 재호출하면 명시적으로 거절한다.
2. script를 붙이기 **전에** 준비 콜백과 `navermap_authFailure`를 설치한다. `callback` 실행 및 `naver.maps.Map` 존재를 확인한 뒤 SDK 준비를 알린다. script `load`만으로 지도 타일이나 인증 성공을 확정하지 않는다.
3. script `error`는 SDK 파일 요청 실패, 준비 콜백 대기 제한은 로딩 시간 초과, `navermap_authFailure`는 공급자가 보고한 인증 실패로 분류한다. 이미 Promise가 해결된 뒤 발생하는 인증 실패도 전역 구독자에게 전달한다.
4. 실패한 전역 상태를 새 마운트가 성공으로 재사용하지 않는다. 복구는 페이지 다시 로드처럼 단일한 경로로 제공한다. 타임아웃 뒤 기존 요청이 늦게 실행될 수 있으므로 script를 계속 새로 삽입하는 자동 재시도는 피한다.
5. 컴포넌트 해제 시 그 컴포넌트의 구독만 해제한다. 다른 지도가 공유하는 script·전역 콜백은 제거하지 않는다. 해제 후 도착한 Promise 결과는 무시한다.

핵심 콜백 연결 예시다. `publishFailure`는 오류 상태 저장·현재 구독자 통지를 함께 수행하는 앱 함수다.

```js
const url = new URL("https://oapi.map.naver.com/openapi/v3/maps.js");
url.searchParams.set("ncpKeyId", publicClientId);
url.searchParams.set("callback", "__timestoryNaverReady");

// 전역 레지스트리를 먼저 만들고 한 번만 실행하는 로더 내부
window.__timestoryNaverReady = () => {
  if (registry.status !== "loading") return; // 늦은 응답 무시
  if (!window.naver?.maps?.Map) return publishFailure("sdk-invalid");
  clearTimeout(registry.timer);
  registry.status = "ready";
  resolveReady(window.naver.maps);
};
window.navermap_authFailure = () => publishFailure("authentication");
const script = document.createElement("script");
script.id = "timestory-naver-sdk";
script.async = true;
script.onerror = () => publishFailure("script-network");
registry.timer = setTimeout(() => publishFailure("sdk-timeout"), 15000);
script.src = url.href;
document.head.appendChild(script);
```

공식 근거는 준비 `callback`과 인증 실패 전역 함수다. Promise 공유, 시간 제한, 오류 상태·구독 관리는 앱 설계다. [비동기 로딩·인증 실패 계약](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)

지도는 `tilesloaded` 이벤트로 해당 뷰의 타일 로딩 완료를 보고한다. 다만 공개 Map 명세에서 모든 타일 HTTP 실패나 상세 인증 원인을 전달하는 공통 오류 이벤트는 확인하지 못했다. `idle`은 타일 성공 증거가 아니다. 첫 타일 대기 시간 초과는 **지도 표시 확인 지연**으로 안내하고 잘못된 키라고 단정하지 않는다. 준비 콜백·타일 이벤트·화면 확인을 실제 연결 검증에서 함께 사용한다. [Map 이벤트](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)

## 지도 생명주기·모바일 조작

`Map`은 `draggable`, `pinchZoom`, `keyboardShortcuts`, `scrollWheel` 옵션을 제공한다. 손가락 이동·핀치와 키보드 이동은 켜고, 페이지의 일반 스크롤을 위해 휠 확대는 끄는 구성을 권고한다. SDK 예제의 전역 `user-scalable=no`를 복사하지 않는다. 지도 밖의 페이지 확대·스크롤을 유지하고 줌 버튼도 제공한다. [Map 옵션](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html)

아래 예시는 로더가 준비된 뒤 크기가 있는 컨테이너에 적용하는 JS 계약이다. 실제 React 코드는 `useEffect`의 해제 여부와 ref를 사용한다. TypeScript에서는 이 예시에 쓰는 생성자·메서드·이벤트 타입만 명시한다.

```js
const map = new maps.Map(container, {
  center: new maps.LatLng(37.4, 127.12), zoom: 12,
  draggable: true, pinchZoom: true, keyboardShortcuts: true,
  scrollWheel: false, zoomControl: true,
});
const listenerHandles = [];
const markerDisposers = [];
let raf = 0;
const observer = new ResizeObserver(() => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    const center = map.getCenter();
    map.setSize(new maps.Size(width, height));
    map.setCenter(center);
    renderGroups();
  });
});
observer.observe(container);
listenerHandles.push(maps.Event.addListener(map, "idle", renderGroups));

function dispose() {
  observer.disconnect();
  cancelAnimationFrame(raf);
  markerDisposers.splice(0).forEach(remove => remove());
  maps.Event.removeListener(listenerHandles);
  map.destroy();
}
```

숨겨진 탭·모달은 0×0에서 초기화하지 않고 보일 때 생성하거나, 다시 표시된 직후 양의 크기로 `setSize`한다. 컨테이너 크기 유지 방식에 관한 안내 차이를 피하기 위해 명시적 크기 갱신을 사용한다. `destroy()`는 지도 이벤트와 DOM 제거를 명시하며, 앱이 만든 DOM 이벤트·Observer·타이머는 앱에서 별도 해제한다. [Map 크기·제거](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html), [이벤트 해제](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Event.html)

## 밀집 마커와 키보드 접근

밀집 처리는 장소 수와 관계없이 적용한다. 지도 투영의 `fromCoordToOffset`으로 화면 픽셀 위치를 얻고, 60px 기준으로 가까운 점을 묶는다. **단순 `floor(x / 60), floor(y / 60)` 동일 셀 판정만으로는 셀 경계 양쪽의 겹침을 막지 못한다.** 인접 셀까지 거리·아이콘 겹침을 검사하거나, 8개 점 전체의 쌍을 비교해 그룹을 만든다. 그룹 규칙은 앱 정책이며 SDK 내장 클러스터 API라는 의미가 아니다. [MapSystemProjection](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.MapSystemProjection.html)

`HtmlIcon.content`는 문자열과 `HTMLElement`를 공식 지원한다. 실제 `<button>`을 만들고 `textContent`, `aria-label`, `type="button"`을 지정한다. 키보드 Enter·Space와 탭·클릭은 버튼의 표준 `click` 경로 하나로 처리해 중복 실행을 피한다. SDK의 `title`만으로 키보드 접근이 된다고 가정하지 않는다. 실제 SDK의 이벤트 전달·포커스 유지 여부는 키 연결 후 확인해야 한다. [Marker·HtmlIcon](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Marker.html)

```js
const point = map.getProjection().fromCoordToOffset(
  new maps.LatLng(place.lat, place.lng)
);
const button = document.createElement("button");
button.type = "button";
button.textContent = group.length > 1 ? String(group.length) : place.name;
button.setAttribute("aria-label", group.length > 1
  ? `관광지 ${group.length}곳 목록 열기` : `${place.name} 상세 열기`);
const activate = event => { event.stopPropagation(); openGroupOrPlace(group); };
button.addEventListener("click", activate);
const marker = new maps.Marker({
  map, position: groupCenter,
  icon: { content: button, size: new maps.Size(44, 44), anchor: new maps.Point(22, 22) },
});
markerDisposers.push(() => {
  button.removeEventListener("click", activate);
  marker.setMap(null);
});
```

그룹 클릭 시 `fitBounds`로 확대하거나 그룹 목록을 열 수 있다. 최대 확대나 같은 좌표에서도 모든 장소를 선택할 수 있도록 목록 경로를 남긴다. 지도 이동·확대·필터·크기 변경 후 묶음을 다시 계산하되, 동일 그룹은 재사용해 버튼 포커스를 유지한다. 선택한 장소와 지도 핀은 동일한 장소 ID를 사용한다. 렌더링 예시의 44px 크기는 원형 숫자 버튼 기준이며, 장소명 칩은 실제 너비를 반영해야 한다.

## NAVER 검증 범위와 전환

OSM 직접 타일 계산·투영·드래그 처리는 SDK가 맡고, 등록 장소 데이터·필터·선택 ID는 앱이 유지한다. 공급자 로고·지도 출처 표시는 가리지 않는다. 초기 구현은 키 누락 시 목록·상세와 안내만 제공했다. 2026-09-14부터 기본 지도로 전환하며 상세 동작과 검증 범위는 아래를 따른다.

공식 문서 계약에 따라 로더·설정 API·지도 세션·밀집 마커·키보드 버튼을 구현했다. SDK 모의 구현으로 인증·네트워크·시간 초과·중복 로드·수명주기·필터 및 위치 복원을 검증했다. 실제 키·허용 도메인 등록, 타일 로딩, 모바일 제스처, SDK HTML 버튼의 포커스, 인증 실패 콜백의 실제 발생은 검증하지 않았다. 키 제공 후 개발·테스트 포트의 실제 지도 연결을 별도로 확인해야 한다.


## 2026-09-14: 키 없는 환경의 기본 지도 복구

현재 실행 환경의 `/api/map-config`는 `configured:false`, `reason:missing-client-id`를 반환했다. 이전 화면은 이 경우 설정 안내만 보여 실제 지도 요청을 시작하지 않았다. 공용 키를 만들어 낼 수 없으므로 NAVER 연결은 유지하면서, 설정 누락과 SDK 실패 시 **OpenStreetMap 공식 HTML 임베드**로 전환한다. 별도 지도 라이브러리나 직접 타일 배치·투영 코드를 추가하지 않는다.

공식 임베드는 `export/embed.html`에 `bbox=west,south,east,north`, `layer=mapnik`, 선택 시 `marker=lat,lng`를 전달한다. 장소 필터는 선택란에 동일하게 적용하며 장소 선택·전국·성남 버튼은 앱 URL과 저장 상태를 갱신한다. 실제 지도 이동·확대와 출처 표시는 임베드가 처리한다. [OSM HTML 내보내기](https://wiki.openstreetmap.org/wiki/Export#Embeddable_HTML), [공식 임베드 소스](https://github.com/openstreetmap/openstreetmap-website/blob/master/app/assets/javascripts/embed.js.erb)

임베드는 **마커 한 개**를 지원한다. 앱이 등록한 여러 마커를 동시에 조작하거나 핀 클릭을 앱 상세로 보내는 인터페이스, 내부 이동·확대를 앱으로 반환하는 계약은 제공하지 않는다. 따라서 선택한 핀과 앱 버튼 범위는 복원하되 임베드 안에서 직접 바꾼 뷰는 복원하지 않는다. 다중 마커·클러스터·양방향 지도 이벤트는 기존 NAVER SDK 경로에 남는다. 이는 두 제공자의 동등한 기능을 주장하는 전환이 아니다.

임베드 문서의 `load`는 타일 성공을 입증하지 않는다. 로딩 안내만 정리하고 “지도 준비 완료”로 판정하지 않는다. 재시도와 큰 지도 링크, 장소 목록을 계속 제공한다. NAVER 치명 오류 후에는 세션·이벤트를 정리하고 늦은 콜백을 차단한다. 초기 렌더링이 세션 반환 전에 실패하는 경우에도 반환된 핸들을 종료한다. [iframe load/error 제약](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#error_and_load_event_behavior)

공급자의 출처·저작권 표시는 가리지 않는다. 앱은 타일을 프록시·미리 수집·오프라인 다운로드하지 않고 기본 브라우저 캐시와 임베드 정책을 따른다. 반복 E2E는 임베드 문서를 mock하고, 실제 타일 수신은 별도 수동 브라우저 검증으로 구분한다. 공용 서비스는 가용성 보장이 없으므로 공개 배포 규모가 정해지면 제공 조건을 다시 검토한다. [OSMF 타일 정책](https://operations.osmfoundation.org/policies/tiles/)
