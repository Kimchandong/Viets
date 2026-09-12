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
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
  if (!supabase) return;
  if (Platform.OS === "web") return;

  try {
    // 에뮬레이터는 토큰을 받을 수 없다 — 권한 창만 띄우고 실패하므로 아예 시도하지 않는다.
    if (!Device.isDevice) return;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) return;

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return;

    if (Platform.OS === "android") {
      // Android는 채널이 없으면 알림이 표시되지 않는다.
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = getProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) return;

    // [2026-09-12] 기기 언어를 함께 보낸다. 푸시는 앱 밖에서 표시되므로 보내는 쪽이
    // 받는 사람의 언어를 알아야 한다 — 예전에는 모든 사용자에게 한국어로 나갔다.
    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS,
      p_lang: (i18n.language ?? "").split("-")[0] || null,
    });
    if (error) {
      console.warn("[services/push] register_push_token failed:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/push] registerPushToken failed:", message);
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
] as const;

export function routeFromNotification(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { route?: unknown } | undefined;
  const route = typeof data?.route === "string" ? data.route : null;
  return route && (PUSH_ROUTES as readonly string[]).includes(route) ? route : null;
}

/** 알림 탭 구독. 해제 함수를 돌려준다. */
export function subscribeToNotificationTaps(onRoute: (route: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = routeFromNotification(response);
    if (route) onRoute(route);
  });
  return () => subscription.remove();
}
