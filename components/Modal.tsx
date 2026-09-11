import { Modal as RNModal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { colors, radius, shadow, spacing } from "@/constants/theme";

export type ModalProps = {
  visible: boolean;
  /** backdrop을 누르거나 Android back 버튼을 눌렀을 때 호출된다. */
  onClose?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * backdrop(닫기 영역)의 접근성 라벨. 특정 언어 문자열을 이 컴포넌트 내부에 하드코딩하지
   * 않으므로, 스크린리더용 설명이 필요하면 호출부가 i18n으로 번역한 문자열을 전달한다.
   * 전달하지 않으면 라벨 없이 accessibilityRole="button"만 유지된다.
   */
  accessibilityLabel?: string;
};

/**
 * React Native 기본 Modal을 감싼 최소 구현. 별도 dependency를 추가하지 않으며,
 * 전역 Modal manager(큐잉/스택 관리 등)는 만들지 않는다 — 화면마다 필요한 곳에서
 * visible 상태를 직접 관리해 사용한다(예: Search/Notification 오버레이, 향후 Phase).
 *
 * [2026-09-11 사용자 제보] "게시판 글쓰기에서 스페이스바를 누르면 창이 닫힘".
 *
 * 원인: 예전 구조는 닫기용 Pressable이 **콘텐츠를 감싸고** 있었고, 거기에
 * accessibilityRole="button"이 붙어 있었다. react-native-web은 role="button"인
 * 요소를 키보드로 활성화할 수 있게 만들어(Enter/Space를 클릭으로 처리) 두는데,
 * 입력창에서 누른 스페이스 키 이벤트가 DOM 상위로 전파되면서 그 "버튼"을 눌러
 * onClose가 불렸다. 안쪽 Pressable의 event.stopPropagation()은 터치/클릭만 막고
 * 키 이벤트는 막지 못한다.
 *
 * 그래서 닫기 영역을 콘텐츠의 **부모가 아니라 형제**로 바꿨다. 콘텐츠보다 먼저
 * 그려진 absoluteFill Pressable이 바깥 여백을 덮어 탭하면 닫히는 동작은 그대로고,
 * 콘텐츠 안에서 일어난 키 이벤트는 그 Pressable을 지나가지 않는다. 콘텐츠는 이제
 * 눌림을 처리할 필요가 없으므로 평범한 View다.
 *
 * 이 컴포넌트는 언어/통화 선택, 관리자 심사, 매물 상태 변경 등 여러 화면이 함께
 * 쓰므로, 입력창이 있는 모든 모달이 같이 고쳐진다.
 */
export function Modal({ visible, onClose, children, style, accessibilityLabel }: ModalProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <RNModal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        />
        <View style={[styles.content, shadow.raised, { backgroundColor: theme.card }, style]}>
          {children}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  content: {
    width: "100%",
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
