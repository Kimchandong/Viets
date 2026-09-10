# DEVELOPMENT_MASTER_CHECKLIST.md — Viet's

버전: v1.2 · 작성일: 2026-09-01 · 최종수정: 2026-09-09 (Property Name/Address 자동번역 금지 불변 규칙 — DECISIONS.md D49 반영)
상태: 이 문서는 VIETS MASTER ARCHITECTURE 추가요구사항 STEP에서 **최초로 생성**되었다. 기존에 별도의 마스터 체크리스트 파일은 없었으므로, 지금까지 코드로 실제 구현된 항목(Property/Invest/Home/My 기능 개발분)과 설계 문서로만 반영된 신규 항목(Agency/Investor/Notification/Admin Push/Chat)을 함께 기록해 "현재 프로젝트의 모든 개발 상태"를 하나의 문서에서 파악할 수 있게 한다. **STEP 1(Property/Agency DB)** 실행 결과가 이번 갱신으로 반영되었다 — 상세는 PART B 하단 "STEP 1 실행 결과" 및 PART C "현재 위치" 참조.

태그 정의: `[완료]` 코드 구현 및 Desktop 전달 완료 · `[진행중]` 일부 구현/설계 진행 중 · `[미완성]` 착수했으나 완결되지 않음 · `[보류]` 의도적으로 뒤로 미룸(사업/기술 결정 대기 포함) · `[미해결]` 시도했으나 원인 미파악 상태로 남은 문제.

---

## PART A. 기존 개발 상태 (Arc B-1까지, 코드 구현 완료분)

이 구획은 새 요구사항이 아니라, 이번 STEP 이전까지 실제로 코드로 구현되어 Desktop에 전달된 내용의 현황판이다.

### A-1. Property 탭
- [완료] 매물 목록 화면(검색/정렬: 최신순·낮은가격순·높은가격순·넓은면적순)
- [완료] 매물 상세 화면(`app/property-detail/[id].tsx`) — 갤러리, 옵션, 문의 모달, 관련 투자상품 연결
- [완료] 찜하기(즐겨찾기) 기능 — `store/useFavoritesStore.ts`, My탭 연동
- [완료] 매물 카드 썸네일 이미지(Mock 이미지)
- [보류] 실제 Supabase 연동(현재 전부 Mock 데이터, `isMock: true`) — DB/Edge Function 구현은 아래 PART B 개발순서 §1 이후 단계

### A-2. Invest 탭
- [완료] 투자상품 목록 화면
- [완료] 투자상품 상세 화면(`app/invest-detail/[id].tsx`) — 모집률/배당주기/리스크뱃지, 투자신청 모달(명시적 비실거래 안내 포함), 관련 매물 연결
- [완료] 투자상품 카드 썸네일 이미지(Mock 이미지)
- [보류] 실제 투자 신청/체결 로직 — PART B §2(Investment DB) 이후 단계에서 Edge Function으로 구현 예정, 지금은 Mock 안내만 존재

### A-3. Home 탭
- [완료] 추천 매물/추천 투자상품 섹션 연동, 상세화면 네비게이션

### A-4. My 탭
- [완료] 관심 매물/관심 투자상품 섹션(즐겨찾기 연동)
- [완료] 기존 인증/세션/언어설정/설정 코드 — 변경 없이 보존됨

### A-5. AI 탭
- [보류] 실제 AI 연동 — "미연결" 상태의 정직한 placeholder 유지, 가짜 API 응답 생성 금지 원칙 준수(변경 없음)

### A-6. i18n
- [완료] ko/en/vi/ja/zh 5개 언어 전체에 신규 화면 관련 키 동일 반영(구조 검증 완료)
- [완료] Property Name/Address 자동번역 금지 불변 규칙(DECISIONS.md D49, 2026-09-09) 문서화(I18N.md §3.2/§3.4) + 현재 Mock 구현 정합성 확인 — `PropertyCard.tsx`/`app/property-detail/[id].tsx`의 `property.title`/`property.location`은 `t()` 없이 원본 문자열을 그대로 렌더링해 이미 규칙 위반 없음

### A-7. 검증 대기
- [미완성] `npm run typecheck` / `npm run lint` — 사용자가 Desktop에서 직접 실행 후 결과 확인 필요(Cloud 세션은 셸 접근 없음). 특히 `app.json`의 `typedRoutes: true`로 인해 신규 동적 라우트(`property-detail/[id]`, `invest-detail/[id]`)는 `npx expo start`를 1회 실행해 라우터 타입을 재생성해야 `tsc`가 완전히 깨끗해짐(런타임 동작에는 영향 없음).

---

## PART B. VIETS MASTER ARCHITECTURE — 신규 요구사항 (2026-09-01)

이 구획이 이번 STEP의 핵심 산출물이다. **전부 설계 문서(.md) 반영만 완료된 상태이며, 실제 migration SQL/Edge Function/클라이언트 코드는 전혀 작성하지 않았다.**

### PROPERTY
| 항목 | 상태 | 비고 |
|---|---|---|
| Property Name/Address 자동번역 금지(불변 규칙) | `[완료]` 설계/문서 반영(DECISIONS.md D49) · `[보류]` 실제 `properties` 테이블 컬럼 설계 반영 | 언어 변경과 무관하게 매물명/주소는 원본 값 그대로 — 언어별 사본 컬럼(`property_name_ko` 등) 생성 금지. `properties` 테이블 자체가 아직 미생성이라(위 STEP 1 실행 결과 참조) 실제 컬럼 설계는 해당 migration 작성 시점에 이 규칙을 그대로 반영 |
| Agency Approval (에이전시 전역 승인) | `[완료]` DB schema/migration · `[미완성]` Admin UI / operational workflow | `agencies` 테이블(`approval_status` enum) STEP 1 migration(`20260901071931_property_agency_foundation.sql`)으로 구현·로컬 Postgres 16 검증 완료. Admin UI/실제 승인 워크플로우(누가 신청하는가 — D46 PENDING)는 미착수 |
| Property Listing Permission | `[완료]` DB schema/migration · `[미완성]` server enforcement / Agency 매물 등록 workflow · `[미완성]` `properties.agency_id` (DESIGN GAP — 아래 참조) | `agency_permissions.permission_type='property_listing'` STEP 1 migration으로 구현·검증 완료. **`properties.agency_id` 컬럼은 이번 STEP에서 추가되지 않았다** — `properties` 테이블 자체가 이 저장소의 어떤 migration에도 아직 존재하지 않기 때문(STEP 1 실행 결과 참조) |
| Post Writing Permission | `[완료]` DB schema/migration · `[미완성]` post 도메인 테이블 / UI | `agency_permissions.permission_type='post_writing'` + 확장용 `scope` 컬럼 STEP 1 migration으로 구현 완료. 실제 "게시물" 도메인 테이블 자체는 아직 없음(향후 필요 시 별도 설계, 범위 밖 유지) |
| Chat Permission | `[완료]` DB schema/migration · `[미완성]` Chat 구현(property_conversations/property_messages 등) | `agency_permissions.permission_type='chat'` STEP 1 migration으로 구현 완료. §13 Chat 스키마 자체는 여전히 설계 단계(STEP 6 대상), 이번 STEP에서 만들지 않음 |

### INVESTMENT
| 항목 | 상태 | 비고 |
|---|---|---|
| Investor (독립 투자자 모델) | `[진행중]` | `investors` 테이블 설계 완료(DATABASE.md §1) — User/Agency Member/Investor 독립 관계 모델 확정(DECISIONS.md D40). 실제 전환 로직/UI 미착수 |
| Investment Notification (12종 자동 알림) | `[진행중]` | `notifications` 확장(`product_id`/`campaign_id`) + `investment_notification_type` enum(12값) 설계 완료(DATABASE.md §0/§7). 각 도메인 로직(주문/모집률/배당 처리)에 알림 생성 스텝을 넣는 실제 구현은 미착수 |
| Notification Preferences (상품/유형/임계값) | `[진행중]` | `notification_preferences` 테이블 + 2개 partial unique index 설계 완료(DATABASE.md §7, DECISIONS.md D45). 구현 미착수 |
| Threshold Alerts (임계값 조건 알림) | `[진행중]` | `threshold_value`/`threshold_unit` 컬럼으로 구조 확보. 실제 판정 로직(동기 트리거 vs Cron 배치, ARCHITECTURE.md §3.4 참고)은 설계만 되어 있고 구현 미착수 |

### ADMIN
| 항목 | 상태 | 비고 |
|---|---|---|
| Admin Push Campaign | `[진행중]` | `notification_campaigns` → `admin_push_campaigns` 재구성 설계 완료(DATABASE.md §7, DECISIONS.md D43) — title/content/target_type/target_filter/language/scheduled_at/sent_at/sent_count/success_count/failed_count/created_by 전체 필드 확보. Edge Function(`send-admin-push`)/PC Admin UI 미착수 |
| Target Segment (푸시 대상 세그먼트) | `[진행중]` | `push_target_type` enum(all_users/general_users/agency_members/all_investors/product_investors/product_favorites/segment) 설계 완료. 판정 쿼리(특히 Agency 소속이면서 투자자인 사용자가 all_investors에 포함되는 규칙) 설계 완료(ARCHITECTURE.md §7.6). 구현 미착수 |
| Scheduled Push (예약 발송) | `[진행중]` | `scheduled_at` 컬럼 + `push_campaign_status`(scheduled 포함) 설계 완료. 실행할 Cron/스케줄러 연동 미착수 |
| Push History (발송 이력) | `[진행중]` | 기존 `notification_deliveries` 테이블을 그대로 재사용(구조 변경 없음, `campaign_id`가 신규 `admin_push_campaigns.id`를 가리키도록만 변경). 조회 UI 미착수 |
| Push Statistics (성공/실패 통계) | `[진행중]` | `sent_count`/`success_count`/`failed_count` 컬럼 + 집계 트리거(`admin_push_campaigns_stats_update`, DATABASE.md §10) 설계 완료. 실제 발송 파이프라인과의 연동 미착수 |

### 공통(Property/Investment/Admin 전반에 걸침)
| 항목 | 상태 | 비고 |
|---|---|---|
| Chat (Property 1:1 상담) | `[진행중]` | `property_conversations`/`property_messages` 최초 스키마 설계 완료(DATABASE.md §13, DECISIONS.md D44). 기존 매물 상세 화면의 "문의하기" 모달(Mock, Arc B-1)과의 실제 연동은 미착수 |
| SYSTEM_NOTIFICATION vs ADMIN_PUSH 분리 | `[완료]` (설계 수준) | `campaign_id` NULL 여부로 생성 경로 분리하는 구조 확정(DECISIONS.md D42) — 이 결정 자체는 확정(ACCEPTED)이며 번복 없이 그대로 구현 단계로 넘어갈 수 있음. 코드 구현은 `[진행중]`이 아니라 `[미완성]`(아직 손도 안 댐)으로 별도 분류: `[미완성]` |

### 사업 결정 대기 (구조는 준비, 값/플로우 미확정)
| 항목 | 상태 | 비고 |
|---|---|---|
| Agency 가입/온보딩 플로우 | `[보류]` | DECISIONS.md D46 PENDING — 신청 단계, 필요 서류, 자동/수동 승인 여부 |
| Investor 전환 조건/트리거 | `[보류]` | DECISIONS.md D47 PENDING — 자동 전환 vs 수동 신청 |
| TTS/Voice Push 확장 범위 | `[보류]` | DECISIONS.md D48 PENDING — 적용 알림 유형/언어 범위 |

### 별도 관리 중인 미해결 기술 이슈 (이번 STEP에서 재조사하지 않음)
| 항목 | 상태 | 비고 |
|---|---|---|
| Google OAuth (Google/Apple 소셜 로그인) | `[미해결]` | 약 7시간 미해결로 기록. STEP 1 범위에서도 재조사 금지 지시 준수 — 손대지 않음(NOT TOUCHED) |
| EAS shallow-clone 문제 | `[미해결]` | STEP 1 범위에서도 재조사 금지 지시 준수 — 손대지 않음(NOT TOUCHED) |

### STEP 1 실행 결과 (2026-09-01, Property/Agency DB)

**전체 프로젝트 스캔 → 기존 구현 대조 → migration 작성 → 로컬 Postgres 16 실제 실행 검증까지 완료.** 상세는 STEP 1 최종 보고서([VIETS STEP 1 IMPLEMENTATION REPORT]) 참조. 이 항목은 그 결과를 체크리스트에 반영한 요약이다.

- **발견한 기존 상태**: 이 저장소의 `supabase/migrations/`에는 STEP 4-3에서 작성된 `20260828083711_profiles_and_user_roles.sql`(Auth Foundation — `profiles`/`user_roles`/`handle_new_user`/`is_super_admin()`) 단 하나만 존재했다. **`properties` 테이블은 이 저장소의 어떤 migration으로도 아직 생성된 적이 없다** — Arc B-1의 "매물 목록/상세/찜" 기능은 전부 `constants/mockData.ts`의 TypeScript Mock 데이터이며 실제 DB 테이블이 아니다. `supabase/.temp/linked-project.json`으로 보아 Supabase CLI `link`는 이미 되어 있으나(원격 프로젝트 연결 존재), 이번 세션에서 Desktop에 대한 셸 접근이 없어 `supabase db push`/원격 DB 상태 확인은 직접 실행하지 못했다.
- **구현/검증한 것**: `20260901071931_property_agency_foundation.sql` 신규 migration 1개로 `agencies`/`agency_members`/`agency_permissions`/`audit_logs`(이 저장소 최초 도입) 4개 테이블, enum 3종(`agency_approval_status`/`agency_permission_type`/`agency_member_role`), SECURITY DEFINER 헬퍼 2개(`is_admin_or_above()`/`is_agency_owner(uuid)`), 감사 트리거(`audit_log_admin_changes()` 재사용, `agencies`/`agency_permissions`에 부착), RLS 정책 16개를 구현했다. **Desktop에 실제 연결된 Supabase 프로젝트에 대해서는 실행하지 못했으나(셸 접근 없음)**, 이 세션의 Cloud 컨테이너에 임시 Postgres 16 인스턴스를 직접 설치해 기존 STEP 4-3 migration + 이번 migration을 순서대로 적용하고, 10개 시나리오(일반 사용자 권한상승 차단, admin 승인/토글, anon의 승인된 Agency만 열람, agency_members owner-sees-team의 재귀 없는 동작, audit_logs 자동 기록 및 super_admin 전용 열람, audit_logs immutability)로 RLS를 직접 실행 검증했다 — 전부 의도한 대로 동작(세부는 STEP 1 보고서 §7 참조).
- **DESIGN GAP (승인 필요)**: `properties.agency_id` 컬럼은 추가하지 않았다 — ALTER 대상인 `properties` 테이블 자체가 없기 때문이다. `agencies`/`agency_permissions`는 nullable FK 관계라 이 컬럼을 나중에 추가해도 기존 데이터에 영향이 없으므로, `properties` 테이블 생성 시점(및 그 설계 범위 — locations/developers/owners까지 함께 만들지, agency_id만 우선 추가할 최소 테이블로 시작할지)은 사용자 승인 후 별도로 진행한다.

---

## PART C. 개발 순서 (요구사항 §10 원문 반영, 변경 없이 확정)

아래 순서는 사용자가 지정한 순서를 그대로 기록한 것이며, 임의로 재배열하지 않는다.

1. Property/Agency DB — `properties.agency_id`, `agencies`, `agency_members`, `agency_permissions` migration
2. Investment DB — `investors`, `notifications` 확장, `notification_preferences`, `admin_push_campaigns` migration
3. Investor — 투자자 전환 로직/화면(전환 조건은 D47 확정 후)
4. Property User Features — Agency가 관리하는 매물의 사용자 노출 로직
5. Agency Permission — 관리자용 Agency 승인/권한 토글 UI + 서버 검증
6. Chat — `property_conversations`/`property_messages` Edge Function + 클라이언트 채팅 UI
7. Notification Backend — 12종 자동 알림 생성 로직(도메인 이벤트 → notifications INSERT)
8. Investment User Notification — 클라이언트 알림 수신함 UI + `notification_preferences` 설정 UI
9. Admin Backend — Admin Push 관련 서버 로직(`send-admin-push` 등)
10. Admin Push — PC Admin에서의 캠페인 작성/예약/발송 기능
11. PC Admin — Admin Dashboard 전반(프레임워크는 ARCHITECTURE.md §6 미확정 항목, Phase 9 착수 전 확정 필요)
12. Mobile Admin — (필요 시) 모바일 관리자 기능
13. Integration Test — 전체 통합 테스트

(원 요구사항이 12단계로 나열되었으나 "PC Admin"과 "Mobile Admin"을 별개 항목으로 분리하면서 "Integration Test"까지 포함하면 자연스럽게 13행으로 표기됨 — 순서와 항목 자체는 원문 그대로이며 병합/누락 없음.)

**현재 위치: 1단계(Property/Agency DB) 부분 완료.** Agency 도메인(agencies/agency_members/agency_permissions/audit_logs) migration 작성 및 로컬 실행 검증까지 완료했다. `properties.agency_id`는 `properties` 테이블 자체가 아직 없어 DESIGN GAP으로 보류 — 이 gap의 해결 방향(아래 PART D 1번) 결정 전에는 1단계를 "완전 완료"로 표시하지 않는다. **2단계(Investment DB)로 넘어가려면 먼저 이 gap에 대한 사용자 결정이 필요하다** — STEP 1 지시(§14)의 "STEP 1이 완전히 검증된 경우에만 STEP 2로 이동" 조건을 문자 그대로 지킨 것이다.

---

## PART D. 다음 세션에서 바로 이어갈 작업

1. **[결정 필요]** `properties.agency_id` DESIGN GAP 해결 방향 — (a) `properties`(및 그 FK 대상인 locations/developers/owners까지) 전체를 지금 함께 만드는 큰 migration으로 진행할지, (b) `properties`만 최소 컬럼으로 우선 만들고 나머지는 후속 migration으로 미룰지, (c) `properties.agency_id` 추가를 Property Domain 자체 migration이 작성되는 시점까지 통째로 미룰지 — 사용자 승인 후 진행
2. 위 1번이 정리되면 Desktop에서 실제 `npx supabase db push`(또는 CLI 절차)로 `20260901071931_property_agency_foundation.sql`을 연결된 Supabase 프로젝트에 반영 — 이 세션은 셸 접근이 없어 직접 push 불가, 사용자가 Desktop에서 실행 필요
3. push 후 `npx supabase gen types typescript --linked`로 TS 타입 재생성(이번 STEP에서 타입은 생성/추측하지 않았음 — 섹션 10 규칙 준수)
4. 승인 후 PART C 2단계(Investment DB) 착수
5. Google OAuth/EAS 문제는 계속 별도 트랙으로 보류 — 재개 시점은 이 프로젝트의 다른 STEP 지시에서 별도로 결정
