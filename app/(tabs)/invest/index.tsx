import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function InvestScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("invest.title")} />;
}
