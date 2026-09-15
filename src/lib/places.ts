import expandedPlaces from './places-expanded.json' with { type: 'json' };

/** Official place facts verified per record; expanded on 2026-09-15. Unknown operational facts remain null.
 * Exact provenance, coordinate interpretation and photo rights: docs/place-sources.md.
 */
export interface PlacePhoto {
  src: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  width: number;
  height: number;
  caption?: string;
  capturedAt?: string;
  downloadUrl?: string;
  changes?: string;
}
export interface Place {
  id: string;
  name: string;
  district: "수정구" | "중원구" | "분당구";
  type: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  sourceUrl: string;
  verifiedAt: string;
  operatingHours: string | null;
  closedDays: string | null;
  admission: string | null;
  photo: PlacePhoto | null;
  officialQuotes: { text: string; sourceUrl: string }[];
  coordinateSourceUrl?: string;
  descriptionSourceUrl?: string;
  operationsSourceUrl?: string;
  verificationNote?: string;
}

export const PLACES: Place[] = [
  {
    "id": "pangyo-museum",
    "name": "판교박물관",
    "district": "분당구",
    "type": "박물관",
    "description": "판교에서 발굴된 삼국시대 유적과 유물을 통해 지역의 역사를 살펴보는 박물관입니다.",
    "address": "경기도 성남시 분당구 판교로 191(판교동)",
    "lat": 37.4009256028463,
    "lng": 127.095584641642,
    "sourceUrl": "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1",
    "verifiedAt": "2026-09-13",
    "operatingHours": "09:00 ~ 18:00 (입장 마감 17:30)",
    "closedDays": "매주 월요일, 1월 1일, 설 연휴, 추석 연휴",
    "admission": "무료",
    "photo": {
      "src": "/places/pangyo-museum.jpg",
      "sourceUrl": "https://archive.much.go.kr/data/01/folderView.do?idnbr=2016013905&jobdirSeq=314",
      "author": "대한민국역사박물관",
      "license": "KOGL Type 1",
      "licenseUrl": "https://www.kogl.or.kr/info/licenseType1.do",
      "width": 1920,
      "height": 1281,
      "caption": "판교박물관 외관 (아카이브 자료번호 2016013939)",
      "capturedAt": "2014-11-13",
      "downloadUrl": "https://archive.much.go.kr/archiveImage/service.do?idnbr=2016013939",
      "changes": "아카이브가 제공한 서비스 이미지 그대로 사용. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "관람 종료 30분전까지 입장",
        "sourceUrl": "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1"
      },
      {
        "text": "매주 월요일",
        "sourceUrl": "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1"
      },
      {
        "text": "경기도 성남시 분당구 판교로 191(판교동) 판교박물관",
        "sourceUrl": "https://museum.seongnam.go.kr/pangyo/contents/content.do?cIdx=1"
      }
    ],
    "coordinateSourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/44",
    "descriptionSourceUrl": "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=d73a3a50-2f94-4a12-bed8-34c5ca1536ab"
  },
  {
    "id": "yuldong-park",
    "name": "율동공원",
    "district": "분당구",
    "type": "공원",
    "description": "자연호수를 중심으로 잔디밭과 야산이 이어지는 공원입니다. 산책과 휴식을 즐길 수 있습니다.",
    "address": "경기도 성남시 분당구 율동 399",
    "lat": 37.3746279803245,
    "lng": 127.150571222078,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/44",
    "verifiedAt": "2026-09-13",
    "operatingHours": null,
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/yuldong-park.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Yuldong_Park,_Seongnam,_Gyeonggi_(%EA%B2%BD%EA%B8%B0%EB%8F%84_%EC%84%B1%EB%82%A8_%EC%9C%A8%EB%8F%99%EA%B3%B5%EC%9B%90)_-_panoramio.jpg",
      "author": "골뱅이",
      "license": "CC BY-SA 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0",
      "width": 3072,
      "height": 722,
      "caption": "Yuldong Park, Seongnam, Gyeonggi  (경기도 성남 율동공원)",
      "capturedAt": "촬영일 미상 (원본 업로드일: 2010-12-24)",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/b/bb/Yuldong_Park,_Seongnam,_Gyeonggi_(%EA%B2%BD%EA%B8%B0%EB%8F%84_%EC%84%B1%EB%82%A8_%EC%9C%A8%EB%8F%99%EA%B3%B5%EC%9B%90)_-_panoramio.jpg",
      "changes": "Commons가 제공한 원본 파일 그대로 사용. 확대 보간이나 내용 수정 없음. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "율동공원은 원래의 자연을 최대한 살려 조성한 자연호수 공원으로 호수와 잔디밭·야산 등 경치가 아름답습니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/44"
      },
      {
        "text": "삼일운동 기념탑",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/44"
      },
      {
        "text": "경기도 성남시 분당구 율동 399",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/44"
      }
    ]
  },
  {
    "id": "central-park",
    "name": "중앙공원",
    "district": "분당구",
    "type": "공원",
    "description": "도심의 숲과 호수를 걸으며 수내동가옥 등 지역의 문화유산을 함께 둘러볼 수 있는 공원입니다.",
    "address": "경기도 성남시 분당구 성남대로 550",
    "lat": 37.3803076563208,
    "lng": 127.121178669524,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/43",
    "verifiedAt": "2026-09-13",
    "operatingHours": null,
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/central-park.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Bundang_Central_Park.JPG",
      "author": "Jfranklee",
      "license": "Public domain",
      "licenseUrl": "https://commons.wikimedia.org/wiki/File:Bundang_Central_Park.JPG#Licensing",
      "width": 2048,
      "height": 1536,
      "caption": "Bundang Central Park",
      "capturedAt": "2007-12-12",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/1/13/Bundang_Central_Park.JPG",
      "changes": "원본 파일 그대로 사용. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "도심 중심에 자리한 중앙공원은 숲과 호수가 어우러지는 대표적인 녹지공간입니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/43"
      },
      {
        "text": "한산이씨 수내동가옥",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/43"
      },
      {
        "text": "경기도 성남시 분당구 성남대로 550",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/43"
      }
    ]
  },
  {
    "id": "seongnam-arts-center",
    "name": "성남아트센터",
    "district": "분당구",
    "type": "문화예술",
    "description": "오페라하우스·콘서트홀·앙상블시어터와 전시공간을 갖춘 문화예술 공간입니다. 공연과 전시 일정에 맞춰 방문할 수 있습니다.",
    "address": "경기도 성남시 분당구 성남대로 808",
    "lat": 37.4029565748635,
    "lng": 127.130559855569,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/42",
    "verifiedAt": "2026-09-13",
    "operatingHours": "프로그램·시설별 상이",
    "closedDays": "프로그램·시설별 상이",
    "admission": "프로그램·시설별 상이",
    "photo": {
      "src": "/places/seongnam-arts-center.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Seongnam_Arts_Center.jpg",
      "author": "Snart",
      "license": "CC BY-SA 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0",
      "width": 1500,
      "height": 928,
      "caption": "Seongnam Arts Center",
      "capturedAt": "2012-10-12 18:35:15",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/9/9d/Seongnam_Arts_Center.jpg",
      "changes": "Commons가 제공한 원본 파일 그대로 사용. 확대 보간이나 내용 수정 없음. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "성남아트센터는 날로 증가하는 문화예술 수요를 충족시키기 위해 건립된 전문 문화예술 공간입니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/42"
      },
      {
        "text": "오페라하우스, 콘서트홀, 앙상블시어터",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/42"
      },
      {
        "text": "경기도 성남시 분당구 성남대로 808",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/42"
      }
    ],
    "operationsSourceUrl": "https://english.visitkorea.or.kr/svc/whereToGo/locIntrdn/rgnContentsView.do?vcontsId=100191"
  },
  {
    "id": "moran-market",
    "name": "모란민속5일장",
    "district": "중원구",
    "type": "전통시장",
    "description": "날짜 끝자리가 4일과 9일인 날에 열리는 전통시장입니다. 장날마다 다양한 물건과 사람들로 도심 속 장터 풍경이 펼쳐집니다.",
    "address": "경기도 성남시 중원구 둔촌대로 68",
    "lat": 37.4293379506949,
    "lng": 127.126658477575,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/39",
    "verifiedAt": "2026-09-13",
    "operatingHours": "매월 4·9·14·19·24·29일 09:00~19:00",
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/moran-market.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Moran_Market_20260204_01.jpg",
      "author": "Motoko C. K.",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0",
      "width": 3951,
      "height": 2963,
      "caption": "모란시장 곡물 판매대",
      "capturedAt": "2026-02-04 15:30:18",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/4/4c/Moran_Market_20260204_01.jpg",
      "changes": "원본 파일 그대로 사용. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "모란은 1960년대 성남 일대의 황무지를 개간하면서 붙인 지명입니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/39"
      },
      {
        "text": "매월 끝자리 4일과 9일, 닷새마다 열리는",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/39"
      },
      {
        "text": "경기도 성남시 중원구 둔촌대로 68",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/39"
      }
    ]
  },
  {
    "id": "seongnam-city-hall",
    "name": "성남시청",
    "district": "중원구",
    "type": "시민공간",
    "description": "시민 소통 공간으로 소개되는 성남의 시청입니다. 공간별 이용 안내를 확인하고 방문해 보세요.",
    "address": "경기도 성남시 중원구 성남대로 997",
    "lat": 37.4200218720325,
    "lng": 127.126586301128,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/14",
    "verifiedAt": "2026-09-13",
    "operatingHours": null,
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/seongnam-city-hall.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Seongnam_City_Hall,_Gyeonggi,_South_Korea.jpg",
      "author": "성남시청",
      "license": "KOGL Type 1",
      "licenseUrl": "https://www.kogl.or.kr/info/licenseType1.do",
      "width": 1220,
      "height": 600,
      "caption": "성남시청 전경",
      "capturedAt": "촬영일 미상 (Commons 등록 메타데이터: 2024-05-23)",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/3/34/Seongnam_City_Hall,_Gyeonggi,_South_Korea.jpg",
      "changes": "Commons가 제공한 원본 파일 그대로 사용. 확대 보간이나 내용 수정 없음. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "성남의 상징물이자 시민들의 소중한 자산입니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/14"
      },
      {
        "text": "부드럽고 친숙한 시민 소통 공간으로 태어났습니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/14"
      },
      {
        "text": "경기도 성남시 중원구 성남대로 997",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/14"
      }
    ],
    "verificationNote": "공식 페이지 소개의 연중무휴 안내와 상세정보의 주말·공휴일 휴무 안내가 달라 공간별 운영시간 확인이 필요합니다."
  },
  {
    "id": "bongguksa",
    "name": "봉국사 대광명전",
    "district": "수정구",
    "type": "문화유산",
    "description": "봉국사에 자리한 대광명전은 조선 후기 불전의 형식을 간직하고 있습니다. 도심에서 사찰의 역사와 건축을 만나볼 수 있습니다.",
    "address": "경기도 성남시 수정구 태평로 79",
    "lat": 37.4503533484461,
    "lng": 127.13539976834,
    "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/41",
    "verifiedAt": "2026-09-13",
    "operatingHours": null,
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/bongguksa.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Bongguksa_Daegwangmyeongjeon_by_gnongnong_1.jpg",
      "author": "gnongnong",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
      "width": 3910,
      "height": 2640,
      "caption": "봉국사대광명전",
      "capturedAt": "2016-09-30",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/1/13/Bongguksa_Daegwangmyeongjeon_by_gnongnong_1.jpg",
      "changes": "원본 파일 그대로 사용. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "봉국사는 1028년(고려 현종 19년)에 창건하였습니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/41"
      },
      {
        "text": "대광명전은 조선 후기의 불전 형식을 잘 간직하고 있습니다.",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/41"
      },
      {
        "text": "경기도 성남시 수정구 태평로 79",
        "sourceUrl": "https://www.seongnam.go.kr/tour/tu-pm030101/41"
      }
    ]
  },
  {
    "id": "manggyeongam",
    "name": "망경암",
    "district": "수정구",
    "type": "문화유산",
    "description": "영장산 자락에서 서울 방향을 조망할 수 있는 사찰입니다. 암벽에 새긴 마애여래좌상을 함께 살펴볼 수 있습니다.",
    "address": "경기도 성남시 수정구 태평로55번길 72",
    "lat": 37.453547,
    "lng": 127.137194,
    "sourceUrl": "https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160",
    "verifiedAt": "2026-09-13",
    "operatingHours": "09:00~18:00",
    "closedDays": null,
    "admission": null,
    "photo": {
      "src": "/places/manggyeongam.jpg",
      "sourceUrl": "https://commons.wikimedia.org/wiki/File:Mka-2.jpg",
      "author": "gnongnong",
      "license": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0",
      "width": 3644,
      "height": 2519,
      "caption": "망경암마애여래좌상",
      "capturedAt": "2016-09-30",
      "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/e/ed/Mka-2.jpg",
      "changes": "원본 파일 그대로 사용. 화면 크기에 맞춘 CSS 표시."
    },
    "officialQuotes": [
      {
        "text": "망경암은 서울이 한눈에 내려다볼 수 있는 사찰이다.",
        "sourceUrl": "https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160"
      },
      {
        "text": "이 마애여래좌상은 망경암(望京菴) 암벽에 새겨진 마애불이다.",
        "sourceUrl": "https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160"
      },
      {
        "text": "경기도 성남시 수정구 태평로55번길 72",
        "sourceUrl": "https://www.kctg.or.kr/tour/touristSiteView.do?tourist_cd=TOURIST_ID00011160"
      }
    ]
  },
  ...(expandedPlaces as Place[]),
];

/** Accept both durable IDs and the exact display names used by older runs. */
export function getPlace(idOrName: string): Place | undefined {
  const key = idOrName.trim();
  return PLACES.find((place) => place.id === key || place.name === key || (place.id === "bongguksa" && key === "봉국사"));
}
