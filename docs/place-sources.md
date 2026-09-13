# 성남 장소 카탈로그 출처 및 사진 이용허락

검증일: **2026-09-13 (Asia/Seoul)**. 장소 8곳, 수정구 2곳·중원구 2곳·분당구 4곳. 카탈로그는 `src/lib/places.ts`, 이미지와 귀속정보는 `public/places/`에 저장한다.

## 장소 사실과 지도 좌표

이름·주소·설명은 아래 공식 기관 자료를 확인했다. 좌표는 해당 공식 사이트가 제공하는 지도 마커 값이며, 현장에서 측량한 출입구 위치나 길찾기 경로를 뜻하지 않는다. 운영시간·휴관일·요금이 없거나 상충하면 `null`로 유지한다. 별도 확인 없이 상시 개방이나 무료라고 보충하지 않는다.

| 장소 | 구 | 공식 사실 출처 | 좌표 출처 및 해석 |
| --- | --- | --- | --- |
| 판교박물관 | 분당구 | [공식 안내](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1) | 37.4009256028463, 127.095584641642 · [본문의 주변 문화시설 지도에 명시된 판교박물관 마커](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 율동공원 | 분당구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/44) | 37.3746279803245, 127.150571222078 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/44) |
| 중앙공원 | 분당구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/43) | 37.3803076563208, 127.121178669524 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/43) |
| 성남아트센터 | 분당구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/42) | 37.4029565748635, 127.130559855569 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/42) |
| 모란민속5일장 | 중원구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/39) | 37.4293379506949, 127.126658477575 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/39) |
| 성남시청 | 중원구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/14) | 37.4200218720325, 127.126586301128 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/14) |
| 봉국사 대광명전 | 수정구 | [공식 안내](https://www.seongnam.go.kr/tour/tu-pm030101/41) | 37.4503533484461, 127.13539976834 · [성남문화관광의 Kakao 지도 링크](https://www.seongnam.go.kr/tour/tu-pm030101/41) |
| 망경암 | 수정구 | [공식 안내](https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160) | 37.453547, 127.137194 · [한국관광공사 페이지의 tourist_lat / tourist_lng](https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160) |

### 운영정보와 해석 제한

- 판교박물관 운영시간·휴관일·관람료는 [박물관 자체 관람안내](https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1)를 사용한다. 박물관 소개는 [한국관광공사](https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=d73a3a50-2f94-4a12-bed8-34c5ca1536ab)를 추가 확인했다. 원문의 층수 오기는 재사용하지 않았다.
- 성남아트센터는 성남문화관광의 일반 시간보다 방문 목적에 맞는 [한국관광공사 시설 안내](https://english.visitkorea.or.kr/svc/whereToGo/locIntrdn/rgnContentsView.do?vcontsId=100191)에 따라 시간·휴일·요금을 프로그램 및 시설별 상이로 기록했다.
- 성남시청 공식 소개의 연중무휴 문구와 상세표의 주말·공휴일 휴무가 상충한다. 건물 전체와 개방 공간의 범위가 명시적으로 분리되지 않아 운영시간과 휴무일을 `null`로 두고 `verificationNote`를 표시한다.
- 모란민속5일장의 시간은 공식 장날 운영 안내이며 상설시장이나 개별 점포 전체의 시간으로 확대하지 않는다.
- 봉국사 자료의 과거 문화재 지정 명칭·번호를 현재 등급으로 재진술하지 않았다. 사찰 연혁과 건축 설명만 사용한다.
- 현장 상황, 임시 휴관, 행사 일정, 접근성, 실시간 길찾기는 이 고정 카탈로그로 검증하지 않았다.

`officialQuotes`는 공식 HTML에서 공백을 정규화해 존재 여부를 검사한 짧은 직접 인용 3개씩이다. 주소나 문장 일부도 포함하므로 독립적인 완전 문장으로 오인하지 않는다. 전문을 복제한 스냅샷이 아니다. `description`은 공식 사실을 바탕으로 작성한 요약이다.

## 사진 귀속정보

아래 8개 파일은 출처가 명시한 실제 장소 사진이다. 이미지 생성물이나 다른 장소의 대체 사진을 사용하지 않았다. 각 사진을 직접 열어 피사체를 확인했다. 원본 또는 배포처가 제공한 축소본을 내려받았고, 사진 내용을 편집하지 않았다. 저작자·라이선스 링크는 화면과 결과물에서도 표시해야 한다.

| 파일 | 피사체 | 저작자 | 이용허락 | 출처 |
| --- | --- | --- | --- | --- |
| `/places/pangyo-museum.jpg` | 판교박물관 외관 (아카이브 자료번호 2016013939) | 대한민국역사박물관 | [KOGL Type 1](https://www.kogl.or.kr/info/licenseType1.do) | [사진 설명과 권리](https://archive.much.go.kr/data/01/folderView.do?idnbr=2016013905&jobdirSeq=314) |
| `/places/yuldong-park.jpg` | Yuldong Park, Seongnam, Gyeonggi  (경기도 성남 율동공원) | 골뱅이 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Yuldong_Park,_Seongnam,_Gyeonggi_(%EA%B2%BD%EA%B8%B0%EB%8F%84_%EC%84%B1%EB%82%A8_%EC%9C%A8%EB%8F%99%EA%B3%B5%EC%9B%90)_-_panoramio.jpg) |
| `/places/central-park.jpg` | Bundang Central Park | Jfranklee | [Public domain](https://commons.wikimedia.org/wiki/File:Bundang_Central_Park.JPG#Licensing) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Bundang_Central_Park.JPG) |
| `/places/seongnam-arts-center.jpg` | Seongnam Arts Center | Snart | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Seongnam_Arts_Center.jpg) |
| `/places/moran-market.jpg` | 모란시장 곡물 판매대 | Motoko C. K. | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Moran_Market_20260204_01.jpg) |
| `/places/seongnam-city-hall.jpg` | 성남시청 전경 | 성남시청 | [KOGL Type 1](https://www.kogl.or.kr/info/licenseType1.do) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Seongnam_City_Hall,_Gyeonggi,_South_Korea.jpg) |
| `/places/bongguksa.jpg` | 봉국사대광명전 | gnongnong | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Bongguksa_Daegwangmyeongjeon_by_gnongnong_1.jpg) |
| `/places/manggyeongam.jpg` | 망경암마애여래좌상 | gnongnong | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [사진 설명과 권리](https://commons.wikimedia.org/wiki/File:Mka-2.jpg) |

### 라이선스 확인 방법

- Wikimedia 사진은 Commons API `action=query&prop=imageinfo&iiprop=url|extmetadata|size`의 `Artist`, `LicenseShortName`, `LicenseUrl`, `ImageDescription`와 파일 설명 페이지를 확인했다. Commons의 일반 사이트 푸터 라이선스를 개별 사진의 라이선스로 간주하지 않는다.
- 판교박물관은 대한민국역사박물관 아카이브의 판교 신도시 컬렉션 안 **자료번호 2016013939**이다. 공식 상세정보 요청 `POST https://archive.much.go.kr/data/select.json` (`idnbr=2016013939`)의 `name=판교박물관`, `koglcd=1`, `koglcdNm=1유형`, `prodDt=2014.11.13`을 확인했다. 생산기관은 컬렉션 페이지에 대한민국역사박물관으로 표시된다. 출처 링크에서 판교박물관 사진을 선택하면 개별 메타데이터와 공공누리 1유형 안내를 볼 수 있다.
- 성남시청 사진은 Commons가 성남시의 공공누리 1유형 저작물로 식별한 사진이다. 원 게시물 [공공누리 추천저작물 60693](https://www.kogl.or.kr/recommend/recommendDivView.do?recommendIdx=60693&division=img)도 Commons 설명에 기록되어 있다.
- CC BY-SA 3.0/4.0 사진을 편집한 파생 이미지를 배포할 때는 해당 동일조건변경허락을 지켜야 한다. 원 사진의 저작권을 서비스 전체의 저작권과 혼동하지 않는다. [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), [공공누리 1유형](https://www.kogl.or.kr/info/licenseType1.do).
- 중앙공원 사진은 저작자의 public domain 공개로 표시된다. 저작자와 원출처를 계속 제공한다.
- 과거 촬영 사진이므로 현재 시설 외관이나 운영 상태를 보장하지 않는다. 날짜가 업로드일만 확인되는 사진은 촬영일로 바꾸지 않았다. 율동공원 사진의 기존 서명도 그대로 보존했다.

`public/places/attribution.json`에 각 파일의 다운로드 URL, 이미지 크기, 바이트 수, SHA-256, 촬영/업로드일 정보, 변경 설명 및 판교박물관 라이선스 확인 필드를 기록했다. 사진 권리 미확인 항목은 **없다**. 운영정보의 미확인 항목은 카탈로그의 `null`과 위 제한사항으로 남겨 두었다.

## 검증

- 장소 ID 8개 및 한국어 이름 고유성, 3개 구 분포 확인.
- 공식 원문에 직접 인용 24개가 존재하는지 검사 통과.
- 사진 8개 JPEG 파일을 열어 장소·피사체를 확인하고 실제 이미지 해상도를 읽음.
- 모든 사진의 해시, 바이트 수 및 크기를 매니페스트와 대조.

### 원본 해상도 보강 (2026-09-13)

율동공원·성남시청·성남아트센터는 기존 사진과 동일한 Commons 원본 파일로 교체했다. 저작자·장소·이용허락은 그대로이며 재샘플링이나 사진 내용 편집은 하지 않았다. 다운로드 URL, 크기, 바이트 수, SHA-256을 카탈로그와 매니페스트에 반영했다.

| 사진 | 기존 크기 | 원본 크기 | 원본 바이트 수 |
| --- | --- | --- | --- |
| 율동공원 | 1,280 × 301 | 3,072 × 722 | 674,108 |
| 성남시청 | 960 × 472 | 1,220 × 600 | 161,674 |
| 성남아트센터 | 1,280 × 792 | 1,500 × 928 | 651,969 |

세 파일 모두 가로 1,080px·세로 430px 이상, 8MB·2,000만 화소 이하이다. 율동공원은 가로로 긴 파노라마이므로 카드의 CSS 프레임에서는 좌우 일부가 잘릴 수 있다. 원본의 서명은 파일에 보존되어 있다. 과거 결과물은 생성 당시 사진 해시를 유지하며, 교체 후 새 결과물은 `outputs/evaluation/place-probe.json`으로 재검증한다.

교체 후 8개 장소 전체 fixture를 순차 실행해 32개 1,080 × 1,080 PNG 생성, 장소별 사진 해시 일치, 출처 이미지 메타데이터, 폰트·이미지 로딩, 넘침 없음, API 호출 0회를 확인했다. 새 율동공원·성남시청·성남아트센터 첫 카드를 직접 열어 1,080 × 430px 사진 프레임의 표시 상태를 확인했다. 율동공원은 호수 물결과 수목 경계가 구분되고, 시청은 창문 격자와 건물 윤곽이 선명하다. 율동공원의 좌우 산책로·서명은 중앙 크롭 프레임 밖에 있으나 원본 파일에 남아 있으며, 아트센터는 야간 원본의 어두운 부분과 하단 크롭을 유지한다. 이 검증은 fixture 통합·시각 확인이며 실제 AI 생성 품질 평가는 아니다.
