import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { listBoardPosts, type BoardKind, type BoardPost } from "@/services/boards";
import { isAdmin } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 게시판 관리 — 목록. 관리자 전용.
 *
 * 공지사항 / QA / FAQ 세 탭. 줄을 누르면 읽기 페이지로 가고, 수정·삭제·답변은 모두
 * 거기서 한다 — 목록에 버튼을 달아 두면 글이 몇 건만 쌓여도 한 줄이 버튼으로 가득
 * 차고, 제목을 다 읽지 않은 채로 삭제를 누르기 쉽다.
 *
 * 읽기 페이지는 사용자와 **같은 화면**(app/board-detail/[id].tsx)이다. 관리자에게만
 * 거기서 수정·삭제(QA는 답변)가 더 보인다 — 관리자용 상세를 따로 두면 같은 글이 두
 * 화면에서 다르게 보이고, 한쪽만 고치는 일이 반복된다.
 *
 * 목록 모양은 홈의 공지 목록과 같은 썸네일 카드다(좌측 이미지 / 우측 제목 2줄 /
 * 그 아래 작성일) — 같은 글이 화면마다 다르게 보일 이유가 없다.
 */

const KIND_ORDER: BoardKind[] = ["notice", "qa", "faq"];

export default function AdminBoardsScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [kind, setKind] = useState<BoardKind>("notice");
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextKind: BoardKind) => {
      setLoading(true);
      const rows = await listBoardPosts(nextKind, i18n.language, { includeUnpublished: true });
      setPosts(rows);
      setLoading(false);
    },
    [i18n.language],
  );

  // useFocusEffect라서 읽기 페이지에서 수정·삭제를 하고 돌아오면 목록이 다시 읽힌다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      isAdmin().then(async (ok) => {
        if (!active) return;
        setAllowed(ok);
        if (!ok) {
          setLoading(false);
          return;
        }
        await load(kind);
      });
      return () => {
        active = false;
      };
    }, [kind, load]),
  );

  const screenTitle = t("adminBoards.title");

  if (allowed === false) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />
        <EmptyState title={t("adminBoards.adminOnly")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />

      {/* 사각 탭 — 활성 탭은 위쪽 2px 파란 선(다른 관리자 화면과 같은 모양). */}
      <View style={[styles.tabRow, { borderBottomColor: theme.border }]}>
        {KIND_ORDER.map((item) => {
          const active = item === kind;
          return (
            <Pressable
              key={item}
              onPress={() => setKind(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tab,
                {
                  borderTopColor: active ? theme.accent : "transparent",
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[
                  textStyles.bodySmall,
                  {
                    color: active ? theme.accent : theme.secondaryText,
                    fontWeight: active ? typography.weight.semibold : typography.weight.regular,
                  },
                ]}
              >
                {t(`board.kind.${item}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* QA는 관리자가 글을 쓰는 게시판이 아니다 — 답변만 단다. */}
          {kind !== "qa" ? (
            <Button
              title={t("adminBoards.write")}
              onPress={() => router.push({ pathname: "/admin-board-write", params: { kind } })}
            />
          ) : null}

          {posts.length === 0 ? (
            <EmptyState title={t("adminBoards.empty")} />
          ) : (
            posts.map((post) => (
              <Pressable
                key={post.id}
                onPress={() => router.push(`/board-detail/${post.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                    opacity: pressed ? opacity.pressed : 1,
                  },
                ]}
              >
                {/* 첨부가 없는 글도 같은 자리를 차지해야 줄 높이가 들쭉날쭉해지지 않는다. */}
                {post.images.length > 0 ? (
                  <Image source={{ uri: post.images[0] }} style={styles.thumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: theme.background }]}>
                    <Ionicons
                      name={post.kind === "qa" ? "help-circle-outline" : "megaphone-outline"}
                      size={20}
                      color={theme.secondaryText}
                    />
                  </View>
                )}

                <View style={styles.texts}>
                  <View style={styles.titleLine}>
                    {post.pinned ? <Ionicons name="pin" size={13} color={theme.accent} /> : null}
                    {/* 관리자 목록은 원문을 보여 준다 — 번역본을 띄우면 어떤 글을
                        고치는 중인지 헷갈린다. */}
                    <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]} numberOfLines={2}>
                      {post.originalTitle}
                    </Text>
                  </View>
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {post.createdAt.slice(0, 10)}
                    {post.kind === "qa"
                      ? ` · ${post.answeredAt ? t("adminBoards.answeredBadge") : t("adminBoards.waitingBadge")}`
                      : ""}
                    {!post.published ? ` · ${t("adminBoards.hidden")}` : ""}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
              </Pressable>
            ))
          )}
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
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
  },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  // minWidth:0이 없으면 긴 제목이 카드를 밀어내 썸네일이 찌그러진다.
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
});
