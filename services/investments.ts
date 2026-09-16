import type { ImageSourcePropType } from "react-native";

import { MOCK_INVEST_IMAGES, type InvestImageCategory } from "@/constants/mockImages";
import type { MockInvestmentProduct, MockInvestmentStatus } from "@/constants/mockData";
import { formatVndAmount } from "@/utils/format";
import {
  currentContentLang,
  toContentMap,
  translateTextForAllLanguages,
} from "./contentTranslation";
import { supabase } from "./supabase";

/**
 * [STEP 05/06] 투자상품 — Mock(constants/mockData.ts) → 실제 Supabase
 * investment_products 테이블 연동.
 *
 * 매물(services/properties.ts)과 동일한 전략: 화면(app/(tabs)/invest.tsx,
 * app/invest-detail/[id].tsx)의 필터/렌더링 로직을 바꾸지 않기 위해, DB row를
 * MockInvestmentProduct와 같은 shape으로 매핑해서 돌려준다.
 *
 * 공개 조회는 status IN ('open','completed')만 가능하다(RLS) — draft/pending_review
 * 상품은 admin에게만 보인다.
 */

// DB investment_product_status(7종) → 화면 상태(3종) 매핑.
// 화면은 모집중/마감/완료 세 가지만 구분한다 — 나머지 상태(draft/pending_review/
// fundraising_failed/cancelled)는 애초에 공개 조회에 걸리지 않거나(RLS) 운영상
// "마감"으로 보여주는 것이 사용자 관점에서 정확하다.
const DB_STATUS_TO_UI: Record<string, MockInvestmentStatus> = {
  open: "fundraising",
  completed: "completed",
  closed: "closed",
  fundraising_failed: "closed",
  cancelled: "closed",
  draft: "closed",
  pending_review: "closed",
};

type InvestmentProductRow = {
  id: string;
  title: string;
  description: string | null;
  /** [2026-09-12] 언어코드 → 번역된 설명. 매물과 같은 규칙. */
  description_i18n: Record<string, string> | null;
  description_lang: string | null;
  property_id: string | null;
  category: InvestImageCategory;
  target_amount: number;
  minimum_investment: number;
  expected_return: number | null;
  investment_period_months: number | null;
  dividend_frequency: string | null;
  risk_level: "low" | "medium" | "high";
  status: string;
  raised_amount: number;
  /** [2026-09-16 확정-결정사항 5] 모집 기간. 2026-09-10에 열만 만들어 두고 아무도
   * 쓰지 않던 값(불일치-목록 3③). NULL이면 그 방향으로 제한이 없다. */
  start_at: string | null;
  end_at: string | null;
  properties: { address: string | null } | null;
};

const PRODUCT_SELECT =
  "id,title,description,description_i18n,description_lang,property_id,category,target_amount,minimum_investment,expected_return,investment_period_months,dividend_frequency,risk_level,status,raised_amount,start_at,end_at,properties(address)";

/**
 * [2026-09-16 확정-결정사항 5] 지금 모집 기간 안인가.
 *
 * NULL은 "제한 없음"이다 — 시작일이 없으면 이미 시작했고, 종료일이 없으면 무기한이다.
 * 모집 기간 열이 생기기 전에 등록된 상품은 둘 다 NULL이라 지금까지와 똑같이 동작한다.
 * 이 규칙은 아래 목록 조회의 서버 필터와 **같은 식**이어야 한다 — 한쪽만 고치면
 * 목록에는 보이는데 열면 마감인 상품이 생긴다.
 */
function isFundraisingWindowOpen(
  startAt: string | null,
  endAt: string | null,
  now: Date = new Date(),
): boolean {
  if (startAt && new Date(startAt) > now) return false;
  if (endAt && new Date(endAt) < now) return false;
  return true;
}

/** 화면용 — 이미 매핑된 상품이 모집 기간 안인지. 상세·신청 화면이 쓴다. */
export function isFundraisingOpen(
  product: Pick<MockInvestmentProduct, "fundraisingStartAt" | "fundraisingEndAt">,
  now: Date = new Date(),
): boolean {
  return isFundraisingWindowOpen(
    product.fundraisingStartAt ?? null,
    product.fundraisingEndAt ?? null,
    now,
  );
}

function resolveImages(category: InvestImageCategory): ImageSourcePropType[] {
  // 투자상품 사진 테이블은 아직 없다(DATABASE.md §3 investment_product_documents는
  // 문서용) — 카테고리별 기본 이미지를 쓴다.
  return MOCK_INVEST_IMAGES[category] ?? MOCK_INVEST_IMAGES.other;
}

function mapRow(row: InvestmentProductRow): MockInvestmentProduct {
  const category: InvestImageCategory = row.category ?? "other";
  const fundedPercent =
    row.target_amount > 0 ? Math.round((row.raised_amount / row.target_amount) * 100) : 0;

  return {
    id: row.id,
    title: row.title,
    // 연계 매물이 있으면 그 주소를, 없으면 빈 문자열(화면은 빈 값도 그대로 처리한다).
    propertyLocation: row.properties?.address ?? "",
    expectedReturn: row.expected_return !== null ? `${row.expected_return}%/năm` : "",
    minInvestment: formatVndAmount(row.minimum_investment),
    period: row.investment_period_months !== null ? `${row.investment_period_months} tháng` : "",
    riskLevel: row.risk_level,
    // [2026-09-16 확정 5] DB status가 'open'이어도 모집 기간 밖이면 화면에서는
    // 마감이다. 상태를 DB에 다시 쓰지 않는 이유: 기간이 지났다고 배치로 status를
    // 바꾸면 관리자가 종료일을 미루었을 때 되돌릴 방법이 없다. 기간은 기간대로 두고
    // 표시할 때 계산한다.
    status: isFundraisingWindowOpen(row.start_at, row.end_at)
      ? (DB_STATUS_TO_UI[row.status] ?? "closed")
      : "closed",
    fundedPercent,
    // DB에는 "추천" 컬럼이 없다 — 투자상품은 매물(properties.featured)과 달리
    // 큐레이션 필드를 아직 설계하지 않았다. 모집중 상품을 추천으로 노출한다.
    // 기간이 끝난 상품이 홈 추천에 남으면 안 되므로 기간도 함께 본다.
    featured: row.status === "open" && isFundraisingWindowOpen(row.start_at, row.end_at),
    fundraisingStartAt: row.start_at ?? undefined,
    fundraisingEndAt: row.end_at ?? undefined,
    category,
    relatedPropertyId: row.property_id ?? undefined,
    minInvestmentValueVnd: row.minimum_investment,
    targetAmountVnd: row.target_amount,
    raisedAmountVnd: row.raised_amount,
    dividendFrequency: (row.dividend_frequency as MockInvestmentProduct["dividendFrequency"]) ?? "quarterly",
    // [2026-09-12] 저장 시점에 만들어 둔 번역. 없는 언어는 원문으로 폴백한다.
    description: toContentMap(row.description, row.description_i18n, row.description_lang),
    images: resolveImages(category),
    isMock: false,
  };
}

export async function listInvestmentProducts(): Promise<MockInvestmentProduct[]> {
  if (!supabase) {
    return [];
  }

  // [2026-09-16 확정-결정사항 5] 모집 기간이 지난 상품은 목록에서 숨긴다.
  //
  // 이 필터를 **RLS가 아니라 조회 쿼리에** 두는 이유: RLS로 막으면 이미 투자한
  // 사람이 MY에서 자기 상품을 열 수 없게 된다(사용자 결정 — "투자자는 자신의
  // 투자상품 목록을 볼 수 있도록"). 목록에서만 가리고, id로 직접 여는 길은 열어 둔다.
  //
  // NULL은 제한 없음이다. 쓰고 싶은 조건은 이것이다:
  //
  //   (start_at is null or start_at <= now) and (end_at is null or end_at >= now)
  //
  // 그런데 `.or()`를 두 번 부르면 PostgREST에 `or=` 파라미터가 둘 생긴다. 같은
  // 레벨의 중복 키가 어떻게 합쳐지는지는 보장돼 있지 않아, **한 번의 or 안에서
  // and(...) 묶음 네 개**로 편다(선언형 논리곱의 전개 — 각 묶음이 위 조건의 한
  // 경우다). 이 형태는 PostgREST가 문서로 보장하는 문법이다.
  //
  // 위 mapRow의 isFundraisingWindowOpen과 같은 규칙이어야 한다 — 한쪽만 고치면
  // 목록에는 보이는데 열면 마감인 상품이 생긴다.
  const nowIso = new Date().toISOString();
  const withinWindow = [
    `and(start_at.is.null,end_at.is.null)`,
    `and(start_at.is.null,end_at.gte.${nowIso})`,
    `and(start_at.lte.${nowIso},end_at.is.null)`,
    `and(start_at.lte.${nowIso},end_at.gte.${nowIso})`,
  ].join(",");

  const { data, error } = await supabase
    .from("investment_products")
    .select(PRODUCT_SELECT)
    .in("status", ["open", "completed"])
    .or(withinWindow)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/investments] listInvestmentProducts failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as InvestmentProductRow[]).map(mapRow);
}

export async function getInvestmentProductById(
  id: string,
): Promise<MockInvestmentProduct | undefined> {
  if (!supabase) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("investment_products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("[services/investments] getInvestmentProductById failed:", error.message);
    return undefined;
  }
  if (!data) {
    return undefined;
  }
  return mapRow(data as unknown as InvestmentProductRow);
}

export async function getInvestmentProductsByIds(ids: string[]): Promise<MockInvestmentProduct[]> {
  if (!supabase || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from("investment_products").select(PRODUCT_SELECT).in("id", ids);

  if (error) {
    console.warn("[services/investments] getInvestmentProductsByIds failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as InvestmentProductRow[]).map(mapRow);
}

/** 투자상품 등록/수정 입력값 — app/invest-register.tsx 폼이 채운다. DB 컬럼명과 1:1. */
export type NewInvestmentProductInput = {
  title: string;
  description: string;
  category: InvestImageCategory;
  product_type: "reit_share" | "co_investment" | "fund" | "bond_like";
  target_amount: number;
  minimum_investment: number;
  expected_return: number | null;
  investment_period_months: number | null;
  dividend_frequency: "monthly" | "quarterly" | "yearly";
  risk_level: "low" | "medium" | "high";
  /** [2026-09-11] 지역 — 매물 지역 필터(MOCK_REGIONS)와 같은 값. 고르지 않으면 빈 문자열. */
  region: string;
  /** 연계 매물(선택) — properties.id. 없으면 null. */
  property_id: string | null;
  /** 모집 금액. D10 범위에서는 실제 입금이 없어 관리자가 직접 관리하는 값이다. */
  raised_amount: number;
  /**
   * [2026-09-16 확정-결정사항 5] 모집 기간. ISO 문자열이거나 null(제한 없음).
   * 등록 화면은 YYYY-MM-DD로 받아 여기 넣기 전에 ISO로 바꾼다 — 종료일은 그날
   * 23:59:59까지를 의미한다(하루를 통째로 주는 편이 관리자가 기대하는 동작이다).
   */
  start_at: string | null;
  end_at: string | null;
  /** 'open'이면 공개 모집중, 'draft'면 비공개 저장. */
  status: "open" | "draft" | "closed" | "completed";
};

/**
 * 투자상품 등록. 권한은 서버(RLS)가 최종 판정한다 — admin 계열이거나
 * `user_permissions.investment_manage`가 활성인 계정만 통과한다.
 */
export async function createInvestmentProduct(
  input: NewInvestmentProductInput,
): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  // [2026-09-12] 설명을 나머지 5개 언어로 번역한 뒤 한 번에 넣는다(매물과 같은 규칙).
  const descriptionLang = currentContentLang();
  const descriptionI18n = await translateTextForAllLanguages(input.description, descriptionLang);

  const { data, error } = await supabase
    .from("investment_products")
    .insert({
      ...input,
      region: input.region.length > 0 ? input.region : null,
      currency: "VND",
      description_i18n: descriptionI18n,
      description_lang: descriptionLang,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[services/investments] createInvestmentProduct failed:", error?.message);
    return null;
  }
  return (data as { id: string }).id;
}

export async function updateInvestmentProduct(
  id: string,
  input: NewInvestmentProductInput,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  // 설명이 그대로면 다시 번역하지 않는다 — 모집금액만 고치는 수정이 대부분이다.
  const { data: current } = await supabase
    .from("investment_products")
    .select("description")
    .eq("id", id)
    .maybeSingle();

  const prev = (current ?? null) as { description: string | null } | null;

  let translation: { description_i18n?: Record<string, string>; description_lang?: string } = {};
  if ((prev?.description ?? "") !== input.description) {
    const descriptionLang = currentContentLang();
    translation = {
      description_i18n: await translateTextForAllLanguages(input.description, descriptionLang),
      description_lang: descriptionLang,
    };
  }

  const { error } = await supabase
    .from("investment_products")
    .update({
      ...input,
      region: input.region.length > 0 ? input.region : null,
      ...translation,
    })
    .eq("id", id);

  if (error) {
    console.warn("[services/investments] updateInvestmentProduct failed:", error.message);
    return false;
  }
  return true;
}

/**
 * 소프트 삭제 — status를 'closed'로 바꾼다. 공개 조회는 open/completed만 노출하므로
 * 목록에서 사라지지만, 이미 접수된 신청(investment_orders)이 참조를 잃지 않는다.
 * (investment_orders.product_id는 ON DELETE RESTRICT라 신청이 있으면 하드 삭제 자체가 막힌다.)
 */
export async function closeInvestmentProduct(id: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("investment_products").update({ status: "closed" }).eq("id", id);

  if (error) {
    console.warn("[services/investments] closeInvestmentProduct failed:", error.message);
    return false;
  }
  return true;
}

/**
 * 하드 삭제 — 되돌릴 수 없다. 신청 이력이 하나라도 있으면 FK(ON DELETE RESTRICT)로
 * 거부되며, 그 경우 호출부는 소프트 삭제를 안내해야 한다.
 */
export async function deleteInvestmentProductPermanently(id: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("investment_products").delete().eq("id", id);

  if (error) {
    console.warn("[services/investments] deleteInvestmentProductPermanently failed:", error.message);
    return false;
  }
  return true;
}

/** 수정 화면용 단건 조회 — 공개 상태 필터를 걸지 않는다(draft도 열어서 고칠 수 있어야 한다). */
export async function getInvestmentProductForEdit(
  id: string,
): Promise<NewInvestmentProductInput | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("investment_products")
    .select(
      "title,description,category,product_type,target_amount,minimum_investment,expected_return,investment_period_months,dividend_frequency,risk_level,region,property_id,raised_amount,status,start_at,end_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/investments] getInvestmentProductForEdit failed:", error.message);
    return null;
  }
  // region은 DB에서 NULL로 올 수 있다 — 폼은 "고르지 않음"을 빈 문자열로 다룬다.
  const row = data as unknown as NewInvestmentProductInput & { region: string | null };
  return { ...row, region: row.region ?? "" };
}

/**
 * 투자 신청(의향 접수) 생성 — D10(2026-09-10 확정: 실제 결제 없음).
 *
 * 서버에서는 RLS가 "본인 명의 + status='pending'"만 허용하므로, 사용자가 자기
 * 신청을 곧바로 승인 상태로 만들 수 없다. 첫 신청 시 investors 행이 트리거로
 * 자동 생성된다(D47).
 */
export async function createInvestmentOrder(params: {
  productId: string;
  amountVnd: number;
  contactPhone?: string;
  note?: string;
}): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      console.warn("[services/investments] createInvestmentOrder: no authenticated user");
      return null;
    }

    const { data, error } = await supabase
      .from("investment_orders")
      .insert({
        user_id: userId,
        product_id: params.productId,
        amount: params.amountVnd,
        currency: "VND",
        status: "pending",
        order_type: "buy",
        contact_phone: params.contactPhone ?? null,
        note: params.note ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.warn("[services/investments] createInvestmentOrder failed:", error?.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/investments] createInvestmentOrder threw:", message);
    return null;
  }
}

export type MyInvestmentOrder = {
  id: string;
  product_id: string;
  amount: number;
  status: string;
  created_at: string;
};

/** 내 투자 신청 이력 — MY탭에서 사용한다(RLS Owner-Only라 본인 것만 돌아온다). */
export async function listMyInvestmentOrders(): Promise<MyInvestmentOrder[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("investment_orders")
    .select("id,product_id,amount,status,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/investments] listMyInvestmentOrders failed:", error.message);
    return [];
  }
  return (data ?? []) as MyInvestmentOrder[];
}

/** 내 투자 한 건 — 상품과 내가 넣은 금액을 함께 들고 있다. */
export type MyInvestment = {
  product: MockInvestmentProduct;
  /** 같은 상품에 여러 번 신청했으면 합계. */
  totalAmount: number;
  orders: MyInvestmentOrder[];
};

/**
 * [2026-09-16 확정-결정사항 5] 내가 투자한 상품 목록.
 *
 * 모집이 끝난 상품은 T3 목록에서 사라진다. 그런데 이미 투자한 사람에게는 그 상품이
 * 여전히 자기 자산이므로 볼 수 있어야 한다(사용자 결정). 그래서 이 함수는
 * **모집 기간을 보지 않는다** — 내 주문에 있는 상품은 무조건 가져온다.
 *
 * getInvestmentProductsByIds도 기간을 보지 않으므로 그대로 쓴다. 그쪽에 기간 필터를
 * 넣으면 이 화면이 조용히 비어 버린다.
 */
export async function listMyInvestments(): Promise<MyInvestment[]> {
  const orders = await listMyInvestmentOrders();
  if (orders.length === 0) return [];

  const productIds = [...new Set(orders.map((order) => order.product_id))];
  const products = await getInvestmentProductsByIds(productIds);
  const byId = new Map(products.map((product) => [product.id, product]));

  // 주문은 최신순으로 돌아온다 — 그 순서를 상품 순서로 그대로 쓴다.
  const seen = new Set<string>();
  const result: MyInvestment[] = [];
  for (const order of orders) {
    if (seen.has(order.product_id)) continue;
    const product = byId.get(order.product_id);
    // 상품이 지워졌거나 RLS에 걸려 안 돌아오면 그 줄은 그릴 수 없다. 주문만 남은
    // 상태를 빈 카드로 보여 주는 것보다 빼는 편이 낫다.
    if (!product) continue;
    seen.add(order.product_id);
    const mine = orders.filter((row) => row.product_id === order.product_id);
    result.push({
      product,
      totalAmount: mine.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      orders: mine,
    });
  }
  return result;
}

/**
 * [2026-09-11 사용자 지시] 이 매물에 연결된 투자상품 — 매물 상세 하단에 쓴다.
 *
 * "투자 카테고리에 매물이 있으면 노출하고 없으면 노출하지 마시오"(사용자) — 그래서
 * 빈 배열이면 화면은 섹션 자체를 그리지 않는다. 무엇이 보이는지는 RLS가 정한다
 * (공개 상태인 상품만 일반 사용자에게 돌아온다).
 */
export async function listInvestmentProductsByPropertyId(
  propertyId: string,
): Promise<MockInvestmentProduct[]> {
  if (!supabase || propertyId.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("investment_products")
    .select(PRODUCT_SELECT)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/investments] listInvestmentProductsByPropertyId failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as InvestmentProductRow[]).map(mapRow);
}
