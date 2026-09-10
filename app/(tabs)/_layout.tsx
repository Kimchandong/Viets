import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing, textStyles } from "@/constants/theme";

// Bottom Navigation: HOME / PROPERTY / INVEST / AI / MY (마스터 프롬프트 3번,
// ARCHITECTURE.md §2.3). STEP 4-9B: 아이콘 크기(TAB_ICON_SIZE 고정)와 라벨 타이포그래피
// (textStyles.navLabel)를 명시해 5개 탭 전체가 동일한 시각 규칙을 따르도록 한다.
// focused 상태는 outline → filled 아이콘 전환으로 표현한다(색상만으로 구분하지 않음).
// 탭 목적지/구조는 변경하지 않는다.
//
// STEP 4-12: 탭 바가 실제 기기의 하단 Safe Area(iPhone 홈 인디케이터, Android
// 제스처/버튼 내비게이션 바)를 고려하지 않고 고정 height만 쓰고 있어 라벨이 화면
// 아래로 잘리거나 시스템 내비게이션 영역과 겹치는 문제가 있었다. useSafeAreaInsets()의
// insets.bottom을 실제 padding/height 계산에 반영해 기기별로 안전하게 확보한다
// (react-native-safe-area-context는 이미 설치된 dependency — 새 패키지 추가 없음).
const TAB_ICON_SIZE = 22;
// [STEP: 2026-09-09 세 번째 수정] 하단 탭 라벨 글자 잘림 — 처음엔 상단이, 이전
// 수정(lineHeight 15→20px) 이후엔 반대로 하단이 잘리는 것을 실기기 스크린샷으로
// 재확인했다. 개발자도구로 정확히 추적한 결과: 라벨 DOM(react-native-web이
// numberOfLines=1을 구현하는 방식)은 height가 우리가 지정한 lineHeight 값과
// 정확히 같고 overflow:hidden이 걸린다 — 그 박스를 감싸는 모든 상위 요소는
// overflow:visible이라 바깥에서 잘리는 게 아니라, 라벨 박스 "그 자체" 안에서
// 실제 글리프 잉크 높이가 지정한 lineHeight보다 커서 위/아래 중 한쪽이 잘린다.
// 15px→20px로 5px만 늘렸을 때도 여전히 부족했다는 뜻이라, 조금씩 올리는 시행착오
// 대신 한글 11px 글꼴이 실제로 필요로 하는 높이보다 명백히 넉넉한 값(약 2.7배)으로
// 한 번에 크게 올린다 — 어떤 폰트 메트릭이어도 위아래 모두 여유가 남도록.
// react-navigation 탭 아이템 자체에도 우리가 지정하지 않은 내부 padding(약
// 5px 상/하)이 있다는 것도 개발자도구로 함께 확인했다 — 그만큼까지 포함해
// 전체 탭바 높이를 넉넉히 늘려 라벨이 커져도 탭바 흰 배경 영역 안에 들어오게 한다.
const TAB_BAR_CONTENT_HEIGHT = 68;

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: "home-outline",
  property: "business-outline",
  invest: "trending-up-outline",
  ai: "sparkles-outline",
  my: "person-outline",
};

const ICONS_ACTIVE: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: "home",
  property: "business",
  invest: "trending-up",
  ai: "sparkles",
  my: "person",
};

export default function TabsLayout() {
  const { t } = useTranslation();
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const insets = useSafeAreaInsets();
  // 사용자 요청(2026-09-09): 하단 탭바 padding을 "4px 0px 8px" → "4px 0px 4px"로 —
  // 안전영역이 없는 기기(이 값의 하한선)에서의 paddingBottom을 8px(spacing.sm)에서
  // 4px(spacing.xs)로 줄인다. 실제 홈 인디케이터/제스처 바가 있는 기기에서는
  // insets.bottom이 이보다 크면 그 값을 그대로 쓰므로 안전 영역 자체는 계속 보장된다.
  const bottomInset = Math.max(insets.bottom, spacing.xs);

  function renderIcon(key: keyof typeof ICONS) {
    // STEP 4-10A-1: 이름 없는 함수를 그대로 return하면 eslint(react/display-name)가
    // "컴포넌트에 표시 이름이 없다"고 판단한다. named const로 한 번 바인딩한 뒤
    // 반환하면 동일하게 동작하면서 표시 이름을 얻는다 — 별도 컴포넌트 파일 분리 등
    // 불필요한 구조 변경 없이 가장 단순한 방식으로 해결한다.
    const TabIcon = ({ color, focused }: { color: string; focused: boolean }) => (
      <Ionicons name={focused ? ICONS_ACTIVE[key] : ICONS[key]} color={color} size={TAB_ICON_SIZE} />
    );
    return TabIcon;
  }

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.secondaryText,
        tabBarLabelStyle: {
          fontSize: textStyles.navLabel.fontSize,
          fontWeight: textStyles.navLabel.fontWeight,
          // 위 TAB_BAR_CONTENT_HEIGHT 주석 참고 — 1.8배(20px)로도 부족해서
          // (이번엔 반대쪽이 잘림) 훨씬 더 넉넉한 배율로 올린다.
          lineHeight: Math.round(textStyles.navLabel.fontSize * 2.7),
        },
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          // 콘텐츠 높이(아이콘+라벨) + 기기별 실제 하단 Safe Area — 라벨이 화면 밖으로
          // 잘리거나 Android 시스템 내비게이션 바와 겹치지 않도록 한다.
          height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
          paddingTop: spacing.xs,
          paddingBottom: bottomInset,
        },
        tabBarItemStyle: {
          paddingVertical: spacing.xs / 2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("tabs.home"),
          tabBarIcon: renderIcon("home"),
        }}
      />
      <Tabs.Screen
        name="property"
        options={{
          title: t("tabs.property"),
          tabBarIcon: renderIcon("property"),
        }}
      />
      <Tabs.Screen
        name="invest"
        options={{
          title: t("tabs.invest"),
          tabBarIcon: renderIcon("invest"),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: t("tabs.ai"),
          tabBarIcon: renderIcon("ai"),
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: t("tabs.my"),
          tabBarIcon: renderIcon("my"),
        }}
      />
    </Tabs>
  );
}
