import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function PropertyScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("property.title")} />;
}
