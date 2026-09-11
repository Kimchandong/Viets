import type { ImageSourcePropType } from "react-native";

import { MOCK_PROPERTY_IMAGES, type PropertyImageCategory } from "@/constants/mockImages";
import { MOCK_REGIONS, type MockProperty, type MockPropertyCategory, type MockPropertyStatus } from "@/constants/mockData";
import { formatVndAmount } from "@/utils/format";
import { readImageBytes } from "@/utils/imageBytes";
import { isAdmin } from "./roles";
import { supabase } from "./supabase";

/**
 * [STEP 04] 매물 목록/상세 — Mock(constants/mockData.ts) → 실제 Supabase properties/
 * property_images 테이블 연동 (지도 제외, DB 연동만).
 *
 * app/(tabs)/property.tsx, app/property-detail/[id].tsx의 필터/정렬/렌더링 로직을
 * 전혀 바꾸지 않기 위해, 실제 DB row를 MOCK_PROPERTY와 동일한 shape(MockProperty)로
 * 매핑해서 반환한다 — mockData.ts 상단 주석에 이미 이 방식이 전제되어 있었다.
 *
 * status='active'인 매물만 조회한다(DATABASE.md §2 RLS: Public-Read는 status='active'
 * 행만 허용 — anon 클라이언트로는 다른 status를 조회해도 RLS가 걸러낸다).
 */

// DATABASE.md §2 properties.category(property_category enum, 8종) → UI
// PropertyImageCategory(constants/mockImages.ts, 6종) 매핑. 두 체계는 도입 시점이
// 달라(DB는 STEP 02, UI 카테고리는 그 이전 "카테고리 재구성" STEP) 값 개수가
// 다르므로, 화면쪽 코드는 손대지 않고 이 서비스 계층에서만 흡수한다.
// villa/townhouse→residential(주택/단지), office/retail→building(빌딩/상가),
// hotel→other(전용 UI 카테고리 없음), industrial→factory(공장/창고).
const DB_CATEGORY_TO_UI: Record<string, PropertyImageCategory> = {
  apartment: "apartment",
  villa: "residential",
  townhouse: "residential",
  land: "land",
  office: "building",
  retail: "building",
  hotel: "other",
  industrial: "factory",
};

type PropertyImageRow = { url: string; sort_order: number | null };

type PropertyRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  listing_type: "for_sale" | "for_rent";
  price: number;
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rental_yield: number | null;
  featured: boolean;
  amenities: string[] | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  property_images: PropertyImageRow[] | null;
};

const PROPERTY_SELECT =
  "id,title,description,category,listing_type,price,area,bedrooms,bathrooms,rental_yield,featured,amenities,address,latitude,longitude,created_by,property_images(url,sort_order)";

/** address 텍스트에 MOCK_REGIONS(지역 필터 칩) 중 하나가 포함되어 있으면 그 값을 쓴다.
 * locations 테이블이 아직 비어있어(seed 없음) province_id FK 대신 address 텍스트 매칭으로
 * 지역 필터(property.tsx의 regionBar)가 실제 데이터에서도 동작하게 한다. */
function resolveProvince(address: string | null): string {
  if (!address) return "";
  return MOCK_REGIONS.find((region) => address.includes(region)) ?? "";
}

/** 실제 매물 사진(property_images)이 아직 없으면(등록 초기 단계) 카테고리별 mock
 * 이미지를 임시 썸네일로 보여준다 — 특정 가짜 매물을 만드는 것이 아니라 "사진 없음"
 * 상태를 위한 일반 카테고리 placeholder이므로 "가짜 데이터 금지" 원칙과 무관하다. */
function resolveImages(row: PropertyRow, uiCategory: PropertyImageCategory): ImageSourcePropType[] {
  const images = row.property_images ?? [];
  if (images.length === 0) {
    return MOCK_PROPERTY_IMAGES[uiCategory];
  }
  return [...images]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((image) => ({ uri: image.url }));
}

/** utils/format.ts formatVndAmount()로 mock과 동일한 "4.2 tỷ"/"18,000k" 표기를
 * 만들고, listing_type='for_rent'면 "/tháng"을 붙인다(mock의 "18,000k/tháng"과 동일). */
function formatPrice(row: Pick<PropertyRow, "price" | "listing_type">): string {
  const amount = formatVndAmount(row.price);
  return row.listing_type === "for_rent" ? `${amount}/tháng` : amount;
}

function mapRowToMockProperty(row: PropertyRow): MockProperty {
  const uiCategory: MockPropertyCategory = DB_CATEGORY_TO_UI[row.category] ?? "other";
  const status: MockPropertyStatus = row.listing_type === "for_rent" ? "forRent" : "forSale";

  return {
    id: row.id,
    title: row.title,
    location: row.address ?? "",
    price: formatPrice(row),
    area: row.area != null ? `${row.area} m²` : "-",
    yieldRate: row.rental_yield != null ? `${row.rental_yield}%/năm` : undefined,
    status,
    featured: row.featured,
    category: uiCategory,
    province: resolveProvince(row.address),
    priceValueVnd: row.price,
    areaValueM2: row.area ?? 0,
    bedrooms: row.bedrooms ?? undefined,
    bathrooms: row.bathrooms ?? undefined,
    // description은 아직 언어별 콘텐츠 분리가 없어(단일 text 컬럼) vi 하나만 채운다 —
    // utils/format.ts localizedText()가 없는 언어는 vi로 폴백하므로 화면 쪽은 그대로 동작한다.
    description: { vi: row.description ?? "" },
    options: row.amenities ?? [],
    // [STEP 04-지도] 마커 좌표 — 둘 중 하나라도 없으면 좌표 없는 매물로 취급한다
    // (properties_geom_sync 트리거도 동일한 규칙으로 geom을 NULL 처리한다).
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    // 등록자 — 매물 상세가 "이 매물이 내 것인가"를 판단하는 데 쓴다(중개업소는 자기
    // 매물만 수정할 수 있다). 실제 차단은 properties UPDATE 정책이 서버에서 한다.
    createdBy: row.created_by ?? undefined,
    images: resolveImages(row, uiCategory),
    isMock: false,
  };
}

export async function listProperties(): Promise<MockProperty[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/properties] listProperties failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as PropertyRow[]).map(mapRowToMockProperty);
}

const PROPERTY_IMAGES_BUCKET = "property-images";

/**
 * 매물 사진을 Storage에 업로드하고 공개 URL을 돌려준다(DB에는 아직 기록하지 않는다 —
 * 매물이 생성된 뒤 addPropertyImages()로 property_images에 연결한다).
 *
 * 파일 읽기의 웹/네이티브 분기는 utils/imageBytes.ts가 담당한다 — 채팅 이미지 전송과
 * 같은 함정(네이티브의 fetch().blob() 불완전 읽기 / 웹의 expo-file-system 미지원)을
 * 겪으므로 한 곳에 모아 두었다.
 */
export async function uploadPropertyImage(localUri: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    // 경로 앞머리를 uploads/<timestamp>로 두는 이유: 매물 id는 등록 완료 전이라 아직
    // 없다. 파일명 충돌만 피하면 되고, 조회는 property_images.url로 하므로 경로 자체에
    // 의미를 두지 않는다.
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(PROPERTY_IMAGES_BUCKET)
      .upload(path, bytes, { contentType });

    if (uploadError) {
      console.warn("[services/properties] uploadPropertyImage failed:", uploadError.message);
      return null;
    }

    const { data } = supabase.storage.from(PROPERTY_IMAGES_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/properties] uploadPropertyImage threw:", message);
    return null;
  }
}

/** 업로드된 사진 URL들을 property_images에 연결한다(입력 순서를 sort_order로 보존).
 *
 * sort_order는 0이 아니라 **기존 사진의 마지막 번호 다음**부터 매긴다 — 수정 모드에서
 * 0부터 다시 시작하면 새로 추가한 사진이 대표 사진(sort_order가 가장 작은 사진) 자리를
 * 빼앗아, 사진 한 장 추가했을 뿐인데 매물 썸네일이 바뀌어 버린다. */
export async function addPropertyImages(propertyId: string, urls: string[]): Promise<boolean> {
  if (!supabase || urls.length === 0) {
    return true;
  }

  const { data: last } = await supabase
    .from("property_images")
    .select("sort_order")
    .eq("property_id", propertyId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const lastOrder = (last as { sort_order: number }[] | null)?.[0]?.sort_order;
  const startOrder = lastOrder != null ? lastOrder + 1 : 0;

  const { error } = await supabase
    .from("property_images")
    .insert(urls.map((url, index) => ({ property_id: propertyId, url, sort_order: startOrder + index })));

  if (error) {
    console.warn("[services/properties] addPropertyImages failed:", error.message);
    return false;
  }
  return true;
}

/** 수정 화면에 이미 등록된 사진을 보여주기 위한 최소 형태(대표 사진 판단용 정렬값 포함). */
export type ExistingPropertyImage = {
  id: string;
  url: string;
  sortOrder: number;
};

/**
 * 특정 매물에 이미 등록된 사진 목록. **status 필터를 걸지 않는다** — getPropertyForEdit과
 * 같은 이유로 draft/archived 매물의 사진도 수정 화면에서 다룰 수 있어야 한다.
 * 조회 가능 여부는 RLS(부모 매물 가시성과 동일)가 판정한다.
 */
export async function listPropertyImages(propertyId: string): Promise<ExistingPropertyImage[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("property_images")
    .select("id,url,sort_order")
    .eq("property_id", propertyId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.warn("[services/properties] listPropertyImages failed:", error.message);
    return [];
  }

  return ((data ?? []) as { id: string; url: string; sort_order: number | null }[]).map((row) => ({
    id: row.id,
    url: row.url,
    sortOrder: row.sort_order ?? 0,
  }));
}

/** 공개 URL에서 버킷 내부 경로를 되뽑는다.
 * `https://<ref>.supabase.co/storage/v1/object/public/property-images/uploads/x.jpg`
 * → `uploads/x.jpg`. 형식이 다르면(외부 URL 등) null을 돌려주고 Storage는 건드리지 않는다. */
function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${PROPERTY_IMAGES_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split("?")[0];
  return path.length > 0 ? decodeURIComponent(path) : null;
}

/**
 * 사진 한 장 삭제 — property_images 행을 지우고, 이어서 Storage 파일도 지운다.
 *
 * 성패의 기준은 **DB 행 삭제**다. 행이 지워지면 앱 어디에서도 그 사진은 보이지 않는다.
 * Storage 삭제는 best-effort로 처리한다 — 버킷 정책 때문에 실패하더라도 사용자에게는
 * 이미 사라진 사진이라 다시 지우라고 할 수 없고, 남는 것은 참조되지 않는 파일 하나뿐이다
 * (경고 로그로 남긴다). 반대 순서로 하면 Storage만 지워지고 DB에 죽은 URL이 남아
 * 화면에 깨진 이미지가 뜬다.
 *
 * 권한은 서버(property_images DELETE 정책: admin / 소속 Agency / `property_manage` 보유자)가
 * 최종 판정한다.
 */
export async function deletePropertyImage(imageId: string, url: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("property_images").delete().eq("id", imageId);
  if (error) {
    console.warn("[services/properties] deletePropertyImage failed:", error.message);
    return false;
  }

  const path = storagePathFromPublicUrl(url);
  if (path) {
    const { error: storageError } = await supabase.storage.from(PROPERTY_IMAGES_BUCKET).remove([path]);
    if (storageError) {
      console.warn("[services/properties] deletePropertyImage storage cleanup failed:", storageError.message);
    }
  }
  return true;
}

/** 매물 등록 입력값 — app/property-register.tsx 폼이 채운다. DB 컬럼명과 1:1로 맞춘다. */
export type NewPropertyInput = {
  title: string;
  description: string;
  /** DATABASE.md §0 property_category enum 값 그대로(UI 6종이 아니라 DB 8종). */
  category: string;
  listing_type: "for_sale" | "for_rent";
  /** VND 정수. for_rent이면 월 임대료. */
  price: number;
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  amenities: string[];
  featured: boolean;
  /** 'active'면 즉시 공개, 'draft'면 비공개 저장(목록에 노출되지 않음). */
  status: "active" | "draft";
};

/**
 * 매물 등록. 성공 시 생성된 매물 id를, 실패 시 null을 반환한다(예외를 던지지 않는다).
 *
 * 권한은 서버(properties RLS)가 최종 판정한다 — admin 계열이거나, 소속 Agency에
 * property_listing 권한이 활성인 경우에만 INSERT가 통과한다. 권한이 없으면 여기서
 * 에러가 잡히고 null이 반환된다.
 */
export async function createProperty(input: NewPropertyInput): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  // [2026-09-11] agency_id를 채우는 이유: 승인된 중개업소 계정은 properties_insert_agency
  // 정책(can_manage_agency_property(agency_id))으로 통과하는데, 이 값이 비어 있으면 그
  // 함수가 false를 돌려줘 등록 자체가 막힌다. 관리자/개별 property_manage 계정은 Agency가
  // 없어 NULL이 돌아오고, 그쪽은 각자의 정책으로 통과한다.
  const { data: agencyId } = await supabase.rpc("my_active_agency_id");

  const { data, error } = await supabase
    .from("properties")
    .insert({ ...input, currency: "VND", agency_id: (agencyId as string | null) ?? null })
    .select("id")
    .single();

  if (error) {
    console.warn("[services/properties] createProperty failed:", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * 매물 수정. 성공하면 true. 권한은 서버(RLS)가 최종 판정한다 — admin, 소속 Agency,
 * 또는 `property_manage` 권한 보유자만 통과한다.
 */
export async function updateProperty(id: string, input: NewPropertyInput): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("properties").update(input).eq("id", id);

  if (error) {
    console.warn("[services/properties] updateProperty failed:", error.message);
    return false;
  }
  return true;
}

/**
 * 소프트 삭제 — status를 'archived'로 바꾼다(2026-09-10 사용자 결정: 삭제의 기본 동작).
 * 행과 사진이 그대로 남아 상담 이력·찜 데이터가 깨지지 않고, 되돌릴 수 있다.
 * 공개 조회 정책(status='active')에 걸려 목록/검색/상세에서는 사라진다.
 */
export async function archiveProperty(id: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("properties").update({ status: "archived" }).eq("id", id);

  if (error) {
    console.warn("[services/properties] archiveProperty failed:", error.message);
    return false;
  }
  return true;
}

/**
 * 하드 삭제 — 행을 실제로 지운다. **admin 계열만 가능**하고(2026-09-10 결정),
 * property_images/property_documents도 FK cascade로 함께 삭제되며 되돌릴 수 없다.
 * 호출부는 반드시 사용자 확인을 받은 뒤 호출해야 한다.
 */
export async function deletePropertyPermanently(id: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("properties").delete().eq("id", id);

  if (error) {
    console.warn("[services/properties] deletePropertyPermanently failed:", error.message);
    return false;
  }
  return true;
}

/** 주소 → 좌표 변환 결과. 실패 사유는 화면에서 문구를 고르는 데 쓴다. */
export type GeocodeResult =
  | { ok: true; latitude: number; longitude: number; formattedAddress: string }
  | { ok: false; reason: "not-found" | "forbidden" | "failed" };

/**
 * 주소 문자열을 좌표로 변환한다(Edge Function `geocode` 경유).
 *
 * Google Geocoding API 키는 서버(Supabase Secrets)에만 있다 — 앱에 있는 Maps 키는
 * Android 앱 제한이 걸려 있어 이 용도로 쓸 수 없고, 제한을 풀면 번들에 평문으로
 * 노출된 키로 누구나 과금시킬 수 있다(2026-09-10 번역 키 사고와 같은 부류).
 * 서버가 매물 등록 권한까지 다시 확인하므로, 권한 없는 계정은 403으로 거부된다.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  if (!supabase) {
    return { ok: false, reason: "failed" };
  }

  try {
    const { data, error } = await supabase.functions.invoke("geocode", {
      body: { address },
    });

    if (error) {
      // FunctionsHttpError는 상태코드를 응답 객체로만 알려준다 — 404(결과 없음)와
      // 403(권한 없음)은 사용자에게 다른 문구를 보여줘야 해서 따로 읽는다.
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 404) return { ok: false, reason: "not-found" };
      if (status === 403) return { ok: false, reason: "forbidden" };
      console.warn("[services/properties] geocodeAddress failed:", error.message);
      return { ok: false, reason: "failed" };
    }

    const result = data as { latitude?: number; longitude?: number; formattedAddress?: string } | null;
    if (typeof result?.latitude !== "number" || typeof result?.longitude !== "number") {
      return { ok: false, reason: "failed" };
    }

    return {
      ok: true,
      latitude: result.latitude,
      longitude: result.longitude,
      formattedAddress: result.formattedAddress ?? address,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/properties] geocodeAddress threw:", message);
    return { ok: false, reason: "failed" };
  }
}

/** 투자상품 등록 화면의 "연계 매물" 선택 목록에 쓰는 최소 형태. */
export type PropertyOption = {
  id: string;
  title: string;
  address: string;
};

/** PostgREST `or=` 문법은 쉼표/괄호로 조건을 구분한다 — 검색어에 그 문자가 들어가면
 * 필터 자체가 깨지므로 미리 제거한다. `%`/`*`는 와일드카드라 함께 막는다. */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%*]/g, " ").trim();
}

/**
 * 연계할 매물 후보 목록. 검색어가 있으면 매물명/주소로 부분 일치 검색한다.
 *
 * **status 필터를 걸지 않는다** — 아직 공개하지 않은(draft) 매물에 대한 투자상품을
 * 미리 만들어 둘 수 있어야 하기 때문이다. 실제로 무엇이 보이는지는 RLS가 판정한다
 * (admin은 전체, Agency 소속은 자기 매물 + 공개 매물).
 * 한 번에 50건까지만 가져온다 — 그 이상은 검색어로 좁히는 것을 전제한다.
 */
export async function listPropertyOptions(query?: string): Promise<PropertyOption[]> {
  if (!supabase) {
    return [];
  }

  let request = supabase
    .from("properties")
    .select("id,title,address")
    .order("created_at", { ascending: false })
    .limit(50);

  const term = sanitizeSearchTerm(query ?? "");
  if (term.length > 0) {
    request = request.or(`title.ilike.%${term}%,address.ilike.%${term}%`);
  }

  const { data, error } = await request;

  if (error) {
    console.warn("[services/properties] listPropertyOptions failed:", error.message);
    return [];
  }

  return ((data ?? []) as { id: string; title: string; address: string | null }[]).map((row) => ({
    id: row.id,
    title: row.title,
    address: row.address ?? "",
  }));
}

/** 이미 연결된 매물의 이름을 보여주기 위한 단건 조회(수정 화면 진입 시 1회).
 * 매물이 지워졌거나 볼 권한이 없으면 null — 호출부는 "연결된 매물 없음"으로 표시한다. */
export async function getPropertyOption(id: string): Promise<PropertyOption | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id,title,address")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/properties] getPropertyOption failed:", error.message);
    return null;
  }

  const row = data as { id: string; title: string; address: string | null };
  return { id: row.id, title: row.title, address: row.address ?? "" };
}

/**
 * 수정 화면용 단건 조회 — getPropertyById와 달리 **status 필터를 걸지 않는다**.
 * 비공개(draft)/보관(archived) 매물도 관리자가 열어서 고칠 수 있어야 하기 때문이다.
 * 조회 가능 여부는 RLS가 판정한다(권한이 없으면 결과가 비어 돌아온다).
 */
export async function getPropertyForEdit(id: string): Promise<NewPropertyInput | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("properties")
    .select(
      "title,description,category,listing_type,price,area,bedrooms,bathrooms,address,latitude,longitude,amenities,featured,status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/properties] getPropertyForEdit failed:", error.message);
    return null;
  }

  const row = data as unknown as NewPropertyInput & { status: string };
  return {
    ...row,
    // 폼은 active/draft 두 가지만 다룬다 — archived 매물을 수정하면 draft로 되살아난다
    // (사용자가 "즉시 공개"를 켜서 다시 active로 만들 수 있다).
    status: row.status === "active" ? "active" : "draft",
  };
}

/**
 * 여러 id를 한 번에 조회한다 — MY탭의 관심 매물 목록처럼 찜한 id 배열로 실제 매물을
 * 가져올 때 쓴다(id마다 따로 요청하지 않는다). 조회 시점에 비활성/삭제된 매물은
 * 결과에서 빠지므로, 호출부는 요청한 개수보다 적게 돌아올 수 있음을 전제해야 한다.
 */
export async function getPropertiesByIds(ids: string[]): Promise<MockProperty[]> {
  if (!supabase || ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .in("id", ids)
    .eq("status", "active");

  if (error) {
    console.warn("[services/properties] getPropertiesByIds failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as PropertyRow[]).map(mapRowToMockProperty);
}

/* ==========================================================================
 * [2026-09-11 사용자 지시] 등록 매물 관리 — MY > 매물 정보
 * ======================================================================== */

/** 등록 매물 목록의 탭. DB의 어떤 값에 대응하는지는 아래 주석 참조. */
export type ManagedPropertyTab = "public" | "done" | "hold" | "featured";

/**
 * 탭 → properties.status 매핑.
 *
 * - public(공개) = 'active'  — 노출 중이라 목록/검색/상세에서 보이는 매물
 * - done(완료)   = 'sold'    — 중개가 끝난 매물
 * - hold(보류)   = 'draft'   — 등록은 됐지만 노출하지 않는 매물
 *
 * 'featured'(추천)는 status가 아니라 **properties.featured 플래그**다 — 상태 축과
 * 독립적이라(공개 중인 매물이 동시에 추천일 수 있다) 여기에 넣지 않는다.
 */
export const MANAGED_STATUS_BY_TAB: Record<"public" | "done" | "hold", "active" | "sold" | "draft"> = {
  public: "active",
  done: "sold",
  hold: "draft",
};

export type ManagedPropertyStatus = "active" | "sold" | "draft";

/** 등록 매물 한 줄. 목록에 필요한 것만 담는다(상세는 매물 상세 화면이 따로 조회한다). */
export type ManagedProperty = {
  id: string;
  title: string;
  address: string;
  /** "4.2 tỷ" / "18,000k/tháng" — 목록 카드와 같은 표기. */
  price: string;
  status: string;
  featured: boolean;
  /** 대표 사진(sort_order가 가장 작은 것). 없으면 null — 화면에서 자리표시자를 그린다. */
  thumbnailUrl: string | null;
};

type ManagedPropertyRow = {
  id: string;
  title: string;
  address: string | null;
  price: number;
  listing_type: "for_sale" | "for_rent";
  status: string;
  featured: boolean;
  created_by: string | null;
  property_images: PropertyImageRow[] | null;
};

/**
 * 내가 등록한 매물 — **status 필터를 걸지 않는다**(공개/완료/보류를 한 화면에서 다룬다).
 *
 * 소유 필터를 왜 클라이언트에서 하는가: RLS로는 표현할 수 없다. properties에는
 * `properties_select_active_public`(status='active'면 anon/authenticated 모두 SELECT 허용)이
 * 있고, 공개 매물 목록·상세가 바로 그 정책으로 동작한다. 정책은 OR로 합쳐지므로
 * `properties_select_permitted`를 "본인 매물"로 좁혀도 공개 중인 매물은 여전히 누구에게나
 * 보인다 — 2026-09-11 이 화면에서 teststore가 관리자 매물까지 보고 있던 이유가 이것이다.
 *
 * 그래서 여기서 created_by로 거른다. 관리자는 예외로 전체를 본다(운영상 필요).
 * 이것은 화면 필터일 뿐 보안 경계가 아니다 — 남의 매물을 고치거나 지우는 것은
 * properties UPDATE 정책(created_by = auth.uid())이 서버에서 막는다.
 */
export async function listManagedProperties(): Promise<ManagedProperty[]> {
  if (!supabase) {
    return [];
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    return [];
  }

  let request = supabase
    .from("properties")
    .select("id,title,address,price,listing_type,status,featured,created_by,property_images(url,sort_order)")
    .order("created_at", { ascending: false });

  if (!(await isAdmin())) {
    request = request.eq("created_by", userId);
  }

  const { data, error } = await request;

  if (error) {
    console.warn("[services/properties] listManagedProperties failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as ManagedPropertyRow[]).map((row) => {
    const images = [...(row.property_images ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    return {
      id: row.id,
      title: row.title,
      address: row.address ?? "",
      price: formatPrice({ price: row.price, listing_type: row.listing_type }),
      status: row.status,
      featured: row.featured,
      thumbnailUrl: images[0]?.url ?? null,
    };
  });
}

/**
 * 공개/완료/보류 상태만 바꾼다(추천은 여기서 켜지 않는다 — 유료 서비스라 결제
 * 흐름을 거쳐야 하고, 그 설계는 아직 없다).
 *
 * 권한은 서버(properties UPDATE 정책)가 최종 판정한다.
 */
export async function updatePropertyStatus(
  id: string,
  status: ManagedPropertyStatus,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.from("properties").update({ status }).eq("id", id);

  if (error) {
    console.warn("[services/properties] updatePropertyStatus failed:", error.message);
    return false;
  }
  return true;
}

export async function getPropertyById(id: string): Promise<MockProperty | undefined> {
  if (!supabase) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.warn("[services/properties] getPropertyById failed:", error.message);
    return undefined;
  }
  if (!data) {
    return undefined;
  }
  return mapRowToMockProperty(data as unknown as PropertyRow);
}
