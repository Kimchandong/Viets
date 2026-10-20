# REALTY_AI_BASELINE_REPORT.md

**STEP 00 — 기존 프로젝트 사전 조사**

| | |
|---|---|
| 작성일 | 2026-10-20 |
| 대상 | Viet's 벳츠플랫폼 (앱 표시명 `BĐS & REiT`, Expo 프로젝트명 `viets-app`) |
| 조사 기준 | 로컬 작업 폴더의 소스·마이그레이션 파일 (커밋 `b8e47a3`) |
| 코드 변경 | **없음.** 이 단계에서는 조사만 수행했다 |

조사 방법의 한계를 먼저 밝힌다. 운영 DB에 직접 질의하지 않았고, 마이그레이션 파일을
근거로 스키마를 판단했다. 실제 DB에만 존재하는 객체(SQL Editor로 직접 만든 것)가
있으면 이 보고서에 빠진다. 또한 외부 서비스 상태는 2026-10-20 기준 공개 문서를
확인한 결과이며, 계약·요금은 실제 가입 절차에서 달라질 수 있다.

---

## 1. 현재 프로젝트 구조

| 항목 | 값 |
|---|---|
| 프레임워크 | React Native 0.81.5 · React 19.1.0 · Expo SDK ^54 |
| 라우팅 | expo-router ^6 (파일 기반) |
| 상태 | zustand ^5 |
| 다국어 | i18next ^24 — 6개 언어(vi, ko, en, zh, ja, th) |
| 백엔드 | Supabase (`@supabase/supabase-js` ^2.112.4) |
| 패키지 매니저 | npm (`package-lock.json`) |
| 타입·린트 | `npm run typecheck` (tsc --noEmit) · `npm run lint` (expo lint) |
| 빌드·배포 | EAS. OTA는 `npx eas update --branch preview`, 네이티브는 `eas build` |

소스 규모: `app` 38파일 · `components` 29 · `services` 23 · `supabase` 87 ·
마이그레이션 68개.

루트에 정리 대상이 섞여 있다(`web-preview-build`, `web-preview-build2`, `wpb3`,
`wpb4`, `dist`, `Viets 백업본.zip`, `package.json.before-expo-fix`, mp4 2개).
이번 작업과 무관하지만, 빌드 산출물이 저장소에 남아 있다는 사실은 기록해 둔다.

### 외부 연동 현황 (엣지 함수 7개)

| 함수 | 외부 호출 | 용도 |
|---|---|---|
| `translate` | Google Translation API v2 | 채팅 번역 (전역 캐시 `translation_cache`) |
| `translate-content` | Google Translation API v2 | 매물·투자 설명 번역 + 행에 저장 |
| `geocode` | Google Geocoding API | 주소 → 좌표 |
| `send-push` | Expo Push (`exp.host`) | 푸시 발송 |
| `ad-bid`, `ad-click` | Expo Push | 광고 입찰·클릭 처리 |

**LLM 연동은 한 건도 없다.** `openai` / `anthropic` / `gemini` 어느 흔적도
소스에 없다. `app/(tabs)/ai.tsx`의 "AI 검색"은 `services/aiSearch.ts`의
**로컬 규칙 기반 필터**이며(`listProperties` / `listInvestmentProducts` 결과를
앱에서 걸러낸다) 서버 호출도 LLM 호출도 하지 않는다. 요구사항의 "AI 분석"은
전부 신규 구축 대상이다.

---

## 2. 홈 화면 및 추천영역의 실제 구현 위치

파일: `app/(tabs)/home.tsx` (1,846줄). 탭 상태는 `categoryTab: "property" | "invest"`,
기본값 `"property"`.

| testID | 탭 | 섹션 | 데이터 공급 | 줄 |
|---|---|---|---|---|
| `home-section-property-featured` | 매물 | **추천 매물** | `listActiveAdSlots("featured")` → 없으면 `property.featured` | 777~ |
| `home-section-property-nearby` | 매물 | 최근 TOP10 | `listActiveAdSlots("top10")` | 878~ |
| `home-section-invest-recommended` | 투자 | **추천 투자상품** | `investmentProducts.filter(p => p.featured)` | 813~ |
| `home-section-invest-all` | 투자 | 전체 투자상품 | `investmentProducts.filter(p => !p.featured)` | 845~ |
| `home-section-notice` | 공통 | 공지 | `board_posts` (kind=notice) | 921~ |
| `home-section-faq` | 공통 | FAQ | `board_posts` (kind=faq) | 976~ |

### ⚠ 반드시 승인이 필요한 사항 — 매물 탭 "추천"은 광고 자리다

매물 탭의 추천 영역은 단순 추천이 아니라 **유료 광고 인벤토리**다.

- 공급원: `active_ad_slots` RPC → `property_ad_slots` 테이블
- 과금: `placement='featured'`, 클릭 단가 입찰(`bid_amount`), 노출 순서 = 광고비 순위
- 관련 화면: `app/ad-slots.tsx`, `app/ad-manage.tsx`, 엣지 함수 `ad-bid`·`ad-click`
- 광고비가 하나도 없을 때만 관리자가 수동으로 켠 `featured` 매물을 보여 준다

요구사항 §8은 "해당 추천영역을 제거하고 그 위치에 자동 부동산 정보 리스트를
배치한다"고 지시한다. 매물 탭의 추천을 제거하면 **`featured` 광고 상품이 사라진다.**
업체가 이미 입찰해 둔 금액의 처리(환불·이전)도 정의되어 있지 않다.

투자 탭의 추천 투자상품은 `featured` 플래그 기반이며 광고가 아니다 — 제거해도
매출 영향이 없다.

### ✅ 2026-10-20 사용자 결정 — "부동산 페이지 상단광고영역만 유지"

추가 조사로 밝혀진 사실: **`featured` 광고 캐러셀은 두 화면에 있다.**

| 화면 | 위치 | 결정 |
|---|---|---|
| 홈 매물 탭 (`home.tsx:777`) | 추천 매물 섹션 | **교체** → 자동 수집 리스트 |
| 부동산 탭 (`property.tsx:711`) | 지역·카테고리 칩 아래, 매물 목록 위 | **유지** |

같은 `placement='featured'` 자리를 두 화면이 공유하므로, 홈에서 빼도 **광고 상품
자체는 사라지지 않는다.** 입찰 금액 처리 문제도 발생하지 않는다.

단, 노출 지점이 두 곳에서 한 곳으로 줄어든다. 과금이 클릭당이므로 광고주의 클릭
수와 플랫폼 광고 수익이 함께 줄어들 수 있다 — 기존 광고주에게 고지가 필요한지는
운영 판단 사항으로 남긴다.

투자 탭 추천 투자상품(`featured` 플래그, 광고 아님)의 교체 여부는 아직 지시가 없다.

### 외부 URL 열기

`react-native-webview`는 **설치되어 있지 않다.** `expo-web-browser`는 OAuth용으로만
쓰이고, 외부 링크는 `Linking.openURL`로 시스템 기본 브라우저를 연 선례가 있다
(`app/admin-agencies.tsx:122`, `app/push-message/[id].tsx:71,95`).
→ LINK_ONLY 동작은 **신규 의존성 없이** 기존 방식으로 구현 가능하다.

---

## 3. 재사용할 수 있는 기존 기능

| 기능 | 위치 | 재사용 방법 |
|---|---|---|
| 다국어 콘텐츠 저장 패턴 | `board_posts`의 `title`/`body` + `title_i18n`/`body_i18n` + `source_lang` | 신규 콘텐츠 테이블에 같은 모양 적용 |
| 번역 + 전역 캐시 | `translate` / `translate-content` 함수, `translation_cache` (sha256 키) | 수집 콘텐츠 번역에 그대로 사용. 비용이 캐시로 눌린다 |
| 번역 사용량·비용 집계 | `translation_usage_log`, `app/admin-translation-usage.tsx` | API 사용량 리포트(STEP 09)에 확장 |
| 이미지 저장 | Storage 버킷 `app-media`, `board-images` | 썸네일 저장(권한 있는 경우만) |
| 관리자 권한 | `is_admin_or_above()` 134곳, `has_user_permission()` 34곳, `user_permissions` EAV | 신규 관리자 화면·RLS에 동일 적용 |
| 관리자 화면 패턴 | `app/admin-*.tsx` 8개 (특히 `admin-push.tsx`, `admin-boards.tsx`) | 정보원·콘텐츠·로그 화면의 틀 |
| 알림/푸시 | `notify_user()`, `user_notifications`, `send-push` | 수집 실패·검토 대기 알림 |
| 카드 UI | `components/PropertyListRow.tsx`, `SectionHeader`, `EmptyState` | 블로그형 썸네일 카드의 기준 스타일 |

**중복 구현 금지 대상**: `docs/AI_RESEARCH.md`(v0.1, 2026-08-26)와
`docs/DATABASE.md` §5에 이번 기능의 설계가 **이미 문서화되어 있다.**

| 설계 문서상 이름 | 구현 여부 |
|---|---|
| `article_sources` | **없음** |
| `articles` (source_url/source_domain/status/summary/facts/embedding) | **없음** |
| `article_translations` | **없음** |
| `research_jobs` | **없음** |
| 엣지 함수 `research-news`, `summarize-article`, `generate-embedding` | **없음** |

문서는 있고 구현은 0%다. 요구사항 §11의 `real_estate_*` 테이블명은 "설계 예시"로
명시되어 있으므로, **기존 설계 문서의 이름을 따르는 것을 권고한다.** 두 이름 체계가
공존하면 DATABASE.md가 즉시 거짓이 된다.

---

## 4. 추가가 필요한 API 및 서비스

### A. 베트남 건설부 주택·부동산 시장 정보 시스템 — PENDING

법령(주택·부동산시장 정보시스템 관련 규정)에 따라 분기별 정보 공개 의무가 있고
전국 통합 데이터베이스가 존재한다는 것은 확인했다. 그러나 **개발자용 공개 API나
데이터 피드 문서는 찾지 못했다.** 공개 자료는 법령 해설·언론 기사뿐이고,
데이터베이스 이용은 신청·수수료 절차를 거치는 구조로 서술되어 있다.

→ STEP 01에서 공식 포털의 실제 제공 형태(웹 공개 통계 / RSS / 신청 기반)를
확인해야 한다. 확인 전까지 **PENDING**이며, 가상 API를 만들지 않는다.

### B. Google · Bing 검색 API — **BLOCKED (요구사항대로는 불가)**

| 서비스 | 2026-10-20 기준 상태 |
|---|---|
| Bing Search API | **2025-08-11 폐지 완료.** Microsoft가 Azure AI Agents의 "Grounding with Bing Search"로 이전을 안내 |
| Google Custom Search JSON API | **신규 가입 중단.** 기존 고객 대상 **2027-01-01 서비스 종료** 예고. (무료 100건/일, 유료 $5/1,000건, 일 10,000건 상한) |

요구사항 §4-B는 "Google 및 Bing 검색 서비스를 연동한다"고 지시하지만,
**두 서비스 모두 신규로 연동할 수 없다.** 개발 원칙 "중단된 서비스에 의존하지
않는다"에 정면으로 걸린다.

대체 후보(요금·약관은 STEP 01에서 확인 필요):

- Azure AI Agents — Grounding with Bing Search (Microsoft 공식 후속)
- Brave Search API (무료 구간 폐지, 전량 종량제로 전환된 것으로 보고됨)
- Serper / SerpAPI / Tavily / Exa 등 상용 검색 API
- 검색 API를 쓰지 않고, 허가된 출처의 RSS·사이트맵만 직접 수집

**검색 제공자 선택은 비용·약관 결정이므로 사용자 승인이 필요하다.**

### C. 허가된 중개업체·개발사 — PENDING

공식 데이터 제공 계약이 확인된 업체가 현재 **하나도 없다.** 등록 구조(테이블·관리자
화면)는 만들 수 있으나, 실제 연동은 계약 후에만 가능하다. 후보 목록으로만 기록한다.

### D. AI 분석(LLM) — PENDING

현재 프로젝트에 LLM 연동이 없다. 요약·분류·사실 추출에는 신규 API 계약과 비용이
필요하다. 어느 제공자를 쓸지, 월 예산 상한을 얼마로 둘지 결정이 필요하다.

---

## 5. 데이터베이스 변경 필요 여부

**필요하다.** 현재 68개 마이그레이션에 정의된 테이블(37개)에 수집 콘텐츠를 담을
곳이 없다.

<details>
<summary>현재 테이블 37개</summary>

`ad_click_log` `ad_notifications` `agencies` `agency_members` `agency_permissions`
`audit_logs` `balance_entries` `board_post_images` `board_posts` `developers`
`favorites` `investment_conversations` `investment_messages` `investment_orders`
`investment_products` `investors` `locations` `notification_preferences` `owners`
`payment_requests` `payment_settings` `profiles` `properties` `property_ad_slots`
`property_categories` `property_conversations` `property_documents`
`property_images` `property_messages` `property_reports` `push_campaigns`
`push_tokens` `translation_cache` `translation_usage_log` `user_notifications`
`user_permissions` `user_read_marks` `user_roles`

</details>

`properties`를 재사용하지 않는 이유: `properties`는 **업체가 등록해 거래하는 매물**이고
광고·상담·투자상품과 FK로 엮여 있다. 외부에서 수집한 기사·시장정보를 같은 표에 넣으면
매물 목록·검색·광고 입찰에 외부 콘텐츠가 섞인다.

권고 스키마(DATABASE.md §5 이름 유지):

| 테이블 | 비고 |
|---|---|
| `article_sources` | 정보원. 상태 `VERIFIED`/`PENDING`/`DISABLED`, 접근 방식, 마지막 성공 시각 |
| `articles` | 수집 콘텐츠. `source_url` `source_domain` `source_published_at` `collected_at` `status` `summary` `facts` `content_permission` `content_hash` |
| `article_translations` | 언어별 제목·요약 (또는 `board_posts`처럼 `*_i18n` jsonb 방식) |
| `research_jobs` | 실행 로그. `started_at` `finished_at` `status` `stats jsonb` `error` |
| 관리자 설정 | **현재 설정 테이블이 없다**(`app_settings`/`admin_settings` 모두 부재). 실행 시각·일일 게시 수 상한을 저장할 곳을 새로 만들어야 한다 |

`embedding vector(1536)` 컬럼은 `pgvector` 확장이 필요하다 — 현재 활성 여부
미확인(§10).

RLS 방침: `articles`는 `status='published'`만 공개 읽기, 나머지는 관리자·리뷰어.
쓰기는 서버(service_role)만. `article_sources`·`research_jobs`는 관리자 전용.
기존 패턴(`is_admin_or_above()`)을 그대로 쓴다.

---

## 6. 예상 변경 파일 목록

**신규**

| 경로 | 내용 |
|---|---|
| `supabase/migrations/<ts>_article_sources.sql` 외 | 위 4~5개 테이블 + RLS + enum |
| `supabase/functions/research-news/index.ts` | 수집 엔진 |
| `supabase/functions/summarize-article/index.ts` | AI 분석·요약 |
| `services/articles.ts` | 목록·상세 조회 |
| `services/articleAdmin.ts` | 정보원·설정·로그 관리 |
| `components/ArticleCard.tsx` | 블로그형 썸네일 카드 |
| `app/article/[id].tsx` | 내부 상세페이지 (INTERNAL_ALLOWED 전용) |
| `app/admin-articles.tsx` | 콘텐츠 관리 |
| `app/admin-article-sources.tsx` | 정보원 관리 |
| `app/admin-article-settings.tsx` | 자동 게시 설정·실행 로그 |

**수정**

| 경로 | 내용 |
|---|---|
| `app/(tabs)/home.tsx` | 지정된 추천영역 교체 (§2의 승인 후) |
| `app/(tabs)/my.tsx` | 관리자 섹션에 신규 화면 진입점 |
| `i18n/locales/*.json` (6개) | 신규 문구 |
| `services/notifications.ts` | 수집 실패·검토 대기 알림 종류 추가 |
| `docs/AI_RESEARCH.md`, `docs/DATABASE.md` | 실제 구현에 맞춰 갱신 |

---

## 7. 보안 및 데이터 사용 권한 위험

| # | 위험 | 현재 상태 | 대응 |
|---|---|---|---|
| 1 | 외부 콘텐츠 무단 복제 | — | `content_permission` 상태로 분기. LINK_ONLY는 본문·이미지를 저장하지 않는다 |
| 2 | 이미지 무단 재업로드 | — | 권한 확인 전에는 다운로드·업로드 금지. 자체 중립 이미지 사용 |
| 3 | SSRF | **대응 없음** | 수집 대상 URL을 서버에서 검증. 사설 IP·내부 호스트 차단 |
| 4 | 프롬프트 인젝션 | **대응 없음** | 수집 본문은 데이터로만 취급. LLM 출력이 설정·권한을 바꾸지 못하게 한다 |
| 5 | API 키 노출 | **현재 양호** | 키는 Supabase Secrets에만. 클라이언트 번들(`EXPO_PUBLIC_*`)에는 Supabase URL·anon key·Maps key만. `EXPO_PUBLIC_GOOGLE_TRANSLATE_API_KEY`는 주석에만 남은 과거 흔적이고 실제 사용처는 없다 |
| 6 | 관리자 기능 우회 | 기존 패턴 양호 | 서버 측 RLS·함수로 검증. 화면 숨김에 의존하지 않는다 |
| 7 | 권한 철회 후 노출 지속 | — | `REVOKED` 상태 시 신규 노출 중단 + 기존 콘텐츠 처리 정책 필요(정책 미정) |
| 8 | 비용 폭주 | **대응 없음** | 일일 호출 상한·중복 제거·캐시. 상한 초과 시 안전 중단 |

추가로 기록할 사실: 요구사항 §7은 `translate-content`를 번역 단계에 쓰도록
설계되어 있는데, 이 함수는 **익명 호출을 허용한다**(비로그인 사용자도 매물 설명
번역을 받아야 하기 때문). 기사 번역에 쓸 때는 행 id만 받고 원문을 서버가 읽는
현재 구조를 유지해야 한다.

---

## 8. 구현 가능 여부와 선행 조건

| 구성요소 | 가능 여부 | 선행 조건 |
|---|---|---|
| DB 스키마·RLS | 가능 | 테이블명 체계 확정(DATABASE.md 이름 권고) |
| 관리자 화면 | 가능 | 없음 |
| 홈 리스트 UI | 가능 | **어느 추천영역을 교체할지 확정** (§2) |
| 권한별 분기(내부 상세 / 외부 링크) | 가능 | 없음. `Linking.openURL` 재사용 |
| 중복 제거·멱등성 | 가능 | 없음 |
| 매일 오전 자동 실행 | **조건부** | 스케줄러가 **현재 없다**. pg_cron 미사용, 엣지 함수는 전부 HTTP 트리거. Supabase 플랜에서 Cron 사용 가능 여부 확인 필요 |
| 검색 기반 정보 수집 | **BLOCKED** | Google·Bing 검색 API 모두 신규 연동 불가(§4-B). 대체 제공자 승인 필요 |
| 건설부 공식 데이터 | **PENDING** | 공개 API 존재 여부 확인 |
| 업체 데이터 피드 | **PENDING** | 계약 |
| AI 요약·분류 | **PENDING** | LLM 제공자·예산 결정 |

요약: **앱과 DB 쪽은 전부 구현 가능하고, 막혀 있는 것은 전부 "외부에서 무엇을
가져올 것인가"다.** 정보원 결정 없이 수집 엔진을 만들면 돌릴 대상이 없다.

---

## 9. 단계별 개발 계획

| 단계 | 내용 | 선행 |
|---|---|---|
| 0 | 이 보고서 검토 · 추천영역 교체 범위 확정 · 검색 제공자 결정 | — |
| 1 | 정보원 조사 확정 (건설부 / 검색 제공자 / 업체) · `REALTY_AI_API_INVENTORY.md` | 0 |
| 2 | DB 스키마 + RLS 마이그레이션 · `REALTY_AI_DATABASE_REPORT.md` | 1 |
| 3 | 관리자 화면 3종 (정보원 / 콘텐츠 / 설정·로그) | 2 |
| 4 | 수집 엔진 `research-news` — 정규화·중복 제거·멱등성. 정보원 1곳으로 먼저 | 2 |
| 5 | AI 분석 `summarize-article` — 요약·분류·품질 검증 | 4 |
| 6 | 홈 리스트 UI + 권한별 분기 + 내부 상세페이지 | 2 |
| 7 | 스케줄러 (베트남 시간대 매일 오전) | 4 |
| 8 | 비용·사용량 제한 | 5, 7 |
| 9 | 테스트 · `REALTY_AI_TEST_REPORT.md` · `REALTY_AI_SECURITY_REPORT.md` | 전부 |

각 단계는 조사 → 변경 계획 보고 → 구현 → 테스트 → 증거 기록 → 완료 판정 순서로
진행한다.

---

## 10. 아직 확인되지 않은 사항

| # | 미확인 | 확인 방법 |
|---|---|---|
| 1 | ~~교체 대상 추천영역~~ → **2026-10-20 결정: 홈 매물 탭 교체, 부동산 탭 광고 유지** | 해결 |
| 2 | ~~입찰 금액 처리~~ → 같은 자리가 부동산 탭에 남아 **해당 없음** | 해결 |
| 3 | 투자 탭 추천 투자상품도 교체할지 | **사용자 결정** |
| 4 | 검색·AI 제공자 확정과 월 예산 (§4 권고안 검토) | **사용자 결정** |
| 5 | 건설부 공개 API·피드의 실제 존재 여부 | STEP 01 — 공식 포털 확인 |
| 6 | Supabase 플랜에서 Cron 사용 가능 여부·실행 제한 | Supabase 대시보드 확인 |
| 7 | `pgvector` 확장 활성 여부 (임베딩을 쓸 경우) | `select * from pg_extension` |
| 8 | 운영 DB에만 있는 객체 유무 (마이그레이션 외 수동 생성분) | DB 스키마 덤프와 마이그레이션 비교 |
| 9 | `REVOKED` 상태가 된 기존 콘텐츠의 처리 정책 (숨김 / 삭제 / 링크만) | **사용자 결정** |
| 10 | 일일 게시 수 상한의 실제 기준값 (초기 제안 20) | 사용자 확인 |

---

## 부록 — 테스트하지 않은 것

이 보고서는 **조사 결과만** 담는다. 다음은 수행하지 않았으므로 어떤 항목도
PASS로 표시하지 않는다.

- 실제 정보원 연동 (연동 대상이 아직 결정되지 않았다)
- 자동 수집·자동 게시 실행 (수집 엔진이 존재하지 않는다)
- 권한별 분기 동작 (`articles` 테이블과 상세페이지가 존재하지 않는다)
- 스케줄러 실행 (스케줄러가 존재하지 않는다)
- 앱 빌드 검증 (코드를 변경하지 않았다)

요구사항 §16의 완료 조건 14개 중 현재 충족된 것은 **1개**(기존 프로젝트 구조 및
변경 대상 확인)이며, 나머지 13개는 미착수다.
