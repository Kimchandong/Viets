# STEP03_ADR_PROPOSALS.md — Viet's

버전: v0.1 · 작성일: 2026-08-26
상태: **제안 — 전부 사용자 승인 대기 중. DECISIONS.md의 ✅/⚪ 상태는 아직 변경하지 않았다.**

이 문서는 STEP 03 Scaffold에 이미 반영된 4개 기술 선택(D1/D3/D16)을 정식 Architecture Decision Record 형태로 정리하고, D24 문구의 실행 주체 불명확성을 보완하는 수정안을 제시한다. 승인 시 DECISIONS.md/ARCHITECTURE.md/QA.md에 반영한다.

---

## D1 — Navigation: Expo Router

**Context**: ARCHITECTURE.md §2.1이 Expo Router를 제안(미확정)으로 남겨두었으나, STEP 03 Scaffold 지시사항 4번("추천안 기준 반영 가능 여부 검토")에 따라 `app/_layout.tsx`, `app/(tabs)/_layout.tsx` 등 실제 코드에 이미 적용되어 있다.

**Decision (제안)**: Expo Router(v6)를 Viet's 모바일 앱의 공식 네비게이션 라이브러리로 채택한다.

**Reason**:
- 파일 기반 라우팅이 Push 알림의 Deep Link(`viets://property/{id}` 등, SECURITY.md §9)와 자연스럽게 매핑됨
- Expo SDK 54와 통합성이 높고, `app.json`에 이미 `experiments.typedRoutes: true`로 타입 안전 라우팅 설정 완료
- React Navigation을 직접 구성하는 것보다 보일러플레이트가 적음

**Alternatives**:
- React Navigation 직접 구성 — 세밀한 제어는 가능하나 Deep Link 연결을 수동으로 관리해야 하고 설정 코드가 늘어남

**Impact**:
- `app/` 폴더 구조가 Expo Router 컨벤션(그룹 `()`, 동적 라우트 `[id]` 등)에 종속됨(이미 그렇게 구현됨)
- 향후 화면 추가 시 파일 경로가 곧 라우트가 되므로, 폴더 이름 변경에 신중해야 함

---

## D3 — State Management: Zustand + TanStack Query

**Context**: ARCHITECTURE.md §2.2가 클라이언트 상태 관리 라이브러리를 미확정으로 남겨두었으나, Scaffold의 `store/useLocaleStore.ts`와 `app/_layout.tsx`의 `QueryClientProvider`에 이미 적용되어 있다.

**Decision (제안)**: 서버 상태는 TanStack Query, 클라이언트 전역 상태(언어/테마 등 경량 UI 상태)는 Zustand로 이원화한다.

**Reason**:
- 서버 상태(매물/투자상품/포트폴리오 등)와 클라이언트 UI 상태를 분리하는 구조가 SECURITY.md의 "금전 데이터는 항상 서버 fetch 기준, 낙관적 업데이트 금지" 원칙과 부합 — TanStack Query의 캐시·무효화 모델이 이를 자연스럽게 지원
- Zustand는 보일러플레이트가 적어 언어/테마처럼 가벼운 상태에 적합

**Alternatives**:
- Redux Toolkit(+RTK Query) — 이 앱 규모엔 과설계로 판단
- Jotai — atom 단위 상태관리라 현재 요구되는 전역 상태 종류가 적은 상황에서 Zustand 대비 이점이 크지 않음

**Impact**:
- 신규 전역 상태 추가 시 Zustand store 패턴을 따름
- 서버 데이터 fetch는 항상 React Query 훅을 통해서만 수행(컴포넌트에서 직접 fetch 금지)하는 규칙을 QA 체크리스트에 추가할 것을 권장

---

## D16 — i18n: i18next + react-i18next

**Context**: I18N.md §2.1이 미확정으로 남겨두었으나, `i18n/index.ts`와 5개 언어 리소스 파일(`vi/ko/en/zh/ja.json`)에 이미 적용되어 있다.

**Decision (제안)**: i18next + react-i18next를 Viet's의 공식 UI 번역 라이브러리로 채택한다.

**Reason**:
- React Native 생태계 표준, `expo-localization`과의 통합 사례가 풍부
- plural/interpolation 등 5개 언어(vi/ko/en/zh/ja) 요구사항을 기본 지원

**Alternatives**:
- react-intl(FormatJS) — ICU 메시지 포맷이 강력하지만 러닝커브가 높고 RN 생태계 사례가 i18next 대비 적음
- 자체 구현 — 유지보수 부담이 큼

**Impact**:
- 모든 신규 UI 문자열은 `t()` 경유가 필수(QA.md §5의 하드코딩 검출 lint 규칙 도입과 연결)
- `i18n/locales/*.json`이 UI 카피의 단일 소스가 됨

---

## D24 문구 보완안 — 실행 주체 명확화

**문제 발견**: 현재 DECISIONS.md D24는 "데스크톱 연결 폴더 = 실제 실행/QA 환경"이라고만 되어 있어, **누가(어떤 주체가) 그 실행을 수행하는지가 불명확**했다. STEP 03 진행 중 실제로 확인한 바, 이 Cloud Code 세션에는 데스크톱 셸 실행 도구(`device_bash` 등)가 제공되지 않아 세션이 스스로 데스크톱에서 명령을 실행할 수 없다(파일 list/stage/commit만 가능). 즉 "Desktop = 실행 환경"이라는 문구가 "Cloud Code 세션이 Desktop에서 자동으로 실행해준다"는 뜻으로 오인될 위험이 있었다.

### 현재 문구 (DECISIONS.md D24)

> 데스크톱 프로젝트 폴더 연결 환경을 실제 개발/실행/QA 환경으로 사용한다. Cloud 환경은 코드 분석, 설계, 코드 작성 및 검토에 사용한다. `npm install`, Expo 실행, 실제 디바이스 테스트, APK/iOS 빌드 등 실행 검증은 연결된 데스크톱 환경에서 수행한다.

### 제안 문구

> **Cloud Code 세션**은 분석·설계·코드 작성·코드 리뷰만 수행한다. Cloud Code 세션은 (a) npm 레지스트리 접근이 차단되어 있어 자체적으로 패키지를 설치/실행할 수 없고, (b) 데스크톱 셸 실행 도구(`device_bash` 등)가 세션에 제공되지 않는 한 데스크톱에서도 명령을 대신 실행할 수 없다.
>
> `npm install` / `npx expo install --fix` / TypeScript check / Lint / `npx expo start` / 실제 Device Test / APK·iOS 빌드는 다음 중 하나의 주체가 수행한다:
> 1. **사용자가 Desktop(로컬)에서 직접 실행** — 기본값
> 2. **CI 파이프라인**(GitHub Actions 등, 구축 시)에서 실행
> 3. Cloud Code 세션에 데스크톱 셸 실행 도구가 제공되는 경우에 한해, 세션이 사용자를 대신해 실행
>
> Cloud Code 세션은 실행 결과를 스스로 만들어내지 않으며, 사용자/CI가 보고한 실제 실행 결과를 근거로만 PASS/FAIL/BLOCKED를 판정한다.

### 반영 대상 파일 (승인 시)

| 파일 | 반영 위치 |
|---|---|
| DECISIONS.md | D24 상세 블록 텍스트 교체 |
| ARCHITECTURE.md | §5.2 "코드 실행 환경" 표에 "실행 주체" 열 추가 |
| QA.md | §2 "실행 환경 정책" 표에 동일하게 실행 주체 명시 |

이 세 파일 모두 **아직 수정하지 않았다** — 사용자 승인 후 한 번에 반영한다.
