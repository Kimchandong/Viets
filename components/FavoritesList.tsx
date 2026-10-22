import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { InvestmentCard } from "@/components/InvestmentCard";
import { PropertyListRow } from "@/components/PropertyListRow";
import { createScaledStyles, colors, spacing } from "@/constants/theme";
import type { MockInvestmentProduct, MockProperty } from "@/constants/mockData";
import { getInvestmentProductsByIds } from "@/services/investments";
import { getPropertiesByIds } from "@/services/properties";
import { useFavoritesStore } from "@/store/useFavoritesStore";

/**
 * [2026-10-22 사용자 지시] 관심목록 영역을 MY에서 없애고 매물관리·투자관리 탭으로
 * 옮긴다. MY 화면 안에 펼침 목록으로 박혀 있던 코드를 그대로 두면 두 곳에서 같은
 * 목록을 따로 그리게 되므로, 목록을 이 컴포넌트 하나로 모은다.
 *
 * 찜 목록(store)은 매물/투자상품의 id만 갖고 있다 — 실제 내용은 id로 다시 조회한다.
 */
export function FavoritesList({ kind }: { kind: "property" | "invest" }) {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const favorites = useFavoritesStore((state) => state.favorites);

  const ids = useMemo(() => {
    const prefix = kind === "property" ? "property:" : "investment_product:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [favorites, kind]);

  const [properties, setProperties] = useState<MockProperty[]>([]);
  const [products, setProducts] = useState<MockInvestmentProduct[]>([]);

  useEffect(() => {
    let mounted = true;
    if (ids.length === 0) {
      setProperties([]);
      setProducts([]);
      return;
    }
    if (kind === "property") {
      getPropertiesByIds(ids).then((result) => {
        if (mounted) setProperties(result);
      });
    } else {
      getInvestmentProductsByIds(ids).then((result) => {
        if (mounted) setProducts(result);
      });
    }
    return () => {
      mounted = false;
    };
  }, [ids, kind]);

  const empty = kind === "property" ? properties.length === 0 : products.length === 0;
  if (empty) {
    return (
      <EmptyState
        title={kind === "property" ? t("my.noFavoriteProperties") : t("my.noFavoriteInvestments")}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {kind === "property"
        ? properties.map((property, index) => (
            <PropertyListRow
              key={property.id}
              property={property}
              showDivider={index > 0}
              onPress={() => router.push(`/property-detail/${property.id}`)}
            />
          ))
        : products.map((product) => (
            <InvestmentCard
              key={product.id}
              product={product}
              variant="list"
              onPress={() => router.push(`/invest-detail/${product.id}`)}
            />
          ))}
      <Text style={styles.spacer} />
    </ScrollView>
  );
}

const styles = createScaledStyles(() => ({
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  spacer: {
    height: spacing.lg,
  },
}));
