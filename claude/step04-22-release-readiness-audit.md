# STEP 04-22 — 출시 준비 전수 점검 및 잔여 작업

작성: 2026-09-12
범위: 프로젝트 전체(코드·빌드 설정·보안·검증 상태)
목적: iOS 빌드 착수를 미루고, 그 전에 끝내야 할 것을 한 곳에 모은다.

---

## 0. 이 문서가 생긴 이유

점검을 세 번에 나눠 했더니 누락 건수가 4건 → 11건 → 18건으로 늘었다.
부분 점검을 반복하면 목록이 계속 자라고, 그 상태로는 빌드 순서를 정할 수 없다.
그래서 프로젝트 전체를 한 번에 훑어 아래 목록을 확정했다.

**원칙**: 새 기능에 착수하기 전에 외부 전제조건(자격증명·권한·등록 절차·플랫폼 제약)을
먼저 확인한다. 빌드 크레딧이 유한하므로(현재 $3), 빌드로만 확인 가능한 것과
빌드 없이 확인 가능한 것을 반드시 구분한다.

---

## 1. 심사 반려 사유 — 출시 불가 (최우선)

| # | 항목 | 근거 / 현황 |
|---|---|---|
| 1 | ~~**AI 탭이 껍데기**~~ → **해결(2026-09-12)** | `services/aiSearch.ts` 신설 + `ai.tsx` 전면 재작성. 자연어 6개 언어 파싱 → DB 조회, 해석 조건 칩 노출·제거 재검색, 음성 입력(expo-speech-recognition), 최근 검색 실제 저장. 파서 15개 질의 검증 통과 |
| 2 | **계정 삭제 기능 없음** | 계정 생성이 가능한 앱은 **앱 내에서** 계정 삭제를 제공해야 한다 (Apple 2022-06~, Google 2024~). 현재 `services/`, `app/` 어디에도 구현 없음 |
| 3 | **개인정보처리방침 화면·URL 없음** | i18n에 문구(`privacyLabel`, `termsNotice`)만 있고 실제 화면이 없다. 스토어 등록 시 공개 URL이 필수 |
| 4 | **이용약관 화면 없음** | 동일 |

### 결정 대기 (사용자만 정할 수 있음)

1. **계정 삭제 시 데이터 처리 정책** — 등록 매물·채팅·충전 잔액을 어떻게 할 것인가
   (즉시 삭제 / 익명화 후 보존 / 잔액 환불 절차). 법·회계 영향이 있어 임의로 정하면 안 된다.
2. **약관·개인정보처리방침 원문** — 법적 문서이므로 원문을 받아 화면에 넣는다.

---

## 2. 빌드·배포 설정 누락

| # | 항목 | 현황 | 결과 |
|---|---|---|---|
| 5 | production 프로필 없음 | `eas.json`에 `development` / `preview`만 | 스토어 제출용 빌드를 만들 수 없다 |
| 6 | AAB 설정 없음 | `preview.android.buildType: "apk"` | Play Store는 **AAB만** 받는다 |
| 7 | 버전 자동 증가 없음 | `buildNumber` / `versionCode` 미설정 | 같은 버전 재업로드가 거부된다 |
| 8 | iOS `infoPlist` 없음 | `app.json`의 `ios`에 `infoPlist` 키 자체가 없음 | `ITSAppUsesNonExemptEncryption` 미설정 → 업로드마다 수출규정 질문 |
| 9 | production 환경변수 없음 | `env`가 `preview`에만 있음 | 스토어 빌드가 Supabase에 연결되지 않는다 |

---

## 3. 보안

| # | 항목 | 현황 |
|---|---|---|
| 10 | Google Maps API 키 제한 **미확인** | `app.json` / `eas.json`에 평문(클라이언트 키라 불가피). **키에 앱 제한(Android 패키지+SHA-1, iOS 번들 ID)이 걸려 있는지 확인 필요.** 없으면 도용·과금 위험 |
| 11 | 구 번역 API 키 미폐기 | 이전 세션 미완료 항목 |

---

## 4. 코드 정리

| # | 항목 |
|---|---|
| 12 | ~~`showComingSoon` 미사용 함수~~ → **삭제(2026-09-12)** |
| 13 | `app/(tabs)/home.tsx` 음성 검색 버튼 — 기능 없이 "준비 중" 토스트만 **(미해결 — AI 탭 쪽만 활성화했다)** |
| 14 | ~~`app/(tabs)/ai.tsx` 음성 버튼~~ → **활성화(2026-09-12)**. 인식기가 없는 기기에서는 버튼을 그리지 않는다 |

---

## 5. 검증 미완료

| # | 항목 |
|---|---|
| 15 | ~~오늘 작업 전체 미커밋~~ → **커밋·푸시 완료(`0cb95b0`, 33개 파일)** |
| 16 | 웹 검증 미완료 — 섹션 타이틀 15px / 카드 제목 14px / TOP10 노출 / 일반매물 무한스크롤 / FAQ 아코디언 / 공지 점선 |
| 17 | RLS 전수 재점검 — `service_role` GRANT 복구(20260915000000) 이후 미검증 |
| 18 | ~~`npx expo-doctor`, `npx eslint .` 미실행~~ → **완료(2026-09-12)**. expo-doctor 18/18 통과, ESLint 27건(오류 5·경고 22) 전부 정리해 **0건**, `npx tsc --noEmit` 통과 |

---

## 6. 이상 없음 (확인 완료)

- i18n **972키 × 6개 언어 일치**, 코드에서 호출하는 키 누락 **0건**
- 화면에 렌더되는 하드코딩 한글 **0건** (77건은 모두 주석·내부 로직)
- `.gitignore` 민감파일 처리 정상 (`.env`, `*.key`, `*-firebase-adminsdk-*.json`, `service-account*.json`)
- `npx tsc --noEmit` 통과
- Supabase 마이그레이션 47개 파일 정상 누적

---

## 7. iOS 빌드 준비 (다음 진행으로 보류)

### 좋은 소식 — 추가 작업이 거의 없는 것

| 기능 | 이유 |
|---|---|
| **Google 로그인** | 네이티브 SDK가 아니라 `signInWithOAuth` + `WebBrowser.openAuthSessionAsync` 방식. **iOS용 OAuth 클라이언트 ID 불필요.** `scheme: "viets"`가 iOS에도 자동 등록됨 |
| **Apple 로그인** | 같은 코드 경로를 공유하도록 이미 설계됨(`services/auth.ts` 상단 주석). MY 화면에 버튼도 존재 |
| **푸시 알림** | `expo-notifications`가 플랫폼 자동 분기. **코드 변경 0** — APNs 키만 등록하면 동작 |
| **지도** | iOS는 Apple Maps 자동 사용. API 키 불필요 |

### 필수 전제조건

| 항목 | 비고 |
|---|---|
| Apple Developer Program | **보유 중** (확인됨) |
| 아이폰 UDID 등록 | `npx eas device:create` → `Website` 선택 → 나온 URL을 **아이폰 Safari**에서 열어 프로파일 설치. **빌드보다 먼저** 해야 한다 — 건너뛰면 어느 아이폰에도 설치되지 않고 재빌드($2)가 필요 |
| APNs 키 | `npx eas credentials` → iOS → Push Notifications → 자동 생성 |
| Sign in with Apple | developer.apple.com에서 활성화 + Service ID·Key 생성 (약 15분) |
| Supabase Apple provider | Supabase 대시보드 → Authentication → Providers (약 5분) |

### iOS와 Android의 결정적 차이

Android는 APK 파일만 받으면 어느 기기에나 설치된다.
iOS는 **설치될 기기의 UDID가 빌드 시점에 앱 안에 박혀 있어야** 한다.
아이폰에서 Apple ID로 로그인하는 것과는 무관하며, **빌드하는 쪽**에 유료 개발자 계정이 필요하다.

### 빌드 비용

| 플랫폼 | 1회 비용 |
|---|---|
| Android medium | $1 |
| iOS medium | $2 |

현재 크레딧 잔액 **$3** (Starter $19/월에 포함된 $45 중 $42 소진, 10월 3일 리셋).
→ iOS 1회 + Android 1회면 소진. 이후 초과분은 10월 3일 청구서에 가산.

---

## 8. 진행 순서

### 1단계 · 커밋 (되돌릴 수 있는 지점 확보)

### 2단계 · 검증 (빌드 불필요)
- 2-1 웹 확인 (항목 16)
- 2-2 `npx expo-doctor`, `npx eslint .` (항목 18)
- 2-3 RLS 전수 SQL (항목 17)

### 3단계 · 심사 필수 기능 (결정 3건 선행)
- ~~3-1 AI 탭 처리 (항목 1)~~ **완료**
- 3-1 계정 삭제 (항목 2) — 데이터 처리 정책 결정 필요
- 3-2 약관·개인정보처리방침 화면 (항목 3·4) — 원문 필요
- 3-3 홈 화면 음성 버튼 (항목 13)

### 4단계 · 빌드 설정 정비 (항목 5~9 일괄)

### 5단계 · 보안 (항목 10·11)

### 6단계 · Apple 계정 작업 (약 20분)

### 7단계 · 빌드 — iOS $2 → 실기기 검증 → Android $1

### 8단계 · 스토어 등록 자료
스크린샷(6.7"·6.5") / 아이콘 1024px(알파 없음) / 앱 설명·키워드 / 연령 등급 /
**App Privacy 신고**(위치·사진·이메일 수집 명시) / 심사용 테스트 계정

---

## 9. 오늘 완료한 작업 (커밋 대기)

| 영역 | 내용 |
|---|---|
| **치명적 결함** | `public` 스키마 **35개 테이블 전체**에서 `service_role` GRANT 누락 → 엣지 함수가 모두 `permission denied`. 푸시가 한 건도 가지 않던 원인. (`20260915000000_restore_service_role_grants.sql`) |
| **광고 노출** | `featured=true` 매물이 광고 목록·일반 목록 **양쪽에서** 제외되어 TOP10 광고가 어디에도 보이지 않던 문제 수정 |
| 홈 | TOP10 = 유료 광고 10칸 고정, 우측에 정렬 칩(광고 10칸 **안에서만** 조건 적용) |
| 부동산 | 일반 매물 섹션 신설, 정렬 칩 이동, 5개씩 무한 스크롤 |
| 반응형 | 시스템 글꼴 배율 차단 / 하드코딩 `fontSize` 28곳 제거 / 폭 변경 시 스타일시트 재생성 |
| UI | FAQ 아코디언(Q 주황), 공지 점선 구분, 섹션 타이틀·카드 제목 축소 |
| i18n | 6개 언어 972키 |

### 반응형에서 배운 것 (재발 방지)

크기는 `constants/theme.ts`의 `TYPE_SCALE` **한 곳**에서만 정한다.

- `StyleSheet.create` 안의 맨 숫자 하나가 그 글자만 모든 기기에서 같은 크기로 굳힌다 (28곳이 그랬다)
- `textStyles.sectionTitle`을 쓰면서 뒤에 `fontSize`를 덮어쓰면 토큰이 무력화된다
  (`SectionHeader`가 `typography.size.lg`로 덮어쓰고 있었고, 그 때문에 토큰을 세 번 고쳐도 화면이 바뀌지 않았다)
- 폭에 반응해야 하는 화면 스타일은 `StyleSheet.create` 대신 `createScaledStyles(() => ({ ... }))`
- `createScaledStyles`의 제네릭은 react-native `StyleSheet.create`와 **글자 그대로** 같아야 한다
  (`NamedStyles<any>`를 `Record<string, unknown>`이나 `NamedStyles<never>`로 바꾸면 타입 추론이 무너진다 — 각각 135개·428개 오류)


---

## 10. ESLint 전수 정리 (2026-09-12 추가)

`npx eslint .` → **27 problems (5 errors, 22 warnings)** → **0건**.

### 오류 5건 — 코드 문제가 아니었다

전부 `supabase/functions/*/index.ts`의 `jsr:@supabase/supabase-js@2` import다.
이 파일들은 **Deno 런타임**이고 Node용 resolver는 `jsr:` 스키마를 모른다 —
린터가 다른 런타임을 보고 있었던 것이다.
`eslint.config.js`의 `ignores`에 `supabase/functions/**`와 `.expo/**`(자동 생성)를 추가했다.
Deno 쪽 문법 검사가 필요하면 `deno check supabase/functions/*/index.ts`.

### 실제 버그 2건 (내가 만든 것)

| 파일 | 증상 |
|---|---|
| `app/(tabs)/ai.tsx` | `useCallback` 의존성에 `i18n.language` 누락 — 앱 언어를 바꿔도 음성 인식이 콜백이 처음 만들어질 때의 언어로 굳는다 |
| `app/(tabs)/property.tsx` | `adSet`이 매 렌더 새 객체라 `listings`의 의존성이 거짓이었다. `featured`/`featuredSet`/`adSet`을 `useMemo`로 감싸고 의존성을 `adSet`으로 교체 |

### 데드코드

`property.tsx` `showComingSoon()` / `property-register.tsx` `ToggleRow`·`PHOTOS_PER_ROW`·남은 스타일 2개 /
`theme.ts` 미사용 `scaled()`·불필요한 `eslint-disable` 3줄 / 9개 파일의 미사용 import /
`property-detail/[id].tsx`의 중복 `mockData` import 병합.

### 오탐 1건

`i18n/index.ts`의 `i18n.use(...).init(...)`은 i18next 공식 초기화 방식이다.
`import/no-named-as-default-member`가 "`import {use}`를 쓰려던 것 아니냐"고 묻는 것이라 사유를 적고 지시문으로 껐다.

**주의**: 이 경고는 `.use` 줄이 아니라 **`i18n` 식별자 줄**에 붙는다.
`.use` 위에 지시문을 두면 원래 경고가 그대로 남고 "Unused eslint-disable directive" 경고가 하나 더 늘어난다.
