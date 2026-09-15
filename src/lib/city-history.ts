export interface CityHistoryRecord {
  id: string;
  placeId: string;
  title: string;
  summary: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  publisher: string;
  imageUrl: null;
}

/** Dates distinguish events from publication; source photographs are not licensed here. */
export const CITY_HISTORY_RECORDS: CityHistoryRecord[] = [
  {
    id: 'pangyo-museum-opening-2013', placeId: 'pangyo-museum',
    title: '판교박물관 개관',
    summary: '2013년 4월 2일 판교박물관이 문을 열었습니다. 같은 해 7월 시정소식지가 개관일을 기록했습니다.',
    date: '2013-04-02', dateLabel: '개관일',
    sourceUrl: 'https://snvision.seongnam.go.kr/2692', publisher: '성남시 비전성남', imageUrl: null,
  },
  {
    id: 'pangyo-museum-renewal-2023', placeId: 'pangyo-museum',
    title: '개관 10주년, 상설전시실 새 단장',
    summary: '개관 10주년을 맞아 안내 키오스크와 전시 패널 등을 정비하고 상설전시실을 다시 열었다는 소식입니다. 아래 날짜는 보도일이며 정확한 재개관일은 확인되지 않았습니다.',
    date: '2023-06-02', dateLabel: '보도일',
    sourceUrl: 'https://snvision.seongnam.go.kr/17371', publisher: '성남시 비전성남', imageUrl: null,
  },
];
