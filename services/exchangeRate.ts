import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * [2026-09-28 사용자 지시] VND ↔ USD 환율.
 *
 * MY의 잔액 옆 버튼으로 통화를 바꾸면 **그때 환율로** 금액이 바뀌어야 한다.
 *
 * 무료·키 없는 공개 API를 쓴다(open.er-api.com). 키가 필요한 곳을 쓰면 그 키가 앱
 * 번들에 들어가고, 번들의 평문 키는 이미 한 번 문제가 됐다(translate 함수를 서버로
 * 옮긴 이유와 같다).
 *
 * 실패해도 화면이 멈추지 않는다:
 *   1. 이번 실행에서 받아 둔 값
 *   2. 지난 실행에서 저장해 둔 값(기기)
 *   3. 둘 다 없으면 null — 화면은 USD 버튼을 감춘다(틀린 환율을 보여 주느니 안 보여 준다)
 */
const API_URL = "https://open.er-api.com/v6/latest/USD";
const STORAGE_KEY = "viets.fx.vndPerUsd";
/** 다시 받아 오는 간격. 환율은 하루에 몇 번 움직이므로 1시간이면 충분하다. */
const TTL_MS = 60 * 60 * 1000;

let cachedRate: number | null = null;
let cachedAt = 0;
let inFlight: Promise<number | null> | null = null;

function isUsableRate(value: unknown): value is number {
  // VND는 1달러에 2만 남짓이다. 자릿수가 크게 벗어나면 받은 값이 잘못된 것이다.
  return typeof value === "number" && Number.isFinite(value) && value > 1000 && value < 1_000_000;
}

/** 지난 실행에서 저장해 둔 값을 먼저 올려 둔다(앱 시작 시 1회). */
export async function hydrateExchangeRate(): Promise<void> {
  if (cachedRate !== null) return;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = stored === null ? NaN : Number(stored);
    if (isUsableRate(parsed)) {
      cachedRate = parsed;
      // cachedAt은 그대로 0 — 저장값은 "지난번 값"이므로 곧 다시 받아 온다.
    }
  } catch {
    // 읽기 실패는 조용히 넘긴다 — 환율이 없으면 버튼만 안 보인다.
  }
}

/** 지금 쓸 수 있는 환율(1 USD = ? VND). 없으면 null. */
export function getVndPerUsd(): number | null {
  return cachedRate;
}

/**
 * 환율을 받아 온다. TTL 안이면 받아 오지 않고 가진 값을 돌려준다.
 * 동시에 여러 번 불러도 요청은 하나만 나간다.
 */
export async function refreshExchangeRate(): Promise<number | null> {
  if (cachedRate !== null && Date.now() - cachedAt < TTL_MS) return cachedRate;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) return cachedRate;
      const data = (await response.json()) as { rates?: Record<string, unknown> };
      const rate = data?.rates?.VND;
      if (!isUsableRate(rate)) return cachedRate;

      cachedRate = rate;
      cachedAt = Date.now();
      void AsyncStorage.setItem(STORAGE_KEY, String(rate)).catch(() => undefined);
      return cachedRate;
    } catch {
      // 네트워크가 없으면 가진 값을 그대로 쓴다.
      return cachedRate;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** VND 금액 → USD. 환율이 없으면 null. */
export function vndToUsd(amountVnd: number): number | null {
  if (cachedRate === null) return null;
  return amountVnd / cachedRate;
}
