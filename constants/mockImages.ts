import type { ImageSourcePropType } from "react-native";

/**
 * [FULL-DEV] Property/Invest 상세 화면 및 카드 썸네일에서 쓰는 테스트용 mock 이미지.
 *
 * 이 프로젝트에는 실제 매물/투자상품 사진이 없다(테스트 단계, 실제 소유자 정보 없음).
 * 사용자 지시(§12 Mock 이미지)에 따라 외부 이미지 서비스(picsum 등 불안정한 URL)에
 * 의존하지 않고, 카테고리별로 준비한 이미지를 프로젝트 assets 폴더
 * (assets/images/mock/)에 실제 파일로 저장해 정적으로 require()한다. 이미지 자체는
 * "MOCK" 배지 없는 순수 사진이다 — mock 표시는 이미지 픽셀이 아니라 카드/상세 화면의
 * 실제 UI 컴포넌트(예: property-detail/[id].tsx의 mockBadge)가 담당한다(카드 썸네일은
 * crop 비율이 제각각이라 이미지에 구운 텍스트는 잘려나가기 때문 — PropertyCard.tsx 참고).
 *
 * Metro 번들러는 동적 경로의 require(변수)를 지원하지 않으므로, 카테고리 → 이미지
 * 배열 매핑을 이 파일 한 곳에서 정적으로 선언한다. 새 카테고리/이미지를 추가할 때는
 * 이 매핑에 새 require() 줄을 추가하는 방식만 가능하다(문자열 조합으로 경로를 만들지
 * 않는다).
 *
 * [STEP: 홈/부동산/투자 카테고리 재구성, 2026-09-07] 사용자 지시로 카테고리 체계를
 * 재구성했다 — 기존 villa/retail 키는 그대로 두고 표시 라벨만 바꿨고(villa→"주택/단지",
 * retail→"공장/창고" — retail 슬롯 사진은 이미 이전 STEP에서 공장 외관 사진으로
 * 교체되어 있었다), 신규 키 townhouse(단독건물)/office(빌딩·상가)를 추가했다.
 * townhouse/office는 아직 전용 사진이 없어 개념적으로 가까운 기존 실사진을 임시로
 * 재사용한다(townhouse←villa의 다세대 건물 사진, office←invest retail의 매장 사진) —
 * 전용 사진이 준비되면 이 두 require() 경로만 교체하면 된다.
 */

export type PropertyImageCategory =
  | "apartment"
  | "residential"
  | "building"
  | "factory"
  | "land"
  | "other";

/**
 * [STEP: 카테고리 재구성] 투자상품 카테고리를 "토지/부지, 빌딩/상가, 주택/단지, 공장/창고,
 * 기타" 5개로 재구성했다. 기존 retail→commercial(빌딩·상가, 사진은 기존 매장 사진
 * 그대로 재사용), residential은 라벨만 "주택/단지"로 변경(키/사진 동일). 기존 office/
 * development 키는 새 5개 체계에 없어 제거했다 — office였던 상품(i6, 오피스 펀드)은
 * commercial로, development였던 상품(i2, 신규 타워 개발)은 residential로 재분류했다
 * (constants/mockData.ts 참조). land/industrial은 신규 키 — 전용 사진이 아직 없어
 * land←property의 나대지 사진, industrial←property의 공장 외관 사진을 임시로
 * 재사용한다.
 */
export type InvestImageCategory = "land" | "building" | "commercial" | "residential" | "industrial" | "warehouse" | "other";

export const MOCK_PROPERTY_IMAGES: Record<PropertyImageCategory, ImageSourcePropType[]> = {
  apartment: [
    require("../assets/images/mock/property/apartment-1.png"),
    require("../assets/images/mock/property/apartment-2.png"),
  ],
  // [STEP: 카테고리 전체 변경, 2026-09-09] "주택" — 기존 villa 사진을 재사용한다.
  residential: [
    require("../assets/images/mock/property/villa-1.png"),
    require("../assets/images/mock/property/villa-2.png"),
  ],
  // "빌딩" — 기존 office 사진을 재사용한다.
  building: [
    require("../assets/images/mock/property/office-1.png"),
    require("../assets/images/mock/property/office-2.png"),
  ],
  // "공장" — 전용 사진이 없어 invest 카테고리의 industrial(공장) 사진을 재사용한다.
  factory: [
    require("../assets/images/mock/invest/industrial-1.png"),
    require("../assets/images/mock/invest/industrial-2.png"),
  ],
  land: [
    require("../assets/images/mock/property/land-1.png"),
    require("../assets/images/mock/property/land-2.png"),
  ],
  other: [
    require("../assets/images/mock/property/other-1.png"),
    require("../assets/images/mock/property/other-2.png"),
  ],
};

export const MOCK_INVEST_IMAGES: Record<InvestImageCategory, ImageSourcePropType[]> = {
  land: [
    require("../assets/images/mock/invest/land-1.png"),
    require("../assets/images/mock/invest/land-2.png"),
  ],
  // [STEP: 카테고리 전체 변경, 2026-09-09] "빌딩" 신규 — 전용 사진이 없어 기존
  // commercial(빌딩/상가) 사진을 재사용한다.
  building: [
    require("../assets/images/mock/invest/commercial-1.png"),
    require("../assets/images/mock/invest/commercial-2.png"),
  ],
  commercial: [
    require("../assets/images/mock/invest/commercial-1.png"),
    require("../assets/images/mock/invest/commercial-2.png"),
  ],
  residential: [
    require("../assets/images/mock/invest/residential-1.png"),
    require("../assets/images/mock/invest/residential-2.png"),
  ],
  industrial: [
    require("../assets/images/mock/invest/industrial-1.png"),
    require("../assets/images/mock/invest/industrial-2.png"),
  ],
  // "창고" 신규 — 전용 사진이 없어 기존 industrial(공장/창고) 사진을 재사용한다.
  warehouse: [
    require("../assets/images/mock/invest/industrial-1.png"),
    require("../assets/images/mock/invest/industrial-2.png"),
  ],
  other: [
    require("../assets/images/mock/invest/other-1.png"),
    require("../assets/images/mock/invest/other-2.png"),
  ],
};
