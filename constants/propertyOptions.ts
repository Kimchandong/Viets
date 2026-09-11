/**
 * [2026-09-11 사용자 지시] 매물 편의시설/옵션 분류.
 *
 * 매매와 임대는 고르는 항목이 전혀 다르다 — 매매는 입지·단지·건물·물건 자체의
 * 특성이고, 임대는 실제로 들어가서 쓰는 가구·가전·조건이다. 그래서 거래 유형에
 * 따라 다른 목록을 보여준다.
 *
 * **저장값은 여기 정의한 안정적인 키다**(예: `sale.nearby.park`). 이전에는
 * 베트남어 원문을 그대로 저장했는데, 표기가 조금만 달라도 번역 사전에 걸리지 않아
 * 다국어 표시가 깨졌다. 키로 저장하면 라벨은 i18n(`propertyOptions.<키>`)에서
 * 가져오므로 6개 언어가 항상 일치한다.
 *
 * 예전에 자유 입력으로 저장된 값은 키 형식이 아니므로, 표시할 때 기존 사전
 * (constants/mockData.ts의 translateOption)으로 폴백한다 — 기존 데이터는 그대로 보인다.
 */

export type PropertyOptionGroup = {
  /** i18n 그룹 제목 키: propertyOptions.groups.<listing>.<id> */
  id: string;
  /** 이 그룹에 속한 옵션들의 전체 저장값(=i18n 키). */
  values: string[];
};

/** 저장값이 이 형식이면 i18n에서 라벨을 찾고, 아니면 예전 자유 입력값으로 취급한다. */
export const PROPERTY_OPTION_VALUE_PATTERN = /^(sale|rent)\.[a-zA-Z]+\.[a-zA-Z0-9]+$/;


/** 매매 매물에서 고를 수 있는 옵션. */
export const SALE_OPTION_GROUPS: PropertyOptionGroup[] = [
  {
    id: "nearby",
    values: [
      "sale.nearby.park",
      "sale.nearby.school",
      "sale.nearby.internationalSchool",
      "sale.nearby.university",
      "sale.nearby.hospital",
      "sale.nearby.pharmacy",
      "sale.nearby.shoppingCenter",
      "sale.nearby.hypermarket",
      "sale.nearby.convenienceStore",
      "sale.nearby.traditionalMarket",
      "sale.nearby.bank",
      "sale.nearby.atm",
      "sale.nearby.restaurant",
      "sale.nearby.cafe",
      "sale.nearby.cinema",
      "sale.nearby.sportsFacility",
      "sale.nearby.golfCourse",
      "sale.nearby.beach",
      "sale.nearby.river",
      "sale.nearby.lake",
      "sale.nearby.touristSpot",
      "sale.nearby.industrialComplex",
      "sale.nearby.busStop",
      "sale.nearby.trainStation",
      "sale.nearby.airport",
      "sale.nearby.mainRoad",
      "sale.nearby.highway",
    ],
  },
  {
    id: "complex",
    values: [
      "sale.complex.pool",
      "sale.complex.kidsPool",
      "sale.complex.gym",
      "sale.complex.sauna",
      "sale.complex.spa",
      "sale.complex.garden",
      "sale.complex.playground",
      "sale.complex.walkingTrail",
      "sale.complex.tennisCourt",
      "sale.complex.basketballCourt",
      "sale.complex.soccerField",
      "sale.complex.golfPractice",
      "sale.complex.bbq",
      "sale.complex.communityCenter",
      "sale.complex.clubhouse",
      "sale.complex.lounge",
      "sale.complex.rooftop",
      "sale.complex.restaurant",
      "sale.complex.cafe",
      "sale.complex.convenienceStore",
      "sale.complex.supermarket",
    ],
  },
  {
    id: "building",
    values: [
      "sale.building.elevator",
      "sale.building.freightElevator",
      "sale.building.basementParking",
      "sale.building.carParking",
      "sale.building.motorbikeParking",
      "sale.building.evCharging",
      "sale.building.security24",
      "sale.building.cctv",
      "sale.building.accessCard",
      "sale.building.smartAccess",
      "sale.building.fireSafety",
      "sale.building.emergencyGenerator",
    ],
  },
  {
    id: "unit",
    values: [
      "sale.unit.balcony",
      "sale.unit.terrace",
      "sale.unit.garden",
      "sale.unit.privatePool",
      "sale.unit.privateParking",
      "sale.unit.rooftop",
      "sale.unit.basement",
      "sale.unit.storage",
      "sale.unit.dressRoom",
      "sale.unit.homeOffice",
      "sale.unit.seaView",
      "sale.unit.riverView",
      "sale.unit.lakeView",
      "sale.unit.parkView",
      "sale.unit.cityView",
      "sale.unit.golfView",
      "sale.unit.gardenView",
    ],
  },
];

/** 임대 매물에서 고를 수 있는 옵션. */
export const RENT_OPTION_GROUPS: PropertyOptionGroup[] = [
  {
    id: "furniture",
    values: [
      "rent.furniture.bed",
      "rent.furniture.mattress",
      "rent.furniture.wardrobe",
      "rent.furniture.sofa",
      "rent.furniture.sofaBed",
      "rent.furniture.diningTable",
      "rent.furniture.chair",
      "rent.furniture.desk",
      "rent.furniture.bookshelf",
      "rent.furniture.tvStand",
      "rent.furniture.dresser",
      "rent.furniture.shoeCabinet",
      "rent.furniture.curtain",
      "rent.furniture.blind",
    ],
  },
  {
    id: "kitchen",
    values: [
      "rent.kitchen.refrigerator",
      "rent.kitchen.freezer",
      "rent.kitchen.microwave",
      "rent.kitchen.oven",
      "rent.kitchen.induction",
      "rent.kitchen.gasStove",
      "rent.kitchen.hood",
      "rent.kitchen.dishwasher",
      "rent.kitchen.riceCooker",
      "rent.kitchen.toaster",
      "rent.kitchen.coffeeMachine",
      "rent.kitchen.kitchenware",
      "rent.kitchen.tableware",
      "rent.kitchen.cookware",
      "rent.kitchen.sink",
      "rent.kitchen.islandTable",
    ],
  },
  {
    id: "appliance",
    values: [
      "rent.appliance.tv",
      "rent.appliance.airConditioner",
      "rent.appliance.washingMachine",
      "rent.appliance.dryer",
      "rent.appliance.refrigerator",
      "rent.appliance.microwave",
      "rent.appliance.oven",
      "rent.appliance.waterHeater",
      "rent.appliance.waterPurifier",
      "rent.appliance.vacuum",
      "rent.appliance.iron",
      "rent.appliance.hairDryer",
    ],
  },
  {
    id: "bathroom",
    values: [
      "rent.bathroom.bathtub",
      "rent.bathroom.showerBooth",
      "rent.bathroom.hotWater",
      "rent.bathroom.washbasin",
      "rent.bathroom.bidet",
      "rent.bathroom.mirror",
      "rent.bathroom.cabinet",
    ],
  },
  {
    id: "internet",
    values: [
      "rent.internet.wifi",
      "rent.internet.internet",
      "rent.internet.cableTv",
      "rent.internet.smartTv",
      "rent.internet.iptv",
    ],
  },
  {
    id: "living",
    values: [
      "rent.living.balcony",
      "rent.living.terrace",
      "rent.living.laundryRoom",
      "rent.living.storage",
      "rent.living.dressRoom",
      "rent.living.builtInCloset",
      "rent.living.workspace",
      "rent.living.smokingArea",
    ],
  },
  {
    id: "complex",
    values: [
      "rent.complex.pool",
      "rent.complex.gym",
      "rent.complex.sauna",
      "rent.complex.spa",
      "rent.complex.playground",
      "rent.complex.garden",
      "rent.complex.walkingTrail",
      "rent.complex.parking",
      "rent.complex.carParking",
      "rent.complex.motorbikeParking",
      "rent.complex.evCharging",
      "rent.complex.elevator",
      "rent.complex.security24",
      "rent.complex.cctv",
      "rent.complex.accessCard",
    ],
  },
  {
    id: "terms",
    values: [
      "rent.terms.petAllowed",
      "rent.terms.smokingAllowed",
      "rent.terms.foreignerAllowed",
      "rent.terms.familyAllowed",
      "rent.terms.childrenAllowed",
      "rent.terms.shortTerm",
      "rent.terms.longTerm",
      "rent.terms.immediateMoveIn",
      "rent.terms.cleaningService",
      "rent.terms.laundryService",
      "rent.terms.managementService",
      "rent.terms.roomService",
    ],
  },
];

/** 거래 유형에 맞는 그룹 목록. */
export function optionGroupsFor(listingType: "for_sale" | "for_rent"): PropertyOptionGroup[] {
  return listingType === "for_sale" ? SALE_OPTION_GROUPS : RENT_OPTION_GROUPS;
}

/** 이 저장값이 해당 거래 유형에 속하는가 — 유형을 바꿨을 때 남은 선택을 걷어내는 데 쓴다. */
export function belongsToListingType(value: string, listingType: "for_sale" | "for_rent"): boolean {
  return value.startsWith(listingType === "for_sale" ? "sale." : "rent.");
}
