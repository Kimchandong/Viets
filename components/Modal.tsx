import { Modal as RNModal, Pressable, StyleProp, StyleSheet, ViewStyle } from "react-native";

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
 */
export function Modal({ visible, onClose, children, style, accessibilityLabel }: ModalProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <RNModal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {/* 콘텐츠 영역에서는 탭이 backdrop으로 전파되지 않도록 별도 Pressable로 감싼다 */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.content, shadow.raised, { backgroundColor: theme.card }, style]}
        >
          {children}
        </Pressable>
      </Pressable>
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
