import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { LocationPicker } from "@/components/LocationPicker";
import { Modal } from "@/components/Modal";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { Select } from "@/components/Select";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  addPropertyImages,
  archiveProperty,
  createProperty,
  deletePropertyImage,
  deletePropertyPermanently,
  geocodeAddress,
  getPropertyForEdit,
  listPropertyImages,
  updateProperty,
  uploadPropertyImage,
  type ExistingPropertyImage,
  type NewPropertyInput,
} from "@/services/properties";
import { chargePropertyRegister } from "@/services/payments";
import { canRegisterProperty, isAdmin } from "@/services/roles";
import { translateOption, MOCK_REGIONS } from "@/constants/mockData";
import {
  belongsToListingType,
  optionGroupsFor,
  PROPERTY_OPTION_VALUE_PATTERN,
} from "@/constants/propertyOptions";

/**
 * [STEP 04] 매물 등록 화면 (Admin 전용, 최소 버전).
 *
 * 지금까지 매물을 넣는 방법은 Supabase SQL Editor 수동 insert뿐이었다. 이 화면은
 * properties 테이블에 직접 INSERT하는 최소 폼이다. 사진 업로드(Storage `property-images`
 * 버킷 → property_images 연결)와 사진 개별 삭제까지 지원한다 — Agency 계정 등록 경로는
 * 여전히 범위 밖이다(D46 Agency 온보딩 결정이 선행되어야 한다).
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

/** 한 매물에 첨부할 수 있는 사진 최대 장수(2026-09-11 사용자 지정: 6장).
 *  화면에는 가로 3칸 × 2줄로 항상 6칸을 그려 두고, 빈 칸은 카메라 아이콘으로 보여준다. */
const MAX_PHOTOS = 6;

/** 사진 그리드 한 줄에 놓는 칸 수. MAX_PHOTOS / PHOTOS_PER_ROW = 줄 수(2줄). */
const PHOTOS_PER_ROW = 3;

export default function PropertyRegisterScreen() {
  const theme = colors.light;
  const { t, i18n } = useTranslation();
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
  // [2026-09-11 사용자 지시 — 4차] 지역 — 투자상품 등록과 같은 목록·같은 모양(맨 위 가로 슬라이드).
  const [region, setRegion] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  // [2026-09-11] 편의시설: 자유 입력 → 목록에서 선택. 값은 기존 데이터와 같은
  // 베트남어 원문(PROPERTY_OPTION_KEYS)으로 저장해 표시 로직을 바꾸지 않는다.
  const [amenities, setAmenities] = useState<string[]>([]);
  const [featured, setFeatured] = useState(false);
  const [publishNow, setPublishNow] = useState(true);

  const [photos, setPhotos] = useState<string[]>([]);
  // [STEP 04-사진삭제] 수정 모드에서만 채워진다 — 이미 DB(property_images)에 등록된 사진.
  // 위의 `photos`(아직 업로드 전인 로컬 파일)와 성격이 완전히 달라 따로 관리한다:
  // 이쪽은 ×를 누르면 **서버에서 즉시 지워지고 되돌릴 수 없다**.
  const [existingPhotos, setExistingPhotos] = useState<ExistingPropertyImage[]>([]);
  const [photoPendingDelete, setPhotoPendingDelete] = useState<ExistingPropertyImage | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; price?: string }>({});

  // [2026-09-11 사용자 지시] 옵션 목록은 거래 유형에 따라 완전히 달라진다.
  // 매매는 입지·단지·건물·물건 특성, 임대는 실제로 쓰는 가구·가전·조건이다.
  const amenityGroups = useMemo(() => optionGroupsFor(listingType), [listingType]);

  // 예전에 자유 입력으로 저장된 값(키 형식이 아닌 것)은 목록 어디에도 속하지 않아
  // 화면에서 사라진다 — 저장 시 조용히 지워지지 않도록 별도 그룹으로 보여준다.
  const legacyAmenities = useMemo(
    () => amenities.filter((item) => !PROPERTY_OPTION_VALUE_PATTERN.test(item)),
    [amenities],
  );

  /** 옵션 라벨 — 키면 i18n에서, 예전 자유 입력값이면 기존 사전으로 번역한다. */
  function optionLabel(value: string): string {
    if (!PROPERTY_OPTION_VALUE_PATTERN.test(value)) {
      return translateOption(value, i18n.language);
    }
    return t(`propertyOptions.${value}`);
  }

  /** 거래 유형을 바꾸면 반대 유형의 선택은 의미가 없으므로 걷어낸다(예전 값은 남긴다). */
  function handleListingTypeChange(next: "for_sale" | "for_rent") {
    setListingType(next);
    setAmenities((prev) =>
      prev.filter(
        (value) => !PROPERTY_OPTION_VALUE_PATTERN.test(value) || belongsToListingType(value, next),
      ),
    );
  }

  // 최대 장수는 "이미 등록된 사진 + 이번에 고른 사진" 합계로 센다.
  const remainingSlots = Math.max(0, MAX_PHOTOS - existingPhotos.length - photos.length);

  // 지도에 넘길 좌표 — 입력란(문자열)이 좌표의 단일 원본이고, 지도는 그 값을 읽고
  // 쓰기만 한다. 둘 중 하나라도 비어 있으면 "위치 미지정"으로 본다
  // (properties_geom_sync 트리거도 같은 규칙으로 geom을 NULL 처리한다).
  const pickedLatitude = parseNumber(latitude);
  const pickedLongitude = parseNumber(longitude);
  const hasPickedLocation = pickedLatitude !== null && pickedLongitude !== null;

  /** 갤러리에서 사진을 여러 장 고른다 — 업로드는 등록 제출 시점에 한 번에 수행한다. */
  async function handlePickPhotos() {
    if (remainingSlots === 0) {
      showToast(t("propertyRegister.photoLimitReached", { max: MAX_PHOTOS }));
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("propertyRegister.photoPermissionDenied"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.8,
    });
    if (result.canceled) return;

    setPhotos((prev) => {
      const merged = [...prev, ...result.assets.map((asset) => asset.uri)];
      // 같은 사진을 두 번 고르는 경우가 있어 중복 제거 후 남은 칸수만큼만 받는다.
      return Array.from(new Set(merged)).slice(0, MAX_PHOTOS - existingPhotos.length);
    });
  }

  /**
   * 입력한 주소로 좌표를 찾아 지도를 그 위치로 옮긴다.
   *
   * 결과는 **제안**이다 — Geocoding은 상세주소가 없으면 동/구 중심 같은 대략적인
   * 위치를 돌려주므로, 찾은 좌표를 그대로 확정하지 않고 지도에 마커로 올려 두고
   * 등록자가 끌어서 실제 위치로 맞추게 한다.
   */
  async function handleGeocodeAddress() {
    const target = address.trim();
    if (target.length < 4) {
      showToast(t("propertyRegister.geocodeAddressTooShort"));
      return;
    }

    setGeocoding(true);
    const result = await geocodeAddress(target);
    setGeocoding(false);

    if (!result.ok) {
      showToast(
        result.reason === "not-found"
          ? t("propertyRegister.geocodeNotFound")
          : result.reason === "forbidden"
            ? t("propertyRegister.geocodeForbidden")
            : t("propertyRegister.geocodeFailed"),
      );
      return;
    }

    setLatitude(result.latitude.toFixed(6));
    setLongitude(result.longitude.toFixed(6));
    showToast(t("propertyRegister.geocodeFound", { address: result.formattedAddress }));
  }

  /** 이미 등록된 사진 1장 삭제 — 확인 모달에서 확정된 뒤에만 호출된다. */
  async function handleDeleteExistingPhoto() {
    const target = photoPendingDelete;
    if (!target) return;

    setDeletingPhoto(true);
    const ok = await deletePropertyImage(target.id, target.url);
    setDeletingPhoto(false);
    setPhotoPendingDelete(null);

    if (!ok) {
      showToast(t("propertyRegister.photoDeleteFailed"));
      return;
    }
    setExistingPhotos((prev) => prev.filter((item) => item.id !== target.id));
    showToast(t("propertyRegister.photoDeleted"));
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
      setPrice(formatThousands(String(existing.price)));
      setArea(existing.area !== null ? String(existing.area) : "");
      setBedrooms(existing.bedrooms !== null ? String(existing.bedrooms) : "");
      setBathrooms(existing.bathrooms !== null ? String(existing.bathrooms) : "");
      setAddress(existing.address ?? "");
      setRegion(existing.region ?? "");
      setLatitude(existing.latitude !== null ? String(existing.latitude) : "");
      setLongitude(existing.longitude !== null ? String(existing.longitude) : "");
      setAmenities(existing.amenities ?? []);
      setFeatured(existing.featured);
      setPublishNow(existing.status === "active");
      setLoadingExisting(false);
    });

    // 사진은 본문 로딩과 별개로 가져온다 — 사진 조회가 늦거나 실패해도 폼 자체는
    // 열려야 한다(사진이 없으면 빈 목록으로 표시될 뿐이다).
    listPropertyImages(editingId).then((images) => {
      if (mounted) setExistingPhotos(images);
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
  /**
   * [2026-09-12 사용자 지시] 금액 입력에 세 자리마다 쉼표.
   *
   * 숫자만 남기고 다시 묶는다 — 사용자가 중간에 쉼표를 지우거나 붙여넣어도 표기가
   * 흐트러지지 않는다. 저장할 때는 parseNumber가 쉼표를 걷어내므로 값에는 영향이 없다.
   */
  function formatThousands(value: string): string {
    const digits = value.replace(/[^\d]/g, "");
    if (digits.length === 0) return "";
    return Number(digits).toLocaleString("en-US");
  }

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
      region,
      latitude: parseNumber(latitude),
      longitude: parseNumber(longitude),
      amenities,
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

    // 수정 모드에서는 새로 고른 사진만 추가한다 — 기존 사진은 그대로 두고, 지우는 것은
    // 사진 칸의 ×(즉시 삭제, 저장 버튼과 무관)로 처리한다.
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

    // [2026-09-11 사용자 지시] 매물 등록 요금 차감 — 신규 등록에만 물린다(수정은
    // 이미 낸 요금이다). 잔액이 모자라면 서버가 요금을 물리지 않고 그 매물을
    // 미노출(draft)로 내려 둔다("등록은 하되 미노출로 저장"). 요금이 0이거나 Agency
    // 없이 등록하는 관리자 계정은 차감 없이 통과한다.
    let charged = true;
    if (!isEditing && targetId) {
      charged = await chargePropertyRegister(targetId);
    }

    setSubmitting(false);
    if (!linked) {
      showToast(t("propertyRegister.photoLinkFailed"));
    }

    // 저장 직후 그 매물 상세로 이동한다 — draft로 저장한 경우에는 공개 조회
    // (status='active')에 걸리지 않아 상세가 열리지 않으므로 이전 화면으로 돌아간다.
    if (!charged) {
      showToast(t("propertyRegister.savedAsDraftNoBalance"));
      router.back();
    } else if (publishNow) {
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
        <Header title={screenTitle} leftAction={<BackButton fallback="/my-properties" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my-properties" />} />
        <EmptyState
          title={t("propertyRegister.noPermissionTitle")}
          description={t("propertyRegister.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/my-properties" />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* [2026-09-11 사용자 지시 — 4차] 지역 — 컨텐츠 맨 위 가로 슬라이드.
            투자상품 등록 화면과 같은 목록·같은 모양으로 둔다(두 곳의 지역 값이
            같아야 지역으로 묶어 볼 수 있다). */}
        {/* [2026-09-12 사용자 지시] 제목을 아래 "기본 정보"와 같은 크기로 맞추고,
            제목과 칩 사이 간격을 좁힌다. content의 gap(lg)이 형제 사이에 끼어들어
            벌어져 있었으므로 둘을 한 View로 묶어 간격을 직접 정한다. */}
        <View style={styles.regionSection}>
        {/* [2026-09-12 사용자 지시] "기본 정보"와 완전히 같은 모양이어야 하므로 같은
            컴포넌트를 쓴다 — 스타일을 흉내 내면 SectionHeader가 바뀔 때 여기만 남는다. */}
        <SectionHeader title={t("propertyRegister.regionLabel")} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.regionRow}
        >
          {MOCK_REGIONS.map((item) => (
            <Chip
              key={item}
              label={item}
              active={region === item}
              onPress={() => setRegion(region === item ? "" : item)}
              theme={theme}
              tone="accent"
            />
          ))}
        </ScrollView>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.basicSection")} />

          {/* [2026-09-12 사용자 지시] 카테고리를 기본 정보의 첫 항목으로 올린다.
              [2026-09-11] 칩 나열 → 셀렉트. 카테고리는 8종이라 칩으로 펼치면 자리를
              많이 차지하고 선택된 값이 한눈에 들어오지 않는다.
              Select의 label은 Input의 label과 같은 스타일이라(sm·medium·본문색)
              "매물명"과 크기·색이 자동으로 맞는다. */}
          <Select
            label={t("propertyRegister.categoryLabel")}
            value={category}
            options={DB_CATEGORIES.map((item) => ({
              value: item,
              label: t(`propertyRegister.dbCategory.${item}`),
            }))}
            onChange={(next) => setCategory(next as DbCategory)}
            theme={theme}
            closeLabel={t("common.cancel")}
          />

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
          <SectionHeader title={t("propertyRegister.priceSection")} />

          {/* [2026-09-12 사용자 지시] 거래 유형을 가격·면적의 첫 항목으로 올린다.
              바로 아래 가격 입력의 라벨(매매가/월세)이 이 값에 따라 바뀌므로, 먼저
              고르는 순서가 자연스럽다. 아래 옵션 목록도 계속 이 선택을 따라간다. */}
          <SegmentedToggle
            label={t("propertyRegister.listingTypeLabel")}
            value={listingType}
            options={[
              { value: "for_sale", label: t("property.status.forSale") },
              { value: "for_rent", label: t("property.status.forRent") },
            ]}
            onChange={(next) => handleListingTypeChange(next as "for_sale" | "for_rent")}
            theme={theme}
          />

          <Input
            label={
              listingType === "for_rent"
                ? t("propertyRegister.priceRentLabel")
                : t("propertyRegister.priceSaleLabel")
            }
            value={price}
            onChangeText={(next) => {
              setPrice(formatThousands(next));
              // 고치는 중에 예전 오류 문구가 남아 있으면 방금 입력이 틀린 것처럼 보인다.
              if (errors.price) setErrors((prev) => ({ ...prev, price: undefined }));
            }}
            keyboardType="numeric"
            error={errors.price}
            helperText={t("propertyRegister.priceHelper")}
          />
          <Input
            label={t("propertyRegister.areaLabel")}
            value={area}
            onChangeText={setArea}
            keyboardType="numeric"
          />
          <View style={styles.row}>
            <Input
              label={t("propertyRegister.bedroomsLabel")}
              value={bedrooms}
              onChangeText={setBedrooms}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
            <Input
              label={t("propertyRegister.bathroomsLabel")}
              value={bathrooms}
              onChangeText={setBathrooms}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.locationSection")} />
          <Input
            label={t("propertyRegister.addressLabel")}
            value={address}
            onChangeText={setAddress}
            placeholder={t("propertyRegister.addressPlaceholder")}
            helperText={t("propertyRegister.addressHelper")}
          />
          {/* [STEP 04-지오코딩] 입력한 주소로 지도를 대략적인 위치까지 옮겨 준다.
              찾은 좌표는 확정이 아니라 출발점이다 — 아래 지도에서 마커를 끌어 맞춘다. */}
          <Button
            title={geocoding ? t("propertyRegister.geocoding") : t("propertyRegister.geocodeButton")}
            variant="outline"
            onPress={handleGeocodeAddress}
            disabled={geocoding || submitting}
            style={styles.submitButton}
          />
          {/* [STEP 04-위치선택] 지도에서 마커로 위치 지정(2026-09-11 요구사항).
              베트남 매물은 상세주소를 끝까지 적지 않는 경우가 많아 주소 문자열만으로는
              위치가 특정되지 않는다 — 지도를 눌러 좌표를 직접 찍는다. 아래 위도/경도
              입력란은 그대로 두어(지도가 없는 웹 미리보기, 좌표를 이미 아는 경우)
              양쪽 어느 쪽으로 넣어도 같은 값이 되도록 했다. */}
          <LocationPicker
            latitude={pickedLatitude ?? undefined}
            longitude={pickedLongitude ?? undefined}
            onChange={({ latitude: nextLat, longitude: nextLng }) => {
              // 소수점 6자리 ≈ 0.1m — 그 이상은 GPS 정밀도를 넘어서는 자릿수다.
              setLatitude(nextLat.toFixed(6));
              setLongitude(nextLng.toFixed(6));
            }}
            theme={theme}
            hintLabel={
              hasPickedLocation
                ? t("propertyRegister.mapHintPicked")
                : t("propertyRegister.mapHintEmpty")
            }
            unavailableLabel={t("propertyRegister.mapUnavailable")}
          />
          <View style={styles.row}>
            <Input
              label={t("propertyRegister.latitudeLabel")}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
            <Input
              label={t("propertyRegister.longitudeLabel")}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
          </View>
          {hasPickedLocation ? (
            <Pressable
              onPress={() => {
                setLatitude("");
                setLongitude("");
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
            >
              <Text style={[textStyles.caption, styles.noticeText, { color: theme.accent }]}>
                {t("propertyRegister.clearLocation")}
              </Text>
            </Pressable>
          ) : (
            <Text style={[textStyles.caption, styles.noticeText, { color: theme.secondaryText }]}>
              {t("propertyRegister.locationOptionalNotice")}
            </Text>
          )}
        </View>

        {/* [STEP 04-사진] 매물 사진 첨부 — Storage(property-images 버킷)에 업로드하고
            등록 완료 시 property_images에 연결한다. 사진을 넣지 않으면 기존처럼
            카테고리 기본 이미지로 표시된다. */}
        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.photosSection")} />
          {/* [2026-09-11 사용자 지시] 가로 3칸 × 2줄, 총 6칸을 항상 그린다.
              채워진 칸은 사진 미리보기, 빈 칸은 카메라 아이콘(누르면 사진 선택).
              앞쪽은 이미 등록된 사진(대표 사진이 맨 앞), 그 뒤가 이번에 고른 사진이다
              — addPropertyImages가 붙이는 순서와 같다. */}
          <View style={styles.photoGrid}>
            {Array.from({ length: MAX_PHOTOS }).map((_, slot) => {
              const existing = existingPhotos[slot];
              const picked = existing ? undefined : photos[slot - existingPhotos.length];

              if (!existing && !picked) {
                return (
                  <Pressable
                    key={`empty-${slot}`}
                    onPress={handlePickPhotos}
                    accessibilityRole="button"
                    accessibilityLabel={t("propertyRegister.addPhoto")}
                    style={({ pressed }) => [
                      styles.photoSlot,
                      styles.photoAdd,
                      { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                    ]}
                  >
                    <Ionicons name="camera-outline" size={22} color={theme.secondaryText} />
                  </Pressable>
                );
              }

              const uri = existing ? existing.url : (picked as string);
              return (
                <View key={existing ? existing.id : uri} style={[styles.photoSlot, styles.photoFilled]}>
                  <Image source={{ uri }} style={styles.photoImage} resizeMode="cover" />
                  <Pressable
                    onPress={() =>
                      existing
                        ? setPhotoPendingDelete(existing)
                        : setPhotos((prev) => prev.filter((item) => item !== uri))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      existing ? t("propertyRegister.deletePhoto") : t("propertyRegister.removePhoto")
                    }
                    hitSlop={6}
                    style={styles.photoRemove}
                    disabled={deletingPhoto}
                  >
                    <Ionicons name="close-circle" size={22} color="#FFFFFF" />
                  </Pressable>
                  {slot === 0 ? (
                    <View style={[styles.photoBadge, { backgroundColor: theme.accent }]}>
                      <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                        {t("propertyRegister.mainPhoto")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("propertyRegister.photosHelper")}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("propertyRegister.optionsSection")} />

          {/* [2026-09-11 사용자 지시] 옵션을 분류별로 모두 보여주고 골라서 넣는다.
              거래 유형(매매/임대)에 따라 목록 자체가 바뀐다. */}
          <Text style={[textStyles.bodySmall, styles.amenityTitle, { color: theme.text }]}>
            {t("propertyRegister.amenitiesLabel")}
          </Text>

          {amenityGroups.map((group) => (
            <View key={group.id} style={styles.amenityGroup}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t(`propertyOptions.groups.${listingType === "for_sale" ? "sale" : "rent"}.${group.id}`)}
              </Text>
              <View style={styles.chipWrap}>
                {group.values.map((option) => (
                  <Chip
                    key={option}
                    label={optionLabel(option)}
                    active={amenities.includes(option)}
                    onPress={() =>
                      setAmenities((prev) =>
                        prev.includes(option)
                          ? prev.filter((item) => item !== option)
                          : [...prev, option],
                      )
                    }
                    theme={theme}
                    tone="accent"
                  />
                ))}
              </View>
            </View>
          ))}

          {/* 예전 자유 입력으로 저장된 값 — 목록 어디에도 속하지 않지만 지우지 않는다. */}
          {legacyAmenities.length > 0 ? (
            <View style={styles.amenityGroup}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("propertyRegister.amenitiesLegacyGroup")}
              </Text>
              <View style={styles.chipWrap}>
                {legacyAmenities.map((option) => (
                  <Chip
                    key={option}
                    label={optionLabel(option)}
                    active
                    onPress={() =>
                      setAmenities((prev) => prev.filter((item) => item !== option))
                    }
                    theme={theme}
                    tone="accent"
                  />
                ))}
              </View>
            </View>
          ) : null}

          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("propertyRegister.amenitiesHelper", { selected: amenities.length })}
          </Text>
          {/* [2026-09-11 사용자 지시] 노출/미노출을 둘 다 보여준다 — 아이콘 하나로
              켜짐/꺼짐을 표현하면 "지금 어느 쪽인지"는 알아도 "반대가 무엇인지"가
              드러나지 않는다. */}
          <SegmentedToggle
            label={t("propertyRegister.publishLabel")}
            value={publishNow ? "on" : "off"}
            options={[
              { value: "on", label: t("propertyRegister.publishOn") },
              { value: "off", label: t("propertyRegister.publishOff") },
            ]}
            onChange={(next) => setPublishNow(next === "on")}
            theme={theme}
            description={t("propertyRegister.publishDescription")}
          />

          {/* [2026-09-12 사용자 지시] 광고(추천매물 / TOP10) 진입점은 이 폼에서 뺐다.
              광고는 설정하는 즉시 반영되고 매물 "저장"과 무관한데, 폼 안에 있으면
              저장해야 적용되는 것처럼 읽힌다. MY > 내 매물 목록의 "광고" 버튼으로 옮겼다. */}
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
        {photos.length === 0 && existingPhotos.length === 0 ? (
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

      {/* [STEP 04-사진삭제] 사진 1장 삭제 확인 — Storage 파일까지 지우므로 되돌릴 수 없다.
          매물 삭제 모달과 달리 선택지가 하나뿐이라 확인/취소 두 버튼으로 끝낸다. */}
      <Modal
        visible={!!photoPendingDelete}
        onClose={() => setPhotoPendingDelete(null)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("propertyRegister.deletePhotoTitle")}
        </Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginBottom: spacing.md }]}>
          {t("propertyRegister.deletePhotoDescription")}
        </Text>
        <Button
          title={deletingPhoto ? t("propertyRegister.deletingPhoto") : t("propertyRegister.deletePhotoConfirm")}
          onPress={handleDeleteExistingPhoto}
          disabled={deletingPhoto}
          style={styles.submitButton}
        />
        <Button
          title={t("common.cancel")}
          variant="outline"
          onPress={() => setPhotoPendingDelete(null)}
          disabled={deletingPhoto}
          style={[styles.submitButton, styles.modalSecondaryButton]}
        />
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
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
      {/* [2026-09-11 사용자 지시] 원형 체크를 이름 **앞**에 둔다. 오른쪽 끝에 있을
          때보다 "무엇이 켜져 있는지"가 이름과 함께 한 번에 읽힌다. */}
      <Ionicons
        name={value ? "checkmark-circle" : "ellipse-outline"}
        size={22}
        color={value ? theme.accent : theme.secondaryText}
      />
      <View style={styles.toggleTexts}>
        <Text style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}>{label}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 지역 슬라이드 — 칩 사이 간격만 두고 좌우 여백은 content가 이미 갖고 있다.
  regionSection: {
    gap: spacing.xs,
  },
  regionRow: {
    gap: spacing.xs,
    // 제목과 칩 사이는 위 gap이 맡는다 — 여기서 또 띄우면 두 번 벌어진다.
    paddingVertical: 0,
  },
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
  amenityTitle: {
    fontWeight: typography.weight.medium,
  },
  amenityGroup: {
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
  // 가로 3칸 고정. 칸 너비를 32%로 두고 space-between으로 배치하면 남는 4%가
  // 칸 사이 두 틈으로 나뉜다 — RN의 gap은 퍼센트를 받지 않아 이 방식이 가장 안전하다.
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.sm,
  },
  photoSlot: {
    width: "32%",
    aspectRatio: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  photoFilled: {
    position: "relative",
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
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  submitButton: {
    width: "100%",
  },
  modalSecondaryButton: {
    marginTop: spacing.sm,
  },
  noticeText: {
    textAlign: "center",
  },
});
