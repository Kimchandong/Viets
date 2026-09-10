import type { ImageSourcePropType } from "react-native";

import { MOCK_INVEST_IMAGES, type InvestImageCategory } from "@/constants/mockImages";
import type { MockInvestmentProduct, MockInvestmentStatus } from "@/constants/mockData";
import { formatVndAmount } from "@/utils/format";
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
  properties: { address: string | null } | null;
};

const PRODUCT_SELECT =
  "id,title,description,property_id,category,target_amount,minimum_investment,expected_return,investment_period_months,dividend_frequency,risk_level,status,raised_amount,properties(address)";

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
    status: DB_STATUS_TO_UI[row.status] ?? "closed",
    fundedPercent,
    // DB에는 "추천" 컬럼이 없다 — 투자상품은 매물(properties.featured)과 달리
    // 큐레이션 필드를 아직 설계하지 않았다. 모집중 상품을 추천으로 노출한다.
    featured: row.status === "open",
    category,
    relatedPropertyId: row.property_id ?? undefined,
    minInvestmentValueVnd: row.minimum_investment,
    targetAmountVnd: row.target_amount,
    raisedAmountVnd: row.raised_amount,
    dividendFrequency: (row.dividend_frequency as MockInvestmentProduct["dividendFrequency"]) ?? "quarterly",
    // 단일 text 컬럼이라 vi 하나만 채운다 — localizedText가 없는 언어는 vi로 폴백한다.
    description: { vi: row.description ?? "" },
    images: resolveImages(category),
    isMock: false,
  };
}

export async function listInvestmentProducts(): Promise<MockInvestmentProduct[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("investment_products")
    .select(PRODUCT_SELECT)
    .in("status", ["open", "completed"])
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
  /** 연계 매물(선택) — properties.id. 없으면 null. */
  property_id: string | null;
  /** 모집 금액. D10 범위에서는 실제 입금이 없어 관리자가 직접 관리하는 값이다. */
  raised_amount: number;
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

  const { data, error } = await supabase
    .from("investment_products")
    .insert({ ...input, currency: "VND" })
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

  const { error } = await supabase.from("investment_products").update(input).eq("id", id);

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
      "title,description,category,product_type,target_amount,minimum_investment,expected_return,investment_period_months,dividend_frequency,risk_level,property_id,raised_amount,status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/investments] getInvestmentProductForEdit failed:", error.message);
    return null;
  }
  return data as unknown as NewInvestmentProductInput;
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
