import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import i18n from "@/i18n";
import { supabase } from "./supabase";

/**
 * [2026-09-12 사용자 지시] 푸시 알림 — 지금은 "광고비 잔액 소진" 한 종류.
 *
 * 토큰은 로그인한 사용자에게만 붙인다. 알림의 수신자는 "광고비를 낸 업체의 대표"라
 * 계정이 정해져야 보낼 곳을 알 수 있다.
 *
 * 실기기에서만 동작한다(Expo/Android 에뮬레이터·웹은 토큰을 발급하지 않는다) —
 * 실패해도 앱 흐름을 막지 않고 조용히 넘어간다. 알림 하나 때문에 로그인이 실패하는
 * 편이 훨씬 나쁘다.
 */

// 앱이 열려 있을 때도 알림을 띄운다 — 잔액 소진은 지금 바로 알아야 하는 내용이다.
/**
 * [2026-09-28 사용자 지시] "읽고 있는 상태가 아니라면 알림은 울려야 한다."
 *
 * 뒤집으면: **읽고 있는 중이면 울리지 않아야 한다.** 상담방을 열어 두고 대화하는
 * 동안 메시지마다 배너가 덮이면 쓸 수가 없다.
 *
 * 서버는 이 사실을 알 수 없다 — 지금 무슨 화면을 보고 있는지는 앱만 안다. 그래서
 * 발송은 언제나 하고(그래야 유실되지 않는다) 표시만 여기서 거른다.
 *
 * 목록에는 남기고 배너와 소리만 끈다 — 화면을 벗어난 뒤 확인할 수 있어야 한다.
 */
let activeRoute: string | null = null;

/** 지금 보고 있는 화면의 알림 경로. 화면이 사라질 때 null로 되돌린다. */
export function setActiveNotificationRoute(route: string | null): void {
  activeRoute = route;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as { route?: unknown } | undefined;
    const route = typeof data?.route === "string" ? data.route : null;
    const reading = route !== null && route === activeRoute;
    return {
      shouldShowBanner: !reading,
      shouldShowList: true,
      shouldPlaySound: !reading,
      shouldSetBadge: false,
    };
  },
});

/**
 * [2026-09-26] 푸시 등록이 **어디서 멈췄는지** 남긴다.
 *
 * 왜 필요했나: 이 함수는 실패해도 조용히 넘어간다(알림 하나 때문에 로그인이 막히면
 * 안 되므로 — 아래 주석 참고). 그 판단 자체는 맞지만, 대신 **왜 실패했는지 알 방법이
 * 전혀 없었다.** 실제로 관리자 계정에 토큰이 끝내 생기지 않았는데,
 * console.warn은 실기기 릴리스 빌드에서 아무 데도 보이지 않아 원인을 못 찾았다
 * (권한 거부인지, 에뮬레이터인지, 토큰 발급 실패인지 구분 불가).
 *
 * 그래서 흐름은 그대로 두고 **마지막 결과만 메모리에 남긴다.** 알림 화면이 이 값을
 * 읽어 한 줄로 보여 준다. 저장하지 않는 이유: 앱을 다시 켜면 어차피 다시 시도하므로
 * 지난 실패를 남겨 둘 이유가 없고, 저장할 곳을 만들면 DB 스키마가 늘어난다.
 */
export type PushRegistrationStatus = {
  /** ok=등록됨, skipped=시도할 조건이 아님(웹·에뮬레이터 등), failed=시도했으나 실패 */
  state: "idle" | "ok" | "skipped" | "failed";
  /** 사람이 읽을 사유. 화면에 그대로 나간다. */
  reason: string;
};

let lastStatus: PushRegistrationStatus = { state: "idle", reason: "아직 시도하지 않음" };

/** 마지막 푸시 등록 시도의 결과. 알림 화면이 읽는다. */
export function getPushRegistrationStatus(): PushRegistrationStatus {
  return lastStatus;
}

function mark(state: PushRegistrationStatus["state"], reason: string): void {
  lastStatus = { state, reason };
  if (state === "failed") {
    console.warn(`[services/push] ${reason}`);
  }
}

/** app.json의 EAS projectId — 새 Expo 푸시 토큰 발급에 필요하다. */
function getProjectId(): string | undefined {
  const fromEas = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
  return fromEas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/**
 * 권한을 확인(필요하면 요청)하고 토큰을 서버에 등록한다.
 * 로그인 직후와 앱 시작 시 호출한다 — 같은 토큰을 다시 넣어도 upsert라 안전하다.
 */
export async function registerPushToken(): Promise<void> {
  if (!supabase) {
    mark("skipped", "Supabase 연결 없음(환경변수 누락)");
    return;
  }
  if (Platform.OS === "web") {
    mark("skipped", "웹에서는 푸시 토큰이 발급되지 않습니다");
    return;
  }

  try {
    // 에뮬레이터는 토큰을 받을 수 없다 — 권한 창만 띄우고 실패하므로 아예 시도하지 않는다.
    if (!Device.isDevice) {
      mark("skipped", "에뮬레이터에서는 푸시 토큰이 발급되지 않습니다(실기기 필요)");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      mark("skipped", "로그인 상태가 아닙니다");
      return;
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) {
      mark(
        "failed",
        existing.canAskAgain
          ? "알림 권한을 허용하지 않았습니다"
          : "알림 권한이 거부되어 있습니다 — 휴대폰 설정 > 앱 > D & D > 알림에서 켜 주세요",
      );
      return;
    }

    if (Platform.OS === "android") {
      // Android는 채널이 없으면 알림이 표시되지 않는다.
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = getProjectId();
    if (!projectId) {
      // 없어도 시도는 한다(구버전 호환). 다만 실패하면 이게 원인일 가능성이 높으므로
      // 사유에 남는다.
      mark("failed", "app.json의 extra.eas.projectId를 찾지 못했습니다");
    }
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) {
      mark("failed", "Expo가 빈 토큰을 돌려주었습니다");
      return;
    }

    // [2026-09-12] 기기 언어를 함께 보낸다. 푸시는 앱 밖에서 표시되므로 보내는 쪽이
    // 받는 사람의 언어를 알아야 한다 — 예전에는 모든 사용자에게 한국어로 나갔다.
    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS,
      p_lang: (i18n.language ?? "").split("-")[0] || null,
    });
    if (error) {
      mark("failed", `서버 등록 실패: ${error.message}`);
      return;
    }
    mark("ok", `등록됨 (${Platform.OS}, ${token.slice(0, 18)}…)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    // 여기로 오는 대표 사례가 getExpoPushTokenAsync 실패다(FCM 자격증명 미등록 등).
    // 메시지를 그대로 노출한다 — 요약하면 원인을 못 찾는다.
    mark("failed", `토큰 발급 실패: ${message}`);
  }
}

/**
 * 알림을 눌렀을 때 이동할 경로. 보내는 쪽(엣지 함수)이 data.route에 넣는다.
 *
 * **허용 목록으로 막는다** — 임의의 문자열로 router.push를 부르면 없는 화면으로 가서
 * 앱이 죽는다. 푸시 내용은 서버가 넣지만, 목록으로 두면 나중에 경로를 지웠을 때도 안전하다.
 */
const PUSH_ROUTES = [
  "/my",
  "/notifications",
  "/payment-info",
  "/ad-manage",
  "/boards",
  // [2026-09-16 실기기 제보 — 결함 수정] 관리자에게 가는 알림의 목적지가 빠져 있었다.
  //
  // notify_payment_requested 트리거는 link를 '/admin-payments'로 넣는데 이 목록에
  // 없어서, 관리자가 푸시를 눌러도 routeFromNotification이 null을 돌려주고 **아무 일도
  // 일어나지 않았다**. 알림은 도착했는데 눌러도 반응이 없으니 "안 온다"로 읽힌다.
  //
  // 지금 쓰이는 링크만 넣지 않고, 관리자 화면 네 곳을 함께 넣는다 — 앞으로 알림이
  // 늘어날 때마다 이 목록을 다시 찾아 고치는 일을 줄인다. 목록으로 막는 이유는
  // 그대로다(없는 화면으로 보내면 앱이 죽는다).
  "/admin-payments",
  "/admin-agencies",
  "/admin-reports",
  "/admin-boards",
  "/chat-inbox",
] as const;

/**
 * [2026-09-27] 뒤에 id가 붙는 경로는 **접두사로** 허용한다.
 *
 * 관리자 푸시 메시지는 /push-message/<uuid>로 간다 — 목록에 정확히 적어 둘 수 없는
 * 형태다. 그렇다고 아무 문자열이나 통과시키면 없는 화면으로 가서 앱이 죽으므로,
 * 허용된 접두사 + 그 뒤에 한 조각만 더 오는 경우로 좁힌다.
 */
// [2026-09-28] /invest-chat/<대화방 id> — 투자 상담 알림을 눌러 들어가는 곳.
// 이 목록에 없으면 알림을 눌러도 아무 데도 가지 않는다(isAllowedRoute가 막는다).
const PUSH_ROUTE_PREFIXES = ["/push-message/", "/invest-chat/"] as const;

function isAllowedRoute(route: string): boolean {
  if ((PUSH_ROUTES as readonly string[]).includes(route)) return true;
  return PUSH_ROUTE_PREFIXES.some((prefix) => {
    if (!route.startsWith(prefix)) return false;
    const rest = route.slice(prefix.length);
    // 한 조각만 — 슬래시가 더 있으면 우리가 아는 경로가 아니다.
    return rest.length > 0 && !rest.includes("/");
  });
}

export function routeFromNotification(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { route?: unknown } | undefined;
  const route = typeof data?.route === "string" ? data.route : null;
  return route && isAllowedRoute(route) ? route : null;
}

/** 알림 탭 구독. 해제 함수를 돌려준다. */
export function subscribeToNotificationTaps(onRoute: (route: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = routeFromNotification(response);
    if (route) onRoute(route);
  });
  return () => subscription.remove();
}
