# Viet's — Mobile App

Vietnam Real Estate & Investment Platform (React Native / Expo)

## 현재 상태: STEP 03 — PROJECT FOUNDATION / SCAFFOLD

이 폴더는 STEP 03(Foundation/Scaffold)에서 생성되었다. **아직 실제 기능(Supabase 연결, 인증, 매물/투자/AI/Push/지도 등)은 구현되어 있지 않다** — Navigation 골격, i18n 골격, Design System 토큰, 폴더 구조, 환경변수 틀만 준비된 상태다. 자세한 내용은 `docs/STEP03_PRE_AUDIT.md`와 `docs/DECISIONS.md` 참고.

## ⚠️ 실행 전 필수: 설치 및 버전 확인

이 `package.json`은 Claude의 클라우드 작업공간에서 작성되었고, **그 환경은 npm 레지스트리 접근이 차단되어 있어 `npm install`을 한 번도 실행/검증하지 못했다**(DECISIONS.md D24 참조). Expo/React Native/TypeScript 핵심 버전(expo ^54, react-native 0.81, react 19.1, typescript ~5.9.2)은 Expo 공식 SDK 54 changelog로 확인했지만, 나머지 패키지(zustand, @tanstack/react-query, i18next, react-i18next 등)의 정확한 최신 patch 버전은 npm 레지스트리에 직접 접근하지 못해 대략적인 범위(`^`)로만 지정했다. **아래 순서로 반드시 직접 검증해야 한다.**

```bash
cd "C:\Users\ASUS\Desktop\Viet's 벳츠플랫폼"   # 이 파일이 있는 폴더

node -v      # 20.19.4 이상 필요 (Expo SDK 54 최소 요구사항)
npm -v
git --version

npm install

# Expo가 SDK 54와 호환되지 않는 버전을 자동으로 정확한 버전으로 맞춰준다.
# 위 package.json의 버전 추정치를 신뢰하지 말고 반드시 이 명령을 실행할 것.
npx expo install --fix

# 타입/린트 확인
npm run typecheck
npm run lint    # 실패하면 npx expo lint 로 Expo 공식 ESLint 설정을 재생성

# 실행
npx expo start
```

## 환경변수

`.env.example`을 복사해 `.env`를 만들고 값을 채운다:

```bash
cp .env.example .env
```

`EXPO_PUBLIC_`으로 시작하는 값만 넣는다 — Service Role Key, LLM/Embedding/PG/FCM Server Secret 등은 여기에 절대 넣지 않는다(향후 Supabase Edge Functions에서 관리, `SECURITY.md` §6 참고).

## 폴더 구조

```
app/                  Expo Router 라우트 (Home/Property/Invest/AI/My 탭 골격)
components/           공용 UI 컴포넌트
services/             Supabase/Edge Function 연동 (Phase 2 이후)
hooks/                React Query 커스텀 훅 (Phase 2 이후)
store/                Zustand 전역 상태
utils/                포맷터 등 순수 유틸
constants/theme.ts    Design System 토큰 (색상/타이포/여백/radius/shadow)
i18n/                 UI 번역 리소스 (vi/ko/en/zh/ja) + locale 감지
assets/               아이콘/스플래시 등 (현재 placeholder 이미지)
supabase/             DB migration, Edge Functions (Phase 2에서 채움)
docs/                 설계 문서 사본 (docs/README.md 참고)
```

## 다음 단계

`docs/STEP03_PRE_AUDIT.md` §12, `docs/DECISIONS.md`의 "지금 바로 답변이 필요한 항목" 참고.
