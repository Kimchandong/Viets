import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ManageTabsScreen, type ManageTab } from "@/components/ManageTabs";
import { isAdmin } from "@/services/roles";
import { supabase } from "@/services/supabase";
import AdminPermissionsScreen from "./admin-permissions";
import AdminPushScreen from "./admin-push";
import AgencyStaffScreen from "./agency-staff";

/**
 * [2026-10-22 사용자 지시] 운영 & 사용 — 직원관리 / 계정권한관리 / 푸시(알림)메세지.
 *
 * 탭을 권한별로 고른다. 전부 그려 두고 눌렀을 때 막으면, 누를 수 없는 탭을 보여 주는
 * 셈이 된다 — 그 안의 화면들이 각자 "권한이 없습니다"를 띄우고 끝난다.
 *   · 직원관리  — 내 업체의 owner만(서버 RPC도 owner가 아니면 예외를 던진다)
 *   · 나머지 둘 — admin 계열만
 */
export default function ManageOpsScreen() {
  const { t } = useTranslation();
  const [isOwner, setIsOwner] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const admin = await isAdmin();
      let owner = false;
      if (supabase) {
        const { data } = await supabase.rpc("my_owned_agency_id");
        owner = !!data;
      }
      if (!mounted) return;
      setIsAdminUser(admin);
      setIsOwner(owner);
      setChecked(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const tabs: ManageTab[] = [];
  if (isOwner) {
    tabs.push({ key: "staff", label: t("agencyStaff.title"), render: () => <AgencyStaffScreen /> });
  }
  if (isAdminUser) {
    tabs.push({ key: "permissions", label: t("my.managePermissions"), render: () => <AdminPermissionsScreen /> });
    tabs.push({ key: "push", label: t("pushMessage.menu"), render: () => <AdminPushScreen /> });
  }

  // 권한 확인이 끝나기 전에는 탭을 그리지 않는다 — 잠깐 한 개만 보였다가 늘어나면
  // 잘못 만든 화면처럼 읽힌다.
  return <ManageTabsScreen title={t("my.manage.ops")} tabs={checked ? tabs : []} />;
}
