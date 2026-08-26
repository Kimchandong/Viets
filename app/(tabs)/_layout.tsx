import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useColorScheme } from "react-native";

import { colors } from "@/constants/theme";

// Bottom Navigation: HOME / PROPERTY / INVEST / AI / MY (마스터 프롬프트 3번,
// ARCHITECTURE.md §2.3). STEP 03 범위는 route architecture만 — 각 탭의 실제
// 화면 구현은 해당 Phase(4/5/6/9)에서 진행한다.

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: "home-outline",
  property: "business-outline",
  invest: "trending-up-outline",
  ai: "sparkles-outline",
  my: "person-outline",
};

export default function TabsLayout() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? "light";
  const theme = colors[scheme];

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.secondaryText,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS.home} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="property"
        options={{
          title: t("tabs.property"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS.property} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="invest"
        options={{
          title: t("tabs.invest"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS.invest} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t("tabs.ai"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS.ai} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: t("tabs.my"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS.my} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
