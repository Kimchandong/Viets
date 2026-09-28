import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGUAGES } from "@/i18n";
import { translateStoredContent, type TranslatableContentKind } from "@/services/contentTranslation";
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
 * 그래서 **볼 때 없으면 그 자리에서 번역한다.**
 *
 * [2026-09-28 수정] 번역을 서버(translate-content)가 하고 그 결과를 매물 행에
 * 저장한다. 예전에는 앱이 번역해 메모리에만 두었는데, 두 가지가 잘못됐다:
 *   · 앱을 껐다 켜면 사라져 사용자마다 같은 글을 다시 번역했다.
 *   · translate 함수는 익명 호출을 막는다 — 매물 상세는 로그인 없이 볼 수 있으므로,
 *     비로그인 사용자에게는 번역이 **한 번도** 되지 않았다.
 * 이제 한 번 번역되면 행에 남아 모두가 그대로 읽는다.
 *
 * @param map  언어코드 → 문장 (services의 toContentMap 결과)
 * @param kind 어느 표의 글인가 — 서버가 원문을 읽을 곳
 * @param id   그 행의 id. 비어 있으면(아직 로딩 중) 번역하지 않는다.
 */
export function useLocalizedContent(
  // MockProperty.description이 Partial<Record<...>>라 그대로 받는다.
  map: Partial<Record<string, string>>,
  kind: TranslatableContentKind,
  id: string | undefined,
): { text: string; translating: boolean } {
  const cacheKey = `${kind}:${id ?? ""}`;
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "").split("-")[0];

  // 이미 그 언어로 저장돼 있으면 번역이 필요 없다.
  const stored = map[lang];
  const fallback = localizedText(map, lang);

  // map은 화면이 그려질 때마다 새 객체다(toContentMap이 매번 만든다). 그대로 의존성에
  // 넣으면 effect가 매 렌더 돈다 — 안에서 쓰는 값만 문자열로 꺼내 의존성으로 쓴다.
  // 원문 언어는 더 이상 필요 없다 — 서버가 행에서 읽는다. 여기서는 "번역할 글이
  // 있기는 한가"만 본다(빈 설명이면 서버를 부르지 않는다).
  const sourceText = findSource(map)?.text ?? "";

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
    // id가 없으면(아직 로딩 중) 서버가 원문을 찾을 수 없다.
    if (
      !id
      || sourceText.length === 0
      || !(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
    ) {
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
    translateStoredContent(kind, id, lang)
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
  }, [cacheKey, kind, id, lang, stored, fallback, sourceText]);

  return { text, translating };
}

/** 앱이 켜져 있는 동안 유지되는 번역 캐시. 키는 `<cacheKey>:<lang>`. */
const MEMORY_CACHE = new Map<string, string>();

/**
 * 번역의 원문으로 쓸 문장과 그 언어를 고른다.
 *
 * toContentMap()이 원문을 "원문 언어" 자리에 넣어 두므로, 맵에 실제로 들어 있는
 * 항목 중 아무거나 쓰면 된다. vi를 먼저 보는 이유: 원문 언어를 모르는 기존
 * 데이터가 vi 자리에 들어간다.
 *
 * [2026-09-28] 번역 자체는 서버가 하므로 여기서 쓰는 것은 text뿐이다 —
 * "번역할 글이 있는가"를 판정한다.
 */
function findSource(map: Partial<Record<string, string>>): { text: string; lang: string } | null {
  for (const lang of ["vi", ...SUPPORTED_LANGUAGES]) {
    const text = map[lang];
    if (text && text.trim().length > 0) return { text, lang };
  }
  return null;
}
