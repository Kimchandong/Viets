import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  addPropertyImages,
  archiveProperty,
  createProperty,
  deletePropertyPermanently,
  getPropertyForEdit,
  updateProperty,
  uploadPropertyImage,
  type NewPropertyInput,
} from "@/services/properties";
import { canRegisterProperty, isAdmin } from "@/services/roles";

/**
 * [STEP 04] 매물 등록 화면 (Admin 전용, 최소 버전).
 *
 * 지금까지 매물을 넣는 방법은 Supabase SQL Editor 수동 insert뿐이었다. 이 화면은
 * properties 테이블에 직접 INSERT하는 최소 폼이다 — 사진 업로드(property_images,
 * Storage 연동)와 Agency 계정 등록 경로는 이번 범위에 넣지 않았다(각각 Storage
 * 설계와 D46 Agency 온보딩 결정이 선행되어야 한다).
 *
 * 권한: 화면 진입 시 services/roles.ts로 admin 계열인지 확인해 아니면 안내만 띄운다.
 * 다만 이는 UI 가드일 뿐이고, 실제 차단은 properties RLS가 서버에서 수행한다.
 *
 * 카테고리는 **DB enum(property_category, 8종) 값을 그대로** 쓴다 — 화면 필터의
 * UI 카테고리(6종)와 다르며, 변환은 조회 시 services/properties.ts가 담당한다.
 */

const DB_CATEGORIES = [
  "apartment",
  "villa",
  "townhouse",
  "land",
  "office",
  "retail",
  "hotel",
  "industrial",
] as const;

type DbCategory = (typeof DB_CATEGORIES)[number];

/** 한 매물에 첨부할 수 있는 사진 최대 장수 — 업로드 시간이 장수에 비례해 늘어난다. */
const MAX_PHOTOS = 10;

export default function PropertyRegisterScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  // [STEP 04-수정] 같은 화면을 등록/수정 두 용도로 쓴다 — `?id=<매물id>`로 진입하면
  // 수정 모드가 되어 기존 값을 불러오고, 제출 시 update를 호출한다. 별도 화면을
  // 만들지 않은 이유: 입력 항목과 검증 규칙이 완전히 동일하기 때문이다.
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id;
  const isEditing = !!editingId;

  const [checkingPermission, setCheckingPermission] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!editingId);
  const [canHardDelete, setCanHardDelete] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<DbCategory>("apartment");
  const [listingType, setListingType] = useState<"for_sale" | "for_rent">("for_sale");
  const [price, setPrice] = useState("");
  const [area, setArea] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [amenities, setAmenities] = useState("");
  const [featured, setFeatured] = useState(false);
  const [publishNow, setPublishNow] = useState(true);

  const [photos, setPhotos] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; price?: string }>({});

  /** 갤러리에서 사진을 여러 장 고른다 — 업로드는 등록 제출 시점에 한 번에 수행한다. */
  async function handlePickPhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("propertyRegister.photoPermissionDenied"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS,
      quality: 0.8,
    });
    if (result.canceled) return;

    setPhotos((prev) => {
      const merged = [...prev, ...result.assets.map((asset) => asset.uri)];
      // 같은 사진을 두 번 고르는 경우가 있어 중복 제거 후 최대 장수로 자른다.
      return Array.from(new Set(merged)).slice(0, MAX_PHOTOS);
    });
  }

  useEffect(() => {
    let mounted = true;
    canRegisterProperty().then((ok) => {
      if (mounted) {
        setAllowed(ok);
        setCheckingPermission(false);
      }
    });
    // 하드 삭제는 admin 계열만 가능하다(RLS도 동일) — 버튼 노출 판단용.
    isAdmin().then((ok) => {
      if (mounted) setCanHardDelete(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // 수정 모드: 기존 값을 폼에 채운다.
  useEffect(() => {
    let mounted = true;
    if (!editingId) return;

    getPropertyForEdit(editingId).then((existing) => {
      if (!mounted) return;
      if (!existing) {
        setLoadingExisting(false);
        showToast(t("propertyRegister.loadFailed"));
        return;
      }
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setCategory((DB_CATEGORIES as readonly string[]).includes(existing.category)
        ? (existing.category as DbCategory)
        : "apartment");
      setListingType(existing.listing_type);
      setPrice(String(existing.price));
      setArea(existing.area !== null ? String(existing.area) : "");
      setBedrooms(existing.bedrooms !== null ? String(existing.bedrooms) : "");
      setBathrooms(existing.bathrooms !== null ? String(existing.bathrooms) : "");
      setAddress(existing.address ?? "");
      setLatitude(existing.latitude !== null ? String(existing.latitude) : "");
      setLongitude(existing.longitude !== null ? String(existing.longitude) : "");
      setAmenities((existing.amenities ?? []).join(", "));
      setFeatured(existing.featured);
      setPublishNow(existing.status === "active");
      setLoadingExisting(false);
    });
    return () => {
      mounted = false;
    };
    // t/showToast는 렌더마다 새로 만들어지지 않는 값이라 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  /** "1,234" / "1 234" 같은 입력도 받아들이되, 숫자가 아니면 null을 돌려준다. */
  function parseNumber(value: string): number | null {
    const cleaned = value.replace(/[,\s]/g, "");
    if (cleaned.length === 0) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function handleSubmit() {
    const nextErrors: { title?: string; price?: string } = {};
    if (title.trim().length === 0) {
      nextErrors.title = t("propertyRegister.errorTitleRequired");
    }
    const priceValue = parseNumber(price);
    if (priceValue === null || priceValue <= 0) {
      nextErrors.price = t("propertyRegister.errorPriceRequired");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: NewPropertyInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      listing_type: listingType,
      price: priceValue as number,
      area: parseNumber(area),
      bedrooms: parseNumber(bedrooms),
      bathrooms: parseNumber(bathrooms),
      address: address.trim(),
      latitude: parseNumber(latitude),
      longitude: parseNumber(longitude),
      // 쉼표로 구분해 입력받고 빈 항목은 버린다(DB는 text[] 컬럼).
      amenities: amenities
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
      featured,
      status: publishNow ? "active" : "draft",
    };

    setSubmitting(true);

    // 사진을 먼저 업로드한다 — 매물 row를 만든 뒤 업로드가 실패하면 사진 없는 매물이
    // 남지만, 반대로 업로드부터 하면 실패 시 아무것도 만들지 않고 그대로 멈출 수 있다.
    const uploadedUrls: string[] = [];
    for (const uri of photos) {
      const url = await uploadPropertyImage(uri);
      if (!url) {
        setSubmitting(false);
        showToast(t("propertyRegister.photoUploadFailed"));
        return;
      }
      uploadedUrls.push(url);
    }

    // 수정 모드에서는 새로 고른 사진만 추가한다(기존 사진은 그대로 둔다 — 기존 사진
    // 개별 삭제는 이번 범위 밖).
    const targetId = isEditing ? (editingId as string) : await createProperty(payload);

    if (isEditing) {
      const updated = await updateProperty(editingId as string, payload);
      if (!updated) {
        setSubmitting(false);
        showToast(t("propertyRegister.submitFailed"));
        return;
      }
    } else if (!targetId) {
      setSubmitting(false);
      showToast(t("propertyRegister.submitFailed"));
      return;
    }

    // 사진 연결이 실패해도 매물 자체는 이미 저장됐으므로 되돌리지 않고, 사용자에게만
    // 알린다(사진은 이후 다시 추가하면 된다).
    const linked = await addPropertyImages(targetId as string, uploadedUrls);
    setSubmitting(false);
    if (!linked) {
      showToast(t("propertyRegister.photoLinkFailed"));
    }
    // 저장 직후 그 매물 상세로 이동한다 — draft로 저장한 경우에는 공개 조회
    // (status='active')에 걸리지 않아 상세가 열리지 않으므로 이전 화면으로 돌아간다.
    if (publishNow) {
      router.replace(`/property-detail/${targetId}`);
    } else {
      showToast(t("propertyRegister.savedAsDraft"));
      router.back();
    }
  }

  /** 소프트 삭제 — 목록에서 감춘다(되돌릴 수 있다). */
  async function handleArchive() {
    if (!editingId) return;
    setDeleteModalVisible(false);
    setSubmitting(true);
    const ok = await archiveProperty(editingId);
    setSubmitting(false);
    if (!ok) {
      showToast(t("propertyRegister.deleteFailed"));
      return;
    }
    showToast(t("propertyRegister.archived"));
    router.replace("/property");
  }

  /** 하드 삭제 — 되돌릴 수 없다. admin 계열에게만 노출된다. */
  async function handleHardDelete() {
    if (!editingId) return;
    setDeleteModalVisible(false);
    setSubmitting(true);
    const ok = await deletePropertyPermanently(editingId);
    setSubmitting(false);
    if (!ok) {
      showToast(t("propertyRegister.deleteFailed"));
      return;
    }
    showToast(t("propertyRegister.deleted"));
    router.replace("/property");
  }

  const screenTitle = isEditing ? t("propertyRegister.editTitle") : t("propertyRegister.title");

  if (checkingPermission || loadingExisting) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <EmptyState
          title={t("propertyRegister.noPermissionTitle")}
          description={t("propertyRegister.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.basicSection")} />
          <Input
            label={t("propertyRegister.titleLabel")}
            value={title}
            onChangeText={setTitle}
            error={errors.title}
            placeholder={t("propertyRegister.titlePlaceholder")}
          />
          <Input
            label={t("propertyRegister.descriptionLabel")}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            style={styles.multiline}
            placeholder={t("propertyRegister.descriptionPlaceholder")}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.categorySection")} />
          <View style={styles.chipWrap}>
            {DB_CATEGORIES.map((item) => (
              <Chip
                key={item}
                label={t(`propertyRegister.dbCategory.${item}`)}
                active={category === item}
                onPress={() => setCategory(item)}
                theme={theme}
                tone="accent"
              />
            ))}
          </View>
          <View style={styles.chipWrap}>
            <Chip
              label={t("property.status.forSale")}
              active={listingType === "for_sale"}
              onPress={() => setListingType("for_sale")}
              theme={theme}
              tone="accent"
            />
            <Chip
              label={t("property.status.forRent")}
              active={listingType === "for_rent"}
              onPress={() => setListingType("for_rent")}
              theme={theme}
              tone="accent"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.priceSection")} />
          <Input
            label={
              listingType === "for_rent"
                ? t("propertyRegister.priceRentLabel")
                : t("propertyRegister.priceSaleLabel")
            }
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            error={errors.price}
            helperText={t("propertyRegister.priceHelper")}
            placeholder="4200000000"
          />
          <Input
            label={t("propertyRegister.areaLabel")}
            value={area}
            onChangeText={setArea}
            keyboardType="numeric"
            placeholder="72"
          />
          <View style={styles.row}>
            <Input
              label={t("propertyRegister.bedroomsLabel")}
              value={bedrooms}
              onChangeText={setBedrooms}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
              placeholder="2"
            />
            <Input
              label={t("propertyRegister.bathroomsLabel")}
              value={bathrooms}
              onChangeText={setBathrooms}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
              placeholder="2"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.locationSection")} />
          <Input
            label={t("propertyRegister.addressLabel")}
            value={address}
            onChangeText={setAddress}
            placeholder="TP. Thủ Đức, TP. Hồ Chí Minh"
            helperText={t("propertyRegister.addressHelper")}
          />
          <View style={styles.row}>
            <Input
              label={t("propertyRegister.latitudeLabel")}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
              placeholder="10.8411"
            />
            <Input
              label={t("propertyRegister.longitudeLabel")}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
              placeholder="106.8296"
            />
          </View>
        </View>

        {/* [STEP 04-사진] 매물 사진 첨부 — Storage(property-images 버킷)에 업로드하고
            등록 완료 시 property_images에 연결한다. 사진을 넣지 않으면 기존처럼
            카테고리 기본 이미지로 표시된다. */}
        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.photosSection")} />
          <View style={styles.photoGrid}>
            {photos.map((uri, index) => (
              <View key={uri} style={styles.photoItem}>
                <Image source={{ uri }} style={styles.photoImage} resizeMode="cover" />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((item) => item !== uri))}
                  accessibilityRole="button"
                  accessibilityLabel={t("propertyRegister.removePhoto")}
                  hitSlop={6}
                  style={styles.photoRemove}
                >
                  <Ionicons name="close-circle" size={22} color="#FFFFFF" />
                </Pressable>
                {index === 0 ? (
                  <View style={[styles.photoBadge, { backgroundColor: theme.accent }]}>
                    <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                      {t("propertyRegister.mainPhoto")}
                    </Text>
                  </View>
                ) : null}
              </View>
            ))}
            <Pressable
              onPress={handlePickPhotos}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.photoAdd,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="camera-outline" size={24} color={theme.secondaryText} />
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("propertyRegister.addPhoto")}
              </Text>
            </Pressable>
          </View>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("propertyRegister.photosHelper")}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.optionsSection")} />
          <Input
            label={t("propertyRegister.amenitiesLabel")}
            value={amenities}
            onChangeText={setAmenities}
            placeholder="Hồ bơi, Phòng gym, Bãi đỗ xe"
            helperText={t("propertyRegister.amenitiesHelper")}
          />
          <ToggleRow
            label={t("propertyRegister.featuredLabel")}
            description={t("propertyRegister.featuredDescription")}
            value={featured}
            onToggle={() => setFeatured((prev) => !prev)}
          />
          <ToggleRow
            label={t("propertyRegister.publishLabel")}
            description={t("propertyRegister.publishDescription")}
            value={publishNow}
            onToggle={() => setPublishNow((prev) => !prev)}
          />
        </View>

        <Button
          title={
            submitting
              ? t("propertyRegister.submitting")
              : isEditing
                ? t("propertyRegister.save")
                : t("propertyRegister.submit")
          }
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.submitButton}
        />

        {/* [STEP 04-삭제] 수정 모드에서만 노출. 실제 삭제 방식(감추기/완전삭제)은
            아래 확인 모달에서 고른다 — 실수로 지워지지 않도록 한 단계를 둔다. */}
        {isEditing ? (
          <Button
            title={t("propertyRegister.delete")}
            variant="outline"
            onPress={() => setDeleteModalVisible(true)}
            disabled={submitting}
            style={styles.submitButton}
          />
        ) : null}
        {photos.length === 0 ? (
          <Text style={[textStyles.caption, styles.noticeText, { color: theme.secondaryText }]}>
            {t("propertyRegister.photoNotice")}
          </Text>
        ) : null}
      </ScrollView>
      <Modal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("propertyRegister.deleteTitle")}
        </Text>

        <Pressable
          onPress={handleArchive}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.deleteOption,
            { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Text style={[textStyles.body, { color: theme.text }]}>{t("propertyRegister.archiveOption")}</Text>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("propertyRegister.archiveOptionDescription")}
          </Text>
        </Pressable>

        {/* 하드 삭제는 admin 계열에게만 보인다(RLS도 동일하게 막는다). */}
        {canHardDelete ? (
          <Pressable
            onPress={handleHardDelete}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.deleteOption,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.body, { color: theme.danger }]}>
              {t("propertyRegister.hardDeleteOption")}
            </Text>
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("propertyRegister.hardDeleteOptionDescription")}
            </Text>
          </Pressable>
        ) : null}
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const theme = colors.light;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
    >
      <Ionicons name="chevron-back" size={24} color={theme.text} />
    </Pressable>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onToggle,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}) {
  const theme = colors.light;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [
        styles.toggleRow,
        { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <View style={styles.toggleTexts}>
        <Text style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}>{label}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{description}</Text>
      </View>
      <Ionicons
        name={value ? "checkmark-circle" : "ellipse-outline"}
        size={24}
        color={value ? theme.accent : theme.secondaryText}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  rowItem: {
    flex: 1,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  toggleTexts: {
    flex: 1,
    gap: 2,
  },
  deleteOption: {
    gap: 2,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  photoItem: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  photoRemove: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  photoBadge: {
    position: "absolute",
    left: 0,
    bottom: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderTopRightRadius: radius.sm,
  },
  photoAdd: {
    width: 96,
    height: 96,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  submitButton: {
    width: "100%",
  },
  noticeText: {
    textAlign: "center",
  },
});
