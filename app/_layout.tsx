import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { initI18n } from "@/i18n";

// STEP 03 범위: Navigation/Provider 골격만 구성한다. Supabase 클라이언트,
// 인증 상태, 실제 화면 로직은 다음 단계(Phase 2 이후)에서 연결한다.

const queryClient = new QueryClient();

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n();
    setI18nReady(true);
  }, []);

  if (!i18nReady) {
    // i18n 초기화는 동기적으로 완료되므로 실제로는 한 프레임 내에 끝난다.
    // 추후 폰트/에셋 프리로딩이 추가되면 이 자리에서 함께 대기한다.
    return null;
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
