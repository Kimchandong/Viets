import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import {
  createBoardPost,
  getBoardPost,
  updateBoardPost,
  uploadBoardImage,
  type BoardKind,
  type BoardPost,
} from "@/services/boards";
import { isAdmin } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 게시판 글쓰기 / 수정 — 관리자 전용.
 *
 * 목록에서 "글쓰기"로 들어오면 새 글(kind만 받음), 읽기 페이지에서 "수정"으로
 * 들어오면 그 글을 고친다(kind + id).
 *
 * 모달이 아니라 화면인 이유: 본문이 여러 줄이고 사진을 최대 3장 붙이므로 모달
 * 안에서는 스크롤이 겹쳐 다루기 어렵다. 읽기 페이지에서 수정으로 넘어오는 흐름도
 * 화면 이동이 자연스럽다.
 *
 * 고치는 대상은 항상 **원문**이다. 번역본을 고치면 저장할 때 원문에서 다시 번역돼
 * 수정이 사라진다.
 */

const MAX_IMAGES = 3;

export default function AdminBoardWriteScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();

  const kind: BoardKind =
    params.kind === "faq" ||
    params.kind === "qa" ||
    params.kind === "terms" ||
    params.kind === "privacy"
      ? (params.kind as BoardKind)
      : "notice";
  const postId = typeof params.id === "string" && params.id.length > 0 ? params.id : null;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<BoardPost | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!postId) {
      setLoading(false);
      return;
    }
    const row = await getBoardPost(postId, i18n.language);
    if (row) {
      setExisting(row);
      setTitle(row.originalTitle);
      setBody(row.originalBody);
      setImages(row.images);
    }
    setLoading(false);
  }, [postId, i18n.language]);

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
        await load();
      });
      return () => {
        active = false;
      };
      // load는 postId/언어에만 의존하므로 화면에 다시 들어와도 폼이 초기화되지 않는다.
    }, [load]),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handlePickImage() {
    if (images.length >= MAX_IMAGES) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("adminBoards.imagePermission"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    const url = await uploadBoardImage(result.assets[0].uri);
    if (!url) {
      showToast(t("adminBoards.imageFailed"));
      return;
    }
    setImages((prev) => [...prev, url].slice(0, MAX_IMAGES));
  }

  async function handleSave() {
    if (saving) return;
    if (title.trim().length === 0) {
      showToast(t("adminBoards.titleRequired"));
      return;
    }
    setSaving(true);

    const input = {
      kind,
      title: title.trim(),
      body: body.trim(),
      // 관리자가 지금 쓰고 있는 앱 언어를 원문 언어로 본다 — 한국어 화면에서 쓰면
      // ko가 출발 언어가 되고 나머지 다섯 언어가 만들어진다.
      sourceLang: i18n.language,
      imageUrls: kind === "notice" ? images : [],
    };

    // 제목·본문이 그대로면 번역을 다시 부르지 않는다(불필요한 과금).
    const textChanged =
      !existing || existing.originalTitle !== input.title || existing.originalBody !== input.body;

    const ok = existing
      ? await updateBoardPost(existing.id, input, textChanged)
      : (await createBoardPost(input)).ok;

    setSaving(false);
    if (!ok) {
      showToast(t("adminBoards.saveFailed"));
      return;
    }
    router.back();
  }

  const screenTitle = t(`board.kind.${kind}`);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/admin-boards" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (allowed === false) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/admin-boards" />} />
        <EmptyState title={t("adminBoards.adminOnly")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/admin-boards" />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Input
          label={kind === "faq" ? t("adminBoards.questionLabel") : t("adminBoards.titleLabel")}
          value={title}
          onChangeText={setTitle}
        />
        <Input
          label={kind === "faq" ? t("adminBoards.answerLabel") : t("adminBoards.bodyLabel")}
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={10}
          style={styles.bodyInput}
        />

        {kind === "notice" ? (
          <View>
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("adminBoards.imagesLabel", { count: images.length, max: MAX_IMAGES })}
            </Text>
            <View style={styles.imageRow}>
              {images.map((url, index) => (
                <View key={url} style={styles.imageBox}>
                  <Image source={{ uri: url }} style={styles.imageThumb} resizeMode="cover" />
                  <Pressable
                    onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                    accessibilityRole="button"
                    accessibilityLabel={t("adminBoards.removeImage")}
                    hitSlop={6}
                    style={styles.imageRemove}
                  >
                    <Ionicons name="close-circle" size={20} color={theme.danger} />
                  </Pressable>
                </View>
              ))}
              {images.length < MAX_IMAGES ? (
                <Pressable
                  onPress={handlePickImage}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.imageAdd,
                    { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Ionicons name="add" size={24} color={theme.secondaryText} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {t("adminBoards.translateHint")}
        </Text>

        <View style={styles.actions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => router.back()}
            style={styles.actionButton}
          />
          <Button
            title={t("common.save")}
            onPress={handleSave}
            loading={saving}
            style={styles.actionButton}
          />
        </View>
      </ScrollView>

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
    gap: spacing.md,
  },
  bodyInput: {
    minHeight: 160,
    textAlignVertical: "top",
  },
  imageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  imageBox: {
    position: "relative",
  },
  imageThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
  },
  imageRemove: {
    position: "absolute",
    top: -6,
    right: -6,
  },
  imageAdd: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
