# 성남시 미니어처 지리 데이터 출처

조회일: 2026-09-15 (KST). 원본 OpenStreetMap 데이터 기준시각: **2026-09-15T00:08:19Z**.

## 사용 파일

| 파일 | 내용 | 좌표 형식 | 가공 |
| --- | --- | --- | --- |
| `src/lib/diorama/seongnam-boundaries.json` | 수정구·중원구·분당구의 3개 Polygon FeatureCollection | WGS84 `[경도, 위도]` | 공통 경계선별 Ramer–Douglas–Peucker 단순화, 약 20 m 허용오차 |
| `src/lib/diorama/tancheon-course.json` | 탄천 중심선 46개 좌표, 남쪽에서 북쪽 순서 | WGS84 `[경도, 위도]` | 시의 남·북 위도 범위로 선분 보간 절단 후 약 15 m 허용오차로 단순화 |

경계선 단순화는 위도 37.4°의 경도 거리 보정과 위도 1°당 111,320 m를 적용한 평면 근사로 수행했다. 수정구 163개, 중원구 102개, 분당구 182개 좌표이며 폐합 좌표를 포함한다. 원본 세 구 관계에는 `inner` 경계(구멍)가 없었다. 외곽 링은 GeoJSON의 반시계 방향으로 정렬했다. 동일 OSM way를 한 번만 단순화해 인접 구 사이 공통 경계가 일치한다. 별도 지형 높이·실제 건물 배치·건물 높이 데이터는 포함하지 않는다.

## 데이터 원본

지리 좌표는 OpenStreetMap의 공개 벡터 데이터다. 행정기관이 제공한 측량 경계 데이터가 아니다.

| 대상 | OSM 원본 | 행정 코드 (`ref:KR:mois:admin`) |
| --- | --- | --- |
| 성남시 | [relation 2409180](https://www.openstreetmap.org/relation/2409180) | 4113000000 |
| 수정구 | [relation 5423192](https://www.openstreetmap.org/relation/5423192) | 4113100000 |
| 중원구 | [relation 5423193](https://www.openstreetmap.org/relation/5423193) | 4113300000 |
| 분당구 | [relation 5423194](https://www.openstreetmap.org/relation/5423194) | 4113500000 |
| 탄천 | [way 768407483](https://www.openstreetmap.org/way/768407483) | 해당 없음 |

원본 성남시 relation의 경계 상자:

```json
{"west":127.0270715,"south":37.3333872,"east":127.1959614,"north":37.4748116}
```

`seongnam-boundaries.json`의 `bbox`는 원본 시 경계 상자다. 단순화된 폴리곤 좌표의 극값과 소폭 다를 수 있다. 경도·위도에 각각 같은 배율을 쓰면 동서 거리가 부풀려지므로 화면 투영에서 경도에 `cos(37.4°)` 보정을 적용한다. 북쪽을 위로 두려면 북쪽으로 증가하는 위도를 Three.js의 감소하는 z축에 대응시킨다.

탄천 원본 way는 성남시 밖의 상·하류를 포함한 188개 좌표다. 이번 파일은 위도 37.3333872–37.4748116 범위로 절단한 109개 좌표를 46개로 단순화했다. **전체 시 폴리곤과의 공간 교차가 아니라 남·북 위도로만 절단한 중심선**이다. 시작점은 `[127.1131668,37.3333872]`, 끝점은 `[127.1186757,37.4748116]`다. 실제 하폭은 이 파일에 없으며 화면의 강 폭은 시각적 표현이다.

## 재현 가능한 조회

서비스: [Overpass API 안내](https://wiki.openstreetmap.org/wiki/Overpass_API), 엔드포인트 `https://overpass-api.de/api/interpreter`.

[원본을 조회한 GET URL](https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A40%5D%3B%28relation%5Bboundary%3Dadministrative%5D%5Bname~%22%5E%28%EC%84%B1%EB%82%A8%EC%8B%9C%7C%EC%88%98%EC%A0%95%EA%B5%AC%7C%EC%A4%91%EC%9B%90%EA%B5%AC%7C%EB%B6%84%EB%8B%B9%EA%B5%AC%29%24%22%5D%2837.3%2C127.0%2C37.52%2C127.22%29%3Bway%5Bwaterway%3Driver%5D%5Bname%3D%22%ED%83%84%EC%B2%9C%22%5D%2837.3%2C127.0%2C37.52%2C127.22%29%3B%29%3Bout+geom%3B)

```overpass
[out:json][timeout:40];(relation[boundary=administrative][name~"^(성남시|수정구|중원구|분당구)$"](37.3,127.0,37.52,127.22);way[waterway=river][name="탄천"](37.3,127.0,37.52,127.22););out geom;
```

이 URL을 다시 실행하면 그 시점의 최신 OSM 상태를 받는다. 이번 파일의 시점은 위의 `timestamp_osm_base`로 기록했다. 애플리케이션은 저장한 JSON만 사용하며 런타임에 공용 Overpass API를 호출할 필요가 없다.

## 이용 조건과 표시

두 JSON 파일은 **© OpenStreetMap contributors**, [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)에 따라 사용한다. 지도 화면에 `© OpenStreetMap contributors`를 표시하고 [OSM 저작권·라이선스 안내](https://www.openstreetmap.org/copyright)로 연결한다. 수정된 데이터베이스를 공개 배포할 때는 해당 데이터의 ODbL 조건을 유지한다. 이 데이터 출처 고지는 앱 소스 코드 전체의 라이선스를 변경한다는 뜻이 아니다.

## 공식 행정·지리 교차 확인 자료

- [성남시청 행정구역 안내](https://www.seongnam.go.kr/city/1000013/10010/contents.do): 수정구·중원구·분당구 구분의 공식 참고 자료. 이 페이지의 지도 이미지를 복제하거나 추적하지 않았다.
- [성남시사 제1권](https://www.seongnam.go.kr/contents/down/History/HistoryOfSeongnamCity_1.pdf), 책자 54쪽의 탄천 설명: 성남시 중앙을 남쪽에서 북쪽으로 흐르는 탄천의 지리적 맥락을 확인하는 참고 자료. 중심선 좌표는 위 OSM way에서 얻었다.

공식 웹사이트 일부 페이지는 조회 시 응답 지연이 있어 검색 색인의 내용과 공개 문서 안내를 참고했다. 지리 형태의 직접 근거는 재현 가능한 OSM 응답이다. 이 미니어처는 실제 행정구역과 하천 위치를 바탕으로 만든 개략 시각화이며 정밀 측량·지적·고도 모델을 의미하지 않는다.
