import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Linking, Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import { getPushCampaign, youtubeIdFrom, type PushCampaign } from "@/services/pushCampaigns";

/**
 * [2026-09-27 사용자 지시] 푸시 알림을 눌렀을 때 열리는 본문 화면.
 *
 * 왜 필요한가: 푸시 알림에는 제목과 한 줄만 실린다. 사진 9장과 유튜브 영상은
 * 알림창에 담을 수 없다. 관리자가 넣은 내용을 온전히 보여 주는 자리가 여기다.
 *
 * 유튜브는 앱 안에서 재생하지 않고 썸네일을 눌러 유튜브 앱/브라우저로 넘긴다 —
 * 재생기를 앱에 넣으려면 패키지가 하나 더 붙고, 그러면 OTA로 배포할 수 없다.
 */
export default function PushMessageScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : null;

  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<PushCampaign | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      getPushCampaign(id).then((result) => {
        if (!active) return;
        setCampaign(result);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  const youtubeId = campaign?.youtubeUrl ? youtubeIdFrom(campaign.youtubeUrl) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
      <Header title={t("pushMessage.title")} leftAction={<BackButton fallback="/notifications" />} />
      {loading ? (
        <Loading />
      ) : !campaign ? (
        <EmptyState title={t("common.notFoundTitle")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[textStyles.screenTitle, { color: theme.text }]}>{campaign.title}</Text>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {campaign.createdAt.slice(0, 10)}
          </Text>

          {/* 사용자 지시: 유튜브 링크가 있으면 **본문 위**에 영상을 노출한다. */}
          {youtubeId ? (
            <Pressable
              onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${youtubeId}`)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.youtube,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Image
                source={{ uri: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` }}
                style={styles.youtubeThumb}
                resizeMode="cover"
              />
              <Ionicons name="logo-youtube" size={44} color="#FF0000" style={styles.youtubeMark} />
            </Pressable>
          ) : null}

          <Text style={[textStyles.body, { color: theme.text }]}>{campaign.body}</Text>

          {campaign.imageUrls.map((url) => (
            <Image key={url} source={{ uri: url }} style={styles.photo} resizeMode="cover" />
          ))}

          {campaign.linkUrl ? (
            <Pressable
              onPress={() => Linking.openURL(campaign.linkUrl as string)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.linkRow,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="link-outline" size={18} color={theme.accent} />
              <Text style={[textStyles.bodySmall, { color: theme.accent, flex: 1 }]} numberOfLines={1}>
                {campaign.linkUrl}
              </Text>
              <Ionicons name="open-outline" size={16} color={theme.secondaryText} />
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
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
  youtube: {
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
    marginTop: -22,
    marginLeft: -22,
  },
  // 사진은 원본 비율을 모르므로 4:3으로 고정한다 — 제각각 높이면 목록이 들쭉날쭉해진다.
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radius.sm,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
}));
