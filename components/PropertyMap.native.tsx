import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import type { MockProperty } from "@/constants/mockData";
import { radius, spacing, textStyles, type ThemeColors } from "@/constants/theme";

/**
 * [STEP 04-지도] 매물 지도 뷰(네이티브 전용).
 *
 * react-native-maps는 웹을 지원하지 않으므로 이 파일은 .native 확장자로 두고,
 * 웹에서는 Metro가 자동으로 PropertyMap.web.tsx를 대신 번들한다 — 호출부
 * (app/(tabs)/property.tsx)는 플랫폼 분기 없이 "@/components/PropertyMap"만
 * import한다.
 *
 * 좌표(latitude/longitude)가 없는 매물은 마커를 찍을 수 없으므로 제외하고,
 * 제외된 건수를 화면 하단에 정직하게 표시한다(임의 좌표를 지어내지 않는다).
 */

type Props = {
  properties: MockProperty[];
  onSelectProperty: (property: MockProperty) => void;
  theme: ThemeColors;
  emptyLabel: string;
  missingCoordsLabel: (count: number) => string;
  /** 지도 높이(px). 매물 목록 탭은 기본값(320), 상세 화면의 "위치" 섹션은 더 낮게 쓴다. */
  height?: number;
};

// 좌표가 하나도 없을 때의 기본 시점 — 호치민시 중심.
const FALLBACK_REGION = {
  latitude: 10.7769,
  longitude: 106.7009,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

export function PropertyMap({
  properties,
  onSelectProperty,
  theme,
  emptyLabel,
  missingCoordsLabel,
  height = 320,
}: Props) {
  const mappable = properties.filter(
    (property) => property.latitude !== undefined && property.longitude !== undefined,
  );
  const missingCount = properties.length - mappable.length;

  const region = computeRegion(mappable);

  if (mappable.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <MapView provider={PROVIDER_GOOGLE} style={[styles.map, { height }]} initialRegion={region}>
        {mappable.map((property) => (
          <Marker
            key={property.id}
            coordinate={{ latitude: property.latitude!, longitude: property.longitude! }}
            title={property.title}
            description={property.price}
            onCalloutPress={() => onSelectProperty(property)}
          />
        ))}
      </MapView>
      {missingCount > 0 ? (
        <Text style={[textStyles.caption, styles.note, { color: theme.secondaryText }]}>
          {missingCoordsLabel(missingCount)}
        </Text>
      ) : null}
    </View>
  );
}

/** 마커들이 모두 보이도록 중심/범위를 계산한다(최소 delta로 과도한 확대를 막는다). */
function computeRegion(properties: MockProperty[]) {
  if (properties.length === 0) return FALLBACK_REGION;

  const lats = properties.map((property) => property.latitude!);
  const lngs = properties.map((property) => property.longitude!);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // 여백 1.4배 + 최소값 0.02(약 2km) — 매물이 1건이면 범위가 0이 되어버린다.
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  map: {
    height: 320,
    borderRadius: radius.md,
  },
  placeholder: {
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  note: {
    textAlign: "center",
  },
});
