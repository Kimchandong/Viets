import type { ImageSourcePropType } from "react-native";
import { File } from "expo-file-system";

import { MOCK_PROPERTY_IMAGES, type PropertyImageCategory } from "@/constants/mockImages";
import { MOCK_REGIONS, type MockProperty, type MockPropertyCategory, type MockPropertyStatus } from "@/constants/mockData";
import { formatVndAmount } from "@/utils/format";
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
  property_images: PropertyImageRow[] | null;
};

const PROPERTY_SELECT =
  "id,title,description,category,listing_type,price,area,bedrooms,bathrooms,rental_yield,featured,amenities,address,latitude,longitude,property_images(url,sort_order)";

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
function formatPrice(row: PropertyRow): string {
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
 * RN(Android)에서 `fetch(localUri).then(r => r.blob())`는 로컬 파일을 온전히 읽지
 * 못해 업로드가 조용히 실패하는 경우가 있어, services/chat.ts의 이미지 전송과 동일하게
 * expo-file-system의 File.arrayBuffer()로 바이트를 직접 읽는다(2026-09-09 진단 결과 재사용).
 */
export async function uploadPropertyImage(localUri: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const file = new File(localUri);
    const arrayBuffer = await file.arrayBuffer();
    const extMatch = localUri.split("?")[0].match(/\.(\w+)$/);
    const fileExt = extMatch?.[1]?.toLowerCase() ?? "jpg";
    const contentType = fileExt === "png" ? "image/png" : "image/jpeg";
    // 경로 앞머리를 uploads/<timestamp>로 두는 이유: 매물 id는 등록 완료 전이라 아직
    // 없다. 파일명 충돌만 피하면 되고, 조회는 property_images.url로 하므로 경로 자체에
    // 의미를 두지 않는다.
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(PROPERTY_IMAGES_BUCKET)
      .upload(path, arrayBuffer, { contentType });

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

  const { data, error } = await supabase
    .from("properties")
    .insert({ ...input, currency: "VND" })
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
