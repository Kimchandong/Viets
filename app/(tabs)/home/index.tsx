import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function HomeScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("home.title")} />;
}
