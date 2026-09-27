import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { uploadBoardImage } from "@/services/boards";
import {
  createPushCampaign,
  getPushAudienceCount,
  youtubeIdFrom,
  type PushAudience,
  type PushTopic,
} from "@/services/pushCampaigns";
import { isAdmin } from "@/services/roles";
import { sendNotificationPush } from "@/services/notifications";

/**
 * [2026-09-27 사용자 지시] 관리자 → 푸시(알림) 메시지 작성·전송.
 *
 * 흐름: 본문을 push_campaigns에 저장 → DB 함수가 대상 계정의 알림함에 넣음 →
 * 그 결과로 send-push 엣지 함수를 한 번 불러 실제 푸시를 보낸다.
 *
 * 왜 화면에서 엣지 함수를 부르나: Postgres는 외부로 HTTP를 보낼 수 없다.
 * 이 앱의 다른 알림(업체 승인, 충전 승인 등)도 모두 같은 방식이다
 * (supabase/functions/send-push/index.ts 첫머리 주석 참고).
 */

/** [2026-09-27 사용자 지시] 사진 최대 9장, 가로 3개씩 3줄. */
const MAX_IMAGES = 9;
const IMAGE_COLUMNS = 3;

/** 본문 입력창 세로 10줄. */
const BODY_LINES = 10;

const AUDIENCES: PushAudience[] = ["all", "interest", "investors"];
const TOPICS: PushTopic[] = ["property", "invest"];

export default function AdminPushScreen() {
  const theme = colors.light;
  const { t } = useTranslation();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState<PushTopic>("property");
  const [audience, setAudience] = useState<PushAudience>("all");
  const [audienceTopics, setAudienceTopics] = useState<PushTopic[]>(["property"]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [audienceCount, setAudienceCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isAdmin().then((result) => {
        if (active) setAllowed(result);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  // 대상이 바뀔 때마다 인원을 다시 센다 — 보내기 직전에 한 번만 세면 조건을 바꾼
  // 뒤의 화면 숫자가 옛 값으로 남는다.
  useEffect(() => {
    let active = true;
    void getPushAudienceCount(audience, audienceTopics).then((count) => {
      if (active) setAudienceCount(count);
    });
    return () => {
      active = false;
    };
  }, [audience, audienceTopics]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  async function handlePickImage() {
    if (images.length >= MAX_IMAGES) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("adminBoards.imagePermission"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return;

    const url = await uploadBoardImage(result.assets[0].uri);
    if (!url) {
      showToast(t("adminBoards.imageFailed"));
      return;
    }
    setImages((prev) => [...prev, url].slice(0, MAX_IMAGES));
  }

  function toggleAudienceTopic(value: PushTopic) {
    setAudienceTopics((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  }

  async function handleSend() {
    if (sending) return;
    if (title.trim().length === 0 || body.trim().length === 0) {
      showToast(t("pushMessage.missingFields"));
      return;
    }
    if (audience === "interest" && audienceTopics.length === 0) {
      showToast(t("pushMessage.missingTopics"));
      return;
    }

    setSending(true);
    const created = await createPushCampaign({
      title: title.trim(),
      body: body.trim(),
      topic,
      audience,
      audienceTopics,
      youtubeUrl: youtubeUrl.trim() || null,
      linkUrl: linkUrl.trim() || null,
      imageUrls: images,
    });

    if (!created) {
      setSending(false);
      showToast(t("pushMessage.failToast"));
      return;
    }

    // 알림함에는 이미 들어갔다. 여기서는 푸시만 밀어 준다 — 실패해도 알림 자체는
    // 남으므로 되돌리지 않는다.
    await sendNotificationPush("admin_message", created.id);
    setSending(false);
    showToast(t("pushMessage.sentToast", { count: created.sentCount }));

    setTitle("");
    setBody("");
    setYoutubeUrl("");
    setLinkUrl("");
    setImages([]);
  }

  const youtubeId = youtubeIdFrom(youtubeUrl);

  if (allowed === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
        <Header title={t("pushMessage.title")} leftAction={<BackButton fallback="/my" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
        <Header title={t("pushMessage.title")} leftAction={<BackButton fallback="/my" />} />
        <EmptyState title={t("pushMessage.noPermission")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
      <Header title={t("pushMessage.title")} leftAction={<BackButton fallback="/my" />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Input
          label={t("pushMessage.fieldTitle")}
          value={title}
          onChangeText={setTitle}
          placeholder={t("pushMessage.fieldTitlePlaceholder")}
        />

        {/* 분류 — 알림을 눌렀을 때 어느 쪽 이야기인지. */}
        <FieldLabel text={t("pushMessage.fieldTopic")} theme={theme} />
        <View style={styles.chipRow}>
          {TOPICS.map((value) => (
            <Chip
              key={value}
              label={t(value === "property" ? "pushMessage.topicProperty" : "pushMessage.topicInvest")}
              selected={topic === value}
              onPress={() => setTopic(value)}
              theme={theme}
            />
          ))}
        </View>

        <Input
          label={t("pushMessage.fieldBody")}
          value={body}
          onChangeText={setBody}
          placeholder={t("pushMessage.fieldBodyPlaceholder")}
          multiline
          numberOfLines={BODY_LINES}
          style={styles.bodyInput}
        />

        {/* 사진 — 3개씩 3줄. */}
        <FieldLabel
          text={t("pushMessage.fieldImages", { count: images.length, max: MAX_IMAGES })}
          theme={theme}
        />
        <View style={styles.imageGrid}>
          {images.map((url, index) => (
            <View key={url} style={styles.imageCell}>
              <Image source={{ uri: url }} style={styles.imageThumb} resizeMode="cover" />
              <Pressable
                onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                accessibilityRole="button"
                hitSlop={8}
                style={[styles.imageRemove, { backgroundColor: theme.background }]}
              >
                <Ionicons name="close" size={14} color={theme.text} />
              </Pressable>
            </View>
          ))}
          {images.length < MAX_IMAGES ? (
            <Pressable
              onPress={handlePickImage}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.imageCell,
                styles.imageAdd,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="add" size={24} color={theme.secondaryText} />
            </Pressable>
          ) : null}
        </View>

        <Input
          label={t("pushMessage.fieldYoutube")}
          value={youtubeUrl}
          onChangeText={setYoutubeUrl}
          placeholder={t("pushMessage.fieldYoutubePlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {/* 링크를 넣으면 본문 위에 영상이 올라간다는 것을 여기서 미리 보여 준다 —
            보낸 뒤에야 확인되면 잘못 넣은 링크를 되돌릴 수 없다. */}
        {youtubeId ? (
          <View style={[styles.youtubePreview, { borderColor: theme.border }]}>
            <Image
              source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }}
              style={styles.youtubeThumb}
              resizeMode="cover"
            />
            <Ionicons name="logo-youtube" size={28} color="#FF0000" style={styles.youtubeMark} />
          </View>
        ) : null}

        <Input
          label={t("pushMessage.fieldLink")}
          value={linkUrl}
          onChangeText={setLinkUrl}
          placeholder={t("pushMessage.fieldLinkPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* 발송 대상 */}
        <FieldLabel text={t("pushMessage.fieldAudience")} theme={theme} />
        <View style={styles.chipRow}>
          {AUDIENCES.map((value) => (
            <Chip
              key={value}
              label={t(
                value === "all"
                  ? "pushMessage.audienceAll"
                  : value === "interest"
                    ? "pushMessage.audienceInterest"
                    : "pushMessage.audienceInvestors",
              )}
              selected={audience === value}
              onPress={() => setAudience(value)}
              theme={theme}
            />
          ))}
        </View>
        {/* 관심 계정일 때만 종류를 고른다 — 다중 선택. */}
        {audience === "interest" ? (
          <View style={styles.chipRow}>
            {TOPICS.map((value) => (
              <Chip
                key={value}
                label={t(value === "property" ? "pushMessage.topicProperty" : "pushMessage.topicInvest")}
                selected={audienceTopics.includes(value)}
                onPress={() => toggleAudienceTopic(value)}
                theme={theme}
              />
            ))}
          </View>
        ) : null}

        <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
          {t("pushMessage.audienceCount", { count: audienceCount })}
        </Text>

        <Button
          title={sending ? t("pushMessage.sending") : t("pushMessage.send")}
          onPress={handleSend}
          loading={sending}
          disabled={sending}
        />
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function FieldLabel({ text, theme }: { text: string; theme: typeof colors.light }) {
  return (
    <Text style={[textStyles.bodySmall, styles.fieldLabel, { color: theme.text }]}>{text}</Text>
  );
}

function Chip({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: typeof colors.light;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? theme.accent : theme.border },
        selected ? { backgroundColor: theme.accent } : null,
        { opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <Text style={[textStyles.bodySmall, { color: selected ? theme.onAccent : theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  fieldLabel: {
    fontWeight: typography.weight.medium,
    marginTop: spacing.xs,
  },
  bodyInput: {
    // 세로 10줄 — 짧은 상자에 긴 글을 쓰면 앞부분이 계속 위로 밀려 보이지 않는다.
    minHeight: Math.round(textStyles.body.fontSize * 1.5 * BODY_LINES),
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  // 가로 3개 — 셀 폭을 비율로 두면 기기 폭이 달라도 3열이 유지된다.
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  imageCell: {
    width: `${100 / IMAGE_COLUMNS - 2}%`,
    aspectRatio: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
    position: "relative",
  },
  imageThumb: {
    width: "100%",
    height: "100%",
  },
  imageAdd: {
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  imageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  youtubePreview: {
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
    position: "relative",
    aspectRatio: 16 / 9,
  },
  youtubeThumb: {
    width: "100%",
    height: "100%",
  },
  youtubeMark: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -14,
    marginLeft: -14,
  },
}));
