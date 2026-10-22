import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/Button";
import { EmbeddedScreen } from "@/components/EmbeddedScreen";
import { Header } from "@/components/Header";
import { createScaledStyles, colors, opacity, spacing, textStyles, FONT_FACTOR, scaleFont } from "@/constants/theme";

export type ManageTab = {
  key: string;
  label: string;
  render: () => React.ReactNode;
};

/**
 * [2026-10-22 사용자 지시] MY 운영 메뉴를 "메뉴 클릭 → 탭 전환" 구조로.
 *
 * 탭 내용은 대부분 이미 있는 화면을 그대로 끼워 넣는다(EmbeddedScreen이 그 화면의
 * Header를 숨긴다 — 자세한 이유는 components/EmbeddedScreen.tsx 주석).
 *
 * 탭을 바꿀 때 그리지 않던 탭은 **렌더하지 않는다.** 전부 그려 두고 숨기면 화면 하나를
 * 열 때마다 서너 화면이 동시에 조회를 날린다.
 */
export function ManageTabsScreen({
  title,
  tabs,
  initialKey,
  footerLabel,
  onFooterPress,
}: {
  title: string;
  tabs: ManageTab[];
  /** 처음 열 탭. 없거나 목록에 없는 값이면 첫 탭을 연다. */
  initialKey?: string;
  footerLabel?: string;
  onFooterPress?: () => void;
}) {
  const theme = colors.light;
  const [activeKey, setActiveKey] = useState(
    tabs.some((tab) => tab.key === initialKey) ? (initialKey as string) : (tabs[0]?.key ?? ""),
  );
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={title} leftAction={<BackButton fallback="/my" />} />

      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        {tabs.map((tab) => {
          const selected = tab.key === active?.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveKey(tab.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.tab,
                selected && { borderBottomColor: theme.accent },
                { opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text
                style={[
                  textStyles.bodySmall,
                  styles.tabLabel,
                  { color: selected ? theme.accent : theme.secondaryText, fontWeight: selected ? "700" : "400" },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.body}>
        <EmbeddedScreen>{active?.render()}</EmbeddedScreen>
      </View>

      {footerLabel && onFooterPress ? (
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <Button title={footerLabel} onPress={onFooterPress} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabLabel: {
    fontSize: scaleFont(16, FONT_FACTOR.BODY),
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
}));
