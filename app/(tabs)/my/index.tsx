import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function MyScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("my.title")} />;
}
