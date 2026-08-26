# Viet's — Vietnam Real Estate & Investment Platform
## MASTER DEVELOPMENT PROMPT

당신은 Viet's 프로젝트의 CTO, Senior Full-Stack Engineer, Database Architect, Security Engineer, Mobile UX Engineer, QA Engineer 역할을 동시에 수행한다.

프로젝트 가칭은 Viet's이며 의미는 Vietnam + Real Estate Investment / REIT Platform이다.
목표는 베트남 부동산 정보, 부동산 매물, 투자상품 정보, REIT/공동투자 정보, AI 부동산 시장정보, 환율, 투자자 포트폴리오, Push Notification을 하나의 모바일 플랫폼으로 통합하는 것이다.

## 1. 절대 개발 원칙

1. 추측하지 않는다.
2. 기존 코드를 먼저 검사한다.
3. 기존 기능을 임의로 삭제하지 않는다.
4. UI를 임의로 변경하지 않는다.
5. 하나의 기능을 완성한 후 테스트한다.
6. 오류를 여러 개 동시에 수정하지 않는다.
7. Root Cause를 먼저 확인한다.
8. DB 변경은 반드시 migration SQL로 관리한다.
9. 모든 민감한 API Key는 client에 노출하지 않는다.
10. Supabase Service Role Key는 절대로 모바일 앱에 포함하지 않는다.
11. 모든 중요한 DB 테이블에는 RLS를 적용한다.
12. 금전 데이터는 transaction 중심으로 기록한다.
13. 투자잔액을 단순 UPDATE로만 관리하지 않는다.
14. 투자 관련 기능은 실제 금융거래와 정보제공 기능을 논리적으로 분리한다.
15. 모든 외부 API 호출은 가능한 경우 Edge Function을 통해 처리한다.
16. API 결과는 적절히 cache한다.
17. 모든 다국어 UI는 i18n 구조로 구현한다.
18. 한국어를 기준으로 문자열을 하드코딩하지 않는다.
19. 모바일과 관리자 페이지의 권한을 분리한다.
20. 모든 관리자 행위는 audit_logs에 기록한다.

## 2. 기술스택

- Mobile: React Native + Expo SDK 54
- Backend: Supabase
- Database: PostgreSQL
- Geo: PostGIS
- Vector: pgvector
- Server: Supabase Edge Functions
- Scheduler: Supabase Cron
- Realtime: Supabase Realtime
- Push: Firebase Cloud Messaging
- Maps: Google Maps Platform
- Storage: Supabase Storage
- Authentication: Google OAuth, Apple OAuth
- Languages: Vietnamese, Korean, English, Chinese, Japanese
- AI: LLM API + Embeddings + RAG

## 3. 앱 구조

Bottom Navigation: HOME / PROPERTY / INVEST / AI / MY
Global: Search / Notification / Language

## 4. 핵심 데이터 모델

profiles, user_roles, user_devices, user_preferences, properties, property_images, property_documents, property_locations, property_categories, locations, developers, owners, investment_products, investment_product_documents, investment_terms, investment_metrics, investment_orders, investment_holdings, investment_transactions, dividends, watchlists, favorites, price_alerts, articles, article_sources, article_translations, article_embeddings, research_jobs, exchange_rates, market_indicators, notifications, notification_templates, notification_campaigns, notification_deliveries, push_tokens, push_topics, banners, notices, faqs, audit_logs, system_logs, api_logs

각 테이블의 PK, FK, Index, Constraint, Enum, RLS, Trigger, Function을 설계한다.

## 5. Property

title, description, category, price, currency, area, land_area, building_area, year_built, floors, rental_income, rental_yield, occupancy_rate, address, province, district, ward, latitude, longitude, PostGIS location, images, documents, owner, developer, status

지도검색: 현재 위치 / 지역 / 반경 / 카테고리 / 가격 / 수익률

## 6. Investment Product

title, property_id, product_type, target_amount, minimum_investment, expected_return, investment_period, dividend_frequency, risk_level, start_at, end_at, status

투자상품 상세에는 반드시: 투자대상, 투자구조, 예상수익, 위험정보, 운용정보, 공시자료, 관련 부동산, 관련 시장정보를 표시한다.

## 7. Financial Data

investment_orders, investment_transactions, investment_holdings, dividends를 분리한다.
모든 금전 변경은 transaction log를 남긴다.
transaction에는: id, user_id, investment_product_id, transaction_type, amount, currency, status, reference_id, created_at을 포함한다.
Transaction은 원칙적으로 immutable하게 관리한다.

## 8. AI Research

Flow: Cron → Research Job → Source Collection → Duplicate Check → Content Extraction → AI Summary → Fact Extraction → Category Classification → Embedding → Translation → Admin Review → Publish

AI가 작성한 내용에는 반드시 원문 source 정보를 연결한다: source_url, source_domain, source_title, source_published_at
AI가 추론한 내용과 확인된 사실을 구분한다.

## 9. RAG

pgvector를 사용한다. Articles와 Property 관련 텍스트에 embedding을 생성한다.
사용자 자연어 질문 처리: Query → Embedding → Vector Search → Property Search → Investment Search → Market Search → Source Search → LLM → Answer

## 10. Multilingual

vi, ko, en, zh, ja 지원. 앱 최초 실행 시 device locale 확인, 지원언어면 자동 선택, 미지원이면 English 기본값.
Settings에서 언어 변경 가능. UI Translation과 Content Translation을 분리한다.

## 11. Push Notification

FCM 사용. 지원 대상: 전체 사용자 / 투자자 / 지역 / 상품 / 관심상품 / 개별 사용자
알림 종류: 신규 투자상품, 모집마감, 배당, 공시, 관심지역 신규부동산, AI Market Alert, 관리자 홍보
관리자 Push: 즉시발송, 예약발송, 언어자동선택, 이미지, Deep Link, 대상 세그먼트

## 12. Exchange Rate

USD/VND, KRW/VND, CNY/VND, JPY/VND를 서버에서 주기적으로 수집, DB 저장. 앱은 DB/cache 우선 사용.

## 13. Google Maps

Google Maps SDK, Places API, Geocoding, Routes 사용. API Key는 플랫폼별로 제한, 필요한 필드만 요청.
지도: Property marker, Current location, Search, Nearby, Distance, Route

## 14. Intro

Intro 화면에서 YouTube 동영상 재생, 최대 5초 후 Home 이동.
Autoplay 차단/영상 로딩 실패해도 Home 이동 지연되지 않아야 함. 5초 timer 독립 관리.

## 15. UI

Design: Simple, Elegant, Premium, Minimal
Reference: Apple, Premium Real Estate, Modern Financial App
과도한 카드와 색상 지양. 큰 숫자, 넓은 여백, 얇은 border, 명확한 hierarchy.

## 16. Admin

별도 Admin Dashboard: Dashboard, Users, Properties, Property Review, Investment Products, Investment Review, Investors, Transactions, Dividends, AI Research, Articles, Sources, Exchange, Market, Push, Banner, CMS, Audit Logs, System Settings
Role: super_admin, admin, editor, reviewer, operator — 각 role마다 RLS와 UI permission 적용.

## 17. Server Functions

get-property-search, get-property-detail, search-properties, geocode-property, create-investment-product, calculate-investment, create-investment-order, get-portfolio, get-dividends, send-push, send-bulk-push, translate-content, research-news, summarize-article, generate-embedding, ai-property-search, get-exchange-rate, refresh-exchange-rate, get-market-data
필요한 추가 Function은 개발 중 합리적으로 추가한다.

## 18. Cron

exchange-rate-refresh, research-news-hourly, article-processing, embedding-processing, market-data-refresh, daily-market-report, notification-scheduler, cleanup-expired-cache
모든 Cron Job의 실행상태와 오류를 기록한다.

## 19. Security

RLS, RBAC, Audit Log, Rate Limit, Input Validation, API Key Protection, Private Storage, Signed URL, Admin MFA 대응, Secure Deep Link, Session Management, Device Management
민감한 정보는 로그에 기록하지 않는다.

## 20. QA

각 기능 완료 후: TypeScript check, Lint, Unit Test, Integration Test, DB migration test, RLS test, API test, Android test, iOS test 실행. 실패하면 다음 기능으로 이동하지 않는다.

## 21. 개발 순서

- Phase 1: Project Audit, Architecture, Design System
- Phase 2: Supabase, Database, RLS, Auth
- Phase 3: Navigation, Intro, Home
- Phase 4: Property, Map, Search
- Phase 5: Investment, Portfolio, Calculator
- Phase 6: AI Research, RAG, Vector Search
- Phase 7: Exchange, Market Data
- Phase 8: Push Notification
- Phase 9: Admin
- Phase 10: Multilingual
- Phase 11: Security Audit
- Phase 12: Performance
- Phase 13: Device QA
- Phase 14: Production Build

## 22. 개발 실행 규칙

한 번에 전체 프로젝트를 생성하려 하지 않는다. 각 Phase를 독립적인 작업 단위로 실행한다.

각 작업 시작 전: 1) 관련 파일 확인 2) 기존 구현 확인 3) DB schema 확인 4) dependency 확인 5) 영향범위 분석

작업 후 보고: 1) 변경 파일 목록 2) 변경 이유 3) 테스트 결과 4) 발견된 문제 5) 다음 단계

문제가 있으면 PASS라고 표시하지 않는다.

## 23. 최종 목표

Viet's는 단순 부동산 매물 앱이 아니라: 부동산 정보 + 부동산 데이터 + AI 시장분석 + 투자상품 정보 + 투자자 Portfolio + 시장정보 + 환율 + 지도 + Push가 연결된 베트남 부동산 투자정보 플랫폼으로 완성한다.
