import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles } from "@/constants/theme";

// STEP 4-9B — AI UI 레이아웃 기반. 실제 LLM/RAG 호출(ai-property-search, generate-embedding
// 등, Phase 6 범위)은 구현하지 않는다. "전송" 시 1초 정도의 로딩을 흉내낸 뒤
// "아직 준비되지 않았다"는 상태를 보여줄 뿐, 가짜 AI 답변을 만들어 보여주지 않는다.

const SUGGESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;
const RECENT_KEYS = ["q1", "q2", "q3"] as const;

export default function AiScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면 —
  // 실제 LLM 미연결 상태는 기존과 동일하게 명확히 표시한다)
  const theme = colors.light;
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function handleSend(text?: string) {
    const value = (text ?? query).trim();
    if (!value) return;
    setQuery(value);
    setSubmittedQuery(value);
    setLoading(true);
    setTimeout(() => setLoading(false), 900);
  }

  function handleReset() {
    setSubmittedQuery(null);
    setQuery("");
  }

  function handleVoicePress() {
    setToast(t("common.comingSoon"));
    setTimeout(() => setToast(null), 1600);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("ai.title")} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.greeting}>
          <View style={[styles.greetingIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="sparkles-outline" size={22} color={theme.accent} />
          </View>
          <Text style={[textStyles.screenTitle, { color: theme.text }]}>{t("ai.greetingTitle")}</Text>
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
            {t("ai.greetingSubtitle")}
          </Text>
        </View>

        <View style={[styles.inputCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("ai.inputPlaceholder")}
            placeholderTextColor={theme.secondaryText}
            multiline
            style={[textStyles.body, styles.input, { color: theme.text }]}
            accessibilityLabel={t("ai.inputPlaceholder")}
          />
          <View style={styles.inputActions}>
            <Pressable
              onPress={handleVoicePress}
              accessibilityRole="button"
              accessibilityLabel={t("ai.voiceHint")}
              style={({ pressed }) => [
                styles.roundButton,
                { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="mic-outline" size={18} color={theme.secondaryText} />
            </Pressable>
            <Pressable
              onPress={() => handleSend()}
              accessibilityRole="button"
              accessibilityLabel={t("ai.sendLabel")}
              style={({ pressed }) => [
                styles.roundButton,
                { backgroundColor: theme.accent, borderColor: theme.accent, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="arrow-up" size={18} color={theme.onAccent} />
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("ai.suggestedTitle")}</Text>
          <View style={styles.chipsWrap}>
            {SUGGESTION_KEYS.map((key) => {
              const label = t(`ai.suggestions.${key}`);
              return (
                <Pressable
                  key={key}
                  onPress={() => handleSend(label)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Text style={[textStyles.bodySmall, { color: theme.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("ai.recentTitle")}</Text>
          <View style={styles.stack}>
            {RECENT_KEYS.map((key) => {
              const label = t(`ai.recent.${key}`);
              return (
                <Pressable
                  key={key}
                  onPress={() => handleSend(label)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.recentRow,
                    { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Ionicons name="time-outline" size={16} color={theme.secondaryText} />
                  <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                    {label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.secondaryText} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.section, styles.responseSection]}>
          {loading ? (
            <Loading message={t("ai.thinking")} />
          ) : submittedQuery ? (
            <EmptyState
              title={t("ai.notReadyTitle")}
              description={t("ai.notReadyDescription", { query: submittedQuery })}
              action={<Button title={t("ai.resetLabel")} variant="outline" size="small" onPress={handleReset} />}
            />
          ) : (
            <EmptyState title={t("ai.emptyTitle")} description={t("ai.emptyDescription")} />
          )}
        </View>
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09-7] 사용자 재확인 — home/property/invest 3개 탭 화면과
  // 동일한 영역 간 간격(md=16)으로 통일해, 5개 탭 화면이 모두 같은 기준으로
  // "영역과 영역 사이"가 구분되도록 한다(영역 내부 간격은 sm=8로 공통).
  content: {
    // 사용자 요청: 화면 좌우 여백을 10px로 변경(세로 여백/gap은 기존 유지)
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  greeting: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  greetingIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  inputCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  input: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  inputActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: spacing.sm,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  stack: {
    gap: spacing.sm,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  responseSection: {
    marginBottom: spacing.lg,
  },
});
