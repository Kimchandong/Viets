import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { colors, spacing, textStyles } from "@/constants/theme";
import { getLegalDocument, type BoardPost, type LegalKind } from "@/services/boards";

/**
 * [2026-09-14 사용자 결정] 이용약관 / 개인정보처리방침.
 *
 * 본문을 코드에 박지 않고 DB(board_posts)에서 읽는 이유: 원문이 베트남 법무법인에서
 * **출시 직전에** 온다. 코드에 있으면 그때 재빌드 + 재심사를 해야 하지만, 글로 두면
 * 관리자 화면에서 붙여넣는 것으로 끝난다.
 *
 * 화면을 하나로 두고 kind만 바꾸는 이유: 두 문서는 제목과 본문뿐이라 구조가 완전히
 * 같다. 따로 만들면 한쪽만 고치는 일이 생긴다.
 *
 * 공개 게시판 탭에는 넣지 않았다 — 목록으로 훑어보는 글이 아니라, 필요할 때 찾아
 * 들어가 읽는 문서다. MY → 설정에서 연다.
 */

function parseKind(raw: string | undefined): LegalKind {
  return raw === "privacy" ? "privacy" : "terms";
}

export default function LegalScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = parseKind(params.kind);

  const [post, setPost] = useState<BoardPost | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      getLegalDocument(kind, i18n.language).then((next) => {
        if (!mounted) return;
        setPost(next);
        setLoading(false);
      });
      return () => {
        mounted = false;
      };
    }, [kind, i18n.language]),
  );

  const title = t(`board.kind.${kind}`);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={title} leftAction={<BackButton />} />

      {loading ? (
        <Loading fullscreen />
      ) : !post ? (
        // 아직 등록 전이어도 화면은 떠야 한다 — 빈 화면이면 "앱이 고장났다"로 읽힌다.
        <EmptyState title={t("legal.emptyTitle")} description={t("legal.emptyBody")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[textStyles.screenTitle, { color: theme.text }]}>{post.title}</Text>
          <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
            {t("legal.effectiveDate", { date: post.createdAt.slice(0, 10) })}
          </Text>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          {/* 줄바꿈을 그대로 살린다 — 조문 번호와 들여쓰기가 의미를 갖는 문서다. */}
          <Text style={[textStyles.body, { color: theme.text, lineHeight: 22 }]}>{post.body}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
});
