import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  MockInvestmentProduct,
  MockProperty,
  MockPropertyCategory,
  MockPropertyStatus,
} from "@/constants/mockData";
import { listProperties } from "@/services/properties";
import { listInvestmentProducts } from "@/services/investments";

/**
 * [2026-09-12 사용자 지시] AI 탭 — 자연어 질의로 실제 매물/투자상품을 찾는다.
 *
 * 그동안 이 화면은 입력창과 추천 질문만 있고 **결과가 하나도 없었다**. 보내면 900ms
 * 로딩 흉내를 낸 뒤 "준비 중"이라고만 했다. 설계 문서는 이것을 "정직한 placeholder"라
 * 불렀지만(가짜 AI 답변을 만들지 않겠다는 뜻이었다), 실제 화면은 정직해 보이지 않는다 —
 * 검색창과 예시 질문이 있으니 누구나 동작하는 기능으로 읽는다.
 *
 * ## 왜 LLM이 아닌가
 *
 * 원래 설계(claude/ai-research.md)는 pgvector + LLM RAG다. 그런데 그 STEP은
 * **Provider 미확정으로 BLOCKED**이고, 착수하려면 API 키 발급과 비용 승인이 먼저다.
 * 그때까지 화면을 비워 두는 대신, **외부 의존성 없이 지금 동작하는 것**을 만든다.
 *
 * 이 파일이 하는 일은 한 문장이다: **문장에서 조건을 뽑아 DB에서 찾는다.**
 * "호치민 방3개 5억 이하 아파트" → 지역·방수·가격상한·유형으로 나누고 그대로 조회한다.
 * 뽑아낸 조건은 화면에 그대로 보여 준다(무엇으로 찾았는지 사용자가 알아야 하고,
 * 틀렸으면 조건을 하나씩 끌 수 있어야 한다).
 *
 * 나중에 LLM을 올리면 이 경로는 사라지지 않는다 — 호출이 실패하거나 비용을 아껴야 할 때
 * 그대로 쓸 수 있는 fallback이 된다.
 *
 * ## 하지 않는 것
 *
 * 없는 사실을 지어내지 않는다. "이 지역 수익률이 좋습니다" 같은 판단은 근거가 없으면
 * 만들지 않는다. 이 파일은 **찾기**만 하고, 해석은 사용자에게 맡긴다.
 */

// ---------------------------------------------------------------------------
// 사전 — 6개 언어
// ---------------------------------------------------------------------------
//
// 앱이 6개 언어를 쓰므로 질의도 6개 언어로 들어온다. 사용자의 앱 언어가 ko라고 해서
// 한국어로만 친다는 보장도 없다(베트남 현지 매물명·지역명은 원문 그대로 쓰는 일이 많다).
// 그래서 언어를 가리지 않고 **모든 언어의 키워드를 동시에** 본다.
//
// 표기를 소문자로 맞추고 성조 기호를 벗겨 비교한다 — "Hồ Chí Minh"과 "ho chi minh"이
// 같은 말이기 때문이다.

/** MOCK_REGIONS의 province 값 → 그 지역을 가리키는 말들. */
const REGION_WORDS: Record<string, string[]> = {
  "TP. Hồ Chí Minh": [
    "ho chi minh", "hochiminh", "hcm", "hcmc", "saigon", "sai gon", "tphcm",
    "호치민", "호찌민", "사이공", "胡志明", "西贡", "ホーチミン", "サイゴン", "โฮจิมินห์",
  ],
  "Hà Nội": ["ha noi", "hanoi", "하노이", "河内", "ハノイ", "ฮานอย"],
  "Hải Phòng": ["hai phong", "haiphong", "하이퐁", "海防", "ハイフォン", "ไฮฟอง"],
  "Đà Nẵng": ["da nang", "danang", "다낭", "岘港", "ダナン", "ดานัง"],
  "Cần Thơ": ["can tho", "cantho", "껀터", "칸토", "芹苴", "カントー"],
  "Huế": ["hue", "후에", "훼", "顺化", "フエ", "เว้"],
};

const CATEGORY_WORDS: Record<MockPropertyCategory, string[]> = {
  apartment: [
    "apartment", "apt", "condo", "condominium", "flat",
    "can ho", "chung cu", "아파트", "공동주택", "公寓", "アパート", "マンション", "คอนโด",
  ],
  residential: [
    "house", "villa", "townhouse", "residential", "home",
    "nha", "nha pho", "biet thu", "주택", "단독", "빌라", "타운하우스",
    "住宅", "别墅", "一戸建て", "戸建", "บ้าน", "วิลล่า",
  ],
  building: [
    "building", "office", "tower", "commercial",
    "toa nha", "van phong", "빌딩", "사무실", "오피스", "상가",
    "大楼", "写字楼", "ビル", "オフィス", "อาคาร", "สำนักงาน",
  ],
  factory: [
    "factory", "warehouse", "industrial", "plant",
    "nha xuong", "kho", "공장", "창고", "工厂", "仓库", "工場", "倉庫", "โรงงาน", "คลังสินค้า",
  ],
  land: [
    "land", "plot", "lot", "ground",
    "dat", "dat nen", "토지", "땅", "대지", "土地", "地皮", "ที่ดิน",
  ],
  other: [],
};

const LISTING_WORDS: Record<MockPropertyStatus, string[]> = {
  forRent: [
    "rent", "rental", "lease", "monthly",
    "thue", "cho thue", "임대", "월세", "전세", "렌트",
    "租", "出租", "賃貸", "貸", "เช่า",
  ],
  forSale: [
    "sale", "buy", "purchase", "for sale",
    "mua", "ban", "매매", "분양", "매입", "구입",
    "出售", "买", "売買", "購入", "ขาย",
  ],
};

const RISK_WORDS: Record<"low" | "medium" | "high", string[]> = {
  low: ["low risk", "low-risk", "safe", "rui ro thap", "an toan", "저위험", "안전", "低风险", "低リスク", "ความเสี่ยงต่ำ"],
  medium: ["medium risk", "moderate", "rui ro trung binh", "중위험", "中风险", "中リスク", "ความเสี่ยงปานกลาง"],
  high: ["high risk", "high-risk", "rui ro cao", "고위험", "高风险", "高リスク", "ความเสี่ยงสูง"],
};

/** 투자상품을 찾는 질의인지 가려내는 말들. */
const INVESTMENT_WORDS = [
  "invest", "investment", "reit", "reits", "fund", "dividend", "yield", "return",
  "dau tu", "quy", "co tuc", "loi nhuan",
  "투자", "리츠", "펀드", "배당", "수익률", "수익",
  "投资", "房托", "分红", "收益", "投資", "配当", "利回り",
  "ลงทุน", "เงินปันผล", "ผลตอบแทน",
];

/** 상한을 뜻하는 말 — 이 말이 숫자 앞뒤에 있으면 최대값으로 읽는다. */
const MAX_WORDS = [
  "under", "below", "less than", "up to", "cheaper than", "max", "maximum", "within",
  "duoi", "toi da", "이하", "이내", "미만", "아래", "까지", "저렴",
  "以下", "未满", "未満", "以内", "ต่ำกว่า", "ไม่เกิน",
];

/** 하한을 뜻하는 말. */
const MIN_WORDS = [
  "over", "above", "more than", "at least", "min", "minimum", "starting from",
  "tren", "tro len", "toi thieu", "이상", "초과", "넘는", "부터",
  "以上", "超过", "より大きい", "มากกว่า", "อย่างน้อย",
];

/** 숫자 뒤에 붙는 배수 단위. 긴 것부터 검사해야 "만"이 "천만"을 가로채지 않는다. */
const UNIT_MULTIPLIERS: { word: string; factor: number }[] = [
  { word: "billion", factor: 1e9 },
  { word: "million", factor: 1e6 },
  { word: "thousand", factor: 1e3 },
  { word: "ty", factor: 1e9 },      // tỷ
  { word: "trieu", factor: 1e6 },   // triệu
  { word: "nghin", factor: 1e3 },   // nghìn
  { word: "조", factor: 1e12 },
  { word: "억", factor: 1e8 },
  { word: "천만", factor: 1e7 },
  { word: "백만", factor: 1e6 },
  { word: "만", factor: 1e4 },
  { word: "천", factor: 1e3 },
  { word: "亿", factor: 1e8 },
  { word: "萬", factor: 1e4 },
  { word: "万", factor: 1e4 },
  { word: "億", factor: 1e8 },
  { word: "ล้าน", factor: 1e6 },
  { word: "แสน", factor: 1e5 },
  { word: "bn", factor: 1e9 },
  { word: "b", factor: 1e9 },
  // "m"은 million이지만 "100m2"의 m이기도 하다. 면적은 금액보다 먼저 떼어 내므로
  // (parseQuery 참고) 여기까지 온 "m"만 million으로 읽는다.
  { word: "m", factor: 1e6 },
  { word: "k", factor: 1e3 },
];

// ---------------------------------------------------------------------------
// 문자열 정규화
// ---------------------------------------------------------------------------

/**
 * 비교용으로 문자열을 눕힌다 — 소문자 + 성조 제거.
 *
 * 베트남어는 같은 말을 성조 있이/없이 둘 다 친다("Hồ Chí Minh" / "ho chi minh").
 * NFD로 분해한 뒤 결합 문자를 지우면 두 표기가 같은 문자열이 된다. đ는 분해되지
 * 않는 별도 글자라 따로 바꿔 준다.
 */
function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      // 라틴 성조만 벗긴다: NFD로 분해 → U+0300~U+036F(라틴 결합 기호)만 제거.
      // 일본어 탁점(U+3099)·태국어 성조(U+0E48~)는 이 범위 밖이라 그대로 남는다.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // **다시 합친다.** 이 한 줄이 없으면 한글이 자모로 쪼개진 채 남아
      // ("호치민" → "호치민") 사전의 조합형 글자와 영영 만나지 못한다.
      // 일본어 "アパート"도 분해된 탁점이 붙지 못해 "アハート"가 된다.
      .normalize("NFC")
      .replace(/đ/g, "d")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function containsAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (n.length > 0 && haystack.includes(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 질의 해석
// ---------------------------------------------------------------------------

/** 화면에 "이렇게 이해했어요"로 보여 줄 한 조각. */
export type ParsedCondition = {
  /** i18n 키(`ai.condition.<kind>`)에 쓰는 종류. */
  kind: "region" | "category" | "listing" | "maxPrice" | "minPrice" | "bedrooms" | "minArea" | "risk" | "keyword";
  /** 문구에 끼워 넣을 값. 이미 사람이 읽을 수 있는 형태다. */
  label: string;
};

export type SearchIntent = {
  raw: string;
  region?: string;
  category?: MockPropertyCategory;
  listing?: MockPropertyStatus;
  maxPriceVnd?: number;
  minPriceVnd?: number;
  minBedrooms?: number;
  minAreaM2?: number;
  risk?: "low" | "medium" | "high";
  /** 투자상품을 찾는 질의인가. */
  wantsInvestment: boolean;
  /** 조건으로 해석되지 않고 남은 말 — 제목·주소·설명에서 찾는다. */
  keywords: string[];
  conditions: ParsedCondition[];
};

/** "5억", "3 ty", "500 trieu", "1000만동", "3b" 같은 덩어리를 숫자로 바꾼다. */
function readAmount(token: string): number | null {
  // 숫자 부분과 단위 부분을 가른다. 쉼표·점은 자릿수 구분으로 보고 지운다.
  const m = token.match(/^([\d.,]+)\s*([a-z억만천백조亿萬万億ล้านแสน]*)$/);
  if (!m) return null;

  const digits = m[1].replace(/,/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = m[2];
  if (!unit) {
    // 단위가 없는 맨 숫자. 너무 작으면 금액이 아니다(방 개수 등과 섞인다).
    return value >= 1_000_000 ? value : null;
  }

  for (const { word, factor } of UNIT_MULTIPLIERS) {
    if (unit.startsWith(word)) return Math.round(value * factor);
  }
  return null;
}

/**
 * 문장을 조건으로 나눈다.
 *
 * 규칙 기반이라 완벽하지 않다. 그래서 **해석 결과를 반드시 화면에 보여 준다** —
 * 잘못 읽었을 때 사용자가 알아채고 조건을 끌 수 있어야 하기 때문이다.
 */
export function parseQuery(raw: string): SearchIntent {
  const text = normalize(raw);
  const conditions: ParsedCondition[] = [];
  const consumed: string[] = [];

  const intent: SearchIntent = {
    raw,
    wantsInvestment: false,
    keywords: [],
    conditions,
  };

  // --- 지역 ---
  for (const [province, words] of Object.entries(REGION_WORDS)) {
    const hit = containsAny(text, words);
    if (hit) {
      intent.region = province;
      conditions.push({ kind: "region", label: province });
      consumed.push(hit);
      break;
    }
  }

  // --- 매물 유형 ---
  for (const [category, words] of Object.entries(CATEGORY_WORDS) as [MockPropertyCategory, string[]][]) {
    const hit = containsAny(text, words);
    if (hit) {
      intent.category = category;
      conditions.push({ kind: "category", label: category });
      consumed.push(hit);
      break;
    }
  }

  // --- 매매 / 임대 ---
  for (const [listing, words] of Object.entries(LISTING_WORDS) as [MockPropertyStatus, string[]][]) {
    const hit = containsAny(text, words);
    if (hit) {
      intent.listing = listing;
      conditions.push({ kind: "listing", label: listing });
      consumed.push(hit);
      break;
    }
  }

  // --- 투자 질의인가 ---
  const investHit = containsAny(text, INVESTMENT_WORDS);
  if (investHit) {
    intent.wantsInvestment = true;
    consumed.push(investHit);
  }

  // --- 위험도 ---
  for (const [risk, words] of Object.entries(RISK_WORDS) as ["low" | "medium" | "high", string[]][]) {
    const hit = containsAny(text, words);
    if (hit) {
      intent.risk = risk;
      intent.wantsInvestment = true; // 위험도는 투자상품에만 있는 말이다.
      conditions.push({ kind: "risk", label: risk });
      consumed.push(hit);
      break;
    }
  }

  // --- 방 개수 ---
  // "방 3개", "3룸", "3 bedroom", "3 phong ngu", "3br", "침실 2"
  const bedMatch = text.match(
    /(\d+)\s*(?:br\b|bed|bedroom|bedrooms|room|rooms|phong ngu|phong|룸|베드|침실|개짜리|居室|寺|ห้องนอน)|(?:방|침실|bedroom|phong ngu|ห้องนอน)\s*(\d+)/,
  );
  if (bedMatch) {
    const n = Number.parseInt(bedMatch[1] ?? bedMatch[2], 10);
    if (Number.isFinite(n) && n > 0 && n < 20) {
      intent.minBedrooms = n;
      conditions.push({ kind: "bedrooms", label: String(n) });
    }
  }

  // --- 면적 ---
  //
  // 금액보다 **먼저** 처리하고, 찾은 구간을 문장에서 지운다. 안 그러면 "100m²"의 100이
  // 금액 검색에도 걸리고, 하필 단위 "m"이 million으로 읽혀 1억동짜리 조건이 생긴다
  // (실제로 "다낭 주택 100m² 이상"이 그렇게 깨졌다).
  let priceText = text;
  const areaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|sqm|met vuong|평방|제곱|平米|平方米|ตารางเมตร)/);
  if (areaMatch) {
    const n = Number.parseFloat(areaMatch[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) {
      intent.minAreaM2 = n;
      conditions.push({ kind: "minArea", label: String(n) });
    }
    priceText = text.replace(areaMatch[0], " ");
  }

  // --- 금액 ---
  // 숫자+단위 덩어리를 모두 찾고, 그 주변에 상/하한을 뜻하는 말이 있는지 본다.
  const amountPattern = /([\d.,]+\s*(?:billion|million|thousand|ty|trieu|nghin|조|억|천만|백만|만|천|亿|萬|万|億|ล้าน|แสน|bn|b|m|k)?)\s*(?:vnd|dong|동|đ|₫)?/g;
  let amountMatch: RegExpExecArray | null;
  const amounts: { value: number; index: number; length: number }[] = [];

  while ((amountMatch = amountPattern.exec(priceText)) !== null) {
    const token = amountMatch[1].replace(/\s+/g, "");
    const value = readAmount(token);
    if (value !== null) {
      amounts.push({ value, index: amountMatch.index, length: amountMatch[0].length });
    }
  }

  for (const amount of amounts) {
    // 금액 앞 12글자, 뒤 8글자 안에서 상/하한 표현을 찾는다. 한국어는 "5억 이하"처럼
    // 뒤에 붙고, 영어는 "under 500 million"처럼 앞에 붙는다.
    const before = priceText.slice(Math.max(0, amount.index - 12), amount.index);
    const after = priceText.slice(amount.index + amount.length, amount.index + amount.length + 8);
    const window = `${before} ${after}`;

    const looksMin = containsAny(window, MIN_WORDS) !== null;
    const looksMax = containsAny(window, MAX_WORDS) !== null;

    if (looksMin && !looksMax) {
      intent.minPriceVnd = amount.value;
      conditions.push({ kind: "minPrice", label: String(amount.value) });
    } else {
      // 상한 표현이 없어도 금액 하나만 있으면 "그 정도 이하"로 읽는 것이 자연스럽다
      // ("3억 아파트"를 정확히 3억인 것만 찾아 달라는 뜻으로 쓰는 사람은 드물다).
      intent.maxPriceVnd = amount.value;
      conditions.push({ kind: "maxPrice", label: String(amount.value) });
    }
  }

  // --- 남은 말 ---
  // 조건으로 쓰인 표현을 지우고, 뜻이 있는 낱말만 남긴다. 이것으로 제목·주소·설명을 찾는다.
  let rest = priceText;
  for (const c of consumed) rest = rest.replace(new RegExp(c, "g"), " ");
  rest = rest.replace(amountPattern, " ");

  intent.keywords = rest
    .split(/[\s,./?!()"'·|-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));

  for (const k of intent.keywords.slice(0, 3)) {
    conditions.push({ kind: "keyword", label: k });
  }

  return intent;
}

/** 조건으로도 검색어로도 쓸모없는 말 — 질문 문장에 흔히 섞이는 조사/의문사. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "in", "on", "at", "of", "for", "to", "and", "or",
  "me", "my", "i", "show", "find", "search", "please", "want", "looking", "near",
  "what", "which", "where", "how", "can", "you", "with", "have", "has", "best", "good",
  "cho", "toi", "tim", "kiem", "gan", "co", "la", "va", "muon", "nao", "dau", "gi",
  "알려줘", "보여줘", "찾아줘", "추천", "해줘", "있나요", "인가요", "어디", "얼마", "무엇",
  "매물", "부동산", "물건", "곳", "좀", "그리고", "또는",
  "请", "帮", "我", "找", "的", "在", "哪", "什么",
  "ください", "教えて", "探して", "どこ", "何",
  "หา", "ช่วย", "ที่ไหน", "อะไร",
]);

// ---------------------------------------------------------------------------
// 검색 실행
// ---------------------------------------------------------------------------

export type AiSearchResult = {
  intent: SearchIntent;
  properties: MockProperty[];
  investments: MockInvestmentProduct[];
  /** 조건을 하나도 못 읽었고 남은 낱말도 없을 때 true — 화면이 안내를 바꾼다. */
  understood: boolean;
};

const MAX_RESULTS = 20;

function matchesKeywords(haystack: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const text = normalize(haystack);
  // 하나라도 걸리면 통과. 전부 요구하면 조사 하나 때문에 결과가 사라진다.
  return keywords.some((k) => text.includes(k));
}

function matchProperty(p: MockProperty, intent: SearchIntent): boolean {
  if (intent.region && p.province !== intent.region && !normalize(p.location).includes(normalize(intent.region))) {
    return false;
  }
  if (intent.category && p.category !== intent.category) return false;
  if (intent.listing && p.status !== intent.listing) return false;
  if (intent.maxPriceVnd !== undefined && p.priceValueVnd > intent.maxPriceVnd) return false;
  if (intent.minPriceVnd !== undefined && p.priceValueVnd < intent.minPriceVnd) return false;
  if (intent.minBedrooms !== undefined && (p.bedrooms ?? 0) < intent.minBedrooms) return false;
  if (intent.minAreaM2 !== undefined && p.areaValueM2 < intent.minAreaM2) return false;
  return matchesKeywords(`${p.title} ${p.location}`, intent.keywords);
}

function matchInvestment(v: MockInvestmentProduct, intent: SearchIntent): boolean {
  if (intent.risk && v.riskLevel !== intent.risk) return false;
  if (intent.region && !normalize(v.propertyLocation).includes(normalize(intent.region))) return false;
  if (intent.maxPriceVnd !== undefined && v.minInvestmentValueVnd > intent.maxPriceVnd) return false;
  return matchesKeywords(`${v.title} ${v.propertyLocation}`, intent.keywords);
}

/**
 * 해석된 조건으로 실제 목록을 거른다.
 *
 * 목록을 통째로 받아 화면에서 거른다 — 조건 조합이 많아 서버 쿼리로 옮기면 경우의 수마다
 * 인덱스를 따로 만들어야 하고, 지금 매물 수는 한 번에 받아도 되는 규모다. 규모가 커지면
 * 이 함수 안쪽만 RPC 호출로 바꾸면 된다(화면은 그대로다).
 */
async function search(intent: SearchIntent): Promise<AiSearchResult> {
  const [allProperties, allInvestments] = await Promise.all([
    listProperties(),
    intent.wantsInvestment ? listInvestmentProducts() : Promise.resolve([] as MockInvestmentProduct[]),
  ]);

  return {
    intent,
    properties: allProperties.filter((p) => matchProperty(p, intent)).slice(0, MAX_RESULTS),
    investments: allInvestments.filter((v) => matchInvestment(v, intent)).slice(0, MAX_RESULTS),
    understood: intent.conditions.length > 0,
  };
}

/** 사용자가 친 문장을 해석하고 그대로 찾는다. */
export async function runAiSearch(raw: string): Promise<AiSearchResult> {
  return search(parseQuery(raw));
}

/**
 * 조건 하나를 끈 채로 다시 찾는다.
 *
 * 잘못 읽은 조건 때문에 결과가 0건일 때, 질문을 처음부터 다시 치게 하지 않으려고 둔다.
 */
export async function rerunWithout(
  intent: SearchIntent,
  kind: ParsedCondition["kind"],
  label: string,
): Promise<AiSearchResult> {
  const next: SearchIntent = {
    ...intent,
    conditions: intent.conditions.filter((c) => !(c.kind === kind && c.label === label)),
  };

  if (kind === "region") next.region = undefined;
  if (kind === "category") next.category = undefined;
  if (kind === "listing") next.listing = undefined;
  if (kind === "maxPrice") next.maxPriceVnd = undefined;
  if (kind === "minPrice") next.minPriceVnd = undefined;
  if (kind === "bedrooms") next.minBedrooms = undefined;
  if (kind === "minArea") next.minAreaM2 = undefined;
  if (kind === "risk") next.risk = undefined;
  if (kind === "keyword") next.keywords = intent.keywords.filter((k) => k !== label);

  return search(next);
}

// ---------------------------------------------------------------------------
// 최근 검색
// ---------------------------------------------------------------------------
//
// [2026-09-12] 화면의 "최근 검색" 세 줄은 i18n에 박아 둔 **고정 문구**였다. 누가 무엇을
// 찾았든 늘 같은 세 줄이 떴고, 눌러도 그 문구로 검색될 뿐이었다. 실제로 이 사람이 친 말을
// 저장한다.
//
// 기기 안에만 둔다(서버로 보내지 않는다) — 무엇을 찾아봤는지는 개인적인 정보이고,
// 이 기능에 계정이 필요하지도 않다.


const RECENT_KEY = "viets.ai.recentQueries";
const RECENT_LIMIT = 5;

export async function loadRecentQueries(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENT_LIMIT);
  } catch {
    // 저장소를 못 읽어도 검색은 되어야 한다. 최근 목록이 비는 것으로 끝낸다.
    return [];
  }
}

/** 맨 앞에 넣고 같은 말은 지운다(다시 친 질문이 아래에 남아 있으면 목록이 지저분해진다). */
export async function pushRecentQuery(query: string): Promise<string[]> {
  const value = query.trim();
  if (!value) return loadRecentQueries();

  const current = await loadRecentQueries();
  const next = [value, ...current.filter((q) => q !== value)].slice(0, RECENT_LIMIT);
  try {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패는 조용히 넘긴다 — 이번 검색 자체는 이미 끝났다.
  }
  return next;
}

export async function clearRecentQueries(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_KEY);
  } catch {
    // 지우지 못해도 알릴 것이 없다.
  }
}
