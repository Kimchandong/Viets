/**
 * [2026-09-26 사용자 지시] 앱이 쓰는 공용 미디어의 주소.
 *
 * 홈 배경영상을 Supabase Storage(app-media 버킷)에 두고, 앱은 그 주소를 가리킨다.
 * 번들 파일이었을 때는 영상을 바꾸려면 앱을 새로 빌드해 스토어에 다시 올려야 했다.
 *
 * ── 주소를 왜 직접 적지 않았나 ──────────────────────────────────────────────
 * 프로젝트 주소(https://<ref>.supabase.co)를 소스에 박으면 staging/운영을 나눌 때
 * 이 파일도 함께 고쳐야 한다. 이미 있는 EXPO_PUBLIC_SUPABASE_URL에서 만들어 쓴다 —
 * 이 값은 비밀이 아니다(앱 번들에 이미 들어 있고, anon 키와 함께 공개되는 주소다).
 *
 * ── 번들 파일을 남겨 둔 이유 ────────────────────────────────────────────────
 * 네트워크가 느리거나 끊겼을 때, 또는 아직 파일을 올리지 않았을 때 홈 상단이
 * 빈 채로 남지 않게 한다. 원격을 먼저 시도하고 실패하면 번들로 떨어진다
 * (app/(tabs)/home.tsx의 heroVideoSource 참고).
 */

/**
 * app-media 버킷 안의 고정 경로.
 *
 * [2026-09-26] 실제 업로드 위치에 맞춘다 — 처음에는 home/hero.mp4로 안내했는데
 * 버킷 루트에 hero-source.mp4로 올라갔다. 파일을 옮기게 하는 것보다 이 한 줄을
 * 맞추는 편이 낫다(옮기는 동안 홈 배경이 비는 시간도 없다).
 *
 * **이 이름은 고정이다.** 나중에 영상을 바꿀 때는 같은 이름으로 덮어쓰면 앱 수정도
 * 재빌드도 필요 없다. 다른 이름으로 올리면 이 줄을 함께 고쳐야 한다.
 */
const HERO_VIDEO_PATH = "hero-source.mp4";

/** 공개 버킷의 객체 주소. Supabase Storage의 공개 URL 형식이다. */
function publicMediaUrl(path: string): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/app-media/${path}`;
}

/**
 * 홈 상단 배경영상 주소. 환경변수가 없으면 null — 그때는 번들 영상을 쓴다.
 */
export const HOME_HERO_VIDEO_URL: string | null = publicMediaUrl(HERO_VIDEO_PATH);
