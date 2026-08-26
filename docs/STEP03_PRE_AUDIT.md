# STEP03_PRE_AUDIT.md — Viet's

버전: v0.3 · 작성일: 2026-08-26 · 최종수정: 2026-08-26
상태: **완료 — 재검증 포함**

## 변경 이력

| 일자 | 변경 내용 |
|---|---|
| 2026-08-26 | v0.1: 폴더 미연결로 대부분 BLOCKED 상태로 작성 |
| 2026-08-26 | v0.2: 폴더 연결 확인 후 실제 조사(코드 없음 확인) → Scaffold 46개 파일 생성/커밋 |
| 2026-08-26 | v0.3: 사용자가 "Desktop 프로젝트 폴더가 연결되었습니다"라며 STEP 03 재개 지시 → 재조사 결과, 폴더 내용은 **v0.2에서 이 세션이 직접 커밋한 Scaffold와 100% 동일**함을 증거 기반으로 확인(아래 §1 참조) |

---

## 1. 연결 폴더 및 프로젝트 상태 — Evidence 기반

**연결 경로**: `C:\Users\ASUS\Desktop\Viet's 벳츠플랫폼` (`get_device_info().connectedFolders[0]`로 확인)

**핵심 발견 — 추측하지 않고 증거로 확인**: `device_list_dir(recursive=true)`로 전체 파일을 재조회한 결과, 모든 파일의 `mtimeMs`가 직전 STEP 03에서 이 세션이 `device_commit_files`로 기록한 시각과 **정확히 일치**한다(예: `package.json` mtimeMs=1787778062197). 추가로 `package.json`, `app.json`을 다시 staging해 이 세션의 로컬 사본과 `diff` 비교한 결과 **byte 단위로 완전히 동일**했다.

**결론**: 이 폴더에 있는 코드는 독립적으로 존재하던 "기존 Viet's 프로젝트"가 아니라, **이 세션이 직전 STEP 03에서 직접 작성해 커밋한 Scaffold 그 자체**다. 그 이후 다른 경로로 수정된 흔적이 없다(모든 mtime이 커밋 시점과 동일 = 사용자나 다른 프로세스가 손대지 않음). `작업파일/` 폴더와 PPTX 스토리보드만 이 세션이 만들지 않은, 사용자가 준비한 자료다(v0.2와 동일하게 확인됨, 변경 없음).

Git repository: **없음** — 재조회 결과에 `.git` 폴더가 존재하지 않는다(dotfile인 `.env.example`, `.gitignore`는 정상적으로 조회되므로, `.git`이 있었다면 함께 표시되었을 것).

## 2. 기존 기술스택 — package.json Evidence 기반 (실행 미검증)

`package.json`(직접 재확인, 1045 bytes, 위 diff로 검증됨) 기준:

| 항목 | 선언된 값 | 근거 | 실행 검증 |
|---|---|---|---|
| Expo | `^54.0.0` | package.json dependencies | UNKNOWN(미실행) |
| React Native | `^0.81.0` | package.json dependencies | UNKNOWN |
| React | `19.1.0` | package.json dependencies | UNKNOWN |
| TypeScript | `~5.9.2` | package.json devDependencies | UNKNOWN |
| Navigation | expo-router `^6.0.0` | package.json + `app/` 라우트 파일 실재 | UNKNOWN |
| State Management | zustand `^5.0.0`, @tanstack/react-query `^5.0.0` | package.json + `store/useLocaleStore.ts`, `app/_layout.tsx`의 QueryClientProvider 실재 | UNKNOWN |
| i18n | i18next `^24.0.0`, react-i18next `^15.0.0`, expo-localization `^16.0.0` | package.json + `i18n/` 파일 실재 | UNKNOWN |
| Supabase | **없음** | package.json에 `@supabase/supabase-js` 미포함 — 아직 연결 안 함(의도된 상태, Phase 2 범위) | N/A |
| Firebase | **없음** | FCM 관련 패키지 미포함(Phase 8 범위) | N/A |
| Google Maps | **없음** | 관련 패키지 미포함(Phase 4 범위) | N/A |
| EAS | **없음** | `eas.json` 파일 자체가 존재하지 않음 | N/A |

**`node_modules/`가 존재하지 않는다**(디렉토리 목록에 없음) — 즉 `npm install`이 이 폴더에서 아직 한 번도 실행되지 않았다. 따라서 위 모든 "선언된 값"은 package.json에 적힌 텍스트일 뿐, 실제로 설치·실행 가능한지는 **UNKNOWN**이다(1번 문서의 Root Cause: 이 세션에는 데스크톱 명령 실행 도구가 없음).

## 3. 현재 폴더구조

```
Viet's 벳츠플랫폼/
├── .env.example, .gitignore, README.md, app.json, package.json,
│   tsconfig.json, babel.config.js, metro.config.js, eslint.config.js
├── app/                    (Expo Router: _layout.tsx, index.tsx, (tabs)/ 5개 탭)
├── components/             (PlaceholderScreen.tsx)
├── constants/               (theme.ts)
├── i18n/                    (index.ts + locales/{vi,ko,en,zh,ja}.json)
├── store/                   (useLocaleStore.ts)
├── services/, hooks/, utils/  (README.md만 — 빈 placeholder)
├── supabase/                (README.md, migrations/.gitkeep — 빈 placeholder)
├── assets/images/            (placeholder PNG 4개)
├── docs/                     (설계문서 10종 사본)
├── 작업파일/                  (사용자가 저장한 문서 7종, AI_RESEARCH.md/_1.md 중복 포함 — 이 세션이 만들지 않음)
└── Viets_..._기획스토리보드.pptx (사용자 자료 — 이 세션이 만들지 않음)
```

`node_modules/`, `.expo/`, `.git/` 없음 — 아직 한 번도 install/실행되지 않은 순수 소스 상태.

## 4. 현재 dependencies
2번 표 참조. `dependencies` 15개, `devDependencies` 5개, 전부 STEP 03에서 이 세션이 직접 기입(설치 검증 안 됨).

## 5. 현재 navigation
`expo-router` 기반. `app/_layout.tsx`(Stack) → `app/index.tsx`(`/home`로 Redirect) → `app/(tabs)/_layout.tsx`(Tabs: home/property/invest/ai/my, 아이콘·테마 연결) → 각 탭은 `PlaceholderScreen`만 렌더. 실제 화면 로직 없음(의도된 범위).

## 6. 현재 Supabase
없음. `.env.example`에 키 형태만 존재(값 비어있음), `services/`도 빈 placeholder.

## 7. 현재 Firebase
없음(Phase 8 범위).

## 8. 현재 Google Maps
없음(Phase 4 범위).

## 9. 현재 i18n
i18next 초기화 코드(`i18n/index.ts`)와 5개 언어 리소스 실재. Device locale 감지 → 미지원 시 'en' 폴백 로직 포함. 실제 동작 여부는 UNKNOWN(미실행).

## 10. 현재 환경변수
`.env.example`만 존재, `.env`(실제 값) 없음 — Supabase 프로젝트 자체가 아직 없으므로 채울 값도 없는 상태(D5 참고).

## 11. 현재 폴더구조와 설계문서와의 차이 / 충돌

| 문서 | 판정 | 근거 |
|---|---|---|
| ARCHITECTURE.md §5.2(폴더구조) | **MATCH** | app/components/services/hooks/store/utils/constants/i18n/assets/supabase/docs 전부 실재 |
| DECISIONS.md D5(Supabase dev 1개) | **MATCH**(적용 대상 없음) | 아직 Supabase 미연결이라 위반 여지 자체가 없음 |
| DECISIONS.md D24(Cloud=작성, Desktop=실행) | **MISMATCH 발견** | 이 세션에 데스크톱 실행 도구(device_bash)가 없어 "Desktop에서 실제 실행"을 이 세션이 수행할 방법이 없음 — D24 문구 자체를 재검토하거나, 실행은 전적으로 사용자 수동 실행에 의존해야 함을 명확히 해야 함 |
| DECISIONS.md D1/D3/D16(Expo Router/Zustand/i18next) | **부분 반영, 여전히 PENDING** | 지시사항 4번에 따라 "추천안 기준으로 Scaffold에 반영"했으나 DECISIONS.md 자체는 ACCEPTED로 바꾸지 않음(임의 확정 금지 준수) |
| DATABASE.md, API.md, AI_RESEARCH.md, SECURITY.md(RLS/RBAC 등) | **MISSING(의도된 범위)** | STEP 03은 Foundation 단계이므로 DB/API/AI/보안 기능 구현은 범위 밖 |
| I18N.md | **MATCH** | UI/Content 번역 분리, 5개 언어, locale 감지 원칙 그대로 구현 |
| QA.md §2(실행 환경 정책) | **MISMATCH**(위 D24와 동일 사안) | 문서상 정책과 이 세션의 실제 도구 가용성이 불일치 |

## 12. 삭제하면 안 되는 기존 기능
`작업파일/`(사용자 문서 7종), `Viets_..._기획스토리보드.pptx` — 이 세션이 만들지 않은 사용자 자료이므로 절대 삭제/수정하지 않는다(계속 유지 중, 이번 재조사에서도 변경 없음 확인).

## 13. 추가해야 하는 기능
`npm install` 및 실제 실행 검증(사용자 로컬에서 수행 필요), Supabase 연결(Phase 2), 이후 API/DB/보안/AI 등 전 기능(해당 Phase에서).

## 14. migration 필요사항
없음 — DB migration은 이번 STEP에서도 생성하지 않는다(지시사항 준수). `supabase/migrations/`는 빈 placeholder 상태 유지.
