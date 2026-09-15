# 성남 방문 장소 확장 조사

확인일: 2026-09-15. 기존 8개를 보존하고 새 장소 44개를 더해 좌표가 있는 52개 장소를 정리했다. 추가 후보 2개는 좌표 미확정 또는 지도 모순으로 통합 대상에서 제외했다.

## 통합 계약

- 기계 판독 파일: `outputs/seongnam-living-city-development/tourism-research.json`. `places`만 통합 가능하며 `pendingCandidates`는 표시하지 않는다.
- 기존 8개 ID·이름·좌표·사진·운영정보를 그대로 보존했다. 신규 장소의 운영시간·휴무·요금·사진은 `null`이다.
- 좌표는 방문 지점의 대표 위치이다. 공원 황톳길, 시설 내부 지점, 시장 내 개방화장실, 미술관 입주 건물은 정확한 출입구와 구별해 `coordinatePrecision`과 `notes`에 기록했다.
- `confidence=medium`은 실재 장소의 이름·주소가 확인되었지만 좌표가 부속시설/영역 대표 지점인 경우다. 운영 중·무료·연중 개방을 뜻하지 않는다.
- 성남시박물관은 2023년 공개된 체험동만 포함했다. 공식 페이지의 본관 2027년 개관 목표와 혼동하지 않는다.
- 다른 시에 걸친 산 정상이나 남한산성 전체를 성남 단독 소재지로 처리하지 않았다. 같은 공원의 시설을 임의로 분할하지 않았다. 다만 수내동가옥·책테마파크도서관·판교환경생태학습원은 독립 지정 유산 또는 독립 운영 기관이므로 이름·전용 출처·별도 좌표를 갖춘 항목으로 포함하고 `parentPlaceId`를 기록했다.

## 범위와 출처

성남시 문화관광의 [문화시설](https://www.seongnam.go.kr/tour/tu-pm0501001), [맨발황톳길](https://www.seongnam.go.kr/tour/tu-pm030309), [특화거리](https://www.seongnam.go.kr/tour/tu-pm0501006), [주변시설 지도](https://www.seongnam.go.kr/tour/tu-pm030101/44)를 우선했다. 공식 HTML 지도 링크 또는 지도 마커에 있는 위경도를 직접 확인했다. 한국관광공사 관광 LOD의 낙생대공원·상희공원·신해철거리·성남종합시장 자료를 보완했다.

영장·양지·단대공원은 수정구청의 시설 소개와 OSM 같은 이름의 공원 영역을 대조했다. OSM에 단대공원이 두 곳 있으므로 수정구 공식 주소에 맞는 `way/240822064`만 채택했다. MOKA는 공식 주소와 일치하는 백화점 건물 POI를 사용했다. 신구대학교식물원은 공식 지도 구형 좌표와 OSM 지점을 대조했다.

두 번째 조사에서는 천림산 봉수 유적·수내동가옥, 구미·황새울·능골·운중·금곡·마루공원, 책테마파크도서관, 맹산·판교환경생태학습원, 탄천종합운동장, 새마을역사관 등 13곳을 추가했다. 공원 이름·주소는 [성남시 공공와이파이 시설 목록](https://www.seongnam.go.kr/ct-pm080303)과 대조했다. 이 목록의 소수점 두 자리 지도 좌표는 정확도가 부족해 채택하지 않고, 같은 이름의 OSM 공원 내부 지점을 사용했다.

책테마파크도서관·맹산환경생태학습원·판교환경생태학습원은 각 공식 홈페이지의 카카오 약도 마커 데이터를 확인했다. 공개된 약도 JSON의 `placeX/placeY`를 공식 카카오 지도 JavaScript의 `new daum.maps.Coords(x, y).toLatLng()`로 변환했다. 각각 약도 key는 `2fw7x`, `mcjs`, `tahj`이며 JSON URL을 `coordinateEvidenceUrl`에 기록했다. 숫자 좌표를 추측하거나 주소 중심점으로 대체하지 않았다.

새마을역사관은 [경기도의 현장 소개](https://gnews.gg.go.kr/news/news_detail.do?number=202511091548397897C094&s_code=C094)와 운영 기관의 [연수원 안내](https://sua.saemaul.or.kr/)를 대조했다. 좌표는 한국관광공사의 연수원 대표 지점이므로 역사관 출입구로 간주하면 안 된다. 공식 현장 기사에 사전 예약 안내가 있어 방문 전에 기관에 확인하도록 기록했다.

모든 52개 장소에 `officialQuotes` 3개를 갖췄다. 신규 항목은 공식 페이지에서 실제로 확인한 짧은 이름·주소·종류·이용 안내 등의 근거이며, 새로운 홍보 문구를 공식 인용처럼 만들지 않았다. 기존 승인 39개는 인용문 보강 외 다른 필드를 변경하지 않았다.

사진은 새로 수집하거나 복제하지 않았다. 설명은 사실을 짧게 새로 작성했다. OSM 좌표를 사용하는 경우 [OpenStreetMap 저작자 표시 및 ODbL](https://www.openstreetmap.org/copyright)을 유지해야 한다.

## 장소별 근거

| 장소 | 구 | 유형 | 위도, 경도 | 좌표 해석 | 사실 출처 | 좌표 출처 |
|---|---|---|---|---|---|---|
| 판교박물관 | 분당구 | 박물관 | 37.4009256, 127.0955846 | official-representative-point | [사실](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 율동공원 | 분당구 | 공원 | 37.3746280, 127.1505712 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/44) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 중앙공원 | 분당구 | 공원 | 37.3803077, 127.1211787 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/43) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/43) |
| 성남아트센터 | 분당구 | 문화예술 | 37.4029566, 127.1305599 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/42) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/42) |
| 모란민속5일장 | 중원구 | 전통시장 | 37.4293380, 127.1266585 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/39) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/39) |
| 성남시청 | 중원구 | 시민공간 | 37.4200219, 127.1265863 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/14) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/14) |
| 봉국사 대광명전 | 수정구 | 문화유산 | 37.4503533, 127.1353998 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/41) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/41) |
| 망경암 | 수정구 | 문화유산 | 37.4535470, 127.1371940 | official-representative-point | [사실](https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160) | [좌표](https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160) |
| 성남시 식물원 | 중원구 | 식물원 | 37.4529872, 127.1678168 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 성남문화의집 | 수정구 | 문화예술 | 37.4390504, 127.1408494 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 서현문화의집 | 분당구 | 문화예술 | 37.3825714, 127.1265500 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 성남시박물관 체험동 | 수정구 | 박물관 | 37.4459174, 127.1537612 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 성남아트리움 | 수정구 | 문화예술 | 37.4449846, 127.1390577 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 한국잡월드 | 분당구 | 체험 | 37.3784945, 127.1063938 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm0501001) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501001) |
| 화랑공원 | 분당구 | 공원 | 37.3995305, 127.1038110 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 대원공원 | 중원구 | 공원 | 37.4346813, 127.1491869 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 황송공원 | 중원구 | 공원 | 37.4450968, 127.1685376 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 산성공원 | 중원구 | 공원 | 37.4526106, 127.1686313 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 위례공원 | 수정구 | 공원 | 37.4681623, 127.1388170 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 수진공원 | 수정구 | 공원 | 37.4355427, 127.1231944 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 희망대공원 | 수정구 | 공원 | 37.4464073, 127.1517666 | official-trail-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030309) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030309) |
| 모란 음식문화거리 | 중원구 | 특화거리 | 37.4327225, 127.1294398 | official-street-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm0501006) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501006) |
| 백현동카페문화특화거리 | 분당구 | 특화거리 | 37.3864461, 127.1114723 | official-street-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm0501006) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501006) |
| 정자동 카페거리 | 분당구 | 특화거리 | 37.3711971, 127.1062827 | official-street-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm0501006) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501006) |
| 제1호 백년기름 특화거리 | 중원구 | 특화거리 | 37.4306345, 127.1274914 | official-street-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm0501006) | [좌표](https://www.seongnam.go.kr/tour/tu-pm0501006) |
| 낙생대공원 | 분당구 | 공원 | 37.3875773, 127.1076838 | kto-representative-point | [사실](https://data.visitkorea.or.kr/page/2759981) | [좌표](https://data.visitkorea.or.kr/page/2759981) |
| 상희공원 | 분당구 | 공원 | 37.4109419, 127.1411856 | kto-representative-point | [사실](https://data.visitkorea.or.kr/page/2914491) | [좌표](https://data.visitkorea.or.kr/page/2914491) |
| 신해철거리 | 분당구 | 특화거리 | 37.3657774, 127.1269493 | kto-representative-point | [사실](https://data.visitkorea.or.kr/page/2650828) | [좌표](https://data.visitkorea.or.kr/page/2650828) |
| 성남종합시장 | 수정구 | 전통시장 | 37.4405719, 127.1453538 | kto-representative-point | [사실](https://data.visitkorea.or.kr/page/2762739) | [좌표](https://data.visitkorea.or.kr/page/2762739) |
| 신구대학교식물원 | 수정구 | 식물원 | 37.4339400, 127.0809000 | official-legacy-map-point | [사실](https://www.sbg.or.kr/guide/guide.html) | [좌표](https://www.sbg.or.kr/guide/location.html) |
| 대광사 | 분당구 | 문화유산 | 37.3467452, 127.1276360 | official-representative-point | [사실](https://www.seongnam.go.kr/tour/tu-pm030604?curPage=1#136) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 상대원시장 | 중원구 | 전통시장 | 37.4359794, 127.1587721 | official-facility-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/44) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 단대전통시장 | 중원구 | 전통시장 | 37.4448138, 127.1580158 | official-facility-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/44) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 남한산성시장 | 중원구 | 전통시장 | 37.4571305, 127.1646500 | official-facility-anchor | [사실](https://www.seongnam.go.kr/tour/tu-pm030101/44) | [좌표](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 영장공원 | 수정구 | 공원 | 37.4509614, 127.1338559 | osm-interior-point | [사실](https://www.sujeong-gu.go.kr/sub/content.asp?cIdx=217) | [좌표](https://www.openstreetmap.org/way/893207875) |
| 양지공원 | 수정구 | 공원 | 37.4641459, 127.1636130 | osm-interior-point | [사실](https://www.sujeong-gu.go.kr/sub/content.asp?cIdx=218) | [좌표](https://www.openstreetmap.org/way/871411648) |
| 단대공원 | 수정구 | 공원 | 37.4543891, 127.1566184 | osm-interior-point | [사실](https://www.sujeong-gu.go.kr/sub/content.asp?cIdx=219) | [좌표](https://www.openstreetmap.org/way/240822064) |
| 현대어린이책미술관 | 분당구 | 미술관 | 37.3927998, 127.1119913 | osm-host-building-point | [사실](https://www.hmoka.org/main/index.do) | [좌표](https://www.openstreetmap.org/node/4350141121) |
| 사기막골공원 | 중원구 | 공원 | 37.4455839, 127.1826792 | osm-interior-point | [사실](https://www.seongnam.go.kr/park/poolList.do?menuIdx=1000814&returnURL=%2Fmain.do&searchCode=park) | [좌표](https://www.openstreetmap.org/way/1092611499) |
| 천림산 봉수 유적 | 수정구 | 문화유산 | 37.4221952, 127.0756511 | osm-node | [사실](https://www.seongnam.go.kr/tour/tu-pm030401) | [좌표](https://www.openstreetmap.org/node/7023179789) |
| 수내동가옥 | 분당구 | 문화유산 | 37.3753670, 127.1243048 | official-representative-point | [사실](https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=3413100780000&pageNo=1_1_2_0) | [좌표](https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=3413100780000&pageNo=1_1_2_0) |
| 구미공원 | 분당구 | 공원 | 37.3421784, 127.1200843 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/480806780) |
| 황새울공원 | 분당구 | 공원 | 37.3841303, 127.1183743 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/437236112) |
| 능골공원 | 분당구 | 공원 | 37.3703895, 127.1165279 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/468668906) |
| 운중공원 | 분당구 | 공원 | 37.3908623, 127.0716384 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/493944599) |
| 금곡공원 | 분당구 | 공원 | 37.3573143, 127.1092875 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/435659202) |
| 마루공원 | 분당구 | 공원 | 37.3819898, 127.1134623 | osm-interior-point | [사실](https://www.seongnam.go.kr/ct-pm080303) | [좌표](https://www.openstreetmap.org/way/437912680) |
| 책테마파크도서관 | 분당구 | 도서문화 | 37.3793285, 127.1482213 | official-representative-point | [사실](https://www2.snlib.go.kr/bt/menu/12754/contents/41763/contents.do) | [좌표](https://www2.snlib.go.kr/bt/menu/12754/contents/41763/contents.do) |
| 맹산환경생태학습원 | 분당구 | 생태체험 | 37.4052243, 127.1420150 | official-representative-point | [사실](https://mpark.seongnam.go.kr:10003/main.php?menugrp=010400&master=html&act=page) | [좌표](https://mpark.seongnam.go.kr:10003/main.php?menugrp=010400&master=html&act=page) |
| 판교환경생태학습원 | 분당구 | 생태체험 | 37.3995912, 127.1038176 | official-representative-point | [사실](https://ppark.seongnam.go.kr:10013/info/location) | [좌표](https://ppark.seongnam.go.kr:10013/info/location) |
| 탄천종합운동장 | 분당구 | 체육문화 | 37.4101669, 127.1211970 | osm-interior-point | [사실](https://spo.isdc.co.kr/tan_visitWay.do) | [좌표](https://www.openstreetmap.org/way/658766450) |
| 새마을역사관 | 분당구 | 박물관 | 37.3890558, 127.1567487 | official-campus-representative-point | [사실](https://gnews.gg.go.kr/news/news_detail.do?number=202511091548397897C094&s_code=C094) | [좌표](https://data.visitkorea.or.kr/linkedview/131687) |

## 보류한 후보

| 장소 | 사유 | 근거 |
|---|---|---|
| 남한산성 닭죽촌 | 공식 시설명·주소 확인. 좌표 미확인. | [공식 자료](https://www.seongnam.go.kr/tour/tu-pm0501006) |
| 율동푸드파크 | 공식 지도 좌표가 다른 페이지의 율동공원 책테마파크 지점과 같아 정합성 확인 전 보류. | [공식 자료](https://www.seongnam.go.kr/tour/tu-pm0501006) |

## 확인 결과

- 장소 52개, 새 장소 44개. 구별 수: 수정구 14, 중원구 12, 분당구 26.
- 중복 ID·이름 없음. 모든 통합 좌표는 숫자이며 성남 주변 범위 검사 통과. `src/lib/diorama/seongnam-boundaries.json`의 실제 구 경계와 점-다각형 대조 결과 52/52개가 표기한 구 내부에 있다. 기존 8개 항목의 모든 원래 필드가 보존됐음을 비교 확인했다.
- 지도 출입구 정확도, 실시간 영업 여부, 무장애 접근성, 현장 답사는 검증하지 않았다.
- 운영정보가 상충하는 공식 문화시설 소개는 운영 사실로 옮기지 않았다. 출처 페이지의 요금·시간 필드 오기 및 일부 설명의 위치 모순은 그대로 복제하지 않았다.
