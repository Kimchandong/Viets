import * as Location from "expo-location";

import { MOCK_REGIONS } from "@/constants/mockData";

/**
 * [2026-09-11 사용자 지시] 현위치 — 홈 상단 주소 표시 + 매물 거리순 정렬.
 *
 * 역지오코딩은 expo-location의 내장 기능(reverseGeocodeAsync)을 쓴다. Google
 * Geocoding API를 부르면 호출마다 과금되는데, 여기서 필요한 건 "구/시" 수준의
 * 짧은 이름 하나라 OS가 주는 값으로 충분하다.
 *
 * 권한을 거부하면 기본 위치로 넘어가지 않고 **지역을 고르게 한다**(사용자 결정).
 * 임의의 도시를 몰래 기준 삼으면 "가까운 순"이 거짓말이 된다.
 */

export type Coords = { latitude: number; longitude: number };

/** 위치를 어떻게 얻었는지 — 화면이 안내 문구를 고를 때 쓴다. */
export type LocationOrigin = "gps" | "region" | "none";

export type UserLocation = {
  origin: LocationOrigin;
  /** 화면에 보여 줄 짧은 주소(구/시). 못 얻으면 빈 문자열. */
  label: string;
  /** 거리 계산 기준점. 지역만 고른 경우 그 지역의 대표 좌표. */
  coords: Coords | null;
};

/**
 * 베트남 주요 지역 대표 좌표 — 권한 없이 지역만 고른 사용자의 거리 계산 기준점.
 *
 * constants/mockData.ts의 MOCK_REGIONS와 이름이 일치해야 한다(매물 region, 업체
 * region, 투자상품 region이 모두 그 목록을 쓴다). 목록에 없는 이름이 들어오면
 * 좌표가 없는 것으로 보고 거리순 대신 최신순으로 떨어진다.
 */
export const REGION_COORDS: Record<string, Coords> = {
  "TP. Hồ Chí Minh": { latitude: 10.7769, longitude: 106.7009 },
  "Hà Nội": { latitude: 21.0278, longitude: 105.8342 },
  "Hải Phòng": { latitude: 20.8449, longitude: 106.6881 },
  "Đà Nẵng": { latitude: 16.0544, longitude: 108.2022 },
  "Cần Thơ": { latitude: 10.0452, longitude: 105.7469 },
  "Huế": { latitude: 16.4637, longitude: 107.5909 },
};

/** 대표 좌표가 있는 지역만 고르게 한다 — 좌표가 없으면 거리순이 무의미하다. */
export function selectableRegions(): string[] {
  return MOCK_REGIONS.filter((region) => region in REGION_COORDS);
}

/**
 * 두 좌표 사이 거리(km) — 하버사인.
 *
 * 지도 라이브러리를 부르지 않는 이유: 목록을 정렬할 때 매물마다 한 번씩 계산하므로
 * 순수 함수여야 하고, 이 정확도(도시 안에서 수백 m 오차)면 "가까운 순"에 충분하다.
 */
export function distanceKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 화면에 표시할 거리 문구.
 *
 * [2026-09-11 사용자 지시] 단위는 항상 km로 통일한다 — 목록에서 "800m"과 "1.2km"가
 * 섞이면 어느 쪽이 가까운지 한눈에 비교되지 않는다.
 */
export function formatDistance(km: number): string {
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

/**
 * 현위치를 얻는다. 권한이 없거나 실패하면 origin: "none"을 돌려주고, 화면이
 * 지역 선택을 띄운다.
 *
 * 이미 있는 권한만 확인하고 요청은 하지 않는 모드(requestPermission: false)를 둔 이유:
 * 앱을 켜자마자 권한 창이 뜨면 무슨 기능인지 모른 채 거부하기 쉽다. 홈에서 위치를
 * 누르거나 거리순을 고를 때 요청한다.
 */
export async function getCurrentLocation(
  options: { requestPermission?: boolean } = {},
): Promise<UserLocation> {
  const empty: UserLocation = { origin: "none", label: "", coords: null };

  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.granted;

    if (!granted && options.requestPermission && existing.canAskAgain) {
      const asked = await Location.requestForegroundPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return empty;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const coords: Coords = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    return { origin: "gps", label: await reverseGeocode(coords), coords };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/location] getCurrentLocation failed:", message);
    return empty;
  }
}

/**
 * 좌표 → 짧은 주소. 실패하면 빈 문자열을 돌려주고 화면이 좌표를 숨긴다 —
 * "10.77, 106.70"을 보여 줘 봐야 읽을 수 없다.
 */
async function reverseGeocode(coords: Coords): Promise<string> {
  try {
    const places = await Location.reverseGeocodeAsync(coords);
    const place = places[0];
    if (!place) return "";

    // district(구) + city(시)가 가장 읽기 쉽다. 나라 이름은 뺀다 — 전부 베트남이다.
    const parts = [place.district ?? place.subregion, place.city ?? place.region].filter(
      (part): part is string => !!part && part.length > 0,
    );
    // 같은 값이 두 번 들어오는 기기가 있어 중복을 걷어낸다.
    return Array.from(new Set(parts)).join(", ");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/location] reverseGeocode failed:", message);
    return "";
  }
}

/** 사용자가 고른 지역을 위치로 삼는다(권한 거부 경로). */
export function locationFromRegion(region: string): UserLocation {
  return {
    origin: "region",
    label: region,
    coords: REGION_COORDS[region] ?? null,
  };
}
