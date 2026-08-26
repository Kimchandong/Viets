# supabase/

Supabase 프로젝트 관련 파일(마이그레이션, Edge Functions, 시드 데이터)이 위치할 폴더.

## STEP 03 범위

이번 단계에서는 폴더 구조만 준비하고, 실제 DB migration은 생성하지 않는다(지시사항 10번). `migrations/` 폴더는 비어 있는 placeholder 상태다.

## 다음 단계 (Phase 2: Supabase / DB / RLS / Auth)

1. `npx supabase init` (Supabase CLI 필요, 이 폴더에서 실행)
2. `npx supabase link --project-ref <development project ref>` — DECISIONS.md D5(ACCEPTED)에 따라 development 프로젝트 1개로 시작
3. DATABASE.md에 정의된 테이블을 `migrations/`에 하나씩 SQL로 작성(원칙 8: DB 변경은 반드시 migration SQL로 관리)
4. RLS 정책은 SECURITY.md §2 패턴(Public-Read / Owner-Only / Server-Only)을 따른다

## 환경변수

이 폴더의 Edge Functions는 Supabase Secrets로 관리되는 민감 키(Service Role Key, LLM/Embedding Secret, 결제 PG Secret, FCM Server Secret 등)를 사용한다 — 모바일 앱의 `.env`에는 절대 포함하지 않는다(SECURITY.md §6, ARCHITECTURE.md §5.1).
