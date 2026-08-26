# ARCHITECTURE.md — Viet's

버전: v0.1 (Phase 1 설계 초안) · 작성일: 2026-08-26
상태: **설계 문서 — 코드 미착수**. 실제 스캐폴딩/구현은 이 문서와 DATABASE.md, API.md, SECURITY.md 승인 후 진행.

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

### 2.2 상태 관리 방침

- **서버 상태**: React Query(TanStack Query) — Supabase 쿼리/Edge Function 호출 캐싱, invalidation.
- **실시간 상태**: Supabase Realtime 구독 → React Query 캐시에 반영 (배당 공시, 모집률 변경 등).
- **클라이언트 전역 상태**(언어, 테마, 로그인 세션 캐시 등): 경량 스토어(Zustand 등, Phase 2에서 확정) + `expo-secure-store`로 민감 토큰 보관.
- 서버 상태와 클라이언트 상태를 섞지 않는다 — 투자 잔액/보유 내역 등 금전 데이터는 항상 서버 fetch 기준, 낙관적 업데이트 금지(7번 문서 SECURITY.md/원칙 13 참조).

### 2.3 네비게이션 (앱 구조 3번 항목)

Bottom Tab: HOME · PROPERTY · INVEST · AI · MY
Global overlay: Search(모달), Notification(스택), Language(설정 내부 + 최초 실행 시 온보딩)

### 2.4 Admin Dashboard

모바일과 완전히 별도 프로젝트/별도 배포로 분리(원칙 19). 동일 Supabase 프로젝트를 사용하되:
- Admin 전용 로그인 경로(이메일/비밀번호 또는 SSO, 모바일의 Google/Apple OAuth와 별개)
- Role 기반 UI 렌더링(super_admin/admin/editor/reviewer/operator) + 서버측 RLS로 이중 방어
- 프레임워크는 Phase 9 착수 전 별도 결정 필요(Next.js 권장 후보 — 이 문서에서 미확정으로 남김)

---

## 3. 백엔드 구조 (Supabase)

### 3.1 레이어 분리

1. **Data Layer**: Postgres + PostGIS(위치) + pgvector(임베딩). RLS가 최종 방어선.
2. **Business Logic Layer**: Edge Functions. 금전 계산, 외부 API 호출, AI 파이프라인, Push 발송 등 "부작용이 있는" 로직은 반드시 여기서 처리(클라이언트에서 직접 INSERT/UPDATE 금지 대상은 SECURITY.md에서 테이블별로 명시).
3. **Presentation Layer**: 클라이언트는 읽기 위주 쿼리(RLS로 허용된 범위)와 Edge Function 호출만 수행.

### 3.2 정보성 기능 vs 금융거래 기능 분리 (원칙 14)

- **정보성**: properties, investment_products, articles, market_indicators 등 조회 — 클라이언트가 RLS 범위 내에서 직접 SELECT 가능.
- **금융거래성**: investment_orders 생성, investment_transactions 기록, investment_holdings 갱신 — 반드시 Edge Function(`create-investment-order`, `calculate-investment`)을 통해서만 발생. 클라이언트에 해당 테이블 INSERT/UPDATE 권한을 주지 않는다(SELECT만, 본인 소유 row 한정).

### 3.3 Edge Functions

목록/계약은 API.md 참조. Deno 런타임, 공통 미들웨어(인증 검증, rate limit, 로깅→api_logs)를 공유 모듈로 구성.

### 3.4 Cron

pg_cron 또는 Supabase Scheduled Functions로 구현. 목록은 마스터 프롬프트 18번 항목 + 실행상태/오류를 `system_logs`에 기록하는 공통 wrapper 사용.

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

- `dev` / `staging` / `production` 3단계 Supabase 프로젝트 분리 권장.
- Edge Function 환경변수로 각 외부 API 키 관리(Supabase Secrets), 클라이언트 빌드에는 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`만 포함.
- Service Role Key는 Edge Function 환경에만 존재, 어떤 클라이언트 번들에도 포함되지 않음(원칙 10).

---

## 6. 미결정 항목 (다음 결정 필요)

1. Expo Router vs React Navigation 최종 채택
2. Admin Dashboard 프레임워크
3. 클라이언트 전역 상태 라이브러리 (Zustand vs Jotai vs Redux Toolkit)
4. LLM/Embedding Provider 계약
5. Supabase 프로젝트 생성 및 dev/staging/prod 분리 여부

이 항목들은 각 Phase 착수 직전 사용자 확인 후 확정한다(추측 금지 원칙).
