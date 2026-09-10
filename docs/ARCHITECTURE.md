# ARCHITECTURE.md — Viet's

버전: v0.3 (Phase 1 설계 초안 + VIETS MASTER ARCHITECTURE 추가요구사항 반영) · 작성일: 2026-08-26 · 최종수정: 2026-09-01
상태: **설계 문서 — 코드 미착수**. 실제 스캐폴딩/구현은 이 문서와 DATABASE.md, API.md, SECURITY.md 승인 후 진행.

## 변경 이력

| 일자 | 변경 내용 | 근거 |
|---|---|---|
| 2026-08-26 | §5 환경 분리를 5.1(Supabase 프로젝트)·5.2(코드 실행 환경) 두 절로 확정, §6 미결정 목록에서 해당 항목 제거 | DECISIONS.md D5, D24 ACCEPTED |
| 2026-09-01 | §7 Agency / Investor / Notification / Admin Push / Chat 확장 아키텍처 신규 추가. VIETS MASTER ARCHITECTURE 추가요구사항(2026-09-01) 반영 — 기존 §1~§6 내용은 변경 없음 | DECISIONS.md D39~D45 ACCEPTED, DATABASE.md §1/§7/§12/§13, DEVELOPMENT_MASTER_CHECKLIST.md(신규) |

---

## 1. 시스템 개요

Viet's는 베트남 부동산 정보 + 투자상품(REIT/공동투자) + AI 시장분석 + 포트폴리오 + Push를 하나로 묶은 모바일 우선 플랫폼이다. 클라이언트 3종(모바일 앱, Admin Dashboard, 향후 웹)이 하나의 Supabase 백엔드를 공유하되, 권한과 배포 파이프라인은 완전히 분리한다.

```
┌─────────────────┐     ┌──────────────────┐
│  Mobile App      │     │  Admin Dashboard  │
│  (Expo / RN)     │     │  (Web, 별도 배포)   │
│  vi/ko/en/zh/ja  │     │  role-gated        │
└────────┬─────────┘     └─────────┬─────────┘
         │  anon key + RLS         │ admin auth + RLS(role)
         ▼                         ▼
┌───────────────────────────────────────────────┐
│                Supabase Project                │
│  Auth (Google/Apple OAuth)                      │
│  Postgres + PostGIS + pgvector                  │
│  Edge Functions (Deno) ── 외부 API/금전로직 게이트웨이 │
│  Storage (Private buckets + Signed URL)          │
│  Realtime (알림/가격/모집률 등 구독)                │
│  Cron (pg_cron 기반 스케줄 작업)                    │
└───────────────────┬───────────────────────────┘
                     │ Edge Function 경유만 허용
                     ▼
┌───────────────────────────────────────────────┐
│  외부 서비스: Google Maps/Places/Geocoding,       │
│  FCM, LLM API(+Embeddings), 환율/뉴스 소스        │
└───────────────────────────────────────────────┘
```

핵심 원칙(마스터 프롬프트 15번 항목 반영): 클라이언트는 절대 외부 API를 직접 호출하지 않는다(지도 SDK 렌더링 자체는 예외, 단 키는 플랫폼 제한). 모든 민감 키·금전 로직·AI 로직은 Edge Function 뒤에 위치한다.

---

## 2. 클라이언트 구조 (Mobile — Expo/React Native)

### 2.1 폴더 구조 제안

```
apps/mobile/
  app/                      # Expo Router (file-based routing)
    (intro)/                # 인트로: YouTube 영상 + 5초 타이머
    (tabs)/
      home/
      property/
      invest/
      ai/
      my/
    property/[id].tsx
    invest/[id].tsx
    _layout.tsx
  src/
    components/             # 재사용 UI 컴포넌트 (design system 기반)
    features/
      property/              # property 도메인 (map, search, detail)
      investment/             # 투자상품, 포트폴리오, 계산기
      ai/                      # RAG 채팅 UI
      notifications/
      auth/
    lib/
      supabase/               # supabase-js client, typed queries
      i18n/                    # UI 번역 리소스 + locale 로직
      theme/                   # design tokens (color/typography/spacing)
      analytics/
    hooks/
    store/                    # 전역 상태 (React Query + 경량 client state)
    types/                    # DB 타입(Supabase codegen 결과 포함)
  assets/
apps/admin/                  # 별도 웹 프로젝트 (Next.js 등, 별도 결정 필요)
supabase/
  migrations/
  functions/                 # Edge Functions (Deno)
  seed/
packages/
  shared-types/              # mobile/admin 공용 타입 (DB 스키마 파생)
```

Expo Router 사용을 기본안으로 제안 (파일기반 라우팅 + 딥링크 처리가 자연스러움). React Navigation 직접 구성도 대안이나, Deep Link(Push 알림 14/11번 항목 요구사항)와의 통합성 때문에 Expo Router를 우선 권장 — **최종 채택은 Phase 3 시작 전 확정**.

(참고 — 2026-09-01: 실제 구현에서는 Expo Router가 채택되어 `app/(tabs)/` 5탭 + `app/property-detail/[id].tsx` / `app/invest-detail/[id].tsx` 형태의 root-Stack sibling 라우트로 이미 진행 중이다. 이 문서 §6의 "미결정" 표기는 아직 형식상 남겨두되, 실질적으로는 Expo Router로 굳어진 상태임을 기록한다.)

### 2.2 상태 관리 방침

- **서버 상태**: React Query(TanStack Query) — Supabase 쿼리/Edge Function 호출 캐싱, invalidation.
- **실시간 상태**: Supabase Realtime 구독 → React Query 캐시에 반영 (배당 공시, 모집률 변경 등).
- **클라이언트 전역 상태**(언어, 테마, 로그인 세션 캐시 등): 경량 스토어(Zustand 등, Phase 2에서 확정) + `expo-secure-store`로 민감 토큰 보관.
- 서버 상태와 클라이언트 상태를 섞지 않는다 — 투자 잔액/보유 내역 등 금전 데이터는 항상 서버 fetch 기준, 낙관적 업데이트 금지(7번 문서 SECURITY.md/원칙 13 참조).

(참고 — 2026-09-01: 클라이언트 전역 상태 라이브러리는 실제 구현에서 Zustand로 이미 사용 중이다 — `store/useLocaleStore.ts`, `store/useFavoritesStore.ts`. §6의 "미결정" 표기 참조.)

### 2.3 네비게이션 (앱 구조 3번 항목)

Bottom Tab: HOME · PROPERTY · INVEST · AI · MY
Global overlay: Search(모달), Notification(스택), Language(설정 내부 + 최초 실행 시 온보딩)

### 2.4 Admin Dashboard

모바일과 완전히 별도 프로젝트/별도 배포로 분리(원칙 19). 동일 Supabase 프로젝트를 사용하되:
- Admin 전용 로그인 경로(이메일/비밀번호 또는 SSO, 모바일의 Google/Apple OAuth와 별개)
- Role 기반 UI 렌더링(super_admin/admin/editor/reviewer/operator) + 서버측 RLS로 이중 방어
- 프레임워크는 Phase 9 착수 전 별도 결정 필요(Next.js 권장 후보 — 이 문서에서 미확정으로 남김)

(참고 — 2026-09-01: §7에서 Admin Dashboard(PC Admin)에 Admin Push Campaign 구성 화면이 새로 추가된다. 프레임워크 미확정 상태는 변경 없음 — Phase 9 착수 전 확정.)

---

## 3. 백엔드 구조 (Supabase)

### 3.1 레이어 분리

1. **Data Layer**: Postgres + PostGIS(위치) + pgvector(임베딩). RLS가 최종 방어선.
2. **Business Logic Layer**: Edge Functions. 금전 계산, 외부 API 호출, AI 파이프라인, Push 발송 등 "부작용이 있는" 로직은 반드시 여기서 처리(클라이언트에서 직접 INSERT/UPDATE 금지 대상은 SECURITY.md에서 테이블별로 명시).
3. **Presentation Layer**: 클라이언트는 읽기 위주 쿼리(RLS로 허용된 범위)와 Edge Function 호출만 수행.

### 3.2 정보성 기능 vs 금융거래 기능 분리 (원칙 14)

- **정보성**: properties, investment_products, articles, market_indicators 등 조회 — 클라이언트가 RLS 범위 내에서 직접 SELECT 가능.
- **금융거래성**: investment_orders 생성, investment_transactions 기록, investment_holdings 갱신 — 반드시 Edge Function(`create-investment-order`, `calculate-investment`)을 통해서만 발생. 클라이언트에 해당 테이블 INSERT/UPDATE 권한을 주지 않는다(SELECT만, 본인 소유 row 한정).

(참고 — 2026-09-01: 같은 원칙을 §7의 신규 도메인에도 동일 적용한다. Agency 승인/권한 토글, Admin Push 발송은 모두 "부작용이 있는" 작업이므로 Edge Function 경유만 허용하고 클라이언트 직접 write는 금지한다. 상세는 §7.6 참조.)

### 3.3 Edge Functions

목록/계약은 API.md 참조. Deno 런타임, 공통 미들웨어(인증 검증, rate limit, 로깅→api_logs)를 공유 모듈로 구성.

### 3.4 Cron

pg_cron 또는 Supabase Scheduled Functions로 구현. 목록은 마스터 프롬프트 18번 항목 + 실행상태/오류를 `system_logs`에 기록하는 공통 wrapper 사용.

(참고 — 2026-09-01: §7.3의 임계값(threshold) 알림 판정 — 예: "모집률 ≥ 80%" — 은 이벤트 발생 시점(모집률 갱신 트랜잭션)에 동기 트리거로 판정하는 것을 기본으로 하되, 배치성 판정(예: 목표수익률 도달처럼 외부 시세 갱신에 의존하는 유형)은 기존 Cron 레이어에 새 작업으로 추가한다. 상세는 §7.3 및 DATABASE.md §10 참조.)

---

## 4. 기술 스택 확정/미확정 사항

| 영역 | 확정 | 비고 |
|---|---|---|
| Mobile | Expo SDK 54 + React Native + TypeScript | 마스터 프롬프트 지정 |
| Backend | Supabase (Postgres/PostGIS/pgvector/Edge Functions/Storage/Realtime/Cron) | 지정 |
| Push | FCM | 지정 |
| Maps | Google Maps Platform | 지정 |
| Auth | Google OAuth, Apple OAuth | 지정 (모바일). Admin 인증 방식은 미확정 |
| 라우팅 | Expo Router (제안) | Phase 3 착수 전 확정 필요 |
| 클라이언트 상태 | React Query + Zustand(제안) | Phase 2 확정 필요 |
| Admin 프레임워크 | 미확정 (Next.js 후보) | Phase 9 착수 전 확정 필요 |
| LLM/Embedding Provider | 미확정 | AI_RESEARCH.md에서 인터페이스만 정의, provider는 계약 체결 후 확정 |

---

## 5. 환경 분리

### 5.1 Supabase 프로젝트 환경 (확정 — DECISIONS.md D5, 2026-08-26 ACCEPTED)

- 초기에는 **development Supabase 프로젝트 1개**로 시작한다.
- `staging` / `production` 환경 분리는 실제 서비스 출시 준비 단계(Phase 11 전후)에서 진행한다 — 지금은 만들지 않는다.
- Edge Function 환경변수로 각 외부 API 키 관리(Supabase Secrets), 클라이언트 빌드에는 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`만 포함.
- Service Role Key는 Edge Function 환경에만 존재, 어떤 클라이언트 번들에도 포함되지 않음(원칙 10).

### 5.2 코드 실행 환경 (확정 — DECISIONS.md D24, 2026-08-26 ACCEPTED)

개발 실행 환경을 두 곳으로 명확히 분리한다:

| 환경 | 용도 |
|---|---|
| Cloud 세션(이 작업공간) | 코드 분석, 설계 문서 작성, 코드 작성 및 리뷰 |
| 데스크톱 연결 프로젝트 폴더 | `npm install`, Expo 개발 서버 실행, 실제 디바이스/시뮬레이터 테스트, APK/iOS 빌드 등 **실행 검증 전반** |

- 이 구분이 필요한 이유: Cloud 작업공간은 `registry.npmjs.org` 접근이 차단되어 있어(직접 확인함, QA.md §2) `npm install`/Expo 실행 자체가 불가능하다.
- 따라서 코드는 Cloud에서 작성/리뷰하되, 실제 설치·실행·테스트·빌드는 반드시 데스크톱에 연결된 폴더에서 수행한다.
- 이 세션은 현재 사용자 데스크톱의 프로젝트 폴더가 연결되지 않은 상태다 — 실제 스캐폴딩(Phase 1 나머지 항목) 착수 전 폴더 연결이 선행되어야 한다.

(참고 — 2026-09-01: 실제로는 이후 데스크톱 폴더가 연결되어 Cloud 세션 ↔ 데스크톱 간 파일 전달(SendUserFile → device_commit_files) 방식으로 코드가 지속 전달되고 있다. 단, Cloud 세션에는 여전히 터미널/셸 접근이 없다 — `git`/`npm`/`npx`/`eas`/`tsc` 실행은 전부 사용자가 데스크톱에서 직접 수행해야 한다. 이 제약은 §7 전체에도 동일하게 적용된다: 이번 STEP에서 작성하는 모든 산출물은 문서(.md)뿐이며, 실제 migration SQL 실행이나 코드 실행은 전혀 없었다.)

---

## 6. 미결정 항목 (다음 결정 필요)

1. Expo Router vs React Navigation 최종 채택
2. Admin Dashboard 프레임워크
3. 클라이언트 전역 상태 라이브러리 (Zustand vs Jotai vs Redux Toolkit)
4. LLM/Embedding Provider 계약

이 항목들은 각 Phase 착수 직전 사용자 확인 후 확정한다(추측 금지 원칙). 상세 근거/추천안은 DECISIONS.md 참조(각각 D1, D2, D3, D4).

~~5. Supabase 프로젝트 생성 및 dev/staging/prod 분리 여부~~ → **ACCEPTED, §5.1로 이동** (DECISIONS.md D5)

(참고: 코드 실행 환경(D24)은 원래 QA.md의 미결정 항목이었으나 본 문서 §2/전체 개발 착수 방식에도 영향을 주는 항목이라 함께 ACCEPTED 처리, §5.2에 반영했다.)

(참고 — 2026-09-01: §7 관련 미결정 항목(Agency 온보딩 플로우, Investor 전환 조건, TTS/Voice 확장 범위)은 사업 결정이 필요한 항목으로 별도 관리한다 — DECISIONS.md D46~D48, 본 문서 §7.7 참조. 위 1~4번 항목과는 성격이 달라(기술 스택 선택 vs 사업 정책 결정) 이 리스트에 합치지 않았다.)

---

## 7. Agency / Investor / Notification / Admin Push / Chat 확장 아키텍처 (VIETS MASTER ARCHITECTURE 추가요구사항, 2026-09-01)

**상태: 설계 문서 반영만 완료. 실제 migration SQL 작성, Edge Function 구현, 클라이언트 코드 구현은 전혀 착수하지 않았다.** 상세 스키마는 DATABASE.md §1(투자자)·§7(알림)·§12(Agency)·§13(Chat) 참조. 결정 근거는 DECISIONS.md D39~D48 참조. 본 절은 그 결정들을 아키텍처 관점에서 요약한다.

### 7.1 Agency 승인(Approval)과 기능별 권한(Permission)의 분리

기존 문서에는 없던 새 축이다. "에이전시가 승인되었는가"와 "에이전시가 무엇을 할 수 있는가"를 하나의 필드로 묶지 않는다.

- `agencies.approval_status` — Agency 자체의 전역 승인 상태(pending/approved/rejected/suspended). 승인되지 않은 Agency는 어떤 기능도 사용할 수 없는 상위 게이트.
- `agency_permissions` — 승인된 Agency 안에서 기능 단위로 개별 토글되는 EAV(entity-attribute-value) 구조 테이블: `property_listing` / `post_writing` / `chat` / `account_active` 네 종류를 독립적으로 on/off. `post_writing`은 특히 향후 게시물 유형이 늘어날 것을 대비해 별도 `scope` 컬럼을 열어둔다. 모든 변경은 Audit Log 대상(SECURITY.md §3 감사 로그 패턴 재사용).

이 분리 덕분에 "승인은 됐지만 글쓰기는 아직 막아둔 Agency", "승인은 됐지만 채팅만 잠시 정지시킨 Agency" 같은 조합이 필드 하나 늘리는 것만으로 표현 가능해진다 — 새 Permission 종류가 추가돼도 `agency_permission_type` enum에 값만 추가하면 되고 테이블 구조는 바뀌지 않는다.

### 7.2 User / Agency Member / Investor — 독립적 3중 관계 모델

기존 SECURITY.md의 `user_roles`(super_admin/admin/editor/reviewer/operator)는 **내부 운영 인력의 RBAC**이며, 여기서 다루는 것은 **일반 고객 세그먼트**로 완전히 다른 축이다. 이 둘을 절대 혼동하지 않는다.

한 명의 `auth.users` 사용자가 다음 세 관계를 동시에 가질 수 있다:

```
auth.users (1)
  ├── (0..1) investors            — 투자자 자격 (독립 테이블, user_id UNIQUE FK)
  ├── (0..N) agency_members       — 소속 Agency (agency_id, role_in_agency: owner/staff)
  └── (기본) 일반 회원 활동          — 위 두 관계가 전혀 없어도 기본 회원으로서 매물 조회/찜/상담 가능
```

즉 "Agency 직원이면서 동시에 투자자"인 사용자가 정상적으로 존재할 수 있고, 이는 단일 `account_type` 컬럼으로는 표현할 수 없다. §5(Admin Push Target)의 `ALL_INVESTORS`/`PRODUCT_INVESTORS` 세그먼트는 이 `investors` 관계만으로 판정하며, Agency 소속 여부와 무관하게 포함된다.

### 7.3 Investment Notification — 자동 발생 알림

12종(투자 신청/투자 승인·상태변경/모집률 변경/목표 모집금액 달성/예상 수익률 변경/실제 수익률 변경/목표 수익률 도달/배당 예정/배당 확정/배당 지급/중요 공지/상품 상태 변경)을 처리하는 새 테이블을 만들지 않고, **기존 `notifications` 테이블을 확장**하는 쪽을 택했다(기존 구조 최대 재사용 원칙). `product_id`(nullable FK→investment_products)를 추가해 어떤 상품에 대한 알림인지 연결하고, `type` 값의 허용 목록으로 새 enum `investment_notification_type`(12값)을 정의한다. 각 이벤트는 해당 도메인 로직(투자 신청 처리, 모집률 갱신 트랜잭션, 배당 처리 Edge Function 등) 안에서 알림 row를 생성하는 방식 — 별도의 "알림 엔진"을 새로 만들지 않고 기존 도메인 로직에 알림 생성 스텝을 추가하는 구조다.

### 7.4 Customer Notification Preference — 상품별/유형별/임계값 설정

`notification_preferences` 테이블 신규: `user_id, product_id(nullable — NULL이면 전체 상품 대상), notification_type, enabled, threshold_value, threshold_unit, created_at, updated_at`. 단순 Boolean이 아니라 "모집률 ≥ 80%일 때만" 같은 조건을 값으로 저장한다. `threshold_unit`은 `percent`/`currency` 등을 구분하는 새 enum. NULL을 포함한 `(user_id, product_id, notification_type)` 조합의 유일성은 일반 UNIQUE 제약이 아니라 두 개의 partial unique index로 구현한다(Postgres는 UNIQUE 제약에서 NULL을 서로 다른 값으로 취급하므로) — 상세는 DATABASE.md §7, DECISIONS.md D45 참조.

### 7.5 SYSTEM_NOTIFICATION vs ADMIN_PUSH — 생성 경로는 분리, 수신함은 통합

두 시스템을 혼합하지 않는다는 요구사항을, 사용자 경험(하나의 알림함)은 유지하면서도 생성 경로는 코드 레벨에서 분리하는 방식으로 해석했다:

- `notifications.campaign_id`(nullable FK→admin_push_campaigns)가 **NULL이면 SYSTEM_NOTIFICATION**(§7.3의 자동 발생 로직이 생성), **NOT NULL이면 ADMIN_PUSH**(Admin이 작성한 캠페인 발송이 생성).
- 클라이언트가 보는 알림 목록 쿼리는 동일한 `notifications` 테이블 하나만 조회하면 되지만, 두 종류를 생성하는 서버측 코드 경로(Edge Function/트리거)는 완전히 별개로 유지한다 — 즉 "저장 위치는 하나, 생성 로직은 둘"이라는 구조로 두 시스템을 혼합하지 않는다는 요구사항을 만족시킨다.

### 7.6 Admin Push — Target Segment + Campaign

- **Target**: `push_target_type` enum — `all_users` / `general_users` / `agency_members` / `all_investors` / `product_investors` / `product_favorites` / `segment`(향후 조건 기반 확장용 catch-all, `target_filter` jsonb로 조건 표현). §7.2의 관계 모델 덕분에 "Agency 소속이면서 투자자인 사용자"가 `all_investors`/`product_investors` 대상에서 누락되지 않는다.
- **Campaign**: 기존 `notification_campaigns` 테이블을 `admin_push_campaigns`로 재구성(아직 실제 스키마가 구현되지 않은 설계 문서 단계이므로 데이터 손실 없이 재설계 가능 — DATABASE.md 최상단 "설계 문서" 명시 상태 참조). `title, content, target_type, target_filter, language, scheduled_at, sent_at, sent_count, success_count, failed_count, created_by, created_at` 전체 필드 확보. 즉시 발송/예약 발송/다국어/미리보기/발송이력/성공-실패 통계를 모두 이 한 테이블 + 발송 결과 집계로 지원.
- Admin Push 발송 자체는 §3.2 원칙에 따라 반드시 Edge Function을 경유한다 — Admin Dashboard가 `admin_push_campaigns` row를 직접 "발송 완료" 상태로 갱신하지 않는다.

### 7.7 Property Chat(1:1 상담) 알림 연동

기존 Property 상담 기능과 연동하기 위해 최초의 채팅 스키마를 신설한다: `property_conversations`(property_id, customer_id, agency_id nullable, broker_id, status) + `property_messages`(conversation_id, sender_id, sender_role, body, created_at). 신규 메시지 발생 시 알림 채널을 수신자 유형에 따라 분기한다 — 고객은 일반 Push만, Agency 측(에이전시 소속 상담원)은 Push + 다국어 처리 + 향후 Voice/TTS 확장 여지를 남겨둔 구조로 설계(TTS 자체는 이번 STEP 범위 밖, DECISIONS.md D48 PENDING). Chat 기능 자체는 `agency_permissions.permission_type = 'chat'`이 켜진 Agency에 한해 사용 가능(§7.1과 연결).

### 7.8 사업 결정 대기 항목 (PENDING)

아래 항목은 구조는 준비했으나 실제 값/플로우는 사업 판단이 필요해 미확정으로 남긴다(DECISIONS.md D46~D48):

1. Agency 가입/온보딩 플로우(신청 → 승인까지의 구체적 단계, 필요 서류 등)
2. 일반 회원이 Investor로 전환되는 조건/트리거(자동 전환 vs 수동 신청 등)
3. TTS/Voice Push 확장의 실제 범위(어떤 알림 유형에 적용할지, 어떤 언어부터 지원할지)

Google OAuth 문제(약 7시간 미해결)와 EAS shallow-clone 문제는 이번 §7 작업 범위에서 전혀 재조사하지 않았다 — 계속 미해결/보류 상태로 기록한다(DECISIONS.md, QA.md 기존 기록 참조).
