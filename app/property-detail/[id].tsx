import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { LoginPromptModal } from "@/components/LoginPromptModal";
import { PropertyCard } from "@/components/PropertyCard";
import { PropertyMap } from "@/components/PropertyMap";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, ThemeColors, typography } from "@/constants/theme";
import {
  findSimilarPropertiesByArea,
  findSimilarPropertiesByPrice,
  findSimilarPropertiesByRooms,
  translateOption,
  type MockProperty,
} from "@/constants/mockData";
import { PROPERTY_OPTION_VALUE_PATTERN } from "@/constants/propertyOptions";
import { localizedText, splitYieldText } from "@/utils/format";
import { getSession, onAuthStateChange } from "@/services/auth";
import { getPropertyById } from "@/services/properties";
import {
  listInvestmentProductsByPropertyId,
} from "@/services/investments";
import { InvestmentCard } from "@/components/InvestmentCard";
import { type MockInvestmentProduct } from "@/constants/mockData";
import { isAdmin } from "@/services/roles";
import { useFavoritesStore } from "@/store/useFavoritesStore";

// [FULL-DEV] Property 상세 화면 — app/(tabs)/property.tsx(리스트/카드)와 app/(tabs)/home.tsx
// (추천 매물)의 카드 press가 여기로 연결된다. 기존 app/(tabs)/property.tsx 파일을 지우거나
// property/index.tsx + property/[id].tsx 구조로 리팩터링하지 않고, app/_layout.tsx의 루트
// Stack에 login.tsx/register.tsx와 같은 방식의 새 sibling 라우트로 추가했다 — 기존 파일을
// 삭제/이동하지 않는다는 이번 작업의 절대 제약을 지키기 위한 선택이다.
//
// 실제 매물 조회/문의/즐겨찾기 API는 아직 없다 — findMockProperty(constants/mockData.ts)로
// mock 데이터를 조회하고, 즐겨찾기는 store/useFavoritesStore.ts(메모리 상태)를 사용한다.
// 문의(Inquiry)는 실제로 어디에도 전송되지 않는 UI-only mock 확인 흐름이다.

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export default function PropertyDetailScreen() {
  const theme = colors.light;

  const { t, i18n } = useTranslation();

  /**
   * [2026-09-11] 옵션 라벨.
   * 2026-09-11부터 저장값이 `sale.nearby.park` 같은 키라 i18n에서 라벨을 가져온다.
   * 그 이전에 자유 입력으로 저장된 베트남어 원문은 기존 사전(translateOption)으로
   * 번역한다 — 두 형식이 DB에 섞여 있어 양쪽 다 처리해야 한다.
   */
  function optionLabel(value: string): string {
    if (!PROPERTY_OPTION_VALUE_PATTERN.test(value)) {
      return translateOption(value, i18n.language);
    }
    return t(`propertyOptions.${value}`);
  }

  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // [STEP 04] Mock(findMockProperty) → 실제 Supabase properties 연동.
  const [property, setProperty] = useState<MockProperty | undefined>(undefined);
  const [propertyLoading, setPropertyLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setPropertyLoading(true);
    if (!id) {
      setProperty(undefined);
      setPropertyLoading(false);
      return;
    }
    getPropertyById(id).then((result) => {
      if (mounted) {
        setProperty(result);
        setPropertyLoading(false);
      }
    });
    listInvestmentProductsByPropertyId(id).then((result) => {
      if (mounted) setLinkedProducts(result);
    });
    return () => {
      mounted = false;
    };
  }, [id]);

  // [STEP: 2026-09-09-8] 사용자 요청 — "연계 투자상품" 섹션 삭제, 대신 현재 매물과
  // 면적/방수/가격이 비슷한 다른 매물을 AI가 골라준 것처럼 3개 탭으로 보여준다.
  // mock 데이터가 11건뿐이라 조건에 맞는 매물이 없을 수 있는데, 이때 억지로
  // 결과를 만들지 않고 EmptyState를 그대로 노출한다(앱 전반의 "AI 정직성" 원칙).
  // [STEP 04] 실제 DB 매물(isMock:false)은 비교 대상이 mock 11건뿐인 findSimilar*
  // 결과가 실제로는 무관한 매물이라(같은 데이터셋이 아님) "AI 정직성" 원칙상
  // 노출하지 않는다 — mock 매물(isMock:true)일 때만 기존 동작을 유지한다.
  const [aiTab, setAiTab] = useState<"area" | "rooms" | "price">("area");
  const similarByArea = useMemo(
    () => (property?.isMock ? findSimilarPropertiesByArea(property) : []),
    [property],
  );
  const similarByRooms = useMemo(
    () => (property?.isMock ? findSimilarPropertiesByRooms(property) : []),
    [property],
  );
  const similarByPrice = useMemo(
    () => (property?.isMock ? findSimilarPropertiesByPrice(property) : []),
    [property],
  );
  const aiTabResults =
    aiTab === "area" ? similarByArea : aiTab === "rooms" ? similarByRooms : similarByPrice;

  const [session, setSession] = useState<Session | null>(null);
  // [2026-09-11 사용자 지시] 매물 수정 진입점 노출 여부.
  // 이전에는 canRegisterProperty()(= admin이거나 property_manage 보유)만 봤는데, 그러면
  // **남의 매물**에도 수정 버튼이 뜬다(중개업소 A가 B의 매물에서 "매물 수정"을 보고,
  // 눌러도 서버가 거부한다). properties.created_by가 생겼으니 이 매물이 내 것인지로
  // 판단한다 — 관리자는 예외로 전부 수정할 수 있다.
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  // [2026-09-11 사용자 지시 — 4차] 이 매물에 연결된 투자상품. "투자 카테고리에 매물이
  // 있으면 노출하고 없으면 노출하지 마시오" — 비어 있으면 섹션 자체를 그리지 않는다.
  const [linkedProducts, setLinkedProducts] = useState<MockInvestmentProduct[]>([]);
  // [STEP: 2026-09-09] 사용자 요청 — "문의하기"를 비로그인 상태에서 누르면
  // 전체 화면 전환 대신 팝업으로 Google/Apple 로그인을 바로 띄운다.
  const [loginPromptVisible, setLoginPromptVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isFavorite = useFavoritesStore((state) => (property ? state.isFavorite("property", property.id) : false));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  // 등록자 기록이 없는 옛 매물(createdBy 없음)은 관리자에게만 수정 대상이다 —
  // 누가 올렸는지 모르는 매물을 아무 중개업소나 고치게 두지 않는다.
  const canEdit =
    isAdminUser || (!!session && !!property?.createdBy && property.createdBy === session.user.id);

  // [STEP: 2026-09-09-6] 사용자 요청 — "투자신청/문의하기 클릭 시 로그인이 안 되고
  // 다시 로그인창으로 돌아옴" 버그 수정. 기존에는 getSession()을 마운트 시 한 번만
  // 호출해 이 화면의 로컬 session state를 채웠는데, 이 화면 위에 LoginPromptModal로
  // 로그인해도(전체 화면 이동 없이 모달만 닫힘) 이 로컬 state는 갱신되지 않아 실제로는
  // 로그인이 됐는데도 여전히 "비로그인"으로 판단해 버튼을 다시 누르면 로그인 모달이
  // 계속 다시 떴다. app/_layout.tsx의 Auth Guard와 동일하게 onAuthStateChange 구독을
  // 추가해 로그인 성공 시 이 화면의 session state도 즉시 갱신되도록 한다.
  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) setSession(initialSession);
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    isAdmin().then((ok) => {
      if (mounted) setIsAdminUser(ok);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  }

  function handleFavoritePress() {
    if (!property) return;
    if (!session) {
      showToast(t("common.loginRequired"));
      router.push("/login");
      return;
    }
    const nowFavorite = toggleFavorite("property", property.id);
    showToast(t(nowFavorite ? "common.favoriteAdded" : "common.favoriteRemoved"));
  }

  async function handleShare() {
    if (!property) return;
    try {
      await Share.share({ message: `${property.title} — ${property.location} — ${property.price}` });
    } catch {
      // 사용자가 공유를 취소한 경우 등 — 별도 에러 처리를 하지 않는다.
    }
  }

  function handleGalleryScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setGalleryIndex(index);
  }

  if (propertyLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title="" leftAction={<BackButton onPress={() => router.back()} theme={theme} />} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!property) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header
          title={t("common.notFoundTitle")}
          leftAction={<BackButton onPress={() => router.back()} theme={theme} />}
        />
        <EmptyState title={t("common.notFoundTitle")} description={t("common.notFoundDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={property.title}
        leftAction={<BackButton onPress={() => router.back()} theme={theme} />}
        rightAction={
          <View style={styles.headerActions}>
            {/* [STEP 04-수정] 매물 관리 권한이 있는 계정에만 수정 진입점을 노출한다
                (실제 차단은 properties RLS가 서버에서 수행). */}
            {canEdit ? (
              <Pressable
                onPress={() => router.push({ pathname: "/property-register", params: { id: property.id } })}
                accessibilityRole="button"
                accessibilityLabel={t("propertyRegister.editTitle")}
                style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
              >
                <Ionicons name="create-outline" size={22} color={theme.text} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel={t("common.share")}
              style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
            >
              <Ionicons name="share-outline" size={22} color={theme.text} />
            </Pressable>
          </View>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.gallery}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleGalleryScroll}
          >
            {property.images.map((image, index) => (
              <Image key={index} source={image} style={styles.galleryImage} resizeMode="cover" />
            ))}
          </ScrollView>
          <View style={styles.galleryDots}>
            {property.images.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.galleryDot,
                  { backgroundColor: index === galleryIndex ? theme.onAccent : "rgba(255,255,255,0.5)" },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[textStyles.screenTitle, { color: theme.text, flex: 1 }]}>{property.title}</Text>
            <Pressable
              onPress={handleFavoritePress}
              accessibilityRole="button"
              accessibilityLabel={t(isFavorite ? "common.favoriteRemoved" : "common.favoriteAdded")}
              style={({ pressed }) => [
                styles.favoriteButton,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={20}
                color={isFavorite ? theme.danger : theme.text}
              />
            </Pressable>
          </View>

          <View style={styles.row}>
            <Ionicons name="location-outline" size={14} color={theme.secondaryText} />
            {/* [STEP: 2026-09-09-6] 사용자 요청 — 상세페이지 주소 글자크기 11px */}
            <Text style={[styles.addressText, { color: theme.secondaryText }]}>{property.location}</Text>
          </View>

          {/* [STEP: 2026-09-09] 사용자 요청 — 가격 단위(tỷ/tháng) bold 없앰 —
              PropertyCard.tsx와 동일하게 splitYieldText로 숫자/단위를 분리한다. */}
          <Text style={[textStyles.heroValue, { color: theme.accent }]}>
            {splitYieldText(property.price).rate}
            {splitYieldText(property.price).suffix ? (
              <Text style={{ fontWeight: typography.weight.regular, fontSize: typography.size.md }}>
                {splitYieldText(property.price).suffix}
              </Text>
            ) : null}
          </Text>

          <View style={styles.metaChips}>
            <MetaChip icon="resize-outline" label={property.area} theme={theme} />
            {property.bedrooms !== undefined ? (
              <MetaChip icon="bed-outline" label={`${property.bedrooms} ${t("propertyDetail.bedroomsLabel")}`} theme={theme} />
            ) : null}
            {property.bathrooms !== undefined ? (
              <MetaChip icon="water-outline" label={`${property.bathrooms} ${t("propertyDetail.bathroomsLabel")}`} theme={theme} />
            ) : null}
          </View>

          {/* [STEP: 2026-09-09-28] 사용자 요청 — PropertyCard.tsx의 카드 수익률
              표시(큰 볼드 숫자 + 작은 %(bold 없음) + 그 아래 작은 단위)와 동일한
              스타일로. 색상은 녹색 대신 오렌지(theme.warning), 라벨 글자는 회색
              (theme.secondaryText)으로 — 값만 강조색을 쓴다. */}
          {property.yieldRate ? (
            <View style={[styles.yieldBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.yieldLabels}>
                <Text style={[textStyles.caption, { color: theme.secondaryText, fontWeight: typography.weight.semibold }]}>
                  {t("propertyDetail.expectedYieldLabel1")}
                </Text>
                <Text style={[styles.yieldSubLabel, { color: theme.secondaryText }]}>
                  {t("propertyDetail.expectedYieldLabel2")}
                </Text>
              </View>
              <View style={styles.yieldValueStack}>
                <Text style={[styles.yieldValue, { color: theme.warning }]} numberOfLines={1}>
                  {property.yieldRate.split("/")[0].replace("%", "")}
                  {property.yieldRate.split("/")[0].includes("%") ? (
                    <Text style={[styles.yieldPercent, { color: theme.warning }]}>%</Text>
                  ) : null}
                </Text>
                {property.yieldRate.includes("/") ? (
                  <Text style={[styles.yieldUnit, { color: theme.warning }]} numberOfLines={1}>
                    {property.yieldRate.split("/")[1]}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={t("propertyDetail.descriptionTitle")} />
            {/* [STEP: 2026-09-09-8] 사용자 요청 — 상세설명 글자크기 한 치수 축소
                (body -> bodySmall). 다국어는 localizedText가 이미 지원한다. */}
            <Text style={[textStyles.bodySmall, { color: theme.text }]}>
              {localizedText(property.description, i18n.language)}
            </Text>
          </View>

          {/* [STEP 04-지도] 매물 위치 지도. 좌표(latitude/longitude)가 없는 매물은
              지도에 찍을 수 없으므로 섹션 자체를 노출하지 않는다(빈 지도나 임의
              좌표를 보여주지 않는다). 웹에서는 components/PropertyMap.tsx가 대신
              렌더되어 안내 문구만 표시된다. */}
          {property.latitude !== undefined && property.longitude !== undefined ? (
            <View style={styles.section}>
              <SectionHeader title={t("propertyDetail.locationTitle")} />
              <PropertyMap
                properties={[property]}
                onSelectProperty={() => {}}
                theme={theme}
                emptyLabel={t("property.mapNoCoords")}
                missingCoordsLabel={(count: number) => t("property.mapMissingCoords", { count })}
                height={200}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={t("propertyDetail.optionsTitle")} />
            <View style={styles.optionsGrid}>
              {property.options.map((option) => (
                <View key={option} style={[styles.optionChip, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={theme.accent} />
                  {/* [STEP: 2026-09-09-8] 사용자 요청 — 옵션(편의시설) 다국어 지원.
                      options는 mock 데이터상 베트남어 원문 free text라 constants/mockData.ts의
                      PROPERTY_OPTION_TRANSLATIONS 사전으로 변환하고, 사전에 없으면 원문 그대로 표시한다. */}
                  <Text style={[styles.optionText, { color: theme.text }]}>{optionLabel(option)}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* [2026-09-11 사용자 지시 — 4차] 이 매물의 투자상품 — 연결된 상품이 있을
              때만 섹션째로 보인다("있으면 노출하고 없으면 노출하지 마시오"). */}
          {linkedProducts.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title={t("propertyDetail.linkedInvestmentsTitle")} />
              {linkedProducts.map((product) => (
                <InvestmentCard
                  key={product.id}
                  product={product}
                  onPress={() => router.push(`/invest-detail/${product.id}`)}
                />
              ))}
            </View>
          ) : null}

          <View style={[styles.section, styles.lastSection]}>
            <SectionHeader title={t("propertyDetail.aiPropertiesTitle")} />
            {/* [STEP: 2026-09-09-27] 사용자 요청 — invest-detail의 "AI 투자" 탭과
                동일하게, 둥근 Chip 대신 가로 100%를 3등분하는 사각 테두리 탭으로. */}
            <View style={styles.aiTabRow}>
              <Pressable
                onPress={() => setAiTab("area")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "area" }}
                style={[styles.aiTabButton, aiTab === "area" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "area" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "area" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("propertyDetail.tabArea")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAiTab("rooms")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "rooms" }}
                style={[styles.aiTabButton, aiTab === "rooms" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "rooms" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "rooms" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("propertyDetail.tabRooms")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAiTab("price")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "price" }}
                style={[styles.aiTabButton, aiTab === "price" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "price" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "price" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("propertyDetail.tabPrice")}
                </Text>
              </Pressable>
            </View>
            {aiTabResults.length > 0 ? (
              <View style={styles.aiTabList}>
                {aiTabResults.map((similar) => (
                  <PropertyCard
                    key={similar.id}
                    property={similar}
                    variant="list"
                    onPress={() => router.push(`/property-detail/${similar.id}`)}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                title={t("common.noSimilarResultsTitle")}
                description={t("common.noSimilarResultsDescription")}
              />
            )}
          </View>
        </View>
      </ScrollView>

      {/* [STEP: 2026-09-09] 사용자 요청 — "문의하기"를 누르면 기존 단순 확인
          Modal 대신, 매물 등록자와의 1:1 상담 화면(app/property-chat/[id].tsx)으로
          이동한다.

          [2026-09-11 사용자 지시] 매물 관리 권한이 있는 계정(등록자 = 중개업소/관리자)
          에게는 "문의하기" 대신 "매물 수정"을 보여주고 수정 폼으로 보낸다 — 자기가 올린
          매물에 자기가 문의를 남기는 동작은 의미가 없고, 실제로 눌리면 담당자 명의의
          빈 상담 대화만 생긴다(그 대화는 chat-inbox에도 뜨지 않는다). */}
      <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Button
          title={canEdit ? t("propertyDetail.editButton") : t("propertyDetail.inquiryButton")}
          onPress={() => {
            if (canEdit) {
              router.push({ pathname: "/property-register", params: { id: property.id } });
              return;
            }
            if (!session) {
              setLoginPromptVisible(true);
              return;
            }
            router.push({ pathname: "/property-chat/[id]", params: { id: property.id } });
          }}
          style={styles.footerButton}
        />
      </View>

      <LoginPromptModal visible={loginPromptVisible} onClose={() => setLoginPromptVisible(false)} />

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function BackButton({ onPress, theme }: { onPress: () => void; theme: ThemeColors }) {
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

function MetaChip({
  icon,
  label,
  theme,
  tone = "default",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  theme: ThemeColors;
  tone?: "default" | "success";
}) {
  return (
    <View style={[styles.metaChip, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Ionicons name={icon} size={14} color={tone === "success" ? theme.success : theme.secondaryText} />
      <Text style={[textStyles.caption, { color: tone === "success" ? theme.success : theme.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  gallery: {
    height: 260,
  },
  galleryImage: {
    width: SCREEN_WIDTH,
    height: 260,
  },
  galleryDots: {
    position: "absolute",
    bottom: spacing.sm,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  galleryDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  body: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  favoriteButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addressText: {
    fontSize: 11,
    fontWeight: typography.weight.regular,
    flexShrink: 1,
  },
  optionText: {
    fontSize: 11,
    fontWeight: typography.weight.regular,
  },
  metaChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  // [STEP: 2026-09-09-7] 사용자 재확인 — 앱 전체 "영역 간 간격" 기준을 md(16)로
  // 통일한다. body.gap(sm=8) + 이 marginTop(sm=8) = 16, home/property/invest/my/ai
  // 탭 화면의 content.gap(md=16)과 동일한 값이 된다(기존엔 8+16=24로 더 컸음).
  // [STEP: 2026-09-09-8] 사용자 요청("타이틀과 타이틀사이 간격 40px 줄것") — 디자인
  // 토큰을 한 단계 더 축소(sm -> xs). 요청한 40px과 실제 토큰 값(8px) 차이가 커서
  // 그대로 뺄 수 없어 "토큰 한 단계 축소"로 해석했다 — 빌드 후 육안 확인 필요.
  section: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  lastSection: {
    paddingBottom: spacing.xl,
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  yieldBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  // [STEP: 2026-09-09-28] PropertyCard.tsx의 yieldStack/yieldValue/yieldPercent/
  // yieldUnit과 동일한 규칙(큰 볼드 숫자 + 작은 %(bold 없음) + 그 아래 작은 단위).
  yieldValueStack: {
    alignItems: "flex-end",
  },
  yieldValue: {
    fontSize: typography.size.heroValue,
    fontWeight: typography.weight.bold,
    lineHeight: typography.size.heroValue,
  },
  yieldPercent: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.regular,
  },
  yieldUnit: {
    fontWeight: typography.weight.regular,
    fontSize: 11,
    marginTop: -2,
  },
  yieldLabels: {
    flex: 1,
    gap: 2,
  },
  yieldSubLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.regular,
  },
  // [STEP: 2026-09-09-27] invest-detail의 AI 투자 탭과 동일한 사각 테두리 탭
  // 스타일(가로 100% 3등분, 활성 탭 상단 파란 2px + 좌우 회색 1px, 하단 여백 10px).
  aiTabRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  aiTabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  aiTabButtonInactive: {
    borderColor: "#E5E5E5",
  },
  aiTabButtonActive: {
    borderTopWidth: 2,
    borderTopColor: "#2F3C7E",
    borderLeftColor: "#E5E5E5",
    borderRightColor: "#E5E5E5",
    borderBottomWidth: 0,
  },
  aiTabList: {
    gap: spacing.sm,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButton: {
    width: "100%",
  },
});
