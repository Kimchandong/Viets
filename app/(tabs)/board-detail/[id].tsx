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
import { colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import {
  answerQuestion,
  deleteBoardPost,
  getAdjacentPosts,
  getBoardPost,
  type BoardPost,
} from "@/services/boards";
import { isAdmin } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 게시판 글 상세 — 공지사항 / QA / FAQ 공용.
 *
 * 사용자와 관리자가 **같은 화면**을 본다. 관리자에게만 하단에 수정·삭제(QA는 답변)가
 * 더 보일 뿐이다. 관리자용 상세를 따로 두면 같은 글이 두 화면에서 다르게 보이고,
 * 한쪽만 고치는 일이 반복된다.
 *
 * 보여 주는 본문은 뷰어 언어로 고른 것이다(번역본이 없으면 원문). 다만 관리자가
 * 수정으로 넘어갈 때는 원문을 고치러 간다 — 번역본을 고치면 다음 저장 때 원문에서
 * 다시 번역되면서 수정이 사라지기 때문이다.
 *
 * 하단 이전글/다음글은 작성일 하나로만 앞뒤를 정한다(services/boards.ts 주석 참고).
 */

export default function BoardDetailScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [post, setPost] = useState<BoardPost | null>(null);
  const [previous, setPrevious] = useState<BoardPost | null>(null);
  const [next, setNext] = useState<BoardPost | null>(null);
  const [adminUser, setAdminUser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const row = await getBoardPost(id, i18n.language);
    setPost(row);
    setAnswerText(row?.answerBody ?? "");

    if (row) {
      const adjacent = await getAdjacentPosts(row.kind, row.createdAt, i18n.language);
      setPrevious(adjacent.previous);
      setNext(adjacent.next);
    }
    setLoading(false);
  }, [id, i18n.language]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isAdmin().then((ok) => {
        if (active) setAdminUser(ok);
      });
      load();
      return () => {
        active = false;
      };
    }, [load]),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handleDelete() {
    if (!post || busy) return;
    setBusy(true);
    const ok = await deleteBoardPost(post.id);
    setBusy(false);
    setConfirmDelete(false);

    if (!ok) {
      showToast(t("adminBoards.deleteFailed"));
      return;
    }
    router.back();
  }

  async function handleAnswer() {
    if (!post || busy || answerText.trim().length === 0) return;
    setBusy(true);
    const ok = await answerQuestion(post.id, answerText.trim());
    setBusy(false);
    setAnswerOpen(false);
    showToast(ok ? t("adminBoards.answered") : t("adminBoards.saveFailed"));
    if (ok) await load();
  }

  const screenTitle = post ? t(`board.kind.${post.kind}`) : t("board.title");

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/home" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/home" />} />
        <EmptyState title={t("adminBoards.notFound")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={[]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/home" />} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* [2026-09-11 사용자 지시] 목록 아이콘 — 헤더가 아니라 콘텐츠 영역 안,
            제목 위 우측. 회색으로 둬서 제목보다 앞서 읽히지 않게 한다.
            router.navigate는 스택에 이미 목록이 있으면 그것을 다시 쓴다(push처럼 같은
            목록이 겹겹이 쌓이지 않고, replace처럼 뒤로가기 대상을 망가뜨리지도 않는다). */}
        <View style={styles.listIconRow}>
          <Pressable
            onPress={() => router.navigate({ pathname: "/boards", params: { kind: post.kind } })}
            accessibilityRole="button"
            accessibilityLabel={t("board.goToList")}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
          >
            <Ionicons name="list-outline" size={22} color={theme.secondaryText} />
          </Pressable>
        </View>

        <Text style={[textStyles.sectionTitle, styles.postTitle, { color: theme.text }]}>{post.title}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {post.createdAt.slice(0, 10)}
          {post.kind === "qa"
            ? ` · ${post.answeredAt ? t("board.answered") : t("board.waiting")}`
            : ""}
          {adminUser && !post.published ? ` · ${t("adminBoards.hidden")}` : ""}
        </Text>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        {post.body.length > 0 ? (
          <Text style={[textStyles.bodySmall, { color: theme.text }]}>{post.body}</Text>
        ) : null}

        {/* 첨부 이미지 — 등록한 순서대로 세로로 이어 붙인다. */}
        {post.images.map((url) => (
          <Image key={url} source={{ uri: url }} style={styles.attachment} resizeMode="cover" />
        ))}

        {post.answerBody.length > 0 ? (
          <View style={[styles.answerBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[textStyles.caption, { color: theme.accent }]}>{t("board.adminAnswer")}</Text>
            <Text style={[textStyles.bodySmall, { color: theme.text }]}>{post.answerBody}</Text>
          </View>
        ) : null}

        {/* 관리자 전용 — 수정 / 삭제. 서버에서는 RLS가 다시 막으므로 이건 화면 가드다. */}
        {adminUser ? (
          <View style={styles.actions}>
            {post.kind === "qa" ? (
              <Button
                title={post.answeredAt ? t("adminBoards.editAnswer") : t("adminBoards.answer")}
                onPress={() => setAnswerOpen(true)}
                style={styles.actionButton}
              />
            ) : (
              <Button
                title={t("adminBoards.edit")}
                onPress={() =>
                  router.push({
                    pathname: "/admin-board-write",
                    params: { kind: post.kind, id: post.id },
                  })
                }
                style={styles.actionButton}
              />
            )}
            <Button
              variant="outline"
              title={t("adminBoards.delete")}
              onPress={() => setConfirmDelete(true)}
              style={styles.actionButton}
              textStyle={{ color: theme.danger }}
            />
          </View>
        ) : null}

        {/* 이전글 / 다음글 — 각각 한 건. 없으면 그 줄만 빠진다. */}
        <View style={[styles.navBox, { borderColor: theme.border }]}>
          <NavRow
            label={t("board.prevPost")}
            post={previous}
            theme={theme}
            emptyLabel={t("board.noPrevPost")}
            onPress={(target) => router.replace(`/board-detail/${target.id}`)}
          />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <NavRow
            label={t("board.nextPost")}
            post={next}
            theme={theme}
            emptyLabel={t("board.noNextPost")}
            onPress={(target) => router.replace(`/board-detail/${target.id}`)}
          />
        </View>
      </ScrollView>

      <Modal visible={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
          {t("adminBoards.deleteConfirm")}
        </Text>
        <Text style={[textStyles.bodySmall, { color: theme.secondaryText, marginTop: spacing.xs }]}>
          {post.originalTitle}
        </Text>
        <View style={styles.actions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setConfirmDelete(false)}
            style={styles.actionButton}
          />
          <Button
            title={t("adminBoards.delete")}
            onPress={handleDelete}
            loading={busy}
            style={styles.actionButton}
          />
        </View>
      </Modal>

      <Modal visible={answerOpen} onClose={() => setAnswerOpen(false)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{post.originalTitle}</Text>
        <Input
          label={t("adminBoards.answerLabel")}
          value={answerText}
          onChangeText={setAnswerText}
          multiline
          numberOfLines={6}
          style={styles.answerInput}
          containerStyle={styles.answerField}
        />
        <View style={styles.actions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setAnswerOpen(false)}
            style={styles.actionButton}
          />
          <Button
            title={t("common.save")}
            onPress={handleAnswer}
            loading={busy}
            style={styles.actionButton}
          />
        </View>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

/**
 * 이전글 / 다음글 한 줄.
 *
 * 글이 없어도 줄을 남기고 "이전글이 없습니다"로 채운다 — 줄째 사라지면 이전글이
 * 없는 것인지 기능이 없는 것인지 알 수 없다.
 */
function NavRow({
  label,
  post,
  theme,
  emptyLabel,
  onPress,
}: {
  label: string;
  post: BoardPost | null;
  theme: typeof colors.light;
  emptyLabel: string;
  onPress: (post: BoardPost) => void;
}) {
  const content = (
    <>
      <Text style={[textStyles.caption, styles.navLabel, { color: theme.secondaryText }]}>
        {label}
      </Text>
      <Text
        style={[textStyles.bodySmall, { color: post ? theme.text : theme.secondaryText, flex: 1 }]}
        numberOfLines={1}
      >
        {post ? post.title : emptyLabel}
      </Text>
      {post ? <Ionicons name="chevron-forward" size={16} color={theme.secondaryText} /> : null}
    </>
  );

  if (!post) {
    return <View style={styles.navRow}>{content}</View>;
  }
  return (
    <Pressable
      onPress={() => onPress(post)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.navRow, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      {content}
    </Pressable>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    // [2026-09-11 사용자 지시] 제목 위 여백 10px.
    paddingTop: 10,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  // 아이콘 한 줄 — 오른쪽 끝으로 붙인다.
  listIconRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  // [2026-09-11 사용자 지시] 제목 15px. sectionTitle 토큰은 moderateScale이 걸려
  // 기기 폭에 따라 값이 흔들리므로 여기만 고정한다.
  postTitle: {
    fontSize: 15,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  attachment: {
    width: "100%",
    height: 220,
    borderRadius: radius.sm,
  },
  answerBox: {
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  navBox: {
    borderWidth: 1,
    borderRadius: radius.sm,
    marginTop: spacing.lg,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // 라벨 폭을 고정해 두 줄의 제목 시작 위치를 맞춘다.
  navLabel: {
    width: 52,
  },
  answerField: {
    marginTop: spacing.sm,
  },
  answerInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
});
