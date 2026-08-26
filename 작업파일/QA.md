# QA.md — Viet's

버전: v0.1 (설계 초안) · 작성일: 2026-08-26

원칙 5·6·7·20, 22번 항목의 실행 가능한 체크리스트로 전개한다. **핵심 규칙: 하나의 기능을 완성한 후 테스트하고, 실패하면 다음 기능으로 넘어가지 않는다. 오류를 여러 개 동시에 수정하지 않는다. Root Cause를 먼저 확인한다.**

---

## 1. 기능 단위 QA 체크리스트 (매 기능 완료 시 필수)

1. **TypeScript check** — `tsc --noEmit` 오류 0건
2. **Lint** — ESLint 오류 0건(경고는 별도 트래킹, 오류는 즉시 수정)
3. **Unit Test** — 해당 기능의 순수 로직(계산, 포맷터, 유틸)에 대한 단위 테스트
4. **Integration Test** — Edge Function ↔ DB, 화면 ↔ Supabase 쿼리 흐름 테스트
5. **DB migration test** — 새 migration이 clean DB에 순서대로 적용되는지, rollback 가능한지 확인
6. **RLS test** — 익명/일반 user/각 admin role별로 의도한 접근만 허용되는지(허용돼야 할 것 허용, 차단돼야 할 것 차단 — 두 방향 모두 검증)
7. **API test** — Edge Function 요청/응답 계약(API.md) 준수, 에러 케이스 포함
8. **Android test** / **iOS test** — 실기기 또는 시뮬레이터에서 해당 화면 동작 확인

하나라도 실패하면 그 기능은 "완료"로 표시하지 않고, 다음 작업으로 넘어가지 않는다(원칙 5·6). 실패 시 보고 형식은 4번 항목 참조.

---

## 2. 현재 환경 제약 (2026-08-26 기준, 실행 전 반드시 확인)

이 클라우드 세션의 작업공간은 `registry.npmjs.org` 접근이 403으로 차단되어 있음을 확인했다(Phase 1 착수 시도 중 발견). 이 상태로는 위 1번 체크리스트의 1~7번(특히 `npm install` 전제)을 클라우드 작업공간에서 실행할 수 없다. 따라서:

- 실제 코드 스캐폴딩 및 QA 실행은 **사용자 로컬 환경(데스크톱 폴더 연결) 또는 CI 환경**에서 진행하는 것을 전제로 한다.
- 이 문서의 체크리스트는 "무엇을 검증해야 하는가"의 기준이며, "어디서 실행하는가"는 실제 착수 시점에 확정한다(ARCHITECTURE.md 6번 미결정 항목과 연동).
- QA를 건너뛰고 "완료"로 보고하지 않는다 — 실행 불가능한 환경이면 "미검증" 상태로 명시하고, 검증 가능한 환경이 갖춰질 때까지 해당 기능을 완료로 처리하지 않는다.

---

## 3. Phase별 QA 게이트

각 Phase는 아래 게이트를 통과해야 다음 Phase로 진행한다.

| Phase | 게이트 |
|---|---|
| 1. Audit/Architecture/Design | 문서 승인(ARCHITECTURE/DATABASE/API/SECURITY/I18N/AI_RESEARCH/QA) — 현재 진행 중 |
| 2. Supabase/DB/RLS/Auth | 전 테이블 migration 적용 성공, RLS test 통과, OAuth 로그인 e2e 성공 |
| 3. Navigation/Intro/Home | Intro 5초 타이머 독립 동작(영상 실패 시에도 지연 없음) 검증, 탭 전환 정상 |
| 4. Property/Map/Search | 지도 반경검색 정확도(PostGIS) 검증, 필터 조합 테스트 |
| 5. Investment/Portfolio/Calculator | 금전 트랜잭션 정합성 테스트(동시성 포함), holdings 재계산 정확도 |
| 6. AI Research/RAG | 출처 누락 응답 0건, fact/inference 구분 UI 검증 |
| 7. Exchange/Market Data | Cron 정상 수집, 결측 시 fallback(직전 값 유지) 동작 확인 |
| 8. Push | 세그먼트별 발송 정확도, Deep Link 화이트리스트 우회 불가 확인 |
| 9. Admin | Role별 UI/API 접근 통제 확인, Audit Log 누락 없음 |
| 10. Multilingual | 5개 언어 키 누락 0건, 콘텐츠 번역 폴백 동작 |
| 11. Security Audit | SECURITY.md 12번 체크리스트 전 항목 통과 |
| 12. Performance | 주요 화면 TTI/응답시간 기준치(기준치는 착수 시 확정) 충족 |
| 13. Device QA | 대표 Android/iOS 기기 매트릭스에서 회귀 없음 |
| 14. Production Build | 스토어 빌드 성공, 크래시 프리 세션 비율 기준 충족 |

---

## 4. 작업 보고 형식 (원칙 22)

각 작업(기능) 완료 후 다음 형식으로 보고한다:

```
1. 변경 파일 목록
2. 변경 이유
3. 테스트 결과 (위 1번 체크리스트 항목별 pass/fail/미검증)
4. 발견된 문제 (있으면 구체적으로, 없으면 "없음"만 — 얼버무리지 않음)
5. 다음 단계
```

문제가 있는데 "PASS"로 표시하지 않는다 — 부분 성공도 실패 항목을 명시한다.

---

## 5. 테스트 도구 (제안, Phase 2 착수 전 확정)

- Unit/Integration: Jest + React Native Testing Library
- E2E(모바일): Detox 또는 Maestro (팀 선호도에 따라 Phase 13 이전 확정)
- API/RLS test: Supabase 로컬 스택(`supabase start`) 기반 pgTAP 또는 Deno test로 Edge Function 테스트
- Lint/Format: ESLint + Prettier(설정은 Phase 1 스캐폴딩 시 함께 정의)

---

## 6. 미결정 항목

1. 실제 코드/QA 실행 환경(로컬 vs CI vs 데스크톱 연결) 확정.
2. E2E 도구(Detox vs Maestro) 선택.
3. Performance 기준치(TTI, API 응답시간 등) 수치화.
4. 대표 기기 매트릭스(Android/iOS 버전, 화면 크기) 목록.
