import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";

import { FavoritesList } from "@/components/FavoritesList";
import { ManageTabsScreen } from "@/components/ManageTabs";
import MyInvestmentsScreen from "./my-investments";

/** [2026-10-22 사용자 지시] 투자관리 — 투자상품 / 투자 관심목록 + 투자등록 버튼. */
export default function ManageInvestScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  return (
    <ManageTabsScreen
      title={t("my.manage.invest")}
      initialKey={params.tab}
      tabs={[
        { key: "mine", label: t("my.manage.investProducts"), render: () => <MyInvestmentsScreen /> },
        { key: "fav", label: t("my.manage.investFavorites"), render: () => <FavoritesList kind="invest" /> },
      ]}
      footerLabel={t("my.registerInvestment")}
      onFooterPress={() => router.push("/invest-register")}
    />
  );
}
