# 성남시 도로·건물·장소 데이터

조회일: **2026-09-15**. 성남시의 실제 지리 배치를 보여 주기 위해 OpenStreetMap(OSM) 공개 벡터 데이터를 정적 파일로 저장했다. 시 경계는 [성남시 relation 2409180](https://www.openstreetmap.org/relation/2409180)의 원본 좌표다. 기존 `seongnam-boundaries.json`의 약 20 m 단순화 경계로 잘라낸 데이터가 아니다.

OSM은 참여자가 편집하는 지도다. 아래 숫자는 **이번 조회에 등록된 데이터의 수량**이며, 성남시의 모든 건물·도로·점포를 수록했다는 뜻이 아니다. 측량 경계, 지적도, 건축물대장 또는 영업 상태 확인 자료로 사용할 수 없다.

## 저장 파일과 규모

| 파일 | 내용 | 크기 |
| --- | --- | ---: |
| `src/lib/diorama/seongnam-urban.json` | 원본 태그와 시 경계 안의 도로·건물·장소 좌표 | 17,092,054 bytes; gzip 2,779,025 bytes |
| `src/lib/diorama/seongnam-urban-index.json` | 같은 출처 메타데이터, 전체 장소, 이름별 도로 대표 좌표 | 942,648 bytes |
| `scripts/fetch-seongnam-geodata.ts` | 내려받기, 캐시 재사용, 시 경계 처리, 검증, 두 JSON 생성 | 새 의존성 없음 |
| `outputs/seongnam-living-city-development/geodata-*` | 원본 응답·조회문·조회 영수증·해시·제외 사유·검증 결과 | 개발 검증 기록 |

앱은 저장된 JSON만 읽는다. 브라우저에서 공용 Overpass API를 호출하지 않는다. 큰 지리 파일은 3D 장면을 불러올 때 사용하고, 검색 UI는 작은 색인 파일을 사용한다.

## 수록 범위

| 항목 | 성남시 안의 최종 수량 |
| --- | ---: |
| OSM 도로 way | 15,100 |
| 시 경계에서 자른 도로 선 조각 | 15,222 |
| 도로 좌표 | 105,412 |
| 건물 OSM 객체 | 32,300 |
| 건물 외곽 폴리곤 | 33,119 |
| 보존한 건물 내부 구멍 | 29 |
| 건물 좌표 | 221,467 |
| `height` 태그가 있는 건물 | 4,233 |
| `building:levels` 태그가 있는 건물 | 13,330 |
| 이름이 있는 건물 | 4,526 |
| 이름이 있는 장소 | 3,177 |
| 그중 `shop` 태그가 있는 장소 | 587 |
| 그중 식당·카페·패스트푸드·바·펍·아이스크림·푸드코트 | 1,369 |
| 도로 색인의 서로 다른 이름 | 1,627 |

도로에는 `footway` 3,143개, `path` 617개, `pedestrian` 161개, `steps` 348개 등이 포함된다. 이 수치는 잘린 선 조각 기준이다. 보행 가능 여부는 `access`, `foot`, `highway` 등의 원본 태그로 판단해야 하며, 모든 도로가 보행로인 것은 아니다. `bridge`, `tunnel`, `layer`, `oneway`, `width`, `lanes` 등은 등록된 경우 그대로 보존했다.

장소는 `name`과 `shop`, `amenity`, `tourism`, `leisure`, `historic` 중 하나가 있는 객체를 수록한다. 분야는 겹칠 수 있다. 일반 점포·편의시설을 자동으로 관광명소로 분류하지 않는다. 현재 영업 여부와 개·폐점, 상호 변경은 확인되지 않았다. OSM에 없는 업소 이름이나 위치는 만들지 않았다.

높이와 층수는 서로 겹치는 집계다. 없는 높이를 생성하지 않았고, 측정 높이인지 다른 지도 편집자가 추정한 값인지 확인되지 않은 원본 태그도 그대로 유지했다. 장면에서 적용하는 기본 높이·색상·외관은 이 원본 데이터와 구분해야 한다.

## JSON 규격 v1

모든 좌표는 **WGS84 `[경도, 위도]`**다. 미터 투영 좌표가 아니다. 좌표를 반올림하거나 도로·건물 형상을 단순화하지 않았다.

```ts
type Position = [number, number];
type Tags = Record<string, string>;
type UrbanData = {
  version: 1;
  metadata: {
    coordinateSystem: "WGS84";
    cityRelationId: 2409180;
    attribution: string;
    license: "ODbL-1.0";
    inputs: Record<"boundary" | "roads" | "buildings" | "pois", {
      endpoint: string;
      retrievedAt: string;
      osmBaseTimestamp: string;
      query: string;
      rawBytes: number;
      sha256: string;
    }>;
    counts: object;
    // bbox, coordinateOrder, attributionUrl, licenseUrl,
    // sourceUrlTemplate, processing, limitations도 포함.
  };
  roads: { id: string; segmentIndex: number; coordinates: Position[]; tags: Tags }[];
  buildings: { id: string; polygons: Position[][][]; tags: Tags }[];
  pois: {
    id: string;
    coordinates: Position;
    positionSource: "node" | "interior-point" | "geometry-point";
    tags: Tags;
  }[];
};
```

건물의 `polygons`는 `[polygon][ring][coordinate]` 순서이며, 각 polygon의 첫 링은 외곽선, 나머지는 구멍이다. 외곽선은 반시계 방향, 구멍은 시계 방향이며 시작 좌표로 폐합한다. 하나의 multipolygon relation에 여러 건물이 있으면 객체 하나에 여러 polygon을 저장한다. `building:part`만 있고 `building`이 없는 객체는 별도로 조회하지 않았다.

`id`는 `node/123`, `way/123`, `relation/123` 형식이다. 원본 URL은 `https://www.openstreetmap.org/${id}`로 복원한다. 도로가 시 경계를 여러 번 드나들면 같은 `id`의 `segmentIndex`가 달라진다. 장면의 고유 키는 두 값을 함께 사용한다.

장소가 node이면 실제 node 위치를 사용한다. 면이면 구멍과 오목한 외곽선을 피하는 내부 점을 계산한다. 선형 장소 또는 조립할 수 없는 면은 원본 geometry의 시 안쪽 꼭짓점을 쓰고 `geometry-point`로 표시한다. 파생 대표 점은 입구 좌표나 측량 중심점이라는 뜻이 아니다.

작은 색인은 `{version, metadata, pois, roads}`다. 여기의 `roads`만 `{id, name, coordinates: Position}` 형식이며, 같은 이름 중 좌표 수가 가장 많은 도로 선의 중간 꼭짓점을 대표 점으로 쓴다. 원본 도로망은 전체 파일에 보존한다.

## 시 경계 처리와 제외

성남시의 원본 경계 상자 `127.0270715,37.3333872,127.1959614,37.4748116`를 먼저 조회했다. 상자에는 서울·과천·의왕·용인·광주 등의 인접 지역이 일부 포함될 수 있으므로 실제 시 경계로 후처리했다. 조회 전 상자 수량은 도로 20,987개, 건물 39,760개, 장소 4,696개다.

- 도로는 원본 경계와 각 선분의 교차점을 구해 성남시 안쪽 조각만 남긴다. 완전히 시 밖인 5,887개 way는 제외했다.
- 건물은 원래의 면 형상을 유지한다. 시 밖 7,263개, 이미 relation으로 표현한 중복 member way 193개, 조립할 수 없는 relation 3개를 제외했다. 시 경계를 가로지르는 [way 705213935](https://www.openstreetmap.org/way/705213935) 1개는 원본 외곽선을 임의로 변형하지 않고 제외했다.
- 제외한 relation은 [18587655](https://www.openstreetmap.org/relation/18587655), [21198579](https://www.openstreetmap.org/relation/21198579), [21228475](https://www.openstreetmap.org/relation/21228475)다. 각각 외곽 way 없음, 지원하지 않는 member 역할, 외곽 way 없음으로 기록했다.
- 장소는 시 안쪽 좌표를 확보하지 못한 1,519개를 제외했다.

모든 제외 객체의 ID와 이유는 `geodata-validation.json`에 남긴다. 시 안에 남은 건물 relation 553개는 외곽선·구멍·분리된 폴리곤을 조립했다.

## 재현과 검증

프로젝트 루트에서 실행한다.

```sh
node --import tsx scripts/fetch-seongnam-geodata.ts
node --import tsx scripts/fetch-seongnam-geodata.ts --offline
node --import tsx scripts/fetch-seongnam-geodata.ts --self-test
```

기본 실행은 동일 조회문의 로컬 원본 캐시가 있으면 재사용한다. `--offline`은 네트워크 호출 없이 같은 원본으로 두 JSON을 다시 생성하며, 필요한 캐시가 없으면 실패한다. 새 OSM 상태를 받으려면 필요한 `geodata-*-raw.json` 캐시를 별도 보관한 뒤 해당 파일만 제거하고 기본 실행한다. 온라인 재조회 결과는 최신 OSM 편집에 따라 달라진다. 버전별 원본 JSON·조회문·영수증과 SHA-256을 함께 보관해야 이번 스냅샷을 정확하게 재현할 수 있다.

조회 엔드포인트는 `https://overpass-api.de/api/interpreter`이며, 실패하면 공식 목록의 `https://overpass.private.coffee/api/interpreter`를 순차 시도한다. 429/406 응답은 30초 기다린다. 응답에 Overpass `remark`가 있으면 불완전 응답으로 처리하고 채택하지 않는다. 실제 채택한 네 응답은 모두 첫 번째 엔드포인트에서 받았다.

| 레이어 | 원본 OSM 기준 시각 UTC | 조회 완료 UTC |
| --- | --- | --- |
| 시 경계 | 2026-09-15 02:06:20 | 02:08:06 |
| 도로 | 2026-09-15 02:11:22 | 02:13:54 |
| 건물 | 2026-09-15 02:12:21 | 02:14:09 |
| 장소 | 2026-09-15 02:14:15 | 02:15:55 |

레이어는 같은 날 순차 조회했으며 하나의 원자적 시점에 해당하지 않는다. 원본별 정확한 조회문과 해시는 두 데이터 파일의 `metadata.inputs` 및 개발 기록에 있다. 초기 시 경계 조회 영수증의 조회 완료 시각은 다운로드 파일 생성 시각에서 복구했다.

검증 결과:

- 유효하지 않은 좌표, 성남시 밖 좌표, 유효하지 않은 건물 링, 중복 객체 키: **모두 0건**.
- 선분 교차, 오목한 경계, 구멍을 가로지르는 도로, 역방향 multipolygon member, 열린 링 거부, 면 내부 점 생성 회귀 검증 통과.
- 기존 Three.js의 별도 삼각 분할로 33,119개 건물 폴리곤을 검증했다. 삼각형 122,123개의 면적 합이 원본 외곽 면적에서 구멍 면적을 뺀 값과 일치했으며 실패는 0건이다.
- `--offline` 재생성 전후 두 JSON의 SHA-256이 각각 동일했다. 재현성 결과는 `geodata-reproducibility.json`에 보관했다.
- 기존 표시용 구 경계에 대표 좌표를 대입하면 수정구 건물 16,337개·장소 724개, 중원구 건물 5,618개·장소 497개, 분당구 건물 10,345개·장소 1,955개다. 단순화 경계 부근 장소 1개는 별도 집계했다. 이는 세 구에 데이터가 분포함을 확인하는 보조 점검이며 정확한 행정 통계가 아니다.

## 출처와 이용 조건

데이터 귀속은 **© OpenStreetMap contributors**, 라이선스는 [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)이다. 지도 화면에는 귀속 문구와 [OSM 저작권 안내](https://www.openstreetmap.org/copyright) 링크를 표시한다. 공개 배포하는 가공 지리 데이터에는 ODbL 조건과 출처를 유지한다. 이는 앱의 다른 소스 코드 전체의 라이선스를 바꾸는 선언이 아니다.

조회·처리 방식의 참고 자료는 [Overpass 공식 사용 설명서](https://dev.overpass-api.de/overpass-doc/en/), [영역 조회](https://dev.overpass-api.de/overpass-doc/en/full_data/area.html), [Overpass QL 규격](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [공용 서버 목록](https://wiki.openstreetmap.org/wiki/Overpass_API), [공용 자원 사용 안내](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)다. 저장된 선·면 좌표의 직접 근거는 위 해시로 식별한 원본 OSM 응답이다.

## 추가 수록: 실제 공원·숲·잔디·수면

`src/lib/diorama/seongnam-landcover.json`은 같은 시 경계와 좌표 규칙을 사용하는 별도 정적 파일이다. 크기는 **786,742 bytes**, gzip **211,069 bytes**다. 원본 OSM 기준 시각은 **2026-09-15T02:23:36Z**, 조회 완료 시각은 **2026-09-15T02:24:57.852Z**다. 도로·건물·장소 파일은 이 추가 작업에서 다시 내려받거나 변경하지 않았다.

```ts
type LandcoverData = {
  version: 1;
  metadata: {
    inputs: object; counts: object; limitations: string[];
    license: "ODbL-1.0"; attribution: "© OpenStreetMap contributors";
    // 좌표 규칙·시 경계 ID·출처 URL과 가공 방식도 포함.
  };
  areas: { id: string; polygons: [number, number][][][]; tags: Record<string, string> }[];
};
```

대상은 `natural=water|wood`, `landuse=forest|grass|recreation_ground`, `leisure=park|garden|nature_reserve`, `waterway=riverbank`가 있는 way와 relation이다. 동일 조회문으로 먼저 수량만 확인한 결과 경계 상자에 1,362개 객체가 있었으며, 원본 geometry 응답은 4,496,240 bytes였다.

최종 파일에는 **933개 객체, 934개 폴리곤, 내부 구멍 42개, 좌표 28,409개**를 수록했다. 태그별로 수면 66개, 숲 156개, 공원 279개, 정원 39개, 잔디 393개, 레크리에이션 부지 3개다. 분류는 겹칠 수 있으며 공원 경계 안에 별도의 숲·잔디·호수가 존재할 수 있다. 원본에 등록된 나무 높이·수관이나 지형 고도를 재현하는 데이터가 아니다.

확인한 주요 외곽선은 [중앙공원 way 386610164](https://www.openstreetmap.org/way/386610164), [율동공원 way 277795948](https://www.openstreetmap.org/way/277795948), 율동공원 안의 [분당저수지 way 308365215](https://www.openstreetmap.org/way/308365215)다. 각각 폐합 좌표를 포함한 53개, 72개, 67개 좌표를 원본 그대로 보존했다.

시 밖 객체 394개, 시 경계를 가로지르는 객체 31개, 조립할 수 없는 외곽선 1개, 유효하지 않거나 닫히지 않은 way 1개, 동일 분류의 relation으로 이미 표현한 외곽 member way 2개를 제외했다. **탄천 수면 relation 9035438과 낙생저수지 way 37220424는 시 경계를 가로지르므로 이 파일에 없다.** 탄천의 기존 중심선 자료와 이번 수면 자료를 혼동하지 않는다. 가로지르는 큰 숲도 일부 제외되므로 지도 전체의 빈 면적을 미개발지나 무수목 지역이라고 해석할 수 없다.

원래의 면과 구멍을 보존하기 위해 경계에서 면을 임의로 잘라 변형하지 않았다. `inner` member에 다른 종류의 토지 피복이 등록되어 있으면 별개 객체로 보존한다. 모든 제외 ID와 이유는 `outputs/seongnam-living-city-development/geodata-landcover-validation.json`에 기록했다.

```sh
node --import tsx scripts/fetch-seongnam-geodata.ts --landcover
node --import tsx scripts/fetch-seongnam-geodata.ts --landcover --offline
```

이 경로는 기존 시 경계 캐시와 새로운 토지 피복 캐시만 사용한다. 기존 도시 JSON 두 개를 다시 생성하지 않는다. 좌표 오류·시 경계 밖 좌표·유효하지 않은 링·중복 ID는 모두 0건이다. 별도 Three.js 삼각 분할 검증에서 934개 폴리곤의 삼각형 25,649개가 구멍을 뺀 원래 면적과 일치했다. 스크립트의 TypeScript 검사와 ESLint도 통과했다. 전체 출처·ODbL 조건과 캐시 재현 규칙은 앞 절과 같다.
