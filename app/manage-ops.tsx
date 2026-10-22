import { useTranslation } from "react-i18next";

import { ManageTabsScreen } from "@/components/ManageTabs";
import AdminPermissionsScreen from "./admin-permissions";
import AdminPushScreen from "./admin-push";

/**
 * [2026-10-22 사용자 지시] 운영 & 사용 — 직원관리 / 계정권한관리 / 푸시(알림)메세지.
 *
 * 직원관리 탭은 아직 없다. agency_members 표는 이미 있지만 이를 읽고 쓰는 서비스
 * 함수도, RLS 정책도, 화면도 없어 "옮기기"가 아니라 신규 구현이다 — 별도 작업으로
 * 뺐다. 빈 탭을 먼저 만들어 두면 눌러 봐야 아무것도 없는 자리가 생긴다.
 */
export default function ManageOpsScreen() {
  const { t } = useTranslation();
  return (
    <ManageTabsScreen
      title={t("my.manage.ops")}
      tabs={[
        { key: "permissions", label: t("my.managePermissions"), render: () => <AdminPermissionsScreen /> },
        { key: "push", label: t("pushMessage.menu"), render: () => <AdminPushScreen /> },
      ]}
    />
  );
}
