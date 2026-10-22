import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { createScaledStyles, colors, FONT_FACTOR, radius, scaleFont, spacing, textStyles } from "@/constants/theme";
import { getArticleDetail, type ArticleDetail } from "@/services/articles";

/**
 * [2026-10-22] 수집한 부동산 정보의 **내부** 상세페이지.
 *
 * `content_permission = 'internal_allowed'`인 기사만 열린다. 권한이 없는 기사는
 * 서비스(getArticleDetail)가 null을 돌려주므로 이 화면에 들어와도 "볼 수 없음"이
 * 뜬다 — 화면 분기만 믿으면 딥링크로 직접 들어오는 경로가 남는다.
 *
 * 본문 전문을 담지 않는다. 수집기가 저장하는 것은 피드가 준 요약까지이고, 그것이
 * 권한의 범위다. 전문을 읽으려면 원문으로 간다 — 그래서 원문 링크를 반드시 둔다.
 *
 * 사진은 여러 장이면 슬라이드로 보여 준다(사용자 지시). 현재 검증된 출처는 전부
 * 사진이 1장이라 실제로는 대개 1장이고, 제휴가 성사되면(Masterise·Ecopark) 그때
 * 여러 장이 채워진다. 슬라이드는 매물 상세(property-detail)와 같은 방식이다.
 */
export default function ArticleDetailScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  /**
   * [2026-10-22 사용자 지시] 이미지가 가로로 잘리던 문제.
   *
   * 높이를 220으로 못 박고 resizeMode="cover"를 쓰고 있었다. cover는 지정된 틀을
   * 꽉 채우려고 **넘치는 쪽을 잘라낸다** — 뉴스 썸네일은 가로가 긴 것이 많아
   * 좌우가 통째로 날아갔다(제목 글자가 들어 있는 이미지였다).
   *
   * 원본 비율을 재서 높이를 거기에 맞춘다. 재기 전에는 16:9로 두고, 실패하면
   * 그대로 둔다 — 비율을 모를 때 contain으로 바꾸면 위아래에 빈 띠가 생긴다.
   */
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getArticleDetail(id, i18n.language).then((result) => {
      if (!active) return;
      setArticle(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, i18n.language]);

  /**
   * [2026-10-22 결함 수정] 원본 비율 측정.
   *
   * 처음에는 `onLoad`의 `event.nativeEvent.source`에서 폭·높이를 읽었는데,
   * **그 필드는 네이티브에만 있다.** react-native-web에서는 nativeEvent가 다른
   * 모양이라 구조분해가 터졌다("Cannot destructure property 'width'").
   * 웹 미리보기에서 상세페이지가 열리자마자 죽었다.
   *
   * Image.getSize는 양쪽 플랫폼이 같은 모양으로 제공한다. 실패하면 조용히
   * 넘어가고 기본 비율(16:9)을 쓴다 — 비율을 몰라도 화면은 떠야 한다.
   */
  useEffect(() => {
    if (!article) return;
    const urls = (article.images.length > 0
      ? article.images.map((i) => i.url)
      : article.thumbnailUrl
        ? [article.thumbnailUrl]
        : []);

    let active = true;
    for (const url of urls) {
      Image.getSize(
        url,
        (width, height) => {
          if (!active || !width || !height) return;
          setRatios((prev) => (prev[url] ? prev : { ...prev, [url]: width / height }));
        },
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, [article]);

  function handleGalleryScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const width = event.nativeEvent.layoutMeasurement.width;
    if (width <= 0) return;
    setGalleryIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header
          title={t("articles.detailTitle")}
          titleNode={<AiBdsTitle />}
          leftAction={<BackButton fallback="/home" />}
        />
        <Loading fullscreen />
      </SafeAreaView>
    );
  }

  if (!article) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("common.notFoundTitle")} leftAction={<BackButton fallback="/home" />} />
        <EmptyState
          title={t("articles.notAvailableTitle")}
          description={t("articles.notAvailableDescription")}
        />
      </SafeAreaView>
    );
  }

  // 썸네일만 있고 article_images가 비어 있으면 썸네일을 1장짜리 갤러리로 쓴다.
  const images =
    article.images.length > 0
      ? article.images
      : article.thumbnailUrl
        ? [{ url: article.thumbnailUrl, caption: null }]
        : [];
  const visibleImages = images.filter((img) => !failedImages[img.url]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={t("articles.detailTitle")}
        titleNode={<AiBdsTitle />}
        leftAction={<BackButton fallback="/home" />}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {visibleImages.length > 0 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleGalleryScroll}
            >
              {visibleImages.map((image) => (
                <Image
                  key={image.url}
                  source={{ uri: image.url }}
                  style={[
                    styles.galleryImage,
                    {
                      backgroundColor: theme.border,
                      // 세로가 아주 긴 이미지가 화면을 통째로 먹지 않게 상한을 둔다.
                      aspectRatio: Math.max(ratios[image.url] ?? 16 / 9, 0.8),
                    },
                  ]}
                  // 비율을 맞춰 두었으므로 cover가 잘라낼 것이 없다. 측정 전
                  // 한 프레임 동안만 가장자리가 조금 잘릴 수 있는데, contain으로
                  // 두면 그 대신 빈 띠가 깜빡인다 — 잘림 쪽이 덜 거슬린다.
                  resizeMode="cover"
                  onError={() => setFailedImages((prev) => ({ ...prev, [image.url]: true }))}
                />
              ))}
            </ScrollView>
            {/* 점 표시는 2장 이상일 때만. 1장에 점 하나는 의미가 없다. */}
            {visibleImages.length > 1 ? (
              <View style={styles.dots}>
                {visibleImages.map((image, index) => (
                  <View
                    key={image.url}
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          index === galleryIndex ? theme.onAccent : "rgba(255,255,255,0.5)",
                      },
                    ]}
                  />
                ))}
              </View>
            ) : null}
            {visibleImages[galleryIndex]?.caption ? (
              <Text style={[textStyles.caption, styles.caption, { color: theme.secondaryText }]}>
                {visibleImages[galleryIndex].caption}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.textBlock}>
          <Text style={[textStyles.sectionTitle, styles.detailTitle, { color: theme.text }]}>
            {article.title}
          </Text>

          {/* 지역 · 유형 · 기간 — 원문에 있는 것만 */}
          <View style={styles.metaRow}>
            {article.region ? <Meta icon="location-outline" label={article.region} theme={theme} /> : null}
            {article.propertyType ? (
              <Meta icon="home-outline" label={article.propertyType} theme={theme} />
            ) : null}
            {article.periodLabel ? (
              <Meta icon="calendar-outline" label={article.periodLabel} theme={theme} />
            ) : null}
          </View>

          {article.summary.length > 0 ? (
            <Text style={[textStyles.bodySmall, styles.summary, { color: theme.text }]}>
              {article.summary}
            </Text>
          ) : null}
        </View>

        {/* 출처 — 요구사항 §7: 원출처와 원문 링크, 최종 확인일을 표시한다.
            이 블록이 없으면 이 화면은 출처 없는 글이 된다. */}
        <View style={[styles.sourceBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <Row label={t("articles.sourceLabel")} value={article.sourceName} theme={theme} />
          <Row label={t("articles.domainLabel")} value={article.sourceDomain} theme={theme} />
          {article.publishedAt ? (
            <Row
              label={t("articles.publishedLabel")}
              value={new Date(article.publishedAt).toLocaleString(i18n.language)}
              theme={theme}
            />
          ) : null}
          {article.lastCheckedAt ? (
            <Row
              label={t("articles.lastCheckedLabel")}
              value={new Date(article.lastCheckedAt).toLocaleString(i18n.language)}
              theme={theme}
            />
          ) : null}
        </View>

        {/* [2026-10-22 사용자 지시] 안내 문구는 왼쪽, 원문 버튼은 오른쪽 가로 25%.
            버튼이 화면 폭을 다 쓰면 "이 화면의 주 행동"처럼 보이는데, 이 화면의
            주 내용은 위의 요약이고 원문 이동은 그다음이다. */}
        <View style={styles.bottomRow}>
          <Text
            style={[textStyles.caption, styles.disclaimer, { color: theme.secondaryText }]}
          >
            {t("articles.disclaimer")}
          </Text>
          {/* [2026-10-22 사용자 지시] 폭 25%에 글자가 맞게 들어가야 한다.
              Button의 title로 넘기면 Text에 numberOfLines가 없어 글자가 한 자씩
              세로로 쌓였다("원 / 문 / 보 / 기"). children으로 직접 그려
              **한 줄로 못 박고** 글자도 줄인다. children은 title보다 우선한다. */}
          <Button
            variant="primary"
            onPress={() => void Linking.openURL(article.originalUrl).catch(() => undefined)}
            style={styles.originalButton}
            accessibilityLabel={t("articles.openOriginal")}
          >
            <Text style={[styles.originalButtonText, { color: theme.onAccent }]} numberOfLines={1}>
              {t("articles.openOriginal")}
            </Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * [2026-10-22 사용자 지시] 상단 제목 "Ai BĐS" — Ai는 800, BĐS는 600.
 * 홈의 섹션 제목(app/(tabs)/home.tsx)과 같은 배분이다. 한쪽을 바꾸면 양쪽을
 * 함께 바꾼다. 제목은 기능 이름이라 번역하지 않아 언어별로 어긋나지 않는다.
 */
function AiBdsTitle() {
  return (
    <>
      <Text style={{ fontWeight: "800" }}>Ai </Text>
      <Text style={{ fontWeight: "600" }}>BĐS</Text>
    </>
  );
}

function Meta({
  icon,
  label,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  theme: typeof colors.light;
}) {
  return (
    <View style={[styles.metaChip, { borderColor: theme.border }]}>
      <Ionicons name={icon} size={12} color={theme.secondaryText} />
      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{label}</Text>
    </View>
  );
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: typeof colors.light;
}) {
  if (!value || value.length === 0) return null;
  return (
    <View style={styles.sourceRow}>
      <Text style={[textStyles.caption, styles.sourceLabel, { color: theme.secondaryText }]}>
        {label}
      </Text>
      <Text style={[textStyles.caption, styles.sourceValue, { color: theme.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = createScaledStyles(() => ({
  container: { flex: 1 },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  galleryImage: {
    width: layoutWidth(),
    // 높이는 aspectRatio가 정한다(위 Image.getSize로 원본 비율을 잰다).
  },
  dots: {
    position: "absolute",
    bottom: spacing.sm,
    alignSelf: "center",
    flexDirection: "row",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  caption: {
    paddingHorizontal: spacing.screenPaddingX,
    marginTop: spacing.xs,
  },
  textBlock: {
    paddingHorizontal: spacing.screenPaddingX,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  // [2026-10-22 사용자 지시] 제목 줄 간격 한 치수 좁게.
  // 고정값이 아니라 글자 크기에 비례해 계산한다 — 고정값으로 두면 기기 글자
  // 크기를 키울 때 줄이 겹친다(홈 카드 제목과 같은 이유).
  detailTitle: {
    lineHeight: scaleFont(21, FONT_FACTOR.TITLE) * 1.25,
  },
  summary: {
    // [2026-10-22 사용자 지시] 본문 한 치수 작게(body 20 → bodySmall 18),
    // 제목과의 간격 20px.
    //
    // textBlock의 gap(8)과 더해지지 않게 marginTop만 20으로 두지 않고,
    // gap만큼 빼서 정확히 20이 되게 한다.
    marginTop: 20 - spacing.sm,
    lineHeight: scaleFont(18, FONT_FACTOR.BODY) * 1.5,
  },
  sourceBox: {
    marginHorizontal: spacing.screenPaddingX,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sourceRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  sourceLabel: {
    width: 84,
  },
  sourceValue: {
    flex: 1,
    minWidth: 0,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.screenPaddingX,
  },
  // 가로 25% 고정. 버튼이 늘어나 안내 문구를 밀어내지 않게 한다.
  // 기본 좌우 여백(size medium은 24px씩)을 줄인다 — 82px 남짓한 폭에서 여백이
  // 48px을 먹으면 글자 자리가 없다.
  originalButton: {
    width: "25%",
    paddingHorizontal: spacing.xs,
  },
  originalButtonText: {
    fontSize: scaleFont(13, FONT_FACTOR.SMALL),
    fontWeight: "700",
    textAlign: "center",
  },
  disclaimer: {
    flex: 1,
    minWidth: 0,
    // 위의 "출처 / 사이트" 라벨과 같은 크기(caption)다. opacity로 더 흐리게 하면
    // 같은 크기여도 다른 계층처럼 보여, 흐림은 두지 않는다.
  },
}));

/** 갤러리 한 장의 폭 = 화면 폭. createScaledStyles 안에서 Dimensions를 직접 읽는다. */
function layoutWidth(): number {
  return require("react-native").Dimensions.get("window").width;
}
