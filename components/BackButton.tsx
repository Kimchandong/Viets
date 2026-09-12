import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

import { colors, opacity } from "@/constants/theme";

/**
 * [2026-09-12 사용자 제보] "뒤로가기가 안 되는 화면이 많다."
 *
 * 원인: router.back()은 **되돌아갈 기록이 있을 때만** 동작한다. 그런데 기록이
 * 사라지는 경우가 흔하다 —
 *   · 웹 미리보기가 새로고침되면(코드 저장, 새로고침) 현재 주소에서 다시 시작한다
 *   · 푸시 알림이나 링크로 특정 화면에 곧바로 들어온 경우
 *   · router.replace로 들어온 화면(앞 화면이 스택에서 치워진다)
 * 이때 back()은 예외도 없이 조용히 아무 일도 하지 않아, 화면이 멈춘 것처럼 보인다.
 *
 * 그래서 화면마다 복사돼 있던 BackButton을 이 하나로 모으고, 기록이 없으면 fallback
 * 경로로 대신 보낸다. 화면이 20곳이라 각자 고치면 또 어딘가는 빠진다.
 */
export type BackButtonProps = {
  /** 되돌아갈 기록이 없을 때 갈 곳. 기본값은 홈. */
  fallback?: string;
  /** 아이콘 색. 사진 위에 얹는 화면(매물 상세 등)은 흰색을 넘긴다. */
  color?: string;
  size?: number;
  accessibilityLabel?: string;
};

export function BackButton({ fallback = "/home", color, size = 24, accessibilityLabel }: BackButtonProps) {
  const theme = colors.light;
  const router = useRouter();

  function handlePress() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // typedRoutes를 쓰므로 임의 문자열은 타입이 맞지 않는다 — 호출부가 넘긴 값만
    // 신뢰하고 캐스팅한다(존재하지 않는 경로를 넘기면 그 화면에서 바로 드러난다).
    router.replace(fallback as "/home");
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
    >
      <Ionicons name="chevron-back" size={size} color={color ?? theme.text} />
    </Pressable>
  );
}
