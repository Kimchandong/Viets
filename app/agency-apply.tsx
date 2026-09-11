import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { SectionHeader } from "@/components/SectionHeader";
import { Select } from "@/components/Select";
import { Toast } from "@/components/Toast";
import { MOCK_REGIONS } from "@/constants/mockData";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  getMyAgency,
  submitAgencyApplication,
  uploadAgencyDocument,
  type MyAgency,
} from "@/services/agencies";

/**
 * [2026-09-11 사용자 지시] 부동산 등록신청 폼.
 *
 * 이 화면은 두 얼굴을 가진다:
 *   · 아직 신청하지 않았거나 반려된 계정 → 폼
 *   · 심사 중(pending)이거나 승인된(approved) 계정 → 현재 상태 안내
 * 한 사람이 심사 중에 또 신청하는 것을 서버가 막으므로(already-applied), 화면에서도
 * 폼을 감춰 헛걸음을 만들지 않는다.
 *
 * 중개번호는 선택이다 — "중개번호 없음"을 켜면 번호와 첨부 칸이 사라진다(사용자 지시:
 * 없을 때는 제외). 있고 없고에 따라 결제 조건이 달라질 예정이라, 값 자체는 비워 두더라도
 * 있음/없음이 구분되게 저장한다(번호가 NULL이면 없음).
 */

export default function AgencyApplyScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [agency, setAgency] = useState<MyAgency | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [noLicense, setNoLicense] = useState(false);
  const [registrationNo, setRegistrationNo] = useState("");
  const [licenseImage, setLicenseImage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    getMyAgency().then((result) => {
      if (!mounted) return;
      setAgency(result);
      // 반려된 신청은 고쳐서 다시 내는 것이 보통이라, 적어 두었던 값을 채워 준다.
      if (result && result.approvalStatus === "rejected") {
        setName(result.name);
        setRegion(result.region);
        setContactName(result.contactName);
        setPhone(result.phone);
        setAddress(result.address);
        setRegistrationNo(result.registrationNo);
        setNoLicense(result.registrationNo.length === 0);
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handlePickLicense() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("agencyApply.filePermissionDenied"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    setLicenseImage(result.assets[0].uri);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (name.trim().length === 0) next.name = t("agencyApply.errorRequired");
    if (region.length === 0) next.region = t("agencyApply.errorRequired");
    if (contactName.trim().length === 0) next.contactName = t("agencyApply.errorRequired");
    if (phone.trim().length === 0) next.phone = t("agencyApply.errorRequired");
    if (address.trim().length === 0) next.address = t("agencyApply.errorRequired");
    if (!noLicense && registrationNo.trim().length === 0) {
      next.registrationNo = t("agencyApply.errorRequired");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) {
      showToast(t("agencyApply.errorCheckForm"));
      return;
    }

    setSubmitting(true);

    // 첨부는 신청 접수보다 먼저 올린다 — 접수만 되고 서류가 빠지면 관리자가 심사할
    // 근거가 없고, 반대로 파일만 남는 것은 아무 피해가 없다.
    let licenseFilePath = "";
    if (!noLicense && licenseImage) {
      const uploaded = await uploadAgencyDocument(licenseImage);
      if (!uploaded) {
        setSubmitting(false);
        showToast(t("agencyApply.uploadFailed"));
        return;
      }
      licenseFilePath = uploaded;
    }

    const result = await submitAgencyApplication({
      name,
      region,
      contactName,
      phone,
      address,
      registrationNo: noLicense ? "" : registrationNo,
      licenseFilePath,
    });

    setSubmitting(false);

    if (!result.ok) {
      showToast(
        result.reason === "already-applied"
          ? t("agencyApply.alreadyApplied")
          : t("agencyApply.submitFailed"),
      );
      return;
    }

    showToast(t("agencyApply.submitted"));
    const fresh = await getMyAgency();
    setAgency(fresh);
  }

  const screenTitle = t("agencyApply.title");
  const regionOptions = MOCK_REGIONS.map((value) => ({ value, label: value }));

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  // 심사 중 / 승인됨 — 폼 대신 상태만 보여 준다.
  if (agency && (agency.approvalStatus === "pending" || agency.approvalStatus === "approved")) {
    const approved = agency.approvalStatus === "approved";
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.statusCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <Ionicons
              name={approved ? "checkmark-circle" : "time-outline"}
              size={40}
              color={approved ? theme.success : theme.warning}
            />
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {approved ? t("agencyApply.approvedTitle") : t("agencyApply.pendingTitle")}
            </Text>
            <Text style={[textStyles.bodySmall, { color: theme.secondaryText, textAlign: "center" }]}>
              {approved ? t("agencyApply.approvedDescription") : t("agencyApply.pendingDescription")}
            </Text>
          </View>

          <SummaryRow label={t("agencyApply.name")} value={agency.name} />
          <SummaryRow label={t("agencyApply.region")} value={agency.region} />
          <SummaryRow label={t("agencyApply.contactName")} value={agency.contactName} />
          <SummaryRow label={t("agencyApply.phone")} value={agency.phone} />
          <SummaryRow label={t("agencyApply.address")} value={agency.address} />
          <SummaryRow
            label={t("agencyApply.registrationNo")}
            value={agency.registrationNo || t("agencyApply.noLicense")}
          />
        </ScrollView>
        <Toast visible={!!toast} message={toast ?? ""} variant="info" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 반려된 신청은 사유를 먼저 보여 준다 — 무엇을 고쳐야 하는지 모르면
            같은 신청이 그대로 다시 올라온다. */}
        {agency?.approvalStatus === "rejected" ? (
          <View style={[styles.rejectedBox, { borderColor: theme.danger }]}>
            <Text style={[textStyles.bodySmall, { color: theme.danger, fontWeight: typography.weight.medium }]}>
              {t("agencyApply.rejectedTitle")}
            </Text>
            {agency.rejectionReason.length > 0 ? (
              <Text style={[textStyles.bodySmall, { color: theme.text }]}>{agency.rejectionReason}</Text>
            ) : null}
          </View>
        ) : null}

        <SectionHeader title={t("agencyApply.sectionBasic")} />

        <Input
          label={t("agencyApply.name")}
          placeholder={t("agencyApply.namePlaceholder")}
          value={name}
          onChangeText={setName}
          error={errors.name}
        />

        <Select
          label={t("agencyApply.region")}
          value={region}
          options={regionOptions}
          onChange={setRegion}
          theme={theme}
          modalTitle={t("agencyApply.region")}
          placeholder={t("agencyApply.regionPlaceholder")}
          closeLabel={t("common.cancel")}
        />
        {errors.region ? (
          <Text style={[textStyles.caption, { color: theme.danger }]}>{errors.region}</Text>
        ) : null}

        <Input
          label={t("agencyApply.contactName")}
          placeholder={t("agencyApply.contactNamePlaceholder")}
          value={contactName}
          onChangeText={setContactName}
          error={errors.contactName}
        />

        <Input
          label={t("agencyApply.phone")}
          placeholder={t("agencyApply.phonePlaceholder")}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          error={errors.phone}
        />

        <Input
          label={t("agencyApply.address")}
          placeholder={t("agencyApply.addressPlaceholder")}
          value={address}
          onChangeText={setAddress}
          error={errors.address}
        />

        <SectionHeader title={t("agencyApply.sectionLicense")} />

        {/* 없음을 고르면 번호와 첨부 칸이 사라진다 — 빈 칸을 남겨 두면
            "안 적은 것"인지 "없는 것"인지 구분되지 않는다. */}
        <Pressable
          onPress={() => setNoLicense((prev) => !prev)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: noLicense }}
          style={({ pressed }) => [styles.checkRow, { opacity: pressed ? opacity.pressed : 1 }]}
        >
          <Ionicons
            name={noLicense ? "checkbox" : "square-outline"}
            size={20}
            color={noLicense ? theme.accent : theme.secondaryText}
          />
          <Text style={[textStyles.body, { color: theme.text }]}>{t("agencyApply.noLicense")}</Text>
        </Pressable>

        {!noLicense ? (
          <>
            <Input
              label={t("agencyApply.registrationNo")}
              placeholder={t("agencyApply.registrationNoPlaceholder")}
              value={registrationNo}
              onChangeText={setRegistrationNo}
              error={errors.registrationNo}
            />

            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("agencyApply.licenseFileHint")}
            </Text>

            {licenseImage ? (
              <View style={styles.licensePreview}>
                <Image source={{ uri: licenseImage }} style={styles.licenseImage} />
                <Pressable
                  onPress={() => setLicenseImage(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t("agencyApply.removeFile")}
                  style={({ pressed }) => [
                    styles.licenseRemove,
                    { backgroundColor: theme.danger, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Ionicons name="close" size={14} color={theme.onAccent} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={handlePickLicense}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.licenseAdd,
                  { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Ionicons name="document-attach-outline" size={22} color={theme.secondaryText} />
                <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
                  {t("agencyApply.attachFile")}
                </Text>
              </Pressable>
            )}
          </>
        ) : null}

        <Button
          title={t("agencyApply.submit")}
          onPress={handleSubmit}
          loading={submitting}
          style={styles.submit}
        />
      </ScrollView>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const theme = colors.light;
  return (
    <View style={[styles.summaryRow, { borderBottomColor: theme.border }]}>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{label}</Text>
      <Text style={[textStyles.body, { color: theme.text, flex: 1, textAlign: "right" }]} numberOfLines={2}>
        {value || "-"}
      </Text>
    </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  statusCard: {
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rejectedBox: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  licenseAdd: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
  },
  licensePreview: {
    alignSelf: "flex-start",
  },
  licenseImage: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
  },
  licenseRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  submit: {
    marginTop: spacing.md,
  },
});
