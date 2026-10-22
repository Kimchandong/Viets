import { useTranslation } from "react-i18next";

import { ManageTabsScreen } from "@/components/ManageTabs";
import AdManageScreen from "./ad-manage";
import PaymentInfoScreen from "./payment-info";

/** [2026-10-22 사용자 지시] 광고관리 — 유료 노출광고 / 정산관리. */
export default function ManageAdsScreen() {
  const { t } = useTranslation();
  return (
    <ManageTabsScreen
      title={t("my.manage.ads")}
      tabs={[
        { key: "slots", label: t("my.manage.adSlots"), render: () => <AdManageScreen /> },
        { key: "settle", label: t("my.manage.settlement"), render: () => <PaymentInfoScreen /> },
      ]}
    />
  );
}
