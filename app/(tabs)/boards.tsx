import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { createBoardPost, listBoardPosts, type BoardKind, type BoardPost } from "@/services/boards";
import { supabase } from "@/services/supabase";

/**
 * [2026-09-11 사용자 지시] 게시판 — 공지사항 / FAQ / QA (목록).
 *
 * 세 게시판을 한 화면의 탭으로 둔다. 글 수가 많지 않고 성격이 비슷해 화면을 셋으로
 * 나누면 이동만 번거로워진다.
 *
 * 처음에는 줄을 눌러 그 자리에서 펼치는 아코디언이었는데, 사용자 지시로 목록을
 * 썸네일 카드로 바꾸고 상세는 별도 화면(app/board-detail/[id].tsx)으로 옮겼다 —
 * 첨부 이미지와 본문을 목록 안에서 펼치면 줄 높이가 글마다 달라져 목록으로 훑기가
 * 어렵고, 이전글/다음글 이동도 둘 자리가 없다.
 *
 * 홈에서 공지를 눌러 들어올 수 있도록 ?kind= 로 처음 탭을 받는다.
 */

const KIND_ORDER: BoardKind[] = ["notice", "faq", "qa"];

export default function BoardsScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();

  const initialKind = KIND_ORDER.includes(params.kind as BoardKind)
    ? (params.kind as BoardKind)
    : "notice";

  const [kind, setKind] = useState<BoardKind>(initialKind);
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // QA 질문 작성
  const [askOpen, setAskOpen] = useState(false);
  const [askTitle, setAskTitle] = useState("");
  const [askBody, setAskBody] = useState("");
  const [asking, setAsking] = useState(false);

  const load = useCallback(
    async (nextKind: BoardKind) => {
      setLoading(true);
      const rows = await listBoardPosts(nextKind, i18n.language);
      setPosts(rows);
      setLoading(false);
    },
    [i18n.language],
  );

  // useFocusEffect라서 상세에서 글이 지워지고 돌아와도 목록이 다시 읽힌다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      supabase?.auth.getSession().then(({ data }) => {
        if (active) setSignedIn(!!data.session);
      });
      load(kind);
      return () => {
        active = false;
      };
    }, [kind, load]),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handleAsk() {
    if (asking) return;
    if (askTitle.trim().length === 0) {
      showToast(t("board.questionRequired"));
      return;
    }
    setAsking(true);
    const result = await createBoardPost({
      kind: "qa",
      title: askTitle.trim(),
      body: askBody.trim(),
      sourceLang: i18n.language,
    });
    setAsking(false);

    if (!result.ok) {
      showToast(t("board.askFailed"));
      return;
    }
    setAskOpen(false);
    setAskTitle("");
    setAskBody("");
    showToast(t("board.asked"));
    await load("qa");
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
      <Header title={t("board.title")} leftAction={<BackButton fallback="/home" />} />

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
          {kind === "qa" ? (
            <>
              <Button
                title={t("board.ask")}
                onPress={() => {
                  if (!signedIn) {
                    showToast(t("board.signInToAsk"));
                    return;
                  }
                  setAskOpen(true);
                }}
              />
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("board.qaAnonymousHint")}
              </Text>
            </>
          ) : null}

          {posts.length === 0 ? (
            <EmptyState title={t("board.empty")} />
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
                      name={
                        post.kind === "qa"
                          ? "help-circle-outline"
                          : post.kind === "faq"
                            ? "chatbubble-ellipses-outline"
                            : "megaphone-outline"
                      }
                      size={20}
                      color={theme.secondaryText}
                    />
                  </View>
                )}

                <View style={styles.texts}>
                  <View style={styles.titleLine}>
                    {post.pinned ? <Ionicons name="pin" size={13} color={theme.accent} /> : null}
                    <Text
                      style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}
                      numberOfLines={2}
                    >
                      {post.title}
                    </Text>
                  </View>
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {post.createdAt.slice(0, 10)}
                    {post.kind === "qa"
                      ? ` · ${post.answeredAt ? t("board.answered") : t("board.waiting")}`
                      : ""}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={askOpen} onClose={() => setAskOpen(false)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("board.ask")}</Text>
        <Input
          label={t("board.questionLabel")}
          value={askTitle}
          onChangeText={setAskTitle}
          containerStyle={styles.field}
        />
        <Input
          label={t("board.questionBodyLabel")}
          value={askBody}
          onChangeText={setAskBody}
          multiline
          numberOfLines={6}
          style={styles.bodyInput}
          containerStyle={styles.field}
        />
        <View style={styles.modalActions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setAskOpen(false)}
            style={styles.modalButton}
          />
          <Button
            title={t("common.save")}
            onPress={handleAsk}
            loading={asking}
            style={styles.modalButton}
          />
        </View>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
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
  field: {
    marginTop: spacing.sm,
  },
  bodyInput: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalButton: {
    flex: 1,
  },
});
