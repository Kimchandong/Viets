/**
 * [2026-09-12] 푸시 문구 — **받는 사람의 언어로**.
 *
 * 앱 안의 문구는 i18n/locales/*.json이 갖고 있지만, 푸시는 앱이 꺼져 있을 때 표시되므로
 * 앱의 i18n을 쓸 수 없다. 보내는 쪽(엣지 함수)이 같은 문장을 알고 있어야 한다.
 *
 * 그래서 이 파일은 i18n/locales의 `notifications.kind.*`와 **같은 문장의 사본**이다.
 * 사본인 것이 마음에 들지는 않지만, 대안은 발송 때마다 6개 언어 JSON을 읽어 오는 것이고
 * 그쪽이 더 나쁘다(엣지 함수가 앱 저장소의 파일에 의존하게 된다). 문구를 고칠 때는
 * 양쪽을 함께 고친다 — 여기가 틀리면 앱 안과 푸시가 다른 말을 한다.
 *
 * 언어는 push_tokens.lang(기기 언어)에서 온다. 모르면 vi로 본다 — 이 서비스의 1차
 * 사용자는 베트남 사용자다.
 */

export type PushLang = "vi" | "ko" | "en" | "zh" | "ja" | "th";

const FALLBACK_LANG: PushLang = "vi";

type Entry = { title: string; body: string };

const CATALOG: Record<string, Record<PushLang, Entry>> = {
  ad_balance_empty: {
    ko: { title: "광고비 소진", body: "광고비 잔액이 모두 소진되어 광고 노출이 중단되었습니다." },
    en: { title: "Ad balance used up", body: "Your ad balance is empty, so the listing is no longer shown." },
    vi: { title: "Hết số dư quảng cáo", body: "Số dư quảng cáo đã hết nên tin không còn được hiển thị." },
    ja: { title: "広告費の残高切れ", body: "広告費の残高がなくなったため、掲載が停止されました。" },
    zh: { title: "广告余额已用尽", body: "广告余额已用尽，房源已停止展示。" },
    th: { title: "ยอดค่าโฆษณาหมด", body: "ยอดค่าโฆษณาหมดแล้ว ประกาศจึงหยุดแสดง" },
  },
  ad_slot_dropped: {
    ko: { title: "광고 순위 탈락", body: "다른 매물의 광고비가 더 높아 순위에서 밀려났습니다." },
    en: { title: "Dropped from ad ranking", body: "Another listing bid higher, so yours lost its slot." },
    vi: { title: "Rớt khỏi thứ hạng quảng cáo", body: "Tin khác trả phí cao hơn nên tin của bạn mất vị trí." },
    ja: { title: "広告順位から外れました", body: "他の物件の広告費が高く、順位から外れました。" },
    zh: { title: "已跌出广告排名", body: "其他房源出价更高，您的房源失去了排位。" },
    th: { title: "หลุดจากอันดับโฆษณา", body: "ประกาศอื่นจ่ายสูงกว่า ประกาศของคุณจึงเสียอันดับ" },
  },
  agency_approved: {
    ko: { title: "업체 승인 완료", body: "{{agency}} 등록이 승인되었습니다." },
    en: { title: "Agency approved", body: "{{agency}} has been approved." },
    vi: { title: "Công ty được duyệt", body: "{{agency}} đã được duyệt." },
    ja: { title: "会社の承認完了", body: "{{agency}} の登録が承認されました。" },
    zh: { title: "公司审核通过", body: "{{agency}} 的注册已通过审核。" },
    th: { title: "อนุมัติบริษัทแล้ว", body: "{{agency}} ได้รับการอนุมัติแล้ว" },
  },
  agency_rejected: {
    ko: { title: "업체 승인 반려", body: "{{agency}} 등록이 반려되었습니다. {{reason}}" },
    en: { title: "Agency rejected", body: "{{agency}} was rejected. {{reason}}" },
    vi: { title: "Công ty bị từ chối", body: "{{agency}} đã bị từ chối. {{reason}}" },
    ja: { title: "会社の承認却下", body: "{{agency}} の登録が却下されました。{{reason}}" },
    zh: { title: "公司审核未通过", body: "{{agency}} 的注册未通过。{{reason}}" },
    th: { title: "ปฏิเสธบริษัท", body: "{{agency}} ถูกปฏิเสธ {{reason}}" },
  },
  payment_approved: {
    ko: { title: "충전 승인", body: "{{amount}} VND 충전이 잔액에 반영되었습니다." },
    en: { title: "Top-up approved", body: "{{amount}} VND has been added to your balance." },
    vi: { title: "Nạp tiền được duyệt", body: "{{amount}} VND đã được cộng vào số dư." },
    ja: { title: "チャージ承認", body: "{{amount}} VND が残高に反映されました。" },
    zh: { title: "充值已通过", body: "{{amount}} VND 已计入余额。" },
    th: { title: "อนุมัติการเติมเงิน", body: "{{amount}} VND ถูกเพิ่มเข้ายอดคงเหลือแล้ว" },
  },
  payment_rejected: {
    ko: { title: "충전 반려", body: "충전 신청이 반려되었습니다. {{reason}}" },
    en: { title: "Top-up rejected", body: "Your top-up request was rejected. {{reason}}" },
    vi: { title: "Nạp tiền bị từ chối", body: "Yêu cầu nạp tiền đã bị từ chối. {{reason}}" },
    ja: { title: "チャージ却下", body: "チャージ申請が却下されました。{{reason}}" },
    zh: { title: "充值未通过", body: "充值申请未通过。{{reason}}" },
    th: { title: "ปฏิเสธการเติมเงิน", body: "คำขอเติมเงินถูกปฏิเสธ {{reason}}" },
  },
  qa_answered: {
    ko: { title: "문의 답변 등록", body: "{{title}} 문의에 답변이 등록되었습니다." },
    en: { title: "Your question was answered", body: "An answer was posted to {{title}}." },
    vi: { title: "Câu hỏi đã được trả lời", body: "Đã có câu trả lời cho {{title}}." },
    ja: { title: "お問い合わせに回答", body: "{{title}} のお問い合わせに回答が登録されました。" },
    zh: { title: "咨询已回复", body: "{{title}} 的咨询已有回复。" },
    th: { title: "มีคำตอบสำหรับคำถามของคุณ", body: "มีคำตอบสำหรับ {{title}} แล้ว" },
  },
  payment_requested: {
    ko: { title: "입금 신고 도착", body: "{{agency}} 님이 {{amount}} VND 입금을 신고했습니다." },
    en: { title: "New top-up request", body: "{{agency}} reported a {{amount}} VND deposit." },
    vi: { title: "Có yêu cầu nạp tiền", body: "{{agency}} đã báo nạp {{amount}} VND." },
    ja: { title: "入金申告が届きました", body: "{{agency}} が {{amount}} VND の入金を申告しました。" },
    zh: { title: "收到充值申报", body: "{{agency}} 申报了 {{amount}} VND 的充值。" },
    th: { title: "มีคำขอเติมเงินใหม่", body: "{{agency}} แจ้งโอน {{amount}} VND" },
  },
  report_resolved: {
    ko: { title: "신고 처리 완료", body: "신고하신 매물의 검토가 완료되었습니다." },
    en: { title: "Report reviewed", body: "The listing you reported has been reviewed." },
    vi: { title: "Đã xử lý báo cáo", body: "Tin bạn báo cáo đã được xem xét." },
    ja: { title: "通報の処理完了", body: "通報された物件の確認が完了しました。" },
    zh: { title: "举报已处理", body: "您举报的房源已完成核查。" },
    th: { title: "ตรวจสอบรายงานแล้ว", body: "ประกาศที่คุณรายงานได้รับการตรวจสอบแล้ว" },
  },
};

function normalizeLang(lang: string | null | undefined): PushLang {
  const tag = (lang ?? "").split("-")[0];
  return tag === "vi" || tag === "ko" || tag === "en" || tag === "zh" || tag === "ja" || tag === "th"
    ? tag
    : FALLBACK_LANG;
}

/**
 * 문구를 만든다. 모르는 종류면 null — 보내지 않는 편이 "undefined"를 띄우는 것보다 낫다.
 *
 * 치환은 i18next와 같은 `{{key}}` 모양을 쓴다. 값이 없는 자리는 빈 문자열로 지운다 —
 * 반려 사유처럼 비어 있을 수 있는 값이 "{{reason}}" 그대로 나가면 안 된다.
 */
export function pushMessage(
  kind: string,
  lang: string | null | undefined,
  params: Record<string, unknown> = {},
): { title: string; body: string } | null {
  const entry = CATALOG[kind]?.[normalizeLang(lang)];
  if (!entry) return null;

  const fill = (text: string) =>
    text
      .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const value = params[key];
        return value === undefined || value === null ? "" : String(value);
      })
      .replace(/\s+/g, " ")
      .trim();

  return { title: fill(entry.title), body: fill(entry.body) };
}
