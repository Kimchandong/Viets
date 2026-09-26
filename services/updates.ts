import { Platform } from "react-native";
import * as Updates from "expo-updates";

/**
 * [2026-09-26 사용자 지시] OTA(무선 업데이트) — 앱을 다시 켜면 최신 수정이 바로 적용되게.
 *
 * ── 왜 이 파일이 따로 있나 ────────────────────────────────────────────────
 * 처음에는 _layout.tsx 안에서 checkForUpdateAsync → fetch → reload만 하고 실패는
 * catch {}로 삼켰다. 동작은 맞지만 **실패해도 아무 표시가 없다.** 푸시 토큰 등록에서
 * 정확히 그 함정에 빠져, 실기기에서 등록이 안 되는데 원인을 끝내 못 찾았다.
 *
 * 그래서 흐름은 그대로 두되(업데이트 확인 때문에 앱이 안 켜지면 안 된다) **마지막
 * 결과를 남긴다.** 알림 화면이 이 값을 읽어 한 줄로 보여 준다.
 */

export type UpdateState =
  | "idle"        // 아직 확인 안 함
  | "checking"    // 확인 중
  | "latest"      // 최신 — 받을 것 없음
  | "applying"    // 새 번들을 받아 적용하는 중(곧 재시작)
  | "disabled"    // 이 빌드에서는 OTA가 꺼져 있음(개발 모드/웹)
  | "failed";     // 확인 또는 적용 실패

export type UpdateStatus = { state: UpdateState; reason: string };

let last: UpdateStatus = { state: "idle", reason: "아직 확인하지 않음" };

export function getUpdateStatus(): UpdateStatus {
  return last;
}

/**
 * 이 빌드가 어느 업데이트 줄기를 보고 있는지. 빌드가 OTA를 제대로 물고 있는지
 * **눈으로 확인하는 용도**다 — 채널이 비어 있으면 eas update를 올려도 이 앱에는 오지 않는다.
 */
export function describeUpdateRuntime(): string {
  if (Platform.OS === "web") return "웹 — OTA 해당 없음";
  const parts = [
    `채널 ${Updates.channel ?? "(없음)"}`,
    `런타임 ${Updates.runtimeVersion ?? "(없음)"}`,
    Updates.isEmbeddedLaunch ? "빌드에 포함된 번들 실행 중" : "OTA로 받은 번들 실행 중",
  ];
  if (Updates.updateId) parts.push(`번들 ${Updates.updateId.slice(0, 8)}`);
  return parts.join(" · ");
}

/**
 * 새 번들이 있으면 받아서 **바로 적용**한다(앱이 한 번 재시작된다).
 *
 * 기본 동작은 "다음 실행부터 적용"이라 사용자가 앱을 두 번 껐다 켜야 한다.
 * 고친 것이 바로 안 보이면 "고쳤는데 그대로"로 읽히므로 받은 자리에서 재시작한다.
 *
 * 실패해도 예외를 던지지 않는다 — 앱은 지금 가진 번들로 그냥 실행돼야 한다.
 */
export async function checkAndApplyUpdate(): Promise<UpdateStatus> {
  if (Platform.OS === "web") {
    last = { state: "disabled", reason: "웹에서는 OTA를 쓰지 않습니다" };
    return last;
  }
  if (__DEV__) {
    // 개발 중에는 Metro가 번들을 준다. 여기서 reload를 걸면 개발 서버와 싸운다.
    last = { state: "disabled", reason: "개발 모드 — OTA 건너뜀" };
    return last;
  }
  if (!Updates.isEnabled) {
    last = { state: "disabled", reason: "이 빌드는 OTA가 꺼져 있습니다(app.json의 updates 설정 확인)" };
    return last;
  }

  last = { state: "checking", reason: "업데이트 확인 중…" };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      last = { state: "latest", reason: `최신입니다 · ${describeUpdateRuntime()}` };
      return last;
    }
    last = { state: "applying", reason: "새 버전을 받는 중…" };
    await Updates.fetchUpdateAsync();
    last = { state: "applying", reason: "적용 중 — 앱이 곧 다시 시작됩니다" };
    await Updates.reloadAsync();
    return last;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    last = { state: "failed", reason: `업데이트 실패: ${message}` };
    return last;
  }
}
