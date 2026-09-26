/**
 * [2026-09-26 사용자 지시] 베트남 행정구역 — 시(직할시) · 성(tỉnh).
 *
 * 왜 새로 만들었나: 기존 `MOCK_REGIONS`(constants/mockData.ts)는 6개뿐이었고
 * 그나마 "대표 도시" 목록이지 행정구역이 아니었다. 사용자 지시가
 * "베트남 지역구분이름으로 찾아서 변경"이라 실제 행정 단위로 맞춘다.
 *
 * ── 중요 ──────────────────────────────────────────────────────────────────
 * 베트남은 2025년 7월 1일자 행정 개편으로 **63개 → 34개**로 통합됐다.
 * (직할시 6 + 성 28). 옛 63개 목록을 쓰면 이미 없어진 성 이름이 뜬다.
 * 이름은 베트남어 표기(성조 포함) 그대로 둔다 — 번역하지 않는다.
 * 주소·매물 데이터가 베트남어로 들어오므로 표기가 어긋나면 매칭이 깨진다.
 *
 * 매칭 주의: 기존 매물의 `province` 값은 옛 MOCK_REGIONS 표기
 * ("TP. Hồ Chí Minh" 등)로 들어가 있다. 그래서 아래 목록의 `match`에
 * 그 표기를 함께 담아 둔다 — 화면은 `name`을 보여 주고, 필터는 `match`의
 * 어느 하나라도 걸리면 통과시킨다.
 */

export type VietnamRegion = {
  /** 화면에 보여 줄 공식 명칭(베트남어). */
  name: string;
  /** 직할시(thành phố trực thuộc trung ương) 여부. 목록 위쪽에 모아 보여 준다. */
  municipality?: boolean;
  /**
   * 이 지역으로 볼 표기들. 기존 데이터가 다른 표기로 저장돼 있을 수 있어
   * 별칭을 함께 둔다(빈 배열이면 name만으로 본다).
   */
  match?: string[];
};

/** 직할시 6곳 — 2025년 개편 이후. */
export const VIETNAM_MUNICIPALITIES: VietnamRegion[] = [
  { name: "TP. Hồ Chí Minh", municipality: true, match: ["Hồ Chí Minh", "Ho Chi Minh", "HCM", "Sài Gòn"] },
  { name: "Hà Nội", municipality: true, match: ["Ha Noi", "Hanoi"] },
  { name: "Hải Phòng", municipality: true, match: ["Hai Phong"] },
  { name: "Đà Nẵng", municipality: true, match: ["Da Nang"] },
  { name: "Huế", municipality: true, match: ["Thừa Thiên Huế", "Hue"] },
  { name: "Cần Thơ", municipality: true, match: ["Can Tho"] },
];

/** 성(tỉnh) 28곳 — 2025년 개편 이후. 베트남어 가나다(알파벳) 순. */
export const VIETNAM_PROVINCES: VietnamRegion[] = [
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

/** 시 → 성 순서로 이어 붙인 전체 34곳. 선택 목록은 이 순서를 쓴다. */
export const VIETNAM_REGIONS: VietnamRegion[] = [
  ...VIETNAM_MUNICIPALITIES,
  ...VIETNAM_PROVINCES,
];

/**
 * 어떤 매물이 이 지역에 속하는지 판정한다.
 *
 * 정확히 같은지만 보면 안 된다 — 기존 데이터의 province가 "TP. Hồ Chí Minh"인데
 * 목록에서 "Hồ Chí Minh"을 골랐거나 그 반대인 경우가 실제로 있다. name과 match를
 * 모두 후보로 두고, 양쪽 문자열 어느 쪽이 다른 쪽을 포함하면 같은 지역으로 본다.
 */
export function regionMatches(region: VietnamRegion, ...values: (string | null | undefined)[]): boolean {
  const candidates = [region.name, ...(region.match ?? [])].map((c) => c.toLowerCase());
  return values.some((raw) => {
    if (!raw) return false;
    const value = raw.toLowerCase();
    return candidates.some((c) => value.includes(c) || c.includes(value));
  });
}

/** 이름으로 지역을 찾는다(주소 파라미터로 넘어온 문자열 복원용). */
export function findRegionByName(name: string | null | undefined): VietnamRegion | null {
  if (!name) return null;
  return VIETNAM_REGIONS.find((r) => r.name === name) ?? null;
}
