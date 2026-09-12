import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { opacity, radius, spacing, textStyles, ThemeColors } from "@/constants/theme";
import type { MockProperty } from "@/constants/mockData";
import { distanceKm } from "@/services/location";
import { formatVndAmount } from "@/utils/format";

/**
 * [2026-09-12 사용자 지시] 정렬·조건 칩을 홈에서 **부동산 탭의 '일반 매물'로 옮긴다.**
 *
 * 홈의 TOP10은 유료 광고 10칸 고정이 되었다 — 순위를 돈으로 산 자리에 정렬을 얹으면
 * 산 순위가 뒤바뀌므로 홈에서는 칩 자체가 의미를 잃었다. 반면 부동산 탭의 '일반 매물'은
 * 광고가 아닌 목록이라 거리·조건·금액으로 고르는 것이 자연스럽다.
 *
 * 그래서 화면 두 곳에 흩어져 있던 것을 옮기는 대신 **한 곳으로 모아 컴포넌트로 뺐다**.
 * 예전에는 칩 UI·두 팝업·CountPicker·PriceSlider가 전부 home.tsx 안에 있어서, 같은
 * 것을 다른 화면에서 쓰려면 통째로 복사해야 했다(복사하면 한쪽만 고치는 일이 생긴다).
 */

export type PropertySortMode = "distance" | "condition" | "price";

export type PropertySortState = {
  mode: PropertySortMode;
  minBedrooms: number;
  minBathrooms: number;
  priceMax: number;
};

/** 금액 막대의 상한 — 0 ~ 100억동. */
export const PRICE_MAX_VND = 10_000_000_000;

export const DEFAULT_PROPERTY_SORT: PropertySortState = {
  mode: "distance",
  minBedrooms: 0,
  minBathrooms: 0,
  priceMax: PRICE_MAX_VND,
};

/**
 * 목록에 정렬·조건을 적용한다.
 *
 * 서버가 아니라 화면에서 한다 — 거리 기준점이 기기마다 다르고 사용자가 즉시 바꾸므로,
 * 서버에 맡기면 칩을 누를 때마다 다시 조회해야 한다.
 */
export function applyPropertySort(
  list: MockProperty[],
  state: PropertySortState,
  coords: { latitude: number; longitude: number } | null,
): MockProperty[] {
  if (state.mode === "condition") {
    return list.filter(
      (property) =>
        (property.bedrooms ?? 0) >= state.minBedrooms &&
        (property.bathrooms ?? 0) >= state.minBathrooms,
    );
  }

  if (state.mode === "price") {
    return list
      .filter((property) => property.priceValueVnd <= state.priceMax)
      .sort((a, b) => a.priceValueVnd - b.priceValueVnd);
  }

  // 거리순 — 기준점이 없거나 좌표가 없는 매물은 뒤로 보낸다(원래 순서 유지).
  if (!coords) return list;
  return list
    .map((property) => ({
      property,
      km:
        property.latitude !== undefined && property.longitude !== undefined
          ? distanceKm(coords, { latitude: property.latitude, longitude: property.longitude })
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.km - b.km)
    .map((entry) => entry.property);
}

/**
 * 칩 3개 + 팝업 2개.
 *
 * 거리순은 팝업 없이 바로 적용되지만, 기준 위치가 없으면 먼저 위치를 정하게 한다 —
 * 기준 없는 "가까운 순"은 거짓말이다(onNeedLocation).
 */
export function PropertySortControls({
  value,
  onChange,
  theme,
  hasLocation,
  onNeedLocation,
  style,
}: {
  value: PropertySortState;
  onChange: (next: PropertySortState) => void;
  theme: ThemeColors;
  hasLocation: boolean;
  onNeedLocation: () => void;
  style?: object;
}) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<PropertySortMode | null>(null);
  // 팝업에서 고르는 동안의 임시값 — 취소하면 원래대로 돌아가야 한다.
  const [draftBedrooms, setDraftBedrooms] = useState(value.minBedrooms);
  const [draftBathrooms, setDraftBathrooms] = useState(value.minBathrooms);
  const [draftPriceMax, setDraftPriceMax] = useState(value.priceMax);

  function openSheet(mode: PropertySortMode) {
    if (mode === "condition") {
      setDraftBedrooms(value.minBedrooms);
      setDraftBathrooms(value.minBathrooms);
    } else if (mode === "price") {
      setDraftPriceMax(value.priceMax);
    }
    setSheet(mode);
  }

  return (
    <>
      <View style={[styles.sortRow, style]}>
        {(["distance", "condition", "price"] as PropertySortMode[]).map((mode) => {
          const active = value.mode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => {
                if (mode === "distance") {
                  onChange({ ...value, mode: "distance" });
                  if (!hasLocation) onNeedLocation();
                  return;
                }
                openSheet(mode);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.sortChip,
                {
                  borderColor: active ? theme.accent : theme.border,
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[textStyles.caption, { color: active ? theme.accent : theme.secondaryText }]}
              >
                {t(`home.sort.${mode}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 조건별 — 방수/화장실수 최소값을 고른다. */}
      <Modal visible={sheet === "condition"} onClose={() => setSheet(null)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
          {t("home.sort.condition")}
        </Text>
        <CountPicker
          label={t("home.sort.bedrooms")}
          value={draftBedrooms}
          onChange={setDraftBedrooms}
          theme={theme}
        />
        <CountPicker
          label={t("home.sort.bathrooms")}
          value={draftBathrooms}
          onChange={setDraftBathrooms}
          theme={theme}
        />
        <View style={styles.sheetActions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setSheet(null)}
            style={styles.sheetButton}
          />
          <Button
            title={t("common.confirm")}
            onPress={() => {
              onChange({
                ...value,
                mode: "condition",
                minBedrooms: draftBedrooms,
                minBathrooms: draftBathrooms,
              });
              setSheet(null);
            }}
            style={styles.sheetButton}
          />
        </View>
      </Modal>

      {/* 금액별 — 0원부터 고른 값까지. 막대를 끌어 상한을 정한다. */}
      <Modal visible={sheet === "price"} onClose={() => setSheet(null)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("home.sort.price")}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
          {t("home.sort.priceRange", { max: formatVndAmount(draftPriceMax) })}
        </Text>
        <PriceSlider value={draftPriceMax} onChange={setDraftPriceMax} theme={theme} />
        <View style={styles.sheetActions}>
          <Button
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setSheet(null)}
            style={styles.sheetButton}
          />
          <Button
            title={t("common.confirm")}
            onPress={() => {
              onChange({ ...value, mode: "price", priceMax: draftPriceMax });
              setSheet(null);
            }}
            style={styles.sheetButton}
          />
        </View>
      </Modal>
    </>
  );
}

/** 조건별 팝업의 "N개 이상" 선택 — 0(무관)부터 4까지. */
function CountPicker({
  label,
  value,
  onChange,
  theme,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  theme: ThemeColors;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.countBlock}>
      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{label}</Text>
      <View style={styles.countRow}>
        {[0, 1, 2, 3, 4].map((n) => {
          const active = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.countChip,
                {
                  borderColor: active ? theme.accent : theme.border,
                  backgroundColor: active ? theme.accent : "transparent",
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[textStyles.caption, { color: active ? theme.onAccent : theme.secondaryText }]}
              >
                {n === 0 ? t("home.sort.any") : `${n}+`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * 금액 막대 — 0 ~ 100억동.
 *
 * 슬라이더 라이브러리를 추가하지 않고 PanResponder로 직접 만든다(사용자 결정).
 * 폭을 onLayout으로 재는 이유: 퍼센트만으로는 손가락 x좌표를 값으로 바꿀 수 없다.
 * 폭을 재기 전(0)에는 나누기를 하지 않는다 — 0으로 나누면 NaN이 되어 막대가 사라진다.
 */
function PriceSlider({
  value,
  onChange,
  theme,
}: {
  value: number;
  onChange: (next: number) => void;
  theme: ThemeColors;
}) {
  const [width, setWidth] = useState(0);
  // PanResponder는 처음 만들어진 클로저를 계속 쓰므로, 최신 폭을 ref로 읽는다.
  const widthRef = useRef(0);
  widthRef.current = width;
  // onChange도 마찬가지 — 처음 만들어진 함수를 계속 부르면 취소 후 다시 연 팝업에서
  // 예전 setState를 부르게 된다.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        const w = widthRef.current;
        if (w > 0) onChangeRef.current(clampToStep((event.nativeEvent.locationX / w) * PRICE_MAX_VND));
      },
      onPanResponderMove: (event) => {
        const w = widthRef.current;
        if (w <= 0) return;
        onChangeRef.current(clampToStep((event.nativeEvent.locationX / w) * PRICE_MAX_VND));
      },
    }),
  ).current;

  const ratio = width > 0 ? Math.min(1, Math.max(0, value / PRICE_MAX_VND)) : 0;

  return (
    <View style={styles.sliderBlock}>
      {/* [2026-09-12 사용자 지시] 손잡이 바로 위에 지금 고른 금액을 띄운다.
          막대만 있으면 어디까지 끌었는지 눈으로만 재게 되고, 위쪽 안내문은 시선이
          손가락에서 멀어 끄는 동안 읽히지 않는다. 말풍선은 고정 폭을 주고 그 절반만큼
          왼쪽으로 당겨 손잡이 중앙에 맞춘다 — 글자 폭에 따라 중심이 흔들리지 않는다. */}
      <View
        pointerEvents="none"
        style={[
          styles.sliderValue,
          {
            left: `${ratio * 100}%`,
            backgroundColor: theme.accent,
          },
        ]}
      >
        <Text numberOfLines={1} style={[textStyles.caption, styles.sliderValueText, { color: theme.onAccent }]}>
          {formatVndAmount(value)}
        </Text>
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        {...responder.panHandlers}
        style={[styles.sliderTrack, { backgroundColor: theme.border }]}
      >
        <View style={[styles.sliderFill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]} />
        <View
          style={[
            styles.sliderKnob,
            { left: `${ratio * 100}%`, backgroundColor: theme.accent, borderColor: theme.onAccent },
          ]}
        />
      </View>
      <View style={styles.sliderScale}>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>0</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {formatVndAmount(PRICE_MAX_VND)}
        </Text>
      </View>
    </View>
  );
}

/** 금액 말풍선의 고정 폭 — 손잡이 중앙에 맞추려면 폭을 알아야 한다. */
const SLIDER_VALUE_WIDTH = 110;

/** 1억동 단위로 끊는다 — 1원 단위로 움직이면 값이 읽히지 않는다. */
function clampToStep(raw: number): number {
  const step = 100_000_000;
  const clamped = Math.min(PRICE_MAX_VND, Math.max(0, raw));
  return Math.round(clamped / step) * step;
}

const styles = StyleSheet.create({
  sortRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  sortChip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBlock: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  countRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  countChip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 6,
  },
  sliderBlock: {
    marginTop: spacing.lg,
    gap: spacing.xs,
    // 말풍선이 막대 위로 올라오므로 그만큼 자리를 비워 둔다.
    paddingTop: spacing.lg,
  },
  sliderValue: {
    position: "absolute",
    top: 0,
    width: SLIDER_VALUE_WIDTH,
    marginLeft: -SLIDER_VALUE_WIDTH / 2,
    alignItems: "center",
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  sliderValueText: {
    fontWeight: "600",
  },
  sliderTrack: {
    height: 6,
    borderRadius: radius.full,
    justifyContent: "center",
    // 손잡이가 막대 밖으로 나가므로 세로 여백을 둬 터치 영역을 넓힌다.
    marginVertical: spacing.sm,
  },
  sliderFill: {
    height: 6,
    borderRadius: radius.full,
  },
  sliderKnob: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: radius.full,
    borderWidth: 2,
    marginLeft: -10,
  },
  sliderScale: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  sheetButton: {
    flex: 1,
  },
});
