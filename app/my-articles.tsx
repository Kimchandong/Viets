import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ArticleCard } from "@/components/ArticleCard";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { createScaledStyles, colors, spacing } from "@/constants/theme";
import { getArticlesByIds, type Article } from "@/services/articles";
import { useFavoritesStore } from "@/store/useFavoritesStore";

/**
 * [2026-10-22 사용자 지시] MY > 부동산정보 — 북마크한 기사 목록.
 *
 * 해제하면 이 목록에서 바로 사라진다 — favorites가 바뀌면 id 목록이 바뀌고,
 * 그에 맞춰 다시 조회한다. 기사 자체는 지우지 않는다.
 */
export default function MyArticlesScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const favorites = useFavoritesStore((state) => state.favorites);

  const ids = useMemo(() => {
    const prefix = "article:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [favorites]);

  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getArticlesByIds(ids, i18n.language.split("-")[0]).then((result) => {
      if (!mounted) return;
      setItems(result);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [ids, i18n.language]);

  function openArticle(article: Article) {
    // 내부 열람이 허용된 글만 앱 안에서 펼친다 — 나머지는 원문으로 보낸다.
    if (article.contentPermission === "internal_allowed") {
      router.push(`/article/${article.id}` as "/my");
      return;
    }
    void Linking.openURL(article.originalUrl);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("my.rows.articles")} leftAction={<BackButton fallback="/my" />} />
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState title={t("my.noBookmarkedArticles")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {items.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              showDivider={index > 0}
              onPress={() => openArticle(article)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.md,
  },
  loadingBox: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
}));
