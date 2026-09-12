import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Toast } from "@/components/Toast";
import { PropertyListRow } from "@/components/PropertyListRow";
import { SectionHeader } from "@/components/SectionHeader";
import {
  colors,
  createScaledStyles,
  opacity,
  radius,
  spacing,
  textStyles,
} from "@/constants/theme";
import { formatVndAmount } from "@/utils/format";
import {
  clearRecentQueries,
  loadRecentQueries,
  pushRecentQuery,
  rerunWithout,
  runAiSearch,
  type AiSearchResult,
  type ParsedCondition,
} from "@/services/aiSearch";

/**
 * [2026-09-12 사용자 지시] AI 탭 — 실제로 찾아 주는 화면으로 바꾼다.
 *
 * 이전 화면은 입력창·추천 질문·"최근 검색"이 있었지만 셋 다 실체가 없었다. 보내면 900ms
 * 로딩을 흉내 낸 뒤 "준비 중"만 떴고, 최근 검색 세 줄은 i18n에 박힌 고정 문구였다.
 *
 * 이제 문장에서 조건을 뽑아(services/aiSearch.ts) 실제 매물·투자상품을 찾는다.
 *
 * 화면에서 지킨 두 가지:
 *
 * 1. **무엇으로 찾았는지 보여 준다.** 규칙 기반 해석이라 틀릴 수 있다. 뽑아낸 조건을
 *    칩으로 늘어놓고, 각 칩을 눌러 끌 수 있게 했다 — 잘못 읽었을 때 질문을 처음부터
 *    다시 치지 않아도 된다.
 * 2. **없는 말을 지어내지 않는다.** "이 지역이 유망합니다" 같은 판단은 하지 않는다.
 *    찾은 결과만 내놓고, 해석은 사용자 몫으로 둔다.
 *
 * [2026-09-12 사용자 지시] 음성 버튼을 실제로 동작시킨다. 예전에는 눌러도 "준비 중"
 * 토스트만 떴다. 이제 기기의 음성 인식기(Android SpeechRecognizer / iOS SFSpeechRecognizer
 * / 웹 Web Speech API)로 받아 적고, 말이 끝나면 그대로 검색까지 이어 간다.
 */

/** 조건 추출로 실제 찾을 수 있는 예시들. 분석형 질문("어디가 유망한가요")은 넣지 않는다. */
const SUGGESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

/**
 * 앱 언어 → 음성 인식에 넘길 BCP-47 태그.
 *
 * 인식기는 "무슨 말을 들을지" 미리 알아야 정확도가 크게 올라간다. 앱 언어를 그대로
 * 쓰는 이유는, 앱을 한국어로 쓰는 사람이 한국어로 말할 가능성이 가장 높기 때문이다.
 */
const SPEECH_LOCALES: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  vi: "vi-VN",
  ja: "ja-JP",
  zh: "zh-CN",
  th: "th-TH",
};

export default function AiScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면)
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();

  // [2026-09-11 사용자 지시] 홈 검색창의 AI 버튼에서 넘어올 때 적어 둔 말을 받는다 —
  // 홈에서 친 것을 여기서 다시 치게 만들 이유가 없다.
  const { q } = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiSearchResult | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // --- 음성 입력 ---
  //
  // listening: 지금 듣고 있는가(버튼 모양과 안내 문구가 이 값을 따른다).
  // speechAvailable: 이 기기에 인식기가 있는가. 없으면 버튼 자체를 그리지 않는다 —
  //   눌러도 안 되는 버튼을 남겨 두는 것이 예전 "준비 중" 버튼과 같은 실수다.
  // spokenRef: 인식된 마지막 문장. end 이벤트에서 바로 검색으로 넘기는데, 그 시점에
  //   setState가 아직 반영되지 않았을 수 있어 ref로 따로 들고 있는다.
  const [listening, setListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const spokenRef = useRef("");

  useEffect(() => {
    void loadRecentQueries().then(setRecent);
  }, []);

  useEffect(() => {
    try {
      setSpeechAvailable(ExpoSpeechRecognitionModule.isRecognitionAvailable());
    } catch {
      // 모듈이 없는 환경(예: 네이티브 모듈이 빠진 빌드)에서도 화면은 떠야 한다.
      setSpeechAvailable(false);
    }
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  // 넘어온 값으로 입력창을 채우기만 하고 보내지는 않는다 — 사용자가 문장을 다듬을
  // 기회를 뺏지 않기 위해서다. AI 탭은 언마운트되지 않으므로 q가 바뀔 때마다 반영한다.
  useEffect(() => {
    if (typeof q === "string" && q.length > 0) {
      setQuery(q);
    }
  }, [q]);

  const handleSend = useCallback(async (text?: string) => {
    const value = (text ?? query).trim();
    if (!value) return;

    setQuery(value);
    setLoading(true);
    try {
      const next = await runAiSearch(value);
      setResult(next);
      setRecent(await pushRecentQuery(value));
    } finally {
      // 조회가 실패해도 로딩은 반드시 풀어야 한다 — 안 그러면 화면이 영영 돈다.
      setLoading(false);
    }
  }, [query]);

  // 인식된 말을 입력창에 그대로 흘려 넣는다(interimResults) — 말하는 동안 글자가 쌓이면
  // 제대로 알아듣고 있는지 눈으로 확인할 수 있다.
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    spokenRef.current = transcript;
    setQuery(transcript);
  });

  // 말이 끝나면 그대로 검색한다 — 받아 적어 놓고 전송을 또 누르게 할 이유가 없다.
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    const spoken = spokenRef.current.trim();
    if (spoken.length > 0) void handleSend(spoken);
  });

  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    // "아무 말도 못 들었다"는 오류가 아니라 흔한 일이다 — 조용히 넘긴다.
    if (event.error === "no-speech" || event.error === "aborted") return;
    showToast(
      event.error === "not-allowed"
        ? t("ai.voiceDenied")
        : t("ai.voiceFailed"),
    );
  });

  /**
   * 마이크 버튼 — 듣는 중이면 멈추고, 아니면 권한을 확인한 뒤 시작한다.
   *
   * 권한은 누를 때 묻는다. 화면에 들어오자마자 물으면 무엇에 쓰는지 모른 채 거부하기 쉽다.
   */
  const handleVoicePress = useCallback(async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        showToast(t("ai.voiceDenied"));
        return;
      }

      spokenRef.current = "";
      setResult(null);
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: SPEECH_LOCALES[i18n.language] ?? SPEECH_LOCALES.en,
        interimResults: true,
        // 한 문장만 받는다. 계속 켜 두면 배터리를 먹고, 검색은 한 문장이면 충분하다.
        continuous: false,
      });
    } catch {
      setListening(false);
      showToast(t("ai.voiceFailed"));
    }
  }, [listening, t]);

  /** 잘못 읽은 조건을 끄고 다시 찾는다. */
  const handleRemoveCondition = useCallback(
    async (condition: ParsedCondition) => {
      if (!result) return;
      setLoading(true);
      try {
        setResult(await rerunWithout(result.intent, condition.kind, condition.label));
      } finally {
        setLoading(false);
      }
    },
    [result],
  );

  function handleReset() {
    setResult(null);
    setQuery("");
  }

  async function handleClearRecent() {
    await clearRecentQueries();
    setRecent([]);
  }

  /**
   * 조건 칩에 쓸 문구.
   *
   * 종류마다 읽는 방식이 다르다 — 지역·검색어는 값을 그대로, 유형·거래방식·위험도는
   * 기존 i18n 라벨을 재사용하고(다른 화면과 같은 말이어야 한다), 금액은 통화 형식으로,
   * 방수·면적은 단위를 붙인다.
   */
  function conditionLabel(c: ParsedCondition): string {
    switch (c.kind) {
      case "region":
        return c.label;
      case "category":
        return t(`categories.property.${c.label}`);
      case "listing":
        return t(`property.status.${c.label}`);
      case "risk":
        return t(`invest.risk.${c.label}`);
      case "maxPrice":
        return t("ai.condition.maxPrice", { amount: formatVndAmount(Number(c.label)) });
      case "minPrice":
        return t("ai.condition.minPrice", { amount: formatVndAmount(Number(c.label)) });
      case "bedrooms":
        return t("ai.condition.bedrooms", { count: Number(c.label) });
      case "minArea":
        return t("ai.condition.minArea", { area: c.label });
      case "keyword":
      default:
        return c.label;
    }
  }

  const hasResults =
    !!result && (result.properties.length > 0 || result.investments.length > 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("ai.title")} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 결과가 있으면 인사말을 접는다 — 결과를 보러 온 사람에게 소개문은 방해다. */}
        {result ? null : (
          <View style={styles.greeting}>
            <View style={[styles.greetingIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="sparkles-outline" size={22} color={theme.accent} />
            </View>
            <Text style={[textStyles.screenTitle, { color: theme.text }]}>{t("ai.greetingTitle")}</Text>
            <Text style={[textStyles.bodySmall, styles.centerText, { color: theme.secondaryText }]}>
              {t("ai.greetingSubtitle")}
            </Text>
          </View>
        )}

        <View style={[styles.inputCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("ai.inputPlaceholder")}
            placeholderTextColor={theme.secondaryText}
            multiline
            returnKeyType="search"
            onSubmitEditing={() => void handleSend()}
            style={[textStyles.body, styles.input, { color: theme.text }]}
            accessibilityLabel={t("ai.inputPlaceholder")}
          />
          {listening ? (
            <View style={styles.listeningRow}>
              <View style={[styles.listeningDot, { backgroundColor: theme.danger }]} />
              <Text style={[textStyles.caption, { color: theme.danger }]}>{t("ai.listening")}</Text>
            </View>
          ) : null}

          <View style={styles.inputActions}>
            {/* [2026-09-12] 인식기가 있는 기기에서만 그린다. */}
            {speechAvailable ? (
              <Pressable
                onPress={() => void handleVoicePress()}
                accessibilityRole="button"
                accessibilityState={{ selected: listening }}
                accessibilityLabel={listening ? t("ai.voiceStop") : t("ai.voiceHint")}
                style={({ pressed }) => [
                  styles.roundButton,
                  {
                    backgroundColor: listening ? theme.danger : theme.background,
                    borderColor: listening ? theme.danger : theme.border,
                    opacity: pressed ? opacity.pressed : 1,
                  },
                ]}
              >
                <Ionicons
                  name={listening ? "stop" : "mic-outline"}
                  size={18}
                  color={listening ? theme.onAccent : theme.secondaryText}
                />
              </Pressable>
            ) : null}

            {query.length > 0 ? (
              <Pressable
                onPress={handleReset}
                accessibilityRole="button"
                accessibilityLabel={t("ai.resetLabel")}
                style={({ pressed }) => [
                  styles.roundButton,
                  { backgroundColor: theme.background, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Ionicons name="close" size={18} color={theme.secondaryText} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void handleSend()}
              disabled={loading || query.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel={t("ai.sendLabel")}
              style={({ pressed }) => [
                styles.roundButton,
                {
                  backgroundColor: theme.accent,
                  borderColor: theme.accent,
                  opacity: loading || query.trim().length === 0 ? opacity.disabled : pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Ionicons name="arrow-up" size={18} color={theme.onAccent} />
            </Pressable>
          </View>
        </View>

        {/* 검색 전에만 예시와 최근 검색을 보여 준다. */}
        {result ? null : (
          <>
            <View style={styles.section}>
              <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("ai.suggestedTitle")}</Text>
              <View style={styles.chipsWrap}>
                {SUGGESTION_KEYS.map((key) => {
                  const label = t(`ai.suggestions.${key}`);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => void handleSend(label)}
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

            {/* [2026-09-12] 실제로 이 기기에서 찾아본 말들. 없으면 섹션째 감춘다 —
                고정 문구 세 줄을 늘 띄우던 예전 방식은 "최근"이라는 말과 맞지 않았다. */}
            {recent.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader
                  title={t("ai.recentTitle")}
                  actionLabel={t("ai.clearRecent")}
                  onAction={() => void handleClearRecent()}
                />
                <View style={styles.stack}>
                  {recent.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => void handleSend(item)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.recentRow,
                        { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                      ]}
                    >
                      <Ionicons name="time-outline" size={16} color={theme.secondaryText} />
                      <Text style={[textStyles.bodySmall, styles.recentText, { color: theme.text }]} numberOfLines={1}>
                        {item}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.secondaryText} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{t("ai.thinking")}</Text>
          </View>
        ) : result ? (
          <>
            {/* 무엇으로 찾았는지 — 규칙 기반이라 틀릴 수 있으므로 반드시 드러낸다. */}
            {result.intent.conditions.length > 0 ? (
              <View style={styles.section}>
                <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("ai.understoodTitle")}</Text>
                <View style={styles.chipsWrap}>
                  {result.intent.conditions.map((c) => (
                    <Pressable
                      key={`${c.kind}:${c.label}`}
                      onPress={() => void handleRemoveCondition(c)}
                      accessibilityRole="button"
                      accessibilityLabel={t("ai.removeCondition", { condition: conditionLabel(c) })}
                      style={({ pressed }) => [
                        styles.conditionChip,
                        { borderColor: theme.accent, opacity: pressed ? opacity.pressed : 1 },
                      ]}
                    >
                      <Text style={[textStyles.caption, { color: theme.accent }]}>{conditionLabel(c)}</Text>
                      <Ionicons name="close" size={12} color={theme.accent} />
                    </Pressable>
                  ))}
                </View>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{t("ai.disclaimer")}</Text>
              </View>
            ) : null}

            {result.properties.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t("ai.resultProperties", { count: result.properties.length })} />
                <View style={styles.stack}>
                  {result.properties.map((property, index) => (
                    <PropertyListRow
                      key={property.id}
                      property={property}
                      showDivider={index > 0}
                      onPress={() => router.push(`/property-detail/${property.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {result.investments.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t("ai.resultInvestments", { count: result.investments.length })} />
                <View style={styles.stack}>
                  {result.investments.map((product) => (
                    <Pressable
                      key={product.id}
                      onPress={() => router.push(`/invest-detail/${product.id}`)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.investRow,
                        { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                      ]}
                    >
                      <View style={styles.investTexts}>
                        <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                          {product.title}
                        </Text>
                        <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                          {product.propertyLocation}
                        </Text>
                      </View>
                      <Text style={[textStyles.price, { color: theme.accent }]} numberOfLines={1}>
                        {product.expectedReturn}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.secondaryText} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* 결과가 없을 때 — 이유를 나눠서 안내한다. 조건을 하나도 못 읽은 것과,
                읽었는데 맞는 매물이 없는 것은 사용자가 할 일이 다르다. */}
            {hasResults ? null : (
              <View style={styles.section}>
                <EmptyState
                  title={result.understood ? t("ai.noResultTitle") : t("ai.notUnderstoodTitle")}
                  description={
                    result.understood
                      ? t("ai.noResultDescription")
                      : t("ai.notUnderstoodDescription", { query: result.intent.raw })
                  }
                  action={<Button title={t("ai.resetLabel")} variant="outline" size="small" onPress={handleReset} />}
                />
              </View>
            )}
          </>
        ) : (
          <View style={styles.section}>
            <EmptyState title={t("ai.emptyTitle")} description={t("ai.emptyDescription")} />
          </View>
        )}
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09-7] home/property/invest와 동일한 영역 간 간격(md=16).
  content: {
    // 사용자 요청: 화면 좌우 여백 10px
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  greeting: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  centerText: {
    textAlign: "center",
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
  /** 해석된 조건 — 누르면 꺼지므로 닫기 아이콘을 함께 둔다. */
  conditionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  stack: {
    gap: spacing.sm,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  recentText: {
    flex: 1,
  },
  investRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  investTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  /** 듣는 중 표시 — 입력창 위에 한 줄. */
  listeningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  listeningDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  loadingBox: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
}));
