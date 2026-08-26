# STEP03_MIGRATION_PLAN.md — Viet's

버전: v0.1 · 작성일: 2026-08-26

## 중요 전제

이 문서는 지시사항 6번("기존 프로젝트가 있다면 새 Scaffold를 생성하지 않고 정리 계획을 먼저 세운다")에 따라 작성한다. 다만 STEP03_PRE_AUDIT.md v0.3 §1에서 증거로 확인했듯, 이 폴더의 "기존 프로젝트"는 **독립적으로 존재하던 레거시 코드가 아니라, 바로 직전 STEP 03에서 이 세션이 직접 작성·커밋한 Scaffold**다(package.json/app.json byte 단위 diff 일치, 전 파일 mtime 일치로 확인). 따라서 이 계획은 "이질적인 두 코드베이스를 병합"하는 전통적 마이그레이션이 아니라, **이미 목표 아키텍처대로 지어진 Scaffold를 이어서 어떻게 완성해 나갈지에 대한 계획**이다. 이 사실을 숨기지 않고 각 섹션에 명시한다.

---

## 1. 기존 구조

STEP03_PRE_AUDIT.md v0.3 §3 참조. 요약: `app/`(Expo Router 골격), `components/`, `constants/theme.ts`, `i18n/`, `store/`, `services|hooks|utils/`(빈 placeholder), `supabase/`(빈 placeholder), `assets/`(placeholder 이미지), `docs/`(설계문서 사본), 루트 설정 파일(package.json 등). `node_modules/`/`.git/` 없음 — 설치·초기화 이전 상태.

## 2. 목표 구조

ARCHITECTURE.md §5.2와 동일. **현재 구조가 이미 목표 구조와 일치한다** — 별도로 옮기거나 새로 만들 폴더가 없다.

## 3. 유지할 코드

전부 유지한다. `app/`, `components/`, `constants/`, `i18n/`, `store/`, `services|hooks|utils/README.md`, `supabase/`, `assets/`, `docs/`, 루트 설정 파일 전체. 그리고 이 세션이 만들지 않은 `작업파일/`(문서 7종)과 `Viets_..._기획스토리보드.pptx`도 그대로 유지한다(원칙 3, 절대 삭제 금지).

## 4. 수정할 코드

없음(구조/로직 변경 불필요). 단 하나, **패키지 버전 검증**이 남아있다 — `package.json`의 zustand/@tanstack/react-query/i18next/react-i18next/expo-localization 버전은 npm 레지스트리를 직접 조회하지 못한 채 범위(`^`)로 지정했으므로, 사용자가 `npx expo install --fix`를 실행하면 Expo SDK 54와 호환되는 정확한 버전으로 자동 보정된다(코드 수정 아님, 설치 시 자동 처리).

## 5. 추가할 코드

이번 STEP 범위 밖(지시사항 8번 절대 원칙 준수) — Phase 2 이후에 추가한다:
- Supabase 클라이언트(`services/supabase.ts`), Auth 연동, `@supabase/supabase-js` 의존성 추가 (Phase 2)
- DB migration SQL (Phase 2)
- 실제 화면 로직 — Property/Investment/AI/Push/Google Maps 등 (해당 Phase)

## 6. 이동할 코드

없음.

## 7. 제거 후보 (사용자 승인 필요 — 이 세션이 임의로 삭제하지 않음)

- `작업파일/AI_RESEARCH_1.md` — `AI_RESEARCH.md`와 byte 크기 완전 동일한 중복 파일로 추정(STEP03_PRE_AUDIT.md v0.2에서 최초 발견). 정본은 `AI_RESEARCH.md`(또는 `docs/AI_RESEARCH.md`)로 보인다.
- `작업파일/` 폴더 전체 — `docs/`에 더 최신 버전(DECISIONS.md, STEP03_PRE_AUDIT.md 포함)이 이미 존재하므로 중복 관리 부담이 있다. 다만 이 세션은 연결된 폴더에서 파일을 삭제할 권한/도구가 없으므로, **삭제는 전적으로 사용자 몫**이다.

## 8. 제거하면 안 되는 코드

- `Viets_..._기획스토리보드.pptx` — 유일한 원본 기획 자료, 어디에도 사본이 없음.
- `docs/`, `app/`, `constants/theme.ts`, `i18n/` 등 이번 STEP 03의 전체 산출물 — 다음 Phase의 기반이 되므로 유지.

## 9. dependency 변경

현재 계획된 변경 없음. Phase 2 착수 시 `@supabase/supabase-js` 추가가 유일하게 예정된 변경.

## 10. migration 순서 (= 사실상 "이어서 진행할 순서")

1. 사용자가 로컬에서 `npm install` → `npx expo install --fix` 실행(버전 자동 보정)
2. `npm run typecheck`, `npm run lint`, `npx expo start` 실행 후 결과 공유
3. (선택) `git init` — 현재 `.git`이 없어 변경 이력 추적이 안 되는 상태. 이후 작업의 안전망을 위해 이 시점에 git 저장소화를 권장
4. `작업파일/` vs `docs/` 중복 정리 여부 결정(7번 참고)
5. 실행 검증 통과 확인 후 Phase 2(Supabase/DB/RLS/Auth) 착수

## 11. 위험요소

- **버전 미검증 리스크**: 4개 패키지의 정확한 patch 버전을 npm 레지스트리에서 직접 확인하지 못했다. `expo install --fix`가 안전망이지만, 그 명령 자체도 아직 실행/검증되지 않았다.
- **실행 도구 부재(반복 발견)**: 이 세션에는 데스크톱 셸 실행 도구가 없어, 앞으로도 모든 `npm`/`expo`/`tsc`/빌드 명령은 사용자가 직접 실행해야 한다. DECISIONS.md D24("Desktop=실제 실행")가 이 세션에서 자동으로 수행될 것으로 오인하지 않도록 QA.md/ARCHITECTURE.md의 관련 문구를 재검토할 필요가 있다(사용자 확인 후 반영 여부 결정).
- **버전 관리 공백**: `.git` 저장소가 없어 지금까지의 변경을 되돌릴 안전망이 없다. 다음 코드 변경 전에 git 초기화를 권장한다.
- **문서 중복 드리프트**: `작업파일/`과 `docs/`가 정리되지 않으면, 향후 문서가 갱신될 때 한쪽만 업데이트되어 서로 달라질 위험이 있다.
