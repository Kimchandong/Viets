import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import { radius, spacing, textStyles, type ThemeColors } from "@/constants/theme";

/**
 * [STEP 04-위치선택] 매물 등록 화면의 지도 위치 지정(네이티브 전용).
 *
 * 배경(2026-09-11 사용자 요구사항): 베트남 매물은 상세주소를 끝까지 적지 않는 경우가
 * 많아 주소 문자열만으로는 위치를 특정할 수 없다. 그래서 등록자가 **지도에서 직접
 * 마커를 찍어** 좌표를 지정하게 한다 — 이 좌표가 매물 목록/상세의 지도 표시
 * (components/PropertyMap)와 properties_geom_sync 트리거의 입력이 된다.
 *
 * 조작: 지도를 누르면 그 지점에 마커가 생기고, 마커를 끌어서 미세 조정한다.
 * 좌표가 아직 없으면 마커를 그리지 않는다(임의 위치를 기본값으로 찍지 않는다).
 *
 * PropertyMap과 같은 이유로 `.native.tsx` / 확장자 없는 `.tsx` 두 벌로 나눈다 —
 * react-native-maps는 웹을 지원하지 않고, tsc는 `.web.tsx`를 해석하지 못한다.
 */

type Coordinate = { latitude: number; longitude: number };

// 지도/마커 이벤트 타입을 react-native-maps에서 import하지 않고 필요한 만큼만 적는다 —
// 타입 이름(MapPressEvent 등)이 라이브러리 버전에 따라 달라져 빌드가 깨질 수 있다.
type CoordinateEvent = { nativeEvent: { coordinate: Coordinate } };

export type LocationPickerProps = {
  /** 현재 지정된 좌표. 둘 중 하나라도 없으면 "미지정"으로 취급한다. */
  latitude?: number;
  longitude?: number;
  onChange: (coordinate: Coordinate) => void;
  theme: ThemeColors;
  /** 지도 아래 안내 문구(호출부에서 번역해 전달한다 — 컴포넌트는 i18n을 모른다). */
  hintLabel: string;
  /** 웹 구현에서만 쓰인다(여기서는 사용하지 않지만 props 타입을 맞춘다). */
  unavailableLabel: string;
  height?: number;
};

// 좌표가 아직 없을 때의 첫 시점 — 호치민시 중심(PropertyMap과 동일).
const FALLBACK_REGION = {
  latitude: 10.7769,
  longitude: 106.7009,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

/** 마커를 찍은 뒤의 확대 수준 — 건물 단위로 조정할 수 있을 정도. */
const PICKED_DELTA = 0.01;

export function LocationPicker({
  latitude,
  longitude,
  onChange,
  theme,
  hintLabel,
  height = 260,
}: LocationPickerProps) {
  const mapRef = useRef<MapView | null>(null);
  // 지도 자체에서 찍은 좌표인지, 바깥(수정 모드 로딩·좌표 직접 입력)에서 들어온
  // 좌표인지 구분한다 — 후자일 때만 지도를 그 위치로 옮긴다. 이 구분이 없으면
  // 사용자가 지도를 누를 때마다 화면이 다시 중앙으로 튕긴다.
  const selfPicked = useRef<string | null>(null);

  const hasCoordinate = latitude !== undefined && longitude !== undefined;

  useEffect(() => {
    if (!hasCoordinate || !mapRef.current) return;

    const key = `${latitude},${longitude}`;
    if (selfPicked.current === key) return;

    mapRef.current.animateToRegion(
      {
        latitude: latitude as number,
        longitude: longitude as number,
        latitudeDelta: PICKED_DELTA,
        longitudeDelta: PICKED_DELTA,
      },
      300,
    );
  }, [hasCoordinate, latitude, longitude]);

  function emit(coordinate: Coordinate) {
    selfPicked.current = `${coordinate.latitude},${coordinate.longitude}`;
    onChange(coordinate);
  }

  function handleMapPress(event: CoordinateEvent) {
    emit(event.nativeEvent.coordinate);
  }

  function handleMarkerDragEnd(event: CoordinateEvent) {
    emit(event.nativeEvent.coordinate);
  }

  const initialRegion = hasCoordinate
    ? {
        latitude: latitude as number,
        longitude: longitude as number,
        latitudeDelta: PICKED_DELTA,
        longitudeDelta: PICKED_DELTA,
      }
    : FALLBACK_REGION;

  return (
    <View style={styles.wrapper}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={[styles.map, { height }]}
        initialRegion={initialRegion}
        onPress={handleMapPress}
      >
        {hasCoordinate ? (
          <Marker
            coordinate={{ latitude: latitude as number, longitude: longitude as number }}
            draggable
            onDragEnd={handleMarkerDragEnd}
          />
        ) : null}
      </MapView>
      <Text style={[textStyles.caption, styles.hint, { color: theme.secondaryText }]}>{hintLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  map: {
    height: 260,
    borderRadius: radius.md,
  },
  hint: {
    textAlign: "center",
  },
});
