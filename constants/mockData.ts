import type { Ionicons } from "@expo/vector-icons";

import { MOCK_INVEST_IMAGES, MOCK_PROPERTY_IMAGES, type InvestImageCategory, type PropertyImageCategory } from "@/constants/mockImages";

/**
 * STEP 4-9B — UI 레이아웃 기반 전용 로컬 mock 데이터.
 *
 * 이 파일의 모든 값은 화면의 시각적 완성도를 위한 자리표시 데이터다.
 * Supabase에 쓰지 않고, Supabase에서 읽지도 않는다 — 실제 DB row를 만들지 않는다.
 * 이후 Phase(4/5/6)에서 이 파일을 지우고 같은 shape(타입)으로 services/*의
 * 실제 Supabase 쿼리 결과로 교체하는 것을 전제로 필드를 구성했다.
 *
 * 매물/투자상품의 제목·위치·가격 등은 "Content"(I18N.md의 UI Translation과 분리된
 * 영역)이므로 UI 문자열(i18n/locales/*.json)에 넣지 않고 여기 베트남어 그대로 둔다 —
 * 실제 서비스에서도 매물 콘텐츠는 DB(articles/properties 등)에서 오지, UI 번역
 * 리소스에서 오지 않는다. 화면의 라벨/버튼/섹션 제목만 i18n(t())을 거친다.
 *
 * [FULL-DEV, 2026-08-31] Property/Invest 전체 기능 개발(도메인 서비스 확장 개발
 * 지시)에 맞춰 필드를 확장했다. 기존에 이미 쓰이고 있던 필드(title/location/price/
 * area/yieldRate/status/distanceKm/featured, 그리고 투자상품의 title/
 * propertyLocation/expectedReturn/minInvestment/period/riskLevel/status/
 * fundedPercent/featured)는 하나도 제거하거나 이름을 바꾸지 않았다 — PropertyCard/
 * InvestmentCard/property.tsx/invest.tsx/home.tsx가 이 필드들을 이미 직접 참조하고
 * 있으므로, 기존 필드는 그대로 두고 새 필드만 추가하는 방식으로 확장했다(기존 기능
 * 보존 원칙). `category`는 DATABASE.md의 property_category enum 중 이번 mock
 * 범위에서 다루는 부분집합(apartment/villa/retail/land/기타→other)이며, 실제
 * DB 연동 시 enum 값 그대로 매핑된다. `isMock: true`로 모든 항목을 명시적으로
 * 표시해 실제 거래 가능한 매물/상품으로 오해되지 않도록 한다.
 */

export type MockPropertyStatus = "forSale" | "forRent";
export type MockPropertyCategory = PropertyImageCategory;

export type MockProperty = {
  id: string;
  title: string;
  location: string;
  price: string;
  area: string;
  yieldRate?: string;
  status: MockPropertyStatus;
  distanceKm?: number;
  featured?: boolean;
  // [FULL-DEV] 아래부터 신규 필드 — 매물 상세 화면(app/property-detail/[id].tsx)에서 사용.
  category: MockPropertyCategory;
  /** 지역 필터(MOCK_REGIONS)와 매칭되는 대표 도시명. location 문자열 안에도 포함되어 있지만,
   * 정렬/필터 로직에서 문자열 포함검사 대신 정확히 비교할 수 있도록 별도 필드로 둔다. */
  province: string;
  priceValueVnd: number;
  areaValueM2: number;
  bedrooms?: number;
  bathrooms?: number;
  /** [STEP: 2026-09-09-6] 다국어 상세설명 — 언어코드 → 번역문 맵(utils/format.ts localizedText 참고). */
  description: Partial<Record<string, string>>;
  /** 매물 옵션/편의시설 — 사용자 지시 §5 "옵션" 항목. */
  options: string[];
  /** [STEP 04-지도] 지도 마커 좌표 — DB properties.latitude/longitude에서 온다.
   * 좌표가 입력되지 않은 매물이 있을 수 있어(둘 다 NN이 아님) optional로 둔다 —
   * 지도 화면은 좌표가 있는 매물만 마커로 표시한다. */
  latitude?: number;
  longitude?: number;
  images: (typeof MOCK_PROPERTY_IMAGES)[MockPropertyCategory];
  /** [STEP 04] 실제 Supabase 매물은 isMock:false — services/properties.ts가 채운다.
   * 아래 MOCK_PROPERTIES 배열 원소는 전부 isMock:true로 그대로 유지(제거 대상이지만
   * 아직 삭제하지 않음 — findSimilarProperties* 등 일부 화면이 계속 참조). */
  isMock: boolean;
};

function propertyImages(category: MockPropertyCategory) {
  return MOCK_PROPERTY_IMAGES[category];
}

export const MOCK_PROPERTIES: MockProperty[] = [
  {
    id: "p1",
    title: "Vinhomes Grand Park — Tòa S1.01",
    location: "TP. Thủ Đức, TP. Hồ Chí Minh",
    price: "4.2 tỷ",
    area: "72 m²",
    yieldRate: "6.5%/năm",
    status: "forSale",
    distanceKm: 3.2,
    featured: true,
    category: "apartment",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 4_200_000_000,
    areaValueM2: 72,
    bedrooms: 2,
    bathrooms: 2,
    description: {
      vi: "Căn hộ 2 phòng ngủ tại tòa S1.01, view công viên trung tâm. Nội thất cơ bản, sẵn sàng bàn giao. Gần trường học quốc tế và trung tâm thương mại Vincom Mega Mall.",
      ko: "S1.01동 방 2개 아파트, 중앙공원 뷰. 기본 인테리어, 즉시 입주 가능. 국제학교와 빈컴 메가몰 쇼핑센터 인근.",
      en: "2-bedroom apartment in Tower S1.01 with central park views. Basic interior, ready to move in. Near international schools and Vincom Mega Mall.",
      ja: "S1.01棟の2ベッドルームアパート、中央公園の眺め。基本内装、即入居可能。インターナショナルスクールとヴィンコム・メガモールに近い。",
      th: "อพาร์ตเมนต์ 2 ห้องนอนในอาคาร S1.01 วิวสวนสาธารณะกลางเมือง ตกแต่งพื้นฐาน พร้อมเข้าอยู่ ใกล้โรงเรียนนานาชาติและห้างวินคอมเมกะมอลล์",
      zh: "S1.01栋两居室公寓,俯瞰中央公园。基础装修,可即时入住。靠近国际学校和Vincom Mega Mall购物中心。",
    },
    options: ["Hồ bơi", "Phòng gym", "Bãi đỗ xe", "An ninh 24/7", "Công viên nội khu"],
    images: propertyImages("apartment"),
    isMock: true,
  },
  {
    id: "p2",
    title: "The Sun Avenue — Căn góc 2PN",
    location: "Quận 2, TP. Hồ Chí Minh",
    price: "5.6 tỷ",
    area: "84 m²",
    yieldRate: "6.1%/năm",
    status: "forSale",
    distanceKm: 5.7,
    featured: true,
    category: "apartment",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 5_600_000_000,
    areaValueM2: 84,
    bedrooms: 2,
    bathrooms: 2,
    description: {
      vi: "Căn hộ góc 2 phòng ngủ, 2 mặt thoáng, view sông Sài Gòn. Khu dân cư hiện hữu, tiện ích đầy đủ, gần cầu Sài Gòn và trung tâm Quận 1.",
      ko: "2면 개방형 코너 2룸 아파트, 사이공강 뷰. 기존 주거단지, 편의시설 완비, 사이공 대교와 1군 중심가 인근.",
      en: "Corner 2-bedroom apartment with dual aspect and Saigon River views. Established residential area with full amenities, near Saigon Bridge and District 1 center.",
      ja: "2面採光のコーナー2ベッドルームアパート、サイゴン川の眺め。既存住宅地、施設充実、サイゴン橋と1区中心部に近い。",
      th: "อพาร์ตเมนต์มุม 2 ห้องนอน รับลมสองด้าน วิวแม่น้ำไซ่ง่อน อยู่ในย่านที่อยู่อาศัยเดิม สิ่งอำนวยความสะดวกครบครัน ใกล้สะพานไซ่ง่อนและใจกลางเขต 1",
      zh: "转角两居室公寓,双面采光,西贡河景观。成熟住宅区,配套齐全,靠近西贡大桥和第一郡中心。",
    },
    options: ["Hồ bơi", "Phòng gym", "Khu BBQ", "Bãi đỗ xe", "An ninh 24/7"],
    images: propertyImages("apartment"),
    isMock: true,
  },
  {
    id: "p3",
    title: "Masteri Thảo Điền — Studio cao cấp",
    location: "Quận 2, TP. Hồ Chí Minh",
    price: "18,000k/tháng",
    area: "45 m²",
    status: "forRent",
    distanceKm: 6.4,
    featured: true,
    category: "apartment",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 18_000_000,
    areaValueM2: 45,
    bedrooms: 1,
    bathrooms: 1,
    description: {
      vi: "Studio cao cấp đầy đủ nội thất, phù hợp cho người nước ngoài hoặc chuyên gia làm việc tại Thảo Điền. Gần trường quốc tế BIS, siêu thị Annam Gourmet.",
      ko: "풀옵션 프리미엄 스튜디오, 타오디엔에서 근무하는 외국인이나 전문직에 적합. BIS 국제학교와 안남 구르메 슈퍼마켓 인근.",
      en: "Fully furnished premium studio, ideal for expats or professionals working in Thao Dien. Near BIS International School and Annam Gourmet supermarket.",
      ja: "家具付きの高級スタジオ、タオディエンで働く外国人や専門職に最適。BISインターナショナルスクールとアンナム・グルメスーパーに近い。",
      th: "สตูดิโอหรูพร้อมเฟอร์นิเจอร์ครบ เหมาะสำหรับชาวต่างชาติหรือมืออาชีพที่ทำงานในทาวดิ่น ใกล้โรงเรียนนานาชาติ BIS และซูเปอร์มาร์เก็ต Annam Gourmet",
      zh: "全套高级公寓式套房,适合在草田工作的外籍人士或专业人士。靠近BIS国际学校和Annam Gourmet超市。",
    },
    options: ["Nội thất đầy đủ", "Hồ bơi", "Phòng gym", "An ninh 24/7"],
    images: propertyImages("apartment"),
    isMock: true,
  },
  {
    id: "p4",
    title: "Biệt thự Villa Park",
    location: "Quận 9, TP. Hồ Chí Minh",
    price: "12.8 tỷ",
    area: "210 m²",
    yieldRate: "5.4%/năm",
    status: "forSale",
    distanceKm: 8.1,
    category: "residential",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 12_800_000_000,
    areaValueM2: 210,
    bedrooms: 4,
    bathrooms: 4,
    description: {
      vi: "Biệt thự đơn lập trong khu compound an ninh khép kín, sân vườn riêng, gần sông Đồng Nai. Thiết kế hiện đại, phù hợp gia đình nhiều thế hệ.",
      ko: "보안이 철저한 컴파운드 내 단독 빌라, 개인 정원, 동나이강 인근. 현대적 디자인, 대가족에 적합.",
      en: "Detached villa in a secure gated compound with a private garden, near the Dong Nai River. Modern design, suitable for multi-generational families.",
      ja: "セキュリティ完備のコンパウンド内の一戸建てヴィラ、専用庭付き、ドンナイ川近く。モダンなデザインで大家族に最適。",
      th: "วิลล่าเดี่ยวในหมู่บ้านที่มีระบบรักษาความปลอดภัย มีสวนส่วนตัว ใกล้แม่น้ำด่งนาย ดีไซน์ทันสมัย เหมาะกับครอบครัวหลายรุ่น",
      zh: "位于安保封闭式社区内的独栋别墅,带私家花园,靠近同奈河。设计现代,适合多代同堂家庭。",
    },
    options: ["Sân vườn riêng", "Gara ô tô", "Hồ bơi riêng", "An ninh 24/7", "Khu BBQ"],
    images: propertyImages("residential"),
    isMock: true,
  },
  {
    id: "p5",
    title: "Diamond Island — Căn hộ view sông",
    location: "Quận 2, TP. Hồ Chí Minh",
    price: "25,000k/tháng",
    area: "98 m²",
    status: "forRent",
    distanceKm: 4.5,
    category: "apartment",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 25_000_000,
    areaValueM2: 98,
    bedrooms: 3,
    bathrooms: 2,
    description: {
      vi: "Căn hộ 3 phòng ngủ view sông trọn vẹn, tầng cao, thiết kế Singapore. Cho thuê dài hạn, ưu tiên khách nước ngoài hoặc gia đình.",
      ko: "리버뷰가 온전한 3룸 아파트, 고층, 싱가포르 디자인. 장기 임대, 외국인이나 가족 우선.",
      en: "3-bedroom apartment with full river views, high floor, Singapore-style design. Long-term lease, foreigners or families preferred.",
      ja: "リバービューが広がる3ベッドルームアパート、高層階、シンガポールデザイン。長期賃貸、外国人や家族優先。",
      th: "อพาร์ตเมนต์ 3 ห้องนอน วิวแม่น้ำเต็มรูปแบบ ชั้นสูง ดีไซน์สไตล์สิงคโปร์ ให้เช่าระยะยาว เหมาะสำหรับชาวต่างชาติหรือครอบครัว",
      zh: "三居室公寓,河景无遮挡,楼层高,新加坡风格设计。长期出租,优先外籍人士或家庭。",
    },
    options: ["Nội thất cao cấp", "Hồ bơi vô cực", "Phòng gym", "Bãi đỗ xe", "An ninh 24/7"],
    images: propertyImages("apartment"),
    isMock: true,
  },
  {
    id: "p6",
    title: "Empire City — Tòa Tower 1",
    location: "TP. Thủ Đức, TP. Hồ Chí Minh",
    price: "7.9 tỷ",
    area: "90 m²",
    yieldRate: "5.9%/năm",
    status: "forSale",
    distanceKm: 5.0,
    category: "apartment",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 7_900_000_000,
    areaValueM2: 90,
    bedrooms: 2,
    bathrooms: 2,
    description: {
      vi: "Căn hộ cao cấp trong quần thể Empire City, gần tháp quan sát Landmark 81 tương lai. Thiết kế nội thất theo tiêu chuẩn quốc tế.",
      ko: "엠파이어 시티 단지 내 프리미엄 아파트, 향후 랜드마크 81 전망대 인근. 국제 기준 인테리어 디자인.",
      en: "Premium apartment within the Empire City complex, near the future Landmark 81 observation tower. Interior finished to international standards.",
      ja: "エンパイア・シティ内の高級アパート、将来のランドマーク81展望台に近い。国際基準の内装デザイン。",
      th: "อพาร์ตเมนต์หรูในโครงการเอ็มไพร์ซิตี้ ใกล้หอชมวิวแลนด์มาร์ก 81 ในอนาคต ตกแต่งภายในตามมาตรฐานสากล",
      zh: "帝国城综合体内的高级公寓,靠近未来的Landmark 81观景塔。室内设计达国际标准。",
    },
    options: ["Hồ bơi vô cực", "Phòng gym", "Rạp chiếu phim nội khu", "An ninh 24/7"],
    images: propertyImages("apartment"),
    isMock: true,
  },
  {
    id: "p7",
    title: "Shophouse Vinhomes Grand Park",
    location: "TP. Thủ Đức, TP. Hồ Chí Minh",
    price: "9.5 tỷ",
    area: "120 m²",
    yieldRate: "7.2%/năm",
    status: "forSale",
    distanceKm: 3.5,
    category: "building",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 9_500_000_000,
    areaValueM2: 120,
    description: {
      vi: "Shophouse mặt tiền đường chính khu đô thị, phù hợp kinh doanh F&B hoặc bán lẻ. Mật độ dân cư cao xung quanh, đã có sổ hồng.",
      ko: "신도시 대로변 상가주택, F&B나 소매업에 적합. 주변 인구밀도 높음, 등기 완료(소홍).",
      en: "Shophouse fronting the urban area's main road, suitable for F&B or retail. High surrounding population density, ownership certificate (sổ hồng) already issued.",
      ja: "新都市の大通りに面したショップハウス、飲食や小売業に最適。周辺人口密度高い、権利証(ソーホン)発行済み。",
      th: "ช็อปเฮาส์หน้าถนนสายหลักในย่านเมืองใหม่ เหมาะกับธุรกิจอาหารเครื่องดื่มหรือค้าปลีก ความหนาแน่นประชากรโดยรอบสูง มีโฉนดแล้ว",
      zh: "位于新城区主干道沿街的商铺住宅,适合餐饮或零售经营。周边人口密度高,已有红本产权证。",
    },
    options: ["Mặt tiền lớn", "Tầng trệt kinh doanh", "Bãi đỗ xe khách", "Sổ hồng riêng"],
    images: propertyImages("building"),
    isMock: true,
  },
  {
    id: "p8",
    title: "Đất nền dự án Long Thành",
    location: "Long Thành, Đồng Nai",
    price: "6.3 tỷ",
    area: "300 m²",
    status: "forSale",
    distanceKm: 42,
    category: "land",
    province: "TP. Hồ Chí Minh",
    priceValueVnd: 6_300_000_000,
    areaValueM2: 300,
    description: {
      vi: "Đất nền thổ cư 100%, gần sân bay quốc tế Long Thành đang xây dựng. Pháp lý rõ ràng, đường nhựa trước nhà, tiềm năng tăng giá theo hạ tầng.",
      ko: "100% 주거용지, 건설 중인 롱탄 국제공항 인근. 법적 서류 명확, 집 앞 아스팔트 도로, 인프라에 따른 가격 상승 잠재력.",
      en: "100% residential land, near the Long Thanh International Airport under construction. Clear legal status, paved road in front, price growth potential from infrastructure development.",
      ja: "100%宅地、建設中のロンタイン国際空港近く。法的権利明確、家の前は舗装道路、インフラ整備による価格上昇の可能性。",
      th: "ที่ดินเพื่อที่อยู่อาศัย 100% ใกล้สนามบินนานาชาติลองแถ่งที่กำลังก่อสร้าง เอกสารสิทธิ์ชัดเจน ถนนลาดยางหน้าที่ดิน มีศักยภาพราคาเพิ่มขึ้นตามโครงสร้างพื้นฐาน",
      zh: "100%宅基地,靠近在建的龙城国际机场。产权清晰,门前为柏油路,随基础设施建设具有升值潜力。",
    },
    options: ["Thổ cư 100%", "Đường nhựa", "Gần sân bay Long Thành"],
    images: propertyImages("land"),
    isMock: true,
  },
  {
    id: "p9",
    title: "Biệt thự biển Đà Nẵng",
    location: "Ngũ Hành Sơn, Đà Nẵng",
    price: "15.5 tỷ",
    area: "280 m²",
    yieldRate: "6.8%/năm",
    status: "forSale",
    distanceKm: 620,
    category: "residential",
    province: "Đà Nẵng",
    priceValueVnd: 15_500_000_000,
    areaValueM2: 280,
    bedrooms: 5,
    bathrooms: 5,
    description: {
      vi: "Biệt thự nghỉ dưỡng cách bãi biển Mỹ Khê 5 phút đi bộ. Phù hợp ở thực hoặc cho thuê du lịch, quản lý vận hành chuyên nghiệp.",
      ko: "미케 해변에서 도보 5분 거리의 리조트형 빌라. 실거주나 관광 임대에 적합, 전문 운영 관리.",
      en: "Resort villa just a 5-minute walk from My Khe Beach. Suitable for personal living or tourist rental, with professional operation management.",
      ja: "ミーケービーチから徒歩5分のリゾートヴィラ。実居住や観光賃貸に適し、専門運営管理付き。",
      th: "วิลล่าตากอากาศ เดินเพียง 5 นาทีถึงชายหาดหมีเค เหมาะสำหรับอยู่อาศัยจริงหรือปล่อยเช่านักท่องเที่ยว มีการบริหารจัดการแบบมืออาชีพ",
      zh: "度假别墅,步行5分钟即达美溪海滩。适合自住或旅游出租,专业运营管理。",
    },
    options: ["Hồ bơi riêng", "Sân vườn", "Gần biển", "Dịch vụ cho thuê du lịch"],
    images: propertyImages("residential"),
    isMock: true,
  },
  {
    id: "p10",
    title: "Kho xưởng KCN Yên Phong",
    location: "Yên Phong, Bắc Ninh",
    price: "22,000k/tháng",
    area: "500 m²",
    status: "forRent",
    distanceKm: 1120,
    category: "factory",
    province: "Hà Nội",
    priceValueVnd: 22_000_000,
    areaValueM2: 500,
    description: {
      vi: "Nhà xưởng trong khu công nghiệp, đã hoàn thiện PCCC, phù hợp sản xuất nhẹ hoặc kho vận. Gần quốc lộ 18, thuận tiện vận chuyển.",
      ko: "산업단지 내 공장, 소방시설 완비, 경공업 생산이나 물류창고에 적합. 18번 국도 인근, 운송 편리.",
      en: "Factory in an industrial park, fire safety systems completed, suitable for light manufacturing or logistics warehousing. Near National Highway 18, convenient for transport.",
      ja: "工業団地内の工場、消防設備完備、軽工業生産や物流倉庫に最適。国道18号線近く、輸送に便利。",
      th: "โรงงานในนิคมอุตสาหกรรม ติดตั้งระบบป้องกันอัคคีภัยครบถ้วน เหมาะกับการผลิตเบาหรือคลังสินค้าโลจิสติกส์ ใกล้ทางหลวงหมายเลข 18 ขนส่งสะดวก",
      zh: "工业园区内厂房,消防设施齐全,适合轻工业生产或物流仓储。靠近18号国道,运输便利。",
    },
    options: ["Hệ thống PCCC", "Trần cao 8m", "Bãi đỗ container", "An ninh KCN"],
    images: propertyImages("factory"),
    isMock: true,
  },
  {
    id: "p11",
    title: "Vinhomes Ocean Park — Căn 2PN",
    location: "Gia Lâm, Hà Nội",
    price: "3.6 tỷ",
    area: "68 m²",
    yieldRate: "5.7%/năm",
    status: "forSale",
    distanceKm: 1100,
    category: "apartment",
    province: "Hà Nội",
    priceValueVnd: 3_600_000_000,
    areaValueM2: 68,
    bedrooms: 2,
    bathrooms: 1,
    description: {
      vi: "Căn hộ trong đại đô thị biển hồ đầu tiên tại miền Bắc. Tiện ích khép kín, phù hợp gia đình trẻ, gần trường liên cấp Vinschool.",
      ko: "북부 최초의 해양호수 대단지 내 아파트. 자체 완결형 편의시설, 젊은 가족에 적합, 빈스쿨 통합학교 인근.",
      en: "Apartment in the North's first large-scale urban area with a beach-lagoon. Self-contained amenities, ideal for young families, near Vinschool integrated school.",
      ja: "北部初のビーチラグーン大規模都市内のアパート。自己完結型施設、若い家族に最適、ヴィンスクール一貫校近く。",
      th: "อพาร์ตเมนต์ในเมืองใหม่ขนาดใหญ่แห่งแรกในภาคเหนือที่มีทะเลสาบชายหาด สิ่งอำนวยความสะดวกครบวงจร เหมาะกับครอบครัวรุ่นใหม่ ใกล้โรงเรียน Vinschool",
      zh: "位于北部首个海滨湖大型城市综合体内的公寓。配套设施自成一体,适合年轻家庭,靠近永实一贯制学校。",
    },
    options: ["Hồ bơi nước mặn", "Công viên biển hồ", "Trường học nội khu", "An ninh 24/7"],
    images: propertyImages("apartment"),
    isMock: true,
  },
];

export type MockInvestmentStatus = "fundraising" | "closed" | "completed";
export type MockInvestmentCategory = InvestImageCategory;

export type MockInvestmentProduct = {
  id: string;
  title: string;
  propertyLocation: string;
  expectedReturn: string;
  minInvestment: string;
  period: string;
  riskLevel: "low" | "medium" | "high";
  status: MockInvestmentStatus;
  fundedPercent: number;
  featured?: boolean;
  // [FULL-DEV] 아래부터 신규 필드 — 투자상품 상세 화면(app/invest-detail/[id].tsx)에서 사용.
  category: MockInvestmentCategory;
  /** 연계된 매물(MOCK_PROPERTIES의 id) — 상세 화면의 "관련 부동산" 섹션에서 사용, 없으면 undefined. */
  relatedPropertyId?: string;
  minInvestmentValueVnd: number;
  targetAmountVnd: number;
  raisedAmountVnd: number;
  dividendFrequency: "monthly" | "quarterly" | "yearly";
  /** [STEP: 2026-09-09-6] 다국어 상세설명 — 언어코드 → 번역문 맵(utils/format.ts localizedText 참고). */
  description: Partial<Record<string, string>>;
  images: (typeof MOCK_INVEST_IMAGES)[MockInvestmentCategory];
  /** [STEP 06] 실제 Supabase 투자상품은 isMock:false — services/investments.ts가 채운다.
   * 아래 MOCK_INVESTMENT_PRODUCTS 배열 원소는 전부 isMock:true로 유지(제거 대상이지만
   * findSimilarInvestments* 등이 아직 참조). */
  isMock: boolean;
};

function investImages(category: MockInvestmentCategory) {
  return MOCK_INVEST_IMAGES[category];
}

export const MOCK_INVESTMENT_PRODUCTS: MockInvestmentProduct[] = [
  {
    id: "i1",
    title: "Vinhomes Grand Park REIT #3",
    propertyLocation: "TP. Thủ Đức, TP. Hồ Chí Minh",
    expectedReturn: "9.2%/năm",
    minInvestment: "5,000k",
    period: "24 tháng",
    riskLevel: "medium",
    status: "fundraising",
    fundedPercent: 68,
    featured: true,
    category: "residential",
    relatedPropertyId: "p1",
    minInvestmentValueVnd: 5_000_000,
    targetAmountVnd: 15_000_000_000,
    raisedAmountVnd: 10_200_000_000,
    dividendFrequency: "quarterly",
    description: {
      ko: "REIT 공동투자 상품으로 Vinhomes Grand Park 임대형 아파트 3개 유닛의 임대수익을 지분율에 따라 분배합니다. 분기별 배당, 24개월 만기 후 원금 상환 검토.",
      vi: "Sản phẩm đồng đầu tư REIT phân phối thu nhập cho thuê từ 3 căn hộ cho thuê tại Vinhomes Grand Park theo tỷ lệ sở hữu. Chia cổ tức hàng quý, xem xét hoàn vốn sau 24 tháng đáo hạn.",
      en: "A REIT co-investment product distributing rental income from 3 leased units at Vinhomes Grand Park based on ownership share. Quarterly dividends, principal repayment reviewed after 24-month maturity.",
      ja: "REIT共同投資商品として、ヴィンホームズ・グランドパークの賃貸アパート3ユニットの賃貸収益を持分比率に応じて分配します。四半期配当、24ヶ月満期後に元本償還を検討。",
      th: "ผลิตภัณฑ์ร่วมลงทุน REIT ที่กระจายรายได้ค่าเช่าจากอพาร์ตเมนต์ให้เช่า 3 ยูนิตที่ Vinhomes Grand Park ตามสัดส่วนการถือหุ้น ปันผลรายไตรมาส พิจารณาคืนเงินต้นหลังครบกำหนด 24 เดือน",
      zh: "REIT共同投资产品,按持股比例分配Vinhomes Grand Park三套出租公寓的租金收益。按季度分红,24个月到期后审议本金偿还。",
    },
    images: investImages("residential"),
    isMock: true,
  },
  {
    id: "i2",
    title: "Empire City Co-investment",
    propertyLocation: "TP. Thủ Đức, TP. Hồ Chí Minh",
    expectedReturn: "8.4%/năm",
    minInvestment: "10,000k",
    period: "36 tháng",
    riskLevel: "medium",
    status: "fundraising",
    fundedPercent: 41,
    featured: true,
    category: "residential",
    relatedPropertyId: "p6",
    minInvestmentValueVnd: 10_000_000,
    targetAmountVnd: 25_000_000_000,
    raisedAmountVnd: 10_250_000_000,
    dividendFrequency: "yearly",
    description: {
      ko: "Empire City 신규 타워 개발 프로젝트 공동투자. 개발 완료 후 분양수익 및 임대수익을 지분에 따라 분배하는 개발형 상품입니다.",
      vi: "Đồng đầu tư dự án phát triển tòa tháp mới Empire City. Sản phẩm dạng phát triển phân phối lợi nhuận bán hàng và cho thuê theo tỷ lệ vốn góp sau khi hoàn thành.",
      en: "Co-investment in the Empire City new tower development project. A development-type product distributing sales and rental profits by equity share after project completion.",
      ja: "エンパイア・シティ新タワー開発プロジェクトへの共同投資。開発完了後、分譲収益と賃貸収益を持分に応じて分配する開発型商品です。",
      th: "ร่วมลงทุนในโครงการพัฒนาตึกใหม่ของเอ็มไพร์ซิตี้ เป็นผลิตภัณฑ์ประเภทพัฒนาโครงการที่กระจายกำไรจากการขายและค่าเช่าตามสัดส่วนการถือหุ้นหลังการพัฒนาเสร็จสิ้น",
      zh: "共同投资帝国城新塔楼开发项目。这是一款开发型产品,在项目完成后按出资比例分配销售收益和租金收益。",
    },
    images: investImages("residential"),
    isMock: true,
  },
  {
    id: "i3",
    title: "The Sun Avenue Rental Pool",
    propertyLocation: "Quận 2, TP. Hồ Chí Minh",
    expectedReturn: "7.1%/năm",
    minInvestment: "3,000k",
    period: "12 tháng",
    riskLevel: "low",
    status: "fundraising",
    fundedPercent: 89,
    category: "residential",
    relatedPropertyId: "p2",
    minInvestmentValueVnd: 3_000_000,
    targetAmountVnd: 8_000_000_000,
    raisedAmountVnd: 7_120_000_000,
    dividendFrequency: "monthly",
    description: {
      ko: "이미 임차인이 입주해 있는 안정적 임대형 아파트 풀에 투자하는 저위험 상품. 월별 배당으로 현금흐름이 안정적입니다.",
      vi: "Sản phẩm rủi ro thấp đầu tư vào nhóm căn hộ cho thuê ổn định đã có người thuê. Dòng tiền ổn định nhờ chia cổ tức hàng tháng.",
      en: "A low-risk product investing in a stable pool of already-tenanted rental apartments. Monthly dividends provide stable cash flow.",
      ja: "既に入居者がいる安定した賃貸アパートプールに投資する低リスク商品。月次配当で安定したキャッシュフロー。",
      th: "ผลิตภัณฑ์ความเสี่ยงต่ำที่ลงทุนในกลุ่มอพาร์ตเมนต์ให้เช่าที่มั่นคงและมีผู้เช่าอยู่แล้ว กระแสเงินสดมั่นคงด้วยการปันผลรายเดือน",
      zh: "投资于已有租户入住的稳定出租公寓池的低风险产品。按月分红,现金流稳定。",
    },
    images: investImages("residential"),
    isMock: true,
  },
  {
    id: "i4",
    title: "Masteri Thảo Điền Growth Fund",
    propertyLocation: "Quận 2, TP. Hồ Chí Minh",
    expectedReturn: "11.5%/năm",
    minInvestment: "20,000k",
    period: "48 tháng",
    riskLevel: "high",
    status: "closed",
    fundedPercent: 100,
    category: "residential",
    relatedPropertyId: "p3",
    minInvestmentValueVnd: 20_000_000,
    targetAmountVnd: 30_000_000_000,
    raisedAmountVnd: 30_000_000_000,
    dividendFrequency: "yearly",
    description: {
      ko: "시세 차익을 노리는 고위험·고수익 성장형 상품(모집 마감). 임대수익보다 자산가치 상승에 초점을 맞춘 4년 만기 상품입니다.",
      vi: "Sản phẩm tăng trưởng rủi ro cao, lợi nhuận cao nhắm đến chênh lệch giá thị trường (đã đóng huy động). Sản phẩm kỳ hạn 4 năm tập trung vào tăng giá trị tài sản hơn là thu nhập cho thuê.",
      en: "A high-risk, high-return growth product targeting market price appreciation (fundraising closed). A 4-year product focused on asset value growth rather than rental income.",
      ja: "市場価格差益を狙う高リスク・高収益の成長型商品(募集終了)。賃貸収益よりも資産価値上昇に焦点を当てた4年満期商品です。",
      th: "ผลิตภัณฑ์เติบโตความเสี่ยงสูงผลตอบแทนสูงที่มุ่งเน้นส่วนต่างราคาตลาด (ปิดการระดมทุนแล้ว) เป็นผลิตภัณฑ์ระยะเวลา 4 ปีที่เน้นการเพิ่มมูลค่าสินทรัพย์มากกว่ารายได้ค่าเช่า",
      zh: "追求市场价差的高风险高收益成长型产品(募集已截止)。这是一款4年期产品,注重资产增值而非租金收益。",
    },
    images: investImages("residential"),
    isMock: true,
  },
  {
    id: "i5",
    title: "Diamond Island Yield Note",
    propertyLocation: "Quận 2, TP. Hồ Chí Minh",
    expectedReturn: "6.8%/năm",
    minInvestment: "5,000k",
    period: "18 tháng",
    riskLevel: "low",
    status: "completed",
    fundedPercent: 100,
    category: "residential",
    relatedPropertyId: "p5",
    minInvestmentValueVnd: 5_000_000,
    targetAmountVnd: 10_000_000_000,
    raisedAmountVnd: 10_000_000_000,
    dividendFrequency: "quarterly",
    description: {
      ko: "이미 운용이 종료된 저위험 임대수익 상품(완료). 과거 운용 실적 참고용으로 상세 화면에서 확인할 수 있습니다.",
      vi: "Sản phẩm thu nhập cho thuê rủi ro thấp đã kết thúc vận hành (hoàn thành). Có thể xem trong màn hình chi tiết để tham khảo hiệu suất vận hành trước đây.",
      en: "A low-risk rental income product that has already completed its operating period (completed). Past performance can be reviewed in the detail screen for reference.",
      ja: "既に運用が終了した低リスクの賃貸収益商品(完了)。過去の運用実績は参考として詳細画面で確認できます。",
      th: "ผลิตภัณฑ์รายได้ค่าเช่าความเสี่ยงต่ำที่สิ้นสุดการดำเนินงานแล้ว (เสร็จสมบูรณ์) สามารถดูผลการดำเนินงานในอดีตเพื่อใช้อ้างอิงได้ในหน้าจอรายละเอียด",
      zh: "已结束运作的低风险租金收益产品(已完成)。可在详情页面查看过往运作业绩以供参考。",
    },
    images: investImages("residential"),
    isMock: true,
  },
  {
    id: "i6",
    title: "District 1 Grade-A Office Fund",
    propertyLocation: "Quận 1, TP. Hồ Chí Minh",
    expectedReturn: "8.9%/năm",
    minInvestment: "15,000k",
    period: "36 tháng",
    riskLevel: "medium",
    status: "fundraising",
    fundedPercent: 25,
    category: "building",
    minInvestmentValueVnd: 15_000_000,
    targetAmountVnd: 20_000_000_000,
    raisedAmountVnd: 5_000_000_000,
    dividendFrequency: "quarterly",
    description: {
      ko: "Quận 1 중심업무지구 A급 오피스 빌딩 임대수익에 투자하는 상품. 장기 임차 계약(앵커 테넌트) 기반으로 안정적 현금흐름을 목표로 합니다.",
      vi: "Sản phẩm đầu tư vào thu nhập cho thuê tòa văn phòng hạng A tại khu trung tâm thương mại Quận 1. Hướng đến dòng tiền ổn định dựa trên hợp đồng thuê dài hạn (khách thuê chủ lực).",
      en: "A product investing in rental income from a Grade-A office building in District 1's central business district. Aims for stable cash flow based on long-term anchor tenant leases.",
      ja: "1区中心業務地区のAグレードオフィスビル賃貸収益に投資する商品。長期賃貸契約(アンカーテナント)に基づく安定したキャッシュフローを目指します。",
      th: "ผลิตภัณฑ์ลงทุนในรายได้ค่าเช่าอาคารสำนักงานเกรดเออยู่ในย่านศูนย์กลางธุรกิจเขต 1 มุ่งเน้นกระแสเงินสดมั่นคงจากสัญญาเช่าระยะยาวกับผู้เช่าหลัก",
      zh: "投资于第一郡中央商务区甲级写字楼租金收益的产品。以长期主力租户租约为基础,力求稳定现金流。",
    },
    images: investImages("building"),
    isMock: true,
  },
  {
    id: "i7",
    title: "Vincom Retail Income Fund",
    propertyLocation: "TP. Thủ Đức, TP. Hồ Chí Minh",
    expectedReturn: "7.6%/năm",
    minInvestment: "5,000k",
    period: "24 tháng",
    riskLevel: "medium",
    status: "fundraising",
    fundedPercent: 54,
    category: "commercial",
    relatedPropertyId: "p7",
    minInvestmentValueVnd: 5_000_000,
    targetAmountVnd: 12_000_000_000,
    raisedAmountVnd: 6_480_000_000,
    dividendFrequency: "quarterly",
    description: {
      ko: "쇼핑몰·상가 임대수익에 투자하는 상업시설 상품. 다수의 소형 임차인으로 구성되어 있어 특정 임차인 이탈 리스크가 분산되어 있습니다.",
      vi: "Sản phẩm cơ sở thương mại đầu tư vào thu nhập cho thuê trung tâm thương mại và mặt bằng bán lẻ. Rủi ro khách thuê rời đi được phân tán nhờ nhiều khách thuê nhỏ.",
      en: "A commercial facility product investing in rental income from shopping malls and retail space. Risk of any single tenant leaving is diversified across many small tenants.",
      ja: "ショッピングモール・商業施設の賃貸収益に投資する商業施設商品。多数の小規模テナントで構成されているため、特定テナント離脱リスクが分散されています。",
      th: "ผลิตภัณฑ์สถานประกอบการเชิงพาณิชย์ที่ลงทุนในรายได้ค่าเช่าห้างสรรพสินค้าและพื้นที่ค้าปลีก มีผู้เช่ารายย่อยจำนวนมาก ช่วยกระจายความเสี่ยงจากการย้ายออกของผู้เช่ารายใดรายหนึ่ง",
      zh: "投资于购物中心与商铺租金收益的商业设施产品。由众多小型租户构成,分散了特定租户流失的风险。",
    },
    images: investImages("commercial"),
    isMock: true,
  },
  {
    id: "i8",
    title: "Yên Phong Logistics Note",
    propertyLocation: "Yên Phong, Bắc Ninh",
    expectedReturn: "9.8%/năm",
    minInvestment: "8,000k",
    period: "30 tháng",
    riskLevel: "high",
    status: "fundraising",
    fundedPercent: 12,
    category: "warehouse",
    relatedPropertyId: "p10",
    minInvestmentValueVnd: 8_000_000,
    targetAmountVnd: 18_000_000_000,
    raisedAmountVnd: 2_160_000_000,
    dividendFrequency: "quarterly",
    description: {
      ko: "산업단지 물류창고 임대수익에 투자하는 고위험·고수익 상품. 제조업 경기에 따라 임대 수요 변동성이 상대적으로 큽니다.",
      vi: "Sản phẩm rủi ro cao, lợi nhuận cao đầu tư vào thu nhập cho thuê kho vận trong khu công nghiệp. Nhu cầu thuê biến động tương đối lớn theo tình hình sản xuất công nghiệp.",
      en: "A high-risk, high-return product investing in rental income from a logistics warehouse in an industrial park. Rental demand is relatively volatile depending on manufacturing conditions.",
      ja: "工業団地の物流倉庫賃貸収益に投資する高リスク・高収益商品。製造業の景気により賃貸需要の変動性が相対的に大きいです。",
      th: "ผลิตภัณฑ์ความเสี่ยงสูงผลตอบแทนสูงที่ลงทุนในรายได้ค่าเช่าคลังสินค้าโลจิสติกส์ในนิคมอุตสาหกรรม ความต้องการเช่ามีความผันผวนค่อนข้างมากตามภาวะอุตสาหกรรมการผลิต",
      zh: "投资于工业园区物流仓库租金收益的高风险高收益产品。租赁需求随制造业景气波动相对较大。",
    },
    images: investImages("warehouse"),
    isMock: true,
  },
];

/** Invest 화면 상단 개요 stat 3종 — 실제 집계 쿼리(SUM/COUNT/AVG)로 교체될 자리표시 값. */
export const MOCK_INVEST_OVERVIEW = {
  totalRaised: "1,240 tỷ",
  activeProducts: "12",
  avgReturn: "8.4%/năm",
};

/**
 * [STEP: 카테고리 재구성, 2026-09-07] 사용자 지시로 홈 화면 카테고리를 부동산 매물
 * 서브카테고리(7개: 아파트/주택·단지/단독건물/빌딩·상가/공장·창고/토지/기타)와 동일한
 * 체계로 맞췄다 — id는 PropertyImageCategory와 그대로 맞춰(카테고리 텍스트를 이중으로
 * 관리하지 않기 위해) 홈 카테고리 탭 시 해당 카테고리로 필터된 상태로 /property로
 * 이동한다(app/(tabs)/home.tsx 참조). 기존에 있던 "reit"(리츠) 항목은 새 7개 체계에
 * 없어 제거했다 — 이전에도 탭하면 카테고리 필터 없이 그냥 /property로만 이동해
 * 실질적인 기능은 없었다(리츠 상품은 /invest 탭에서 별도로 노출된다). */
export type HomeCategory = {
  id: PropertyImageCategory;
  icon: keyof typeof Ionicons.glyphMap;
};

export const HOME_CATEGORIES: HomeCategory[] = [
  { id: "apartment", icon: "business-outline" },
  { id: "residential", icon: "home-outline" },
  { id: "building", icon: "storefront-outline" },
  { id: "factory", icon: "cube-outline" },
  { id: "land", icon: "map-outline" },
  { id: "other", icon: "ellipsis-horizontal-outline" },
];

/** [STEP: 홈 카테고리 2탭 전환, 2026-09-08] 사용자 지시(§ "텝 2개 : 부동산 투자,
 * 부동산 매물")에 따라 홈 화면 카테고리 영역을 "부동산 투자"/"부동산 매물" 2개
 * 탭으로 나눈다 — 이 배열은 "부동산 투자" 탭에서 보여줄 투자 서브카테고리
 * 아이콘 목록이다(InvestImageCategory 5개: land/commercial/residential/
 * industrial/other). 개념이 같은 property 카테고리와 동일한 아이콘을 재사용했다
 * (예: commercial↔office는 둘 다 "빌딩/상가"라 storefront-outline). 탭 시
 * app/(tabs)/home.tsx가 해당 category로 필터된 상태로 /invest로 이동한다. */
export type HomeInvestCategory = {
  id: InvestImageCategory;
  icon: keyof typeof Ionicons.glyphMap;
};

export const HOME_INVEST_CATEGORIES: HomeInvestCategory[] = [
  { id: "land", icon: "map-outline" },
  { id: "building", icon: "business-outline" },
  { id: "commercial", icon: "storefront-outline" },
  { id: "residential", icon: "home-outline" },
  { id: "industrial", icon: "cube-outline" },
  { id: "warehouse", icon: "archive-outline" },
  { id: "other", icon: "ellipsis-horizontal-outline" },
];

/** 지역 필터 칩 — 첫 항목("전체")은 property.allRegions i18n key로 표시하고,
 * 나머지는 실제 서비스에서도 그대로 쓰일 베트남 지역명(Content)이라 번역하지 않는다.
 * [FULL-DEV] p9/p10/p11이 각각 Đà Nẵng/Hà Nội 매물을 추가하면서 이 필터가 실제로
 * 서로 다른 결과를 보여주도록(이전에는 전 매물이 TP. Hồ Chí Minh라 Hà Nội/Đà Nẵng를
 * 선택하면 항상 빈 목록이었다) province 필드와 함께 의미를 갖게 되었다. */
// [STEP: 2026-09-09-21] 사용자 요청 — 2025년 베트남 행정구역 개편(63개 성/직할시 →
// 34개, 도이머이 이후 최대 규모) 반영. 개편 후 중앙직할시(도시화가 가장 진전돼
// 매물/투자 수요가 몰리는 지역, 이 필터의 기존 단위와 동일한 "도시" 급)는 총
// 6개로 확정되었다: TP. Hồ Chí Minh(빈즈엉·바리아-붕따우 통합), Hà Nội(변경없음),
// Hải Phòng(하이즈엉 통합), Đà Nẵng(꽝남 통합), Cần Thơ(허우장·속짱 통합),
// Huế(변경없음, 2025년 초 별도 개편으로 이미 직할시 승격). 성(省) 단위는 개편
// 과정에서 최종 존속 명칭에 대해 출처마다 표기가 엇갈려(예: Hà Giang/Tuyên Quang
// 통합 후 존속명) 이번에는 이견이 없는 직할시 6개까지만 반영한다.
export const MOCK_REGIONS = [
  "TP. Hồ Chí Minh",
  "Hà Nội",
  "Hải Phòng",
  "Đà Nẵng",
  "Cần Thơ",
  "Huế",
];

/**
 * [STEP: 2026-09-09] 사용자 요청 — 부동산상세 "문의하기" > 1:1 상담(채팅) 기능.
 * 아직 부동산중개업소별 등록자 계정/권한 체계가 없어서(실제 백엔드 부재), 모든
 * 매물 문의가 연결되는 mock 담당자 1명을 고정으로 둔다(사용자 확인 — "mock
 * 담당자 1명을 정해두고 자동응답을 붙이는 방식"). 실제 중개업소별 담당자 배정은
 * 이후 등록자 계정 체계가 생기면 매물별 필드로 확장한다.
 */
export const MOCK_LISTING_AGENT = {
  name: "Nguyễn Thị Lan",
  agency: "Viet's Realty",
};

/** 사용자 요청(2026-09-09): 홈화면 상단 알림 아이콘에 표시할 읽지 않은 알림 수 —
 * 아직 실제 알림 기능/백엔드가 없어 다른 MOCK_ 상수와 동일하게 placeholder로 둔다. */
export const MOCK_UNREAD_NOTIFICATION_COUNT = 3;

export type MockMarketInsight = {
  id: string;
  title: string;
  sourceTag: string;
};

export const MOCK_MARKET_INSIGHTS: MockMarketInsight[] = [
  {
    id: "m1",
    title: "Giá căn hộ TP. Thủ Đức tăng 4.8% trong quý gần nhất",
    sourceTag: "Thị trường",
  },
  {
    id: "m2",
    title: "Tỷ giá USD/VNĐ ổn định, dòng vốn FDI vào bất động sản tăng",
    sourceTag: "Tỷ giá",
  },
  {
    id: "m3",
    title: "Vinhomes Grand Park mở bán giai đoạn tiếp theo",
    sourceTag: "Dự án mới",
  },
];


/**
 * [STEP: 2026-09-09-3] 사용자 요청 — "옵션(편의시설)" 다국어 지원. options는 원문
 * (베트남어)만 mockData에 들어있으므로(description과 달리 언어별 맵이 아님),
 * 위 11개 매물에 실제로 쓰인 베트남어 문구를 key로 하는 번역 사전을 따로 둔다.
 * description과 동일하게 "콘텐츠 계층" 번역이라 i18n/locales(UI 전용)에는 넣지
 * 않는다(i18n/index.ts 상단 원칙 참고). 사전에 없는 문구는 원문(베트남어) 그대로
 * 노출한다(안전한 폴백).
 */
const PROPERTY_OPTION_TRANSLATIONS: Record<string, Partial<Record<string, string>>> = {
  "Hồ bơi": { ko: "수영장", en: "Pool", ja: "プール", th: "สระว่ายน้ำ", zh: "游泳池" },
  "Phòng gym": { ko: "헬스장", en: "Gym", ja: "ジム", th: "ฟิตเนส", zh: "健身房" },
  "Bãi đỗ xe": { ko: "주차장", en: "Parking", ja: "駐車場", th: "ที่จอดรถ", zh: "停车场" },
  "An ninh 24/7": { ko: "24시간 보안", en: "24/7 Security", ja: "24時間セキュリティ", th: "รักษาความปลอดภัย 24 ชม.", zh: "24小时安保" },
  "Công viên nội khu": { ko: "단지 내 공원", en: "Internal Park", ja: "敷地内公園", th: "สวนสาธารณะในโครงการ", zh: "小区内公园" },
  "Khu BBQ": { ko: "바비큐장", en: "BBQ Area", ja: "BBQエリア", th: "พื้นที่บาร์บีคิว", zh: "烧烤区" },
  "Nội thất đầy đủ": { ko: "풀옵션 가구", en: "Fully Furnished", ja: "家具付き", th: "เฟอร์นิเจอร์ครบ", zh: "全套家具" },
  "Sân vườn riêng": { ko: "전용 정원", en: "Private Garden", ja: "専用庭", th: "สวนส่วนตัว", zh: "私家花园" },
  "Gara ô tô": { ko: "차고", en: "Car Garage", ja: "ガレージ", th: "โรงจอดรถ", zh: "车库" },
  "Hồ bơi riêng": { ko: "전용 수영장", en: "Private Pool", ja: "専用プール", th: "สระว่ายน้ำส่วนตัว", zh: "私人泳池" },
  "Nội thất cao cấp": { ko: "고급 인테리어", en: "Premium Interior", ja: "高級インテリア", th: "ตกแต่งพรีเมียม", zh: "高级装修" },
  "Hồ bơi vô cực": { ko: "인피니티 풀", en: "Infinity Pool", ja: "インフィニティプール", th: "สระว่ายน้ำอินฟินิตี้", zh: "无边泳池" },
  "Rạp chiếu phim nội khu": { ko: "단지 내 영화관", en: "In-complex Cinema", ja: "敷地内シアター", th: "โรงภาพยนตร์ในโครงการ", zh: "小区内影院" },
  "Mặt tiền lớn": { ko: "넓은 전면", en: "Large Frontage", ja: "広いファサード", th: "หน้ากว้าง", zh: "大门面" },
  "Tầng trệt kinh doanh": { ko: "1층 상가", en: "Ground-floor Retail", ja: "1階店舗", th: "ชั้นล่างเชิงพาณิชย์", zh: "一楼商铺" },
  "Bãi đỗ xe khách": { ko: "방문객 주차장", en: "Guest Parking", ja: "来客用駐車場", th: "ที่จอดรถผู้มาเยือน", zh: "访客停车位" },
  "Sổ hồng riêng": { ko: "개별 소유권 등기(핑크북)", en: "Individual Title Deed", ja: "個別登記(ピンクブック)", th: "โฉนดแยก", zh: "独立产权证" },
  "Thổ cư 100%": { ko: "100% 주거용 토지", en: "100% Residential Land", ja: "住宅地100%", th: "ที่ดินเพื่อการอยู่อาศัย 100%", zh: "100%住宅用地" },
  "Đường nhựa": { ko: "포장 도로", en: "Paved Road", ja: "舗装道路", th: "ถนนลาดยาง", zh: "沥青路" },
  "Gần sân bay Long Thành": { ko: "롱탄 공항 인근", en: "Near Long Thanh Airport", ja: "ロンタイン空港近く", th: "ใกล้สนามบินลองแถ่ง", zh: "近隆城机场" },
  "Sân vườn": { ko: "정원", en: "Garden", ja: "庭", th: "สวน", zh: "花园" },
  "Gần biển": { ko: "해변 인근", en: "Near the Beach", ja: "ビーチ近く", th: "ใกล้ชายหาด", zh: "近海滩" },
  "Dịch vụ cho thuê du lịch": { ko: "관광 임대 서비스", en: "Tourist Rental Service", ja: "観光賃貸サービス", th: "บริการปล่อยเช่านักท่องเที่ยว", zh: "旅游租赁服务" },
  "Hệ thống PCCC": { ko: "소방 시스템", en: "Fire Protection System", ja: "消防設備", th: "ระบบป้องกันอัคคีภัย", zh: "消防系统" },
  "Trần cao 8m": { ko: "8m 높은 천장", en: "8m High Ceiling", ja: "天井高8m", th: "เพดานสูง 8 เมตร", zh: "8米高层高" },
  "Bãi đỗ container": { ko: "컨테이너 주차장", en: "Container Parking", ja: "コンテナ駐車場", th: "ที่จอดตู้คอนเทนเนอร์", zh: "集装箱停车场" },
  "An ninh KCN": { ko: "산업단지 보안", en: "Industrial Zone Security", ja: "工業団地セキュリティ", th: "รักษาความปลอดภัยนิคมอุตสาหกรรม", zh: "工业区安保" },
  "Hồ bơi nước mặn": { ko: "해수 수영장", en: "Saltwater Pool", ja: "海水プール", th: "สระน้ำเค็ม", zh: "海水泳池" },
  "Công viên biển hồ": { ko: "호수공원", en: "Lake Park", ja: "湖畔公園", th: "สวนริมทะเลสาบ", zh: "湖滨公园" },
  "Trường học nội khu": { ko: "단지 내 학교", en: "In-complex School", ja: "敷地内学校", th: "โรงเรียนในโครงการ", zh: "小区内学校" },
};

/**
 * [2026-09-11] 매물 등록 화면의 편의시설 **선택 목록**.
 *
 * 기존에는 등록자가 쉼표로 직접 타이핑했다. 자유 입력이면 같은 시설이 "Hồ bơi",
 * "hồ bơi", "수영장"처럼 제각각 저장되고, 그러면 아래 번역 사전에 걸리지 않아
 * 다국어 표시가 깨진다. 그래서 사전의 키(베트남어 원문)를 그대로 선택지로 쓴다 —
 * 저장 형식이 기존 데이터와 동일해 표시 로직(translateOption)을 건드릴 필요가 없다.
 */
export const PROPERTY_OPTION_KEYS: string[] = Object.keys(PROPERTY_OPTION_TRANSLATIONS);

/** 옵션(편의시설) 원문(베트남어)을 현재 앱 언어로 변환 — 사전에 없으면 원문 그대로. */
export function translateOption(optionVi: string, lang: string): string {
  return PROPERTY_OPTION_TRANSLATIONS[optionVi]?.[lang] ?? optionVi;
}

/**
 * [STEP: 2026-09-09-3] 사용자 요청 — 매물 상세 "AI 매물" 섹션(연계 투자상품 삭제 후
 * 대체). 탭 3개: 면적/방수(침실수) 동일 매물, 가격 유사(±5%) 매물. mock 데이터가
 * 11건뿐이라 조건에 맞는 매물이 없을 수 있고, 그 경우 화면에서 EmptyState로
 * 정직하게 표시한다(가짜로 채우지 않음).
 */
export function findSimilarPropertiesByArea(property: MockProperty, limit = 6): MockProperty[] {
  return MOCK_PROPERTIES.filter((p) => p.id !== property.id && p.areaValueM2 === property.areaValueM2).slice(0, limit);
}

export function findSimilarPropertiesByRooms(property: MockProperty, limit = 6): MockProperty[] {
  if (property.bedrooms === undefined) return [];
  return MOCK_PROPERTIES.filter((p) => p.id !== property.id && p.bedrooms === property.bedrooms).slice(0, limit);
}

export function findSimilarPropertiesByPrice(property: MockProperty, limit = 6): MockProperty[] {
  const lower = property.priceValueVnd * 0.95;
  const upper = property.priceValueVnd * 1.05;
  return MOCK_PROPERTIES.filter(
    (p) => p.id !== property.id && p.priceValueVnd >= lower && p.priceValueVnd <= upper,
  ).slice(0, limit);
}

/**
 * [STEP: 2026-09-09-3] 사용자 요청 — 투자상품 상세 "AI 투자" 섹션(연계 매물 삭제 후
 * 대체). 탭 3개: 투자금(최소투자금액) 동일, 기간 동일, 목표액 유사(±5%) 상품.
 */
export function findSimilarInvestmentsByMinAmount(
  product: MockInvestmentProduct,
  limit = 6,
): MockInvestmentProduct[] {
  return MOCK_INVESTMENT_PRODUCTS.filter(
    (p) => p.id !== product.id && p.minInvestmentValueVnd === product.minInvestmentValueVnd,
  ).slice(0, limit);
}

export function findSimilarInvestmentsByPeriod(
  product: MockInvestmentProduct,
  limit = 6,
): MockInvestmentProduct[] {
  return MOCK_INVESTMENT_PRODUCTS.filter((p) => p.id !== product.id && p.period === product.period).slice(0, limit);
}

export function findSimilarInvestmentsByTarget(
  product: MockInvestmentProduct,
  limit = 6,
): MockInvestmentProduct[] {
  const lower = product.targetAmountVnd * 0.95;
  const upper = product.targetAmountVnd * 1.05;
  return MOCK_INVESTMENT_PRODUCTS.filter(
    (p) => p.id !== product.id && p.targetAmountVnd >= lower && p.targetAmountVnd <= upper,
  ).slice(0, limit);
}

/** id로 매물/투자상품을 찾는 헬퍼 — 상세 화면(app/property-detail, app/invest-detail)에서 사용. */
export function findMockProperty(id: string): MockProperty | undefined {
  return MOCK_PROPERTIES.find((property) => property.id === id);
}

export function findMockInvestmentProduct(id: string): MockInvestmentProduct | undefined {
  return MOCK_INVESTMENT_PRODUCTS.find((product) => product.id === id);
}
