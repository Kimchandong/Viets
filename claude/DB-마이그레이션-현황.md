# DB-마이그레이션-현황

작성 2026-09-16 · 근거: **마이그레이션 52개 파일 파싱 + 운영 Supabase 실측** (문서가 아니라 SQL과 실DB)

> ## 이 문서를 쓰는 법
>
> - 표는 **화면이 요구해서 존재한다.** 화면이 요구하지 않는 표는 지우거나, 왜 남기는지 여기 적는다.
> - 마이그레이션을 새로 만들면 2절 표에 한 줄 추가한다.
> - 함수를 **재정의**하면 (같은 이름을 다시 `create or replace`) 3절 재정의 횟수를 올린다.
>   재정의는 "이전에 잘못 만들었다"는 뜻이라 흔적을 남겨야 한다.
>
> **측정 방법**
> - 마이그레이션: `supabase/migrations/*.sql` 52개를 파싱해 `create table` / `create function` /
>   `create policy` / `drop policy` / `grant` / `revoke` 를 셌다.
> - 실DB 행 수: `reltuples`는 **쓰지 않았다.** PostgreSQL 14 이상에서 `-1`은 "빈 표"가 아니라
>   **"한 번도 ANALYZE 하지 않음"** 이다. `query_to_xml`로 표마다 실제 `count(*)`를 돌렸다.
> - 정책·트리거 수: `pg_policies` / `pg_trigger` (사용자 트리거만, 내부 FK 트리거 제외).
> - "닿는 경로": 화면 → 서비스 → 표 뿐 아니라 **화면 → RPC → 표**, **화면 → 엣지 함수 → RPC → 표**,
>   **화면 → 스토어 → 표** 까지 따라갔다. 표 이름이 상수로 숨어 있는 경우도 상수를 해석했다.

---

## 1. 요약

| 항목 | 수 |
|---|---|
| 마이그레이션 파일 | 52 |
| 만든 표 | 35 |
| 정의한 함수 | 51 |
| 그중 **재정의된 함수** | **10** (총 26회 정의) |
| 표만 만들고 아무 것도 안 만든 마이그레이션 | 17 (열 추가 · 권한 조정 전용) |
| 화면이 **직접** 읽고 쓰는 표 | 19 |
| RPC·엣지·스토어를 **거쳐서만** 닿는 표 | 9 |
| **닿는 경로가 전혀 없는 표** | **7** |

35 = 19 + 9 + 7. 마이그레이션이 만든 표와 실DB의 표는 **정확히 일치**한다 — 손으로 만든 표도, 사라진 표도 없다.

---

## 2. 마이그레이션 52개

날짜순. `표+n` = 표 n개 생성, `함수+n` = 함수 n개 정의, `정책+n/-n` = 정책 생성/삭제, `grant n` / `revoke n` = 권한 구문 수.

| # | 날짜 | 파일 | 내용 |
|---|---|---|---|
| 1 | 08-28 | `profiles_and_user_roles` | 표+2 함수+3 정책+6 grant1 revoke1 |
| 2 | 09-01 | `property_agency_foundation` | 표+4 함수+3 정책+16 grant2 revoke2 |
| 3 | 09-10 | `property_domain_foundation` | 표+7 함수+5 정책+41 grant4 revoke4 |
| 4 | 09-10 | `property_listing_fields` | 열 추가 (listing_type/bedrooms/bathrooms/featured/amenities) |
| 5 | 09-10 | `grant_property_domain_table_privileges` | 정책+1 grant13 |
| 6 | 09-10 | `favorites` | 표+1 정책+3 grant1 |
| 7 | 09-10 | `investment_domain` | 표+3 함수+1 정책+10 grant5 |
| 8 | 09-10 | `investment_category` | 열 추가 (category 7종) |
| 9 | 09-10 | `property_delete_policy` | 정책+1 grant1 |
| 10 | 09-10 | `user_permissions` | 표+1 함수+1 정책+14 grant2 |
| 11 | 09-10 | `admin_user_search` | 함수+2 grant2 |
| 12 | 09-10 | `translation_cache` | 표+2 함수+1 정책+1 grant2 |
| 13 | 09-11 | `chat_schema_capture` | 표+2 정책+2 grant2 |
| 14 | 09-11 | `chat_property_uuid_fk` | 열 타입 변경 (property_id text→uuid + FK) |
| 15 | 09-11 | `grant_identity_agency_tables` | grant8 |
| 16 | 09-11 | `storage_property_images_permitted` | 정책+3 (스토리지) |
| 17 | 09-11 | `chat_manager_access` | 함수+1 정책+4 grant1 revoke1 |
| 18 | 09-11 | `property_created_by` | 함수+1 정책+5/-5 |
| 19 | 09-11 | `fix_created_by_backfill` | **앞 마이그레이션의 백필 정정** (제목 추측 → 실제 등록자) |
| 20 | 09-11 | `agency_application` | 함수+4 정책+7/-7 grant4 revoke4 |
| 21 | 09-11 | `payment_and_balance` | 표+3 함수+5 정책+9/-9 grant9 revoke5 |
| 22 | 09-11 | `settlement_rename` | 함수+1 grant1 revoke1 |
| 23 | 09-11 | `investment_region` | 열 추가 (region) |
| 24 | 09-11 | `translation_usage_periods` | 함수+2 grant2 |
| 25 | 09-11 | `property_region` | 열 추가 (region) |
| 26 | 09-11 | `boards` | 표+2 함수+2 정책+11/-11 grant5 |
| 27 | 09-11 | `read_marks` | 표+1 함수+3 정책+2/-2 grant4 |
| 28 | 09-11 | `unread_own_properties` | 함수+1 grant1 |
| 29 | 09-11 | `avatars` | 정책+4/-4 (스토리지) |
| 30 | 09-11 | `rename_my_agency` | 함수+1 grant1 revoke1 |
| 31 | 09-12 | `ad_slots` | 표+1 함수+1 정책+1/-1 grant2 revoke1 |
| 32 | 09-12 | `ad_click_billing` | 표+2 함수+5 정책+2/-2 grant4 revoke4 |
| 33 | 09-12 | `push_and_click_guard` | 표+1 함수+2 정책+4/-4 grant2 revoke2 |
| 34 | 09-12 | `ad_rules_and_deposit_min` | 함수+5 grant2 revoke3 |
| 35 | 09-12 | `ad_drop_notice` | 함수+1 grant1 revoke1 |
| 36 | 09-12 | `ad_bid_agency_backfill` | 함수+1 grant1 revoke1 |
| 37 | 09-12 | `ad_bid_agency_fallback_fix` | 함수+1 grant1 revoke1 |
| 38 | 09-13 | `property_reports` | 표+1 정책+3/-3 grant1 |
| 39 | 09-13 | `release_ad_slots_on_status` | 함수+1 |
| 40 | 09-13 | `ad_bid_allow_lower` | 함수+1 grant1 revoke1 |
| 41 | 09-13 | `ad_bid_require_active` | 함수+1 grant1 revoke1 |
| 42 | 09-13 | `content_translation` | 열 추가 (매물·투자상품 설명 6개 언어) |
| 43 | 09-13 | `notification_inbox` | 표+2 함수+7 정책+4/-4 grant3 revoke1 |
| 44 | 09-14 | `push_locale_and_delivery` | 함수+1 grant1 revoke1 |
| 45 | 09-14 | `tighten_public_reads` | 정책+2/-2 |
| 46 | 09-14 | `grant_charge_ad_click_service_role` | grant1 |
| 47 | 09-14 | `ad_billing_summary` | 함수+1 grant1 revoke1 |
| 48 | 09-14 | `payment_request_notification` | 함수+1 |
| 49 | 09-15 | `restore_service_role_grants` | grant5 — **45·46에서 끊긴 권한 복구** |
| 50 | 09-16 | `close_public_read_leaks` | 정책+1/-4 revoke4 — **anon 읽기 누수 차단** |
| 51 | 09-17 | `delete_my_account` | 함수+1 grant1 revoke1 — 스토어 필수 계정 삭제 |
| 52 | 09-18 | `legal_documents` | enum 2값 추가 + 약관·방침 글 2건 (2단계 실행) |

### 여기서 보이는 것

**① 광고 입찰(`set_ad_bid`) 하나에 마이그레이션 7개가 붙어 있다** — 31·34·36·37·40·41 + 32.
`ad_bid_agency_backfill` → `ad_bid_agency_fallback_fix` → `ad_bid_allow_lower` → `ad_bid_require_active`.
한 함수를 네 번 고쳐 쓴 흔적이고, 고칠 때마다 조건이 하나씩 붙었다. **현재 `set_ad_bid`가
어떤 규칙으로 동작하는지 아무 문서에도 정리돼 있지 않다.** → 3단계로 넘김.

**② 권한(grant/revoke)을 끊었다 다시 붙인 구간이 있다.** 49번 마이그레이션 머리말에 원인이
남아 있다 — 공개 노출을 좁히려고 `revoke ... from public`을 걸었는데, **service_role이
상속받아 쓰던 권한이 바로 그 public 권한이었다.** 결과로 `public` 스키마 **35개 표 전부**에서
service_role의 SELECT/INSERT/UPDATE/DELETE가 빠졌고, 푸시 알림이 한 건도 가지 않았다
(`[send-push] lookup failed: permission denied for table user_notifications`).
49에서 복구했고, 50에서 다시 anon 권한 4건을 정확히 지정해 회수했다.

교훈: **`revoke from public`은 service_role까지 같이 끊는다.** 앞으로 권한을 좁힐 때는
역할을 명시해서(`revoke ... from anon`) 건다. 50번이 그 방식이다.

**③ 19번은 18번의 정정이다.** `created_by`를 "제목에 '테스트 매물'이 들어가면 teststore"라는
추측으로 채웠다가 실제와 **정반대**임을 발견해 다시 채웠다. 마이그레이션에 추측을 넣으면
정정 마이그레이션이 한 개 더 생긴다는 기록.

---

## 3. 재정의된 함수 10개

| 함수 | 정의 횟수 | 무엇을 하는가 |
|---|---|---|
| `set_ad_bid` | **7** | 광고 입찰가 설정 |
| `charge_ad_click` | **3** | 클릭당 과금 |
| `active_ad_slots` | 2 | 노출 중인 광고 자리 조회 |
| `admin_review_payment` | 2 | 입금 승인 |
| `admin_translation_usage` | 2 | 번역 사용량 집계 |
| `can_manage_property_chat` | 2 | 상담 권한 판정 |
| `charge_property_register` | 2 | 매물 등록비 과금 |
| `my_unread_chat_count` | 2 | 안 읽은 상담 수 |
| `register_push_token` | 2 | 푸시 토큰 등록 |
| `submit_payment_request` | 2 | 입금 신고 |

**재정의 10개 중 5개가 돈이 오가는 함수다** — `set_ad_bid` · `charge_ad_click` ·
`charge_property_register` · `admin_review_payment` · `submit_payment_request`.
여섯 번째인 `active_ad_slots`도 광고 노출을 결정하므로 같은 영역이다.
정의를 여러 번 고쳤다는 것은 **처음에 규칙을 잘못 잡았다**는 뜻이므로,
빌드 테스트에서 가장 먼저 확인해야 할 영역이 여기다.

---

## 4. 표 35개 — 실측

행 수는 2026-09-16 운영 Supabase 실측치(`count(*)`).

### ① 화면이 직접 읽고 쓰는 표 (19)

| 표 | 행 | 정책 | 트리거 | 쓰는 화면 |
|---|---:|---:|---:|---|
| `user_notifications` | 11 | 3 | 0 | N1 |
| `balance_entries` | 10 | 2 | 0 | G4 |
| `property_images` | 10 | **10** | 0 | P2 |
| `profiles` | 7 | 2 | 1 | T5 |
| `payment_requests` | 6 | 2 | 2 | G4 · M2 |
| `properties` | 6 | **11** | 3 | T1 · T2 · T4 · T5 · P1 · P2 · P3 · G2 · G3 · G4 · I3 |
| `board_posts` | 5 | 5 | 1 | T1 · B1 · B2 · L1 · M3 · M4 |
| `property_ad_slots` | 4 | 1 | 0 | G3 |
| `investment_products` | 3 | 9 | 1 | T1 · T3 · T4 · T5 · I1 · I2 · I3 · P1 |
| `agencies` | 2 | 4 | 3 | M1 |
| `agency_members` | 2 | 6 | 0 | T5 · P2 · P3 · P5 · G1 · G3 · G4 |
| `board_post_images` | 2 | 2 | 1 | B1 · M4 |
| `notification_preferences` | 1 | 1 | 0 | N1 |
| `payment_settings` | 1 | 2 | 0 | G3 · G4 · M2 |
| `property_reports` | 1 | 3 | 1 | P1 · M5 |
| `ad_notifications` | **0** | 2 | 1 | T5 |
| `investment_orders` | **0** | 4 | 1 | I2 · T5 |
| `property_conversations` | **0** | 2 | 0 | P3 · P4 · P5 |
| `property_messages` | **0** | 4 | 0 | P3 · P4 · P5 · M6 |

### ② RPC · 엣지 함수 · 스토어를 거쳐서만 닿는 표 (9)

화면 코드에는 이름이 없지만 **지우면 앱이 깨진다.**

| 표 | 행 | 정책 | 트리거 | 경유 |
|---|---:|---:|---:|---|
| `translation_cache` | 10 | 0 | 0 | 엣지 `translate` |
| `translation_usage_log` | 10 | 1 | 0 | `admin_translation_usage` |
| `user_roles` | 9 | 4 | 0 | `is_admin_or_above` 외 권한 판정 함수 5개 |
| `user_read_marks` | 4 | 2 | 0 | `mark_read` · `my_unread_chat_count` |
| `ad_click_log` | 3 | 0 | 0 | 엣지 `ad-click` → `charge_ad_click` |
| `agency_permissions` | 3 | 4 | 2 | `admin_review_agency` · `agency_has_active_permission` |
| `push_tokens` | 3 | 4 | 0 | `register_push_token` |
| `user_permissions` | 1 | 5 | 1 | `has_user_permission` · `admin_set_user_permission` |
| `favorites` | 2 | 3 | 0 | 스토어(`store/`) 경유 |

`translation_cache`와 `ad_click_log`는 **정책이 0개**다. 엣지 함수가 service_role로 접근하기
때문에 의도된 것이지만, 정책 0 = "RLS를 통과할 수 있는 역할이 없음"이라 **anon/authenticated는
이 표를 아예 못 읽는다.** 이것이 맞는 설계인지 4단계에서 확정한다.

### ③ 닿는 경로가 전혀 없는 표 (7)

| 표 | 행 | 정책 | 트리거 | 상태 |
|---|---:|---:|---:|---|
| `audit_logs` | 5 | 1 | 0 | 트리거 `audit_log_admin_changes`가 **쓰기만** 한다. 읽는 화면 없음 |
| `investors` | 0 | 1 | 0 | 트리거 `ensure_investor_on_order`가 쓸 예정. 주문이 0건이라 비어 있음 |
| `developers` | 0 | 4 | 1 | 쓰는 코드 없음 |
| `owners` | 0 | 4 | 1 | 쓰는 코드 없음 |
| `locations` | 0 | 4 | 1 | 지역은 `MOCK_REGIONS` 상수를 쓴다 |
| `property_categories` | 0 | 4 | 1 | 분류는 `constants/mockData.ts`를 쓴다 |
| `property_documents` | 0 | **8** | 0 | 쓰는 코드 없음. **빈 표에 정책 8개** |

`developers` / `owners` 라는 문자열이 `constants/icons.ts`와 `constants/mockData.ts`에 있지만
**표와 무관한 이름**(아이콘 키·목 데이터)이다. 표를 참조하는 것이 아니다.

---

## 5. 이번 실측에서 드러난 문제

### ① `property_messages`·`property_conversations`가 **0행이다** 〔확정 — 원인은 미확정〕

통계(`pg_class.reltuples`)에는 `property_messages`가 약 10행으로 잡혀 있는데 `count(*)`는 **0**이다.
통계가 남아 있다는 것은 **과거에 행이 있었고 그 뒤에 지워졌다**는 뜻이다.

원인은 **추측하지 않는다.** 가능성만 적어 둔다 — 테스트 계정을 지우면서 `customer_id`의
`on delete cascade`를 타고 대화 전체가 지워졌을 수 있다(51번 마이그레이션에서 이 FK를
`set null`로 바꾼 이유가 바로 그것이다). 확인하려면 Supabase 로그를 봐야 한다.

**영향**: 채팅 기능은 빌드 테스트에서 **처음부터 다시** 만들어 봐야 한다. 기존 데이터로
확인할 수 없다.

### ② `investment_orders`가 0행 — I2 투자 신청은 **한 번도 실행된 적이 없다** 〔확정〕

화면(`invest-apply/[id].tsx`)은 있고 표도 있지만 주문이 0건이다. `ensure_investor_on_order`
트리거도 한 번도 안 돌았고 `investors`도 0행이다.

Dong 지시사항 — *"투자관련 메뉴의 모든 기능은 빌드테스트시 반드시 내용확인이 필요하니
차단되거나 기능구현에 제약이 있으면 안 됩니다"* — 에 따라, **I2는 빌드 테스트 필수 항목**이다.
이 경로는 실행 이력이 0이라 트리거·FK·정책 중 어디서 막힐지 예측할 수 없다.

### ③ 빈 표 5개에 정책 21개가 붙어 있다 〔확정〕

`developers`(4) · `owners`(4) · `locations`(4) · `property_categories`(4) · `property_documents`(8).
**5개 모두 3번 마이그레이션 `property_domain_foundation` 하나에서 나왔다.** 이 마이그레이션은
표 7개(`developers` `locations` `owners` `properties` `property_categories` `property_documents`
`property_images`)와 정책 41개를 한꺼번에 만들었는데, 그중 **실제로 쓰이는 것은 `properties`와
`property_images` 2개뿐**이다.
**설계 단계에서 만든 뒤 화면이 따라오지 않은 표**다.

특히 `property_documents`는 정책 8개(매물 대비 10개인 `property_images`와 비슷한 수준)인데
**쓰는 코드가 한 줄도 없다.** 매물 서류 첨부 기능을 만들다 만 것으로 보이나, 근거가 되는
주석이 없어 단정하지 않는다.

### ④ 정책 수가 표마다 들쭉날쭉하다 〔확인 필요〕

| 표 | 정책 | 비고 |
|---|---:|---|
| `properties` | 11 | 18번에서 정책 5개를 지우고 5개를 다시 만들었다 |
| `property_images` | 10 | |
| `investment_products` | 9 | |
| `property_documents` | 8 | **빈 표 · 쓰는 코드 없음** |
| `translation_cache` · `ad_click_log` | 0 | service_role 전용 |

(위 정책 수는 `public` 스키마 `pg_policies` 기준이다. 스토리지 버킷 정책은 별도이며 세지 않았다.)

한 표에 정책이 10개 넘게 붙으면 **어느 정책이 실제로 통과를 결정하는지 읽어서는 알 수 없다.**
RLS는 SELECT 정책이 OR로 합쳐지므로, 가장 느슨한 정책 하나가 나머지 9개를 무의미하게 만든다.
`properties` · `property_images` · `investment_products` 세 표는 **정책 본문을 실제로 읽어
통합할 후보**다. → 4단계 판단 항목.

---

## 6. 검증된 것 / 검증 안 된 것

| | |
|---|---|
| **검증됨** | 표 35개 존재 · 행 수 · 정책 수 · 트리거 수 (실DB 조회) |
| **검증됨** | 마이그레이션 52개가 만든 표 = 실DB 표 (정확히 일치) |
| **검증됨** | 화면 → 표 도달 경로 (RPC·엣지·스토어 3단계까지 추적) |
| **검증 안 됨** | 정책 **본문**이 의도대로 동작하는지 — 개수만 셌다 |
| **검증 안 됨** | `set_ad_bid` 현재 규칙 — 7번 재정의된 최종본을 읽지 않았다 |
| **검증 안 됨** | 채팅 데이터가 언제·왜 지워졌는지 |
| **검증 안 됨** | 각 표의 **열** 정의가 화면 요구와 맞는지 — 3단계(불일치 목록)에서 한다 |

---

## 7. 다음 문서로 넘길 것

| 항목 | 넘길 곳 |
|---|---|
| 화면이 요구하는 열 × 실제 열 대조 | 3단계 불일치 목록 |
| `set_ad_bid` 최종 규칙 정리 | 3단계 불일치 목록 |
| 빈 표 5개(`developers`·`owners`·`locations`·`property_categories`·`property_documents`) 존폐 | 확정-결정사항.md |
| 정책 통합 여부 (`properties`·`property_images`·`investment_products`) | 확정-결정사항.md |
| `translation_cache`·`ad_click_log` 정책 0개가 맞는지 | 확정-결정사항.md |
| I2 투자 신청 = 빌드 테스트 필수 (실행 이력 0) | 실기기-테스트-체크리스트 |
| 채팅은 처음부터 다시 만들어 테스트 (데이터 0) | 실기기-테스트-체크리스트 |
