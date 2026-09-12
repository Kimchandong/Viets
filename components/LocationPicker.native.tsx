import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";

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

// 좌표가 아직 없고 **현재 위치도 모를 때**의 첫 시점 — 호치민시 중심(PropertyMap과 동일).
//
// [2026-09-12 실기기 테스트에서 발견] 예전에는 언제나 여기서 시작했다. 하노이에서
// 매물을 등록하는 사람이 지도를 열면 1,100km 떨어진 호치민이 떠서, 자기 위치를
// 찾아 한참 끌어야 했다. 아래 useEffect가 현재 위치를 알아내면 그쪽으로 옮긴다.
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
  /**
   * [2026-09-12] 좌표가 아직 없을 때 지도를 **현재 위치**에서 시작한다.
   *
   * getLastKnownPositionAsync를 쓰는 이유: 위성을 새로 잡지 않고 기기가 이미 알고
   * 있는 값을 즉시 돌려준다. 지도 첫 화면을 맞추는 데는 몇 백 미터 오차가 문제되지
   * 않고, 등록자는 어차피 눌러서 정확한 지점을 찍는다.
   *
   * 권한이 없으면 null이 돌아오고 호치민 기본값이 그대로 쓰인다 — 여기서 권한을
   * 다시 묻지 않는다(앱 시작 때 이미 물었다. 폼 한가운데서 팝업이 뜨면 놀란다).
   */
  const [myRegion, setMyRegion] = useState<Coordinate | null>(null);
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

  useEffect(() => {
    let active = true;
    if (hasCoordinate) return;

    Location.getLastKnownPositionAsync()
      .then((position) => {
        if (!active || !position) return;
        const here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setMyRegion(here);
        mapRef.current?.animateToRegion({ ...here, latitudeDelta: PICKED_DELTA, longitudeDelta: PICKED_DELTA }, 300);
      })
      .catch(() => {
        // 위치를 못 잡아도 지도는 떠야 한다 — 기본값 그대로 둔다.
      });

    return () => {
      active = false;
    };
  }, [hasCoordinate]);

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
    : myRegion
      ? { ...myRegion, latitudeDelta: PICKED_DELTA, longitudeDelta: PICKED_DELTA }
      : FALLBACK_REGION;

  return (
    <View style={styles.wrapper}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={[styles.map, { height }]}
        initialRegion={initialRegion}
        onPress={handleMapPress}
        // [2026-09-12 사용자 지시] 내 위치를 파란 점으로 표시하고, 지도를 옮긴 뒤
        // 한 번에 돌아올 수 있도록 '내 위치' 버튼도 켠다.
        showsUserLocation
        showsMyLocationButton
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
