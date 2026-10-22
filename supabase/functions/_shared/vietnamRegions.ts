/**
 * [2026-10-20] 베트남 행정구역 — **constants/vietnamRegions.ts의 사본**.
 *
 * 왜 사본인가: 수집 엔진은 Deno 엣지 함수라 앱의 `@/constants/*`를 import할 수
 * 없다. 대안은 지역 목록을 DB 표로 옮기는 것인데, `public.locations` 표는 존재하지만
 * **데이터가 들어 있지 않다**(seed 마이그레이션이 없다). 지금 그 표를 채우는 일까지
 * 끌어오면 수집 엔진 작업이 행정구역 마스터 정리 작업으로 번진다.
 *
 * 그래서 pushText.ts와 같은 방식으로 사본을 둔다 — 마음에 드는 구조는 아니지만,
 * 이 파일이 틀리면 지역 추출이 앱의 지역 필터와 어긋난다는 점이 중요하다. 한쪽을
 * 고치면 양쪽을 함께 고친다.
 *
 * 2025-07-01 행정 개편으로 63개 → 34개(직할시 6 + 성 28)로 통합됐다. 옛 63개
 * 목록을 쓰면 이미 없어진 성 이름이 추출된다.
 *
 * 추출 결과는 `articles.region`(text)에 그대로 넣는다. `location_id`는 위 사정으로
 * 당장 NULL이다 — 행정구역 마스터를 채우면 그때 매칭을 붙인다.
 */

export type Region = {
  /** 화면에 보여 줄 공식 명칭. articles.region에 이 값이 들어간다. */
  name: string;
  /** 본문에서 이 지역으로 볼 표기들. 성조 없는 표기·약칭·구 명칭. */
  match?: string[];
};

/** 직할시 6곳. 기사에 가장 자주 나오므로 먼저 본다. */
const MUNICIPALITIES: Region[] = [
  { name: "TP. Hồ Chí Minh", match: ["Hồ Chí Minh", "Ho Chi Minh", "HCM", "Sài Gòn", "TPHCM", "TP.HCM"] },
  { name: "Hà Nội", match: ["Ha Noi", "Hanoi"] },
  { name: "Hải Phòng", match: ["Hai Phong"] },
  { name: "Đà Nẵng", match: ["Da Nang"] },
  { name: "Huế", match: ["Thừa Thiên Huế", "Hue"] },
  { name: "Cần Thơ", match: ["Can Tho"] },
];

/** 성 28곳 — 2025년 개편 이후. */
const PROVINCES: Region[] = [
  { name: "An Giang" },
  { name: "Bắc Ninh" },
  { name: "Cà Mau" },
  { name: "Cao Bằng" },
  { name: "Điện Biên" },
  { name: "Đắk Lắk" },
  { name: "Đồng Nai" },
  { name: "Đồng Tháp" },
  { name: "Gia Lai" },
  { name: "Hà Tĩnh" },
  { name: "Hưng Yên" },
  { name: "Khánh Hòa" },
  { name: "Lai Châu" },
  { name: "Lâm Đồng" },
  { name: "Lạng Sơn" },
  { name: "Lào Cai" },
  { name: "Nghệ An" },
  { name: "Ninh Bình" },
  { name: "Phú Thọ" },
  { name: "Quảng Ngãi" },
  { name: "Quảng Ninh" },
  { name: "Quảng Trị" },
  { name: "Sơn La" },
  { name: "Tây Ninh" },
  { name: "Thái Nguyên" },
  { name: "Thanh Hóa" },
  { name: "Tuyên Quang" },
  { name: "Vĩnh Long" },
];

export const REGIONS: Region[] = [...MUNICIPALITIES, ...PROVINCES];

/**
 * 제목·요약에서 지역을 찾는다. 못 찾으면 null — **추측하지 않는다.**
 *
 * 직할시를 먼저 보는 이유: "Đông Anh, Hà Nội"처럼 구역명과 시명이 함께 나오는
 * 경우가 많고, 이때 알고 싶은 것은 시다. 성 목록을 먼저 돌면 이름이 겹치는
 * 성("Hà Tĩnh" vs "Hà Nội")에서 엉뚱한 값이 먼저 걸릴 수 있다.
 *
 * 비교 전에 소문자로만 내린다. 성조를 벗기지 않는 이유는 성조를 벗기면
 * "Hải"와 "Hai"가 같아지면서 서로 다른 지역이 겹치기 때문이다 — 대신 성조 없는
 * 표기를 match에 직접 넣어 둔다.
 */
export function extractRegion(...texts: (string | null | undefined)[]): string | null {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.length === 0) return null;

  for (const region of REGIONS) {
    const candidates = [region.name, ...(region.match ?? [])];
    for (const candidate of candidates) {
      if (haystack.includes(candidate.toLowerCase())) {
        return region.name;
      }
    }
  }
  return null;
}
