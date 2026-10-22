import { useTranslation } from "react-i18next";

import { ManageTabsScreen } from "@/components/ManageTabs";
import AdminBoardsScreen from "./admin-boards";
import ChatInboxScreen from "./chat-inbox";
import BoardsScreen from "./(tabs)/boards";

/** [2026-10-22 사용자 지시] 상담 & 알림 — 상담목록 / 게시판관리 / 공지사항. */
export default function ManageSupportScreen() {
  const { t } = useTranslation();
  return (
    <ManageTabsScreen
      title={t("my.manage.support")}
      tabs={[
        { key: "consults", label: t("my.manage.consults"), render: () => <ChatInboxScreen /> },
        { key: "boards", label: t("my.manage.boardAdmin"), render: () => <AdminBoardsScreen /> },
        { key: "notice", label: t("my.rows.notices"), render: () => <BoardsScreen fixedKind="notice" /> },
      ]}
    />
  );
}
