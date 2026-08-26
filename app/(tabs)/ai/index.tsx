import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function AiScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("ai.title")} />;
}
