import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGUAGES } from "@/i18n";
import { translateOnce } from "@/services/contentTranslation";
import { localizedText } from "@/utils/format";

/**
 * [2026-09-28 사용자 지시] 설명 글은 **입력 언어와 무관하게 보는 사람의 언어로** 보여야 한다.
 *
 * 등록 화면은 이미 저장 시점에 6개 언어를 만들어 둔다(services/contentTranslation.ts).
 * 그런데 그렇지 않은 글이 남아 있다:
 *   · 이 기능이 생기기 전에 등록된 매물
 *   · SQL로 직접 넣은 매물(테스트 데이터 등)
 *   · 등록 당시 번역 API가 실패한 언어
 * 이 글들은 localizedText()가 원문으로 폴백해서, 한국어로 쓴 설명이 베트남어 사용자에게
 * 한국어 그대로 보였다.
 *
 * 그래서 **볼 때 없으면 그 자리에서 번역한다.** 저장은 하지 않는다 — properties UPDATE는
 * 관리자·등록 업체만 되므로(RLS), 보는 사람이 쓰려 하면 어차피 막힌다. 대신 앱이 켜져
 * 있는 동안은 메모리에 캐시해 같은 글을 다시 부르지 않는다.
 *
 * @param map     언어코드 → 문장 (services의 toContentMap 결과)
 * @param cacheKey 이 글을 가리키는 고유 키. 보통 `property:<id>` 형태.
 */
export function useLocalizedContent(
  // MockProperty.description이 Partial<Record<...>>라 그대로 받는다.
  map: Partial<Record<string, string>>,
  cacheKey: string,
): { text: string; translating: boolean } {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "").split("-")[0];

  // 이미 그 언어로 저장돼 있으면 번역이 필요 없다.
  const stored = map[lang];
  const fallback = localizedText(map, lang);

  // map은 화면이 그려질 때마다 새 객체다(toContentMap이 매번 만든다). 그대로 의존성에
  // 넣으면 effect가 매 렌더 돈다 — 안에서 쓰는 값만 문자열로 꺼내 의존성으로 쓴다.
  const source = findSource(map);
  const sourceText = source?.text ?? "";
  const sourceLang = source?.lang ?? "";

  const [text, setText] = useState(stored ?? fallback);
  const [translating, setTranslating] = useState(false);
  // 한 번 실패한 조합을 화면이 다시 그려질 때마다 재시도하지 않는다.
  const attempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const cacheId = `${cacheKey}:${lang}`;

    if (stored) {
      setText(stored);
      return;
    }
    const cached = MEMORY_CACHE.get(cacheId);
    if (cached !== undefined) {
      setText(cached);
      return;
    }
    // 번역할 원문이 없거나, 지원하지 않는 언어면 그대로 둔다.
    if (sourceText.length === 0 || !(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
      setText(fallback);
      return;
    }
    if (attempted.current.has(cacheId)) {
      setText(fallback);
      return;
    }
    attempted.current.add(cacheId);

    let active = true;
    setText(fallback); // 번역이 오기 전에는 원문을 보여 준다(빈 화면 금지)
    setTranslating(true);
    translateOnce(sourceText, sourceLang, lang)
      .then((translated) => {
        if (!active) return;
        if (translated) {
          MEMORY_CACHE.set(cacheId, translated);
          setText(translated);
        }
      })
      .finally(() => {
        if (active) setTranslating(false);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, lang, stored, fallback, sourceText, sourceLang]);

  return { text, translating };
}

/** 앱이 켜져 있는 동안 유지되는 번역 캐시. 키는 `<cacheKey>:<lang>`. */
const MEMORY_CACHE = new Map<string, string>();

/**
 * 번역의 원문으로 쓸 문장과 그 언어를 고른다.
 *
 * toContentMap()이 원문을 "원문 언어" 자리에 넣어 두므로, 맵에 실제로 들어 있는
 * 항목 중 아무거나 쓰면 된다 — 저장된 번역이 있으면 그것도 원문만큼 정확하다.
 * vi를 먼저 보는 이유: 원문 언어를 모르는 기존 데이터가 vi 자리에 들어간다.
 */
function findSource(map: Partial<Record<string, string>>): { text: string; lang: string } | null {
  for (const lang of ["vi", ...SUPPORTED_LANGUAGES]) {
    const text = map[lang];
    if (text && text.trim().length > 0) return { text, lang };
  }
  return null;
}
