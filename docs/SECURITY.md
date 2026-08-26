# SECURITY.md — Viet's

버전: v0.1 (설계 초안) · 작성일: 2026-08-26

절대 개발 원칙 9~11, 19, 20을 구체적인 구현 정책으로 전개한다.

---

## 1. RBAC (Role-Based Access Control)

### 1.1 Role 정의

| Role | 범위 |
|---|---|
| `user` | 일반 앱 사용자(기본값, 가입 시 자동 부여) |
| `operator` | 고객대응/기본 CMS 운영(공지/배너 편집, 조회 위주) |
| `editor` | 매물/투자상품/기사 콘텐츠 작성·수정(발행 권한 없음) |
| `reviewer` | editor 콘텐츠 승인/반려, 발행 권한 |
| `admin` | 위 전체 + 사용자/거래 조회, Push 캠페인, Market/Exchange 관리 |
| `super_admin` | admin 전체 + Role 부여/회수, System Settings, Audit Log 열람 |

- Role은 `user_roles` 테이블에서 관리(한 사용자가 여러 role 보유 가능, 예: admin+editor).
- 모바일 앱과 Admin Dashboard는 **완전히 다른 클라이언트**이며, 모바일 클라이언트는 `user` role 전용 RLS 경로만 사용한다 — admin 계열 role이 있어도 모바일 앱에서 admin 권한이 노출되지 않도록 UI/쿼리 자체를 분리(원칙 19).

### 1.2 권한 검증 이중화

1. **RLS (최종 방어선)**: 모든 admin 계열 write는 Postgres RLS policy에서 `exists(select 1 from user_roles where user_id = auth.uid() and role in (...))`로 검증.
2. **Edge Function 미들웨어**: 함수 진입 시 JWT → role 조회 → 불충분하면 403. RLS와 별개로 사전 차단(불필요한 DB 왕복/에러 메시지 최소화 목적이며, RLS를 대체하지 않음).
3. **Admin UI**: role에 따라 메뉴/버튼 자체를 숨김(사용성 목적, 보안 경계로 간주하지 않음 — 실제 방어는 1·2번).

---

## 2. RLS 정책 방향 (DATABASE.md 참조, 여기서는 구현 패턴 정의)

- 모든 테이블 기본값은 **RLS enabled + 정책 없음(=전면 차단)**, 필요한 접근만 명시적으로 허용(deny-by-default).
- 패턴 3종:
  - **Public-Read**: `using (true)` 이지만 `status`/`is_active` 조건 포함 (예: `using (status = 'active')`).
  - **Owner-Only**: `using (user_id = auth.uid())`.
  - **Server-Only**: RLS policy 자체를 만들지 않음 → anon/authenticated role은 접근 불가, Edge Function은 `service_role` key(Function 환경변수에만 존재)로 RLS 우회 접근.
- 금전 테이블(investment_orders/transactions/holdings/dividends)은 클라이언트 role에 **INSERT/UPDATE/DELETE policy를 아예 만들지 않는다** — SELECT(Owner-Only)만 존재. 원칙 13 위반(단순 UPDATE로 잔액 관리)을 스키마 레벨에서 원천 차단.
- `investment_transactions`는 추가로 `BEFORE UPDATE OR DELETE` 트리거에서 `RAISE EXCEPTION`으로 immutable 강제(RLS 우회 시도까지 방어).

---

## 3. Audit Logging

- 대상: properties, investment_products, investment_orders(상태 변경), notification_campaigns, user_roles, system_settings 등 admin이 변경 가능한 모든 테이블.
- 구현: DB 트리거(`audit_log_admin_changes`)가 UPDATE/DELETE 시 `before`/`after` jsonb를 자동 기록 → 애플리케이션 코드 누락에도 안전.
- Edge Function에서 `actor_id`, `ip_address`, 행위의 비즈니스 컨텍스트(예: "캠페인 즉시발송")를 보강 기록.
- audit_logs는 **수정/삭제 불가**(immutable, transactions와 동일 패턴).
- 열람 권한: `super_admin`(기본), `admin`은 읽기전용 하위 집합 — 세부는 Phase 9에서 UI 설계 시 재확인.

---

## 4. Rate Limiting

- 적용 위치: Edge Function 공통 미들웨어(`_shared/rateLimit.ts`).
- 키: `user_id`(로그인) 또는 `IP`(익명), 함수별 한도는 API.md 표 참조.
- 저장소는 Phase 2에서 확정(Postgres 카운터 테이블 vs 외부 스토어) — 비용이 낮은 Postgres 방식을 기본안으로 제안, 트래픽 증가 시 전환.
- 금전 관련 함수(`create-investment-order`)는 가장 엄격한 한도 + Idempotency-Key 필수.

## 5. Input Validation

- 모든 Edge Function은 진입점에서 스키마 검증(zod 등, 라이브러리는 Phase 2 확정) — 타입/범위/필수값 미검증 상태로 DB에 도달하지 않도록 한다.
- 서버 측 검증이 원칙이며, 클라이언트 폼 검증은 UX 보조 수단으로만 취급(신뢰하지 않음).
- SQL Injection: Supabase client/PostgREST 파라미터 바인딩 사용, raw SQL 문자열 조합 금지.

## 6. API Key / Secret 관리

- Service Role Key: Supabase Edge Function 환경변수(Secrets)에만 존재. 모바일 빌드/Admin 프론트엔드 번들에는 **절대 포함 금지**(원칙 10, CI에서 번들 스캔으로 재확인 — Phase 11 보안감사 항목).
- 클라이언트에 노출 가능한 값: `SUPABASE_URL`, `SUPABASE_ANON_KEY`(RLS로 방어되므로 노출 전제), Google Maps API Key(플랫폼 제한: iOS bundle ID / Android package+SHA-1 제한 필수, HTTP Referrer 제한은 웹 Admin에 한함).
- LLM API Key, FCM Server Key, 환율/뉴스 소스 API Key: Edge Function 환경에만 존재, 클라이언트는 이를 감싼 Edge Function만 호출.
- 키 로테이션 절차와 보관(예: 1Password/Vault 등)은 조직 정책에 맞춰 별도 확정 필요 — **미결정 항목**.

## 7. Storage / Signed URL

- Storage 버킷은 기본 **private**. 매물 이미지처럼 공개해도 되는 자산만 별도 public 버킷 사용.
- 민감 문서(property_documents 중 등기부등본류, investment_product_documents 중 공시자료 원본 등)는 항상 private 버킷 + Signed URL(짧은 TTL, 예: 5분) — Edge Function(`get-property-detail` 등)에서 요청 시점에 발급.
- 업로드는 Admin/Editor role만(Edge Function 경유 또는 RLS로 제한된 storage policy).

## 8. Session / Device Management

- Auth: Supabase Auth(Google/Apple OAuth), 토큰은 `expo-secure-store`에 보관(AsyncStorage 평문 저장 금지).
- `user_devices` 테이블로 기기별 세션 추적, "다른 기기 로그아웃" 등 세션 관리 기능은 Phase 8~9 사이 UX 설계 필요(현재 스키마는 지원 가능하도록 준비만).
- Refresh token 회전은 Supabase Auth 기본 동작 사용.

## 9. Secure Deep Link

- Push의 `deep_link` 필드는 화이트리스트 스킴/경로만 허용(임의 URL 오픈 금지) — 예: `viets://property/{id}`, `viets://invest/{id}` 형태로 제한하고 Edge Function/Admin 캠페인 생성 시점에 검증.
- Universal Link(iOS)/App Link(Android) 도메인 검증 설정 필요(Phase 8).

## 10. Admin MFA 대응

- Supabase Auth의 MFA(TOTP) 기능을 Admin Dashboard 로그인에 적용 — 최소 `admin`/`super_admin` role은 MFA 필수화(정책 강제 방식은 Phase 9 구현 시 확정: DB flag로 미등록 시 기능 제한 등).
- 모바일 일반 사용자에게는 MFA 강제하지 않음(UX 우선, 필요 시 향후 옵션 제공).

## 11. 로그 내 민감정보 비노출

- `api_logs`: 요청/응답 body 미기록, 메타데이터만.
- `system_logs`: 외부 API 응답 원문 대신 요약/상태코드 위주 기록, 개인정보(전화번호/주소 등) 미포함.
- 에러 메시지: 클라이언트에는 일반화된 메시지만 반환, 상세 스택은 서버 로그(외부 미노출)에만.

---

## 12. Phase 11 "Security Audit" 체크리스트 (선반영)

- [ ] 전 테이블 RLS enabled 여부 스캔
- [ ] 금전 테이블에 클라이언트 write policy 없음 확인
- [ ] 클라이언트 번들 내 secret 키 스캔(문자열 검색 + 빌드 산출물 검사)
- [ ] Storage 버킷 public/private 설정 재확인
- [ ] Rate limit 동작 실측 테스트
- [ ] Admin MFA 적용 확인
- [ ] Deep link 화이트리스트 우회 테스트

---

## 13. 미결정 항목

1. Rate limit 저장소 최종 선택.
2. Secret 보관/로테이션 절차(조직 정책).
3. Admin MFA 강제 방식(하드 블록 vs 유예기간).
4. "다른 기기 로그아웃" 등 세션 관리 UX 범위.
