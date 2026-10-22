import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";

import { FavoritesList } from "@/components/FavoritesList";
import { ManageTabsScreen } from "@/components/ManageTabs";
import MyPropertiesScreen from "./my-properties";

/** [2026-10-22 사용자 지시] 매물관리 — 매물정보 / 매물 관심목록 + 매물등록 버튼. */
export default function ManagePropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  return (
    <ManageTabsScreen
      title={t("my.manage.properties")}
      initialKey={params.tab}
      tabs={[
        { key: "mine", label: t("my.manage.propertyInfo"), render: () => <MyPropertiesScreen /> },
        { key: "fav", label: t("my.manage.propertyFavorites"), render: () => <FavoritesList kind="property" /> },
      ]}
      footerLabel={t("my.registerProperty")}
      onFooterPress={() => router.push("/property-register")}
    />
  );
}
