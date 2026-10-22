import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useFavoritesStore } from "@/store/useFavoritesStore";
import type { TFunction } from "i18next";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { createScaledStyles, colors, FONT_FACTOR, opacity, radius, scaleFont, spacing, textStyles } from "@/constants/theme";
import type { Article } from "@/services/articles";

/**
 * [2026-10-22] 자동 수집된 부동산 정보 카드 — 블로그형 썸네일.
 *
 * 왼쪽 썸네일 + 오른쪽 정보 구성이다. PropertyListRow와 같은 모양을 쓰는 이유는
 * 같은 화면에 두 목록이 번갈아 나오기 때문이다 — 서로 다른 레이아웃을 쓰면 같은
 * 자리에서 리듬이 깨진다.
 *
 * 비어 있는 값은 **칸 자체를 숨긴다.** 원문에 없는 값은 NULL로 저장되는데(가격·기간·
 * 지역), 빈 라벨을 두면 "정보가 없다"가 아니라 "앱이 못 가져왔다"로 읽힌다.
 */

/**
 * 게시일을 상대 표기("3시간 전")로 쓸 구간. 하루가 넘으면 날짜로 바꾼다.
 *
 * [2026-10-22] 원래 NEW 배지의 기준이기도 했는데 배지는 사용자 지시로 삭제했다.
 * 상대 표기 기준으로는 그대로 쓴다 — 하루 안의 글은 "몇 시간 전"이 날짜보다
 * 읽기 쉽다.
 */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ArticleCardProps = {
  article: Article;
  showDivider?: boolean;
  onPress: () => void;
};

export function ArticleCard({ article, showDivider, onPress }: ArticleCardProps) {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  // [2026-10-22 사용자 지시] 북마커 — favorites 표를 그대로 쓴다(target_type='article').
  const bookmarked = useFavoritesStore((state) => state.isFavorite("article", article.id));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);
  // 이미지가 깨지는 경우가 실제로 있다 — 외부 CDN이고 핫링크를 막는 출처도 있다.
  const [imageFailed, setImageFailed] = useState(false);

  const dateLabel = formatDate(article.publishedAt ?? article.collectedAt, i18n.language, t);
  const periodLabel = formatPeriod(article, i18n.language);
  // link_only는 앱을 떠난다. 어디로 가는지 미리 알려 준다 — 눌렀더니 브라우저가
  // 열리는 것은 사용자에게 사고처럼 느껴진다.
  const isExternal = article.contentPermission !== "internal_allowed";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        showDivider ? [styles.divider, { borderTopColor: theme.border }] : null,
        { opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      {/* [2026-10-22 사용자 지시] 출처와 게시 시각을 사진 아래로 옮긴다.
          그래서 썸네일을 컬럼으로 감싼다 — 사진과 그 설명이 한 덩어리로 묶여,
          오른쪽 글 블록의 줄 수가 달라져도 자리가 흔들리지 않는다. */}
      <View style={styles.thumbColumn}>
      <View style={[styles.thumbBox, { backgroundColor: theme.border }]}>
        {article.thumbnailUrl && !imageFailed ? (
          <Image
            source={{ uri: article.thumbnailUrl }}
            style={styles.thumb}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          // 대체 이미지 — 원문과 다른 의미를 전달하지 않도록 중립적인 아이콘만 둔다.
          <View style={styles.thumbFallback}>
            <Ionicons name="business-outline" size={24} color={theme.secondaryText} />
          </View>
        )}
        {/* 외부로 나가는 기사 표시. 사진 위에 얹어 레이아웃 자리를 쓰지 않는다 —
            눌렀더니 브라우저가 열리는 것은 예고 없이는 사고처럼 느껴진다. */}
        {isExternal ? (
          <View style={styles.externalBadge}>
            <Ionicons name="open-outline" size={10} color={colors.light.onAccent} />
          </View>
        ) : null}
        {/* 사진이 여러 장일 때만 장수를 알린다. 1장이면 알릴 것이 없다. */}
        {article.imageCount > 1 ? (
          <View style={styles.photoBadge}>
            <Ionicons name="images-outline" size={10} color={colors.light.onAccent} />
            <Text style={styles.photoBadgeText}>{article.imageCount}</Text>
          </View>
        ) : null}
      </View>
      {/* [2026-10-22 사용자 지시] 출처와 게시 시각을 **함께** 사진 아래, 좌측에.
          글자는 caption(14)에서 한 치수 내린 12다.
          두 줄까지 허용한다 — 폭이 썸네일(96)에 묶여 있어 한 줄로 못 박으면
          "Thanh Niên · 3시간 전"처럼 긴 조합이 잘린다. 잘린 출처는 출처가 아니다. */}
      {/* 북마커 — 카드 전체를 누르면 상세로 가므로, 이 버튼은 그 눌림을 삼킨다. */}
      <Pressable
        onPress={() => toggleFavorite("article", article.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: bookmarked }}
        accessibilityLabel={t("article.bookmark")}
        hitSlop={8}
        style={({ pressed }) => [styles.bookmark, { opacity: pressed ? opacity.pressed : 1 }]}
      >
        <Ionicons
          name={bookmarked ? "bookmark" : "bookmark-outline"}
          size={18}
          color={bookmarked ? theme.accent : "#FFFFFF"}
        />
      </Pressable>
      <Text style={[styles.thumbMeta, { color: theme.secondaryText }]} numberOfLines={2}>
        {article.sourceName}
        {dateLabel ? ` · ${dateLabel}` : ""}
      </Text>
      </View>

      <View style={styles.body}>
        {/* [2026-10-22 사용자 지시] NEW 배지 삭제. */}
        <Text style={[textStyles.cardTitle, styles.title, { color: theme.text }]} numberOfLines={2}>
          {article.title}
        </Text>

        {article.summary.length > 0 ? (
          <Text
            style={[textStyles.caption, styles.summary, { color: theme.secondaryText }]}
            numberOfLines={3}
          >
            {article.summary}
          </Text>
        ) : null}

        {/* 지역 · 유형 · 기간 — 있는 것만 */}
        {article.region || article.propertyType || periodLabel ? (
          <View style={styles.metaRow}>
            {article.region ? (
              <Chip label={article.region} icon="location-outline" theme={theme} />
            ) : null}
            {article.propertyType ? (
              <Chip label={article.propertyType} icon="home-outline" theme={theme} />
            ) : null}
            {periodLabel ? (
              <Chip label={periodLabel} icon="calendar-outline" theme={theme} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  icon,
  theme,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  theme: typeof colors.light;
}) {
  return (
    <View style={[styles.chip, { borderColor: theme.border }]}>
      {/* [2026-10-22 사용자 지시] 위치 아이콘·지역명 한 치수 크게(10 → 12). */}
      <Ionicons name={icon} size={12} color={theme.secondaryText} />
      <Text style={[styles.chipText, { color: theme.secondaryText }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * 게시일 표기. 하루 안이면 "3시간 전", 그 뒤로는 날짜.
 *
 * 상대 표기를 쓰는 이유: 매일 갱신되는 목록이라 "오늘 것인가"가 가장 중요한 정보다.
 * 며칠 지난 글에 "5일 전"을 쓰면 반대로 날짜를 못 읽으므로 그때는 날짜로 바꾼다.
 *
 * `Intl.RelativeTimeFormat`을 쓰지 않는다 — 이 프로젝트에 선례가 없고 Hermes의
 * Intl 지원 범위가 플랫폼·버전마다 달라, 기기에서만 터지는 종류의 위험을 안는다.
 * i18n 문구로 처리하면 번역 품질도 우리가 정할 수 있다.
 * (toLocaleDateString은 invest-detail에서 이미 쓰고 있어 안전이 확인된 쪽이다.)
 */
function formatDate(iso: string, lang: string, t: TFunction): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;

  if (diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(diff / 60000));
    return t("articles.minutesAgo", { count: minutes });
  }
  if (diff < RECENT_WINDOW_MS) {
    const hours = Math.max(1, Math.floor(diff / (60 * 60 * 1000)));
    return t("articles.hoursAgo", { count: hours });
  }
  return new Date(ms).toLocaleDateString(lang, { month: "short", day: "numeric" });
}

/**
 * 기간 표기 — 원문에 있을 때만.
 *
 * period_label이 있으면 그것을 그대로 쓴다("2026년 4분기 입주 예정"처럼 날짜로
 * 환산할 수 없는 표현이다). 날짜가 있으면 범위로 그린다. 둘 다 없으면 빈 문자열을
 * 돌려주고 호출부가 칸을 숨긴다.
 */
function formatPeriod(article: Article, lang: string): string {
  if (article.periodLabel && article.periodLabel.trim().length > 0) return article.periodLabel;

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(lang, { year: "2-digit", month: "short" });

  if (article.periodStart && article.periodEnd) return `${fmt(article.periodStart)} ~ ${fmt(article.periodEnd)}`;
  if (article.periodStart) return `${fmt(article.periodStart)} ~`;
  if (article.periodEnd) return `~ ${fmt(article.periodEnd)}`;
  return "";
}

const styles = createScaledStyles(() => ({
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // 사진 + 그 아래 시각. 폭은 썸네일에 맞춘다.
  bookmark: {
    position: "absolute",
    left: 4,
    top: 4,
    // 사진 위에 얹히므로 어두운 원판을 깔아 흰 아이콘이 밝은 사진에서도 보이게 한다.
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    borderRadius: radius.full,
    padding: 4,
  },
  thumbColumn: {
    width: 96,
    gap: 4,
  },
  thumbBox: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  photoBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  // [2026-10-22 사용자 지시] 제목 한 치수 작게 — cardTitle(20)에서 18로 내린다.
  // 굵기는 cardTitle 그대로 둔다. 굵기까지 내리면 제목이 요약과 구분되지 않는다.
  title: {
    fontSize: scaleFont(18, FONT_FACTOR.BODY),
    // [2026-10-22 사용자 지시] 제목이 두 줄이 될 때 줄 간격을 조금 좁힌다.
    // RN 기본 줄 간격(글자 크기의 1.3~1.4배)으로는 두 줄이 서로 떨어져 한 제목이
    // 아니라 두 덩어리처럼 읽힌다.
    //
    // 고정값(예: 21)으로 두지 않는다 — 사용자가 기기 글자 크기를 키우면 글자는
    // 커지는데 줄 간격은 그대로여서 줄이 겹친다. 글자 크기에 비례해 계산한다.
    lineHeight: scaleFont(18, FONT_FACTOR.BODY) * 1.2,
  },
  body: {
    // minWidth:0이 없으면 긴 제목이 썸네일을 밀어낸다.
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  summary: {
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: scaleFont(12, FONT_FACTOR.SMALL),
  },
  thumbMeta: {
    // caption(14)에서 한 치수 내린다. 카드에서 가장 약한 정보라 제일 작다.
    fontSize: scaleFont(12, FONT_FACTOR.SMALL),
    textAlign: "left",
    lineHeight: 15,
  },
  externalBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
}));
