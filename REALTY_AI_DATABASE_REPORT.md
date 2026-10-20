# REALTY_AI_DATABASE_REPORT.md

**STEP 02 — 데이터베이스 설계**

| | |
|---|---|
| 작성일 | 2026-10-20 |
| 마이그레이션 | `20261020000000_article_enums.sql` · `20261020000100_article_tables.sql` |
| 적용 상태 | **미적용.** 파일만 작성했다 |

---

## 1. 이름 체계 결정

요구사항 §11은 `real_estate_sources` / `real_estate_contents` 등을 제시하면서
"설계 예시"라고 명시했다. 그런데 이 프로젝트에는 **같은 기능의 설계가 이미 문서로
존재한다** — `docs/AI_RESEARCH.md`(v0.1, 2026-08-26)와 `docs/DATABASE.md` §5가
`article_sources` / `articles` / `research_jobs`를 정의하고 있다(구현은 0%였다).

두 이름 체계를 공존시키면 `DATABASE.md`가 즉시 거짓이 되므로 **기존 문서의 이름을
따랐다**(개발 원칙 12 — 중복 구현 금지).

| 요구사항 §11 예시 | 실제 채택 |
|---|---|
| `real_estate_sources` | `article_sources` |
| `real_estate_contents` | `articles` |
| `real_estate_content_permissions` | `articles.content_permission` + `article_sources.content_permission` (별도 표를 두지 않음 — 권한은 값 하나다) |
| `real_estate_collection_runs` | `research_jobs` |
| `real_estate_publication_logs` | `research_jobs.stats` (별도 표 불필요 — 실행 단위로 집계된다) |
| `real_estate_admin_settings` | `article_publish_settings` |
| — | `article_images` (추가 — 사진 슬라이드 요구사항) |

## 2. `properties`를 재사용하지 않은 이유

`properties`는 **업체가 등록해 거래하는 매물**이고, 다음과 FK로 엮여 있다.

`property_ad_slots`(광고 입찰) · `property_conversations`(1:1 상담) ·
`property_images` · `property_documents` · `property_reports` · `favorites`

외부에서 수집한 기사를 같은 표에 넣으면 매물 검색 결과와 광고 자리에 외부 콘텐츠가
섞인다. 별도 표로 둔다.

## 3. 테이블

### `article_sources` — 정보원

| 컬럼 | 비고 |
|---|---|
| `name` | 화면에 노출되는 기관명·매체명. 예정작업 #2(우측 출처 패널)가 쓴다 |
| `domain` **unique** | 정보원의 자연키. 같은 매체 중복 등록 방지 |
| `source_type` | `news`/`government`/`portal`/`agency`/`developer` |
| `access_method` | `rss`/`sitemap`/`api`/`manual` |
| `feed_url` | 공개 주소만. **접속 키는 이 표에 넣지 않는다**(Secrets에 둔다) |
| `content_permission` | 기본값 `pending_review` — 명시적으로 승격해야 수집된다 |
| `permission_note` | 약관 근거. "왜 link_only인가"를 재조사하지 않게 |
| `trust_score` | 0.00~1.00. 자동 게시 임계값과 비교 |
| `status` | `verified`만 자동 수집 |
| `daily_limit` | 기본 3. 한 출처 편중 방지 |
| `last_fetched_at` / `last_item_at` / `consecutive_failures` | 헬스체크 |

**`last_item_at`을 따로 둔 이유**: STEP 01에서 피드가 조용히 죽는 것을 실제로
확인했다. Báo Đầu tư는 XML이 열리는데 항목이 0건, VnEconomy는 13일 전에 멈췄다.
조회 성공(`last_fetched_at`)만 보면 둘 다 정상으로 보인다.

### `articles` — 수집 콘텐츠

핵심 설계 원칙: **원문에 없는 값은 NULL로 둔다.** 요구사항 §5의
"원문에 존재하지 않는 가격, 주소, 매물 조건, 게시일을 AI가 임의로 만들어 넣지
않는다"를 스키마 수준에서 지킨다.

| 그룹 | 컬럼 |
|---|---|
| 원문 | `title` `summary` `source_lang` `title_i18n` `summary_i18n` |
| 링크·중복 | `original_url` `url_hash`(unique) `content_hash` |
| 날짜 | `source_published_at`(= 요구사항의 "출시일") `collected_at` `last_checked_at` `published_at` |
| 지역 | `region`(원문 문자열) + `location_id`(행정구역 마스터 FK, nullable) |
| 분류 | `property_type` `transaction_type` `relevance_score` `keywords` |
| 금액 | `price_min` `price_max` `currency` — 원문 명시 시만 |
| **기간** | `period_start` `period_end` `period_label` |
| 권한·상태 | `content_permission` `status` `reject_reason` |
| 사진 | `thumbnail_url` `image_count` |

- **`url_hash`**: 추적 파라미터가 붙은 같은 주소는 URL 문자열 비교로 못 잡는다.
  정규화 후 sha256으로 unique 제약을 건다.
- **`content_hash`**: URL이 달라도 같은 기사인 경우(여러 매체가 같은 보도자료를
  받아쓰는 경우)를 잡는다.
- **`region` + `location_id` 둘 다**: 행정구역 매칭이 실패해도 원문이 말한 지역을
  잃지 않는다.
- **`period_label`**: "2026년 4분기 입주 예정"처럼 날짜로 환산할 수 없는 표현.
  셋 다 비면 화면은 기간 칸을 **숨긴다**(빈 라벨은 "앱이 못 가져왔다"로 읽힌다).
- **`reject_reason`**: 사람이 보는 검토 큐는 없지만, 왜 안 떴는지는 남겨야 한다.
  없으면 "수집은 됐는데 안 보인다"를 조사할 방법이 없다.

### `article_images` — 사진

`property_images`와 같은 모양(`article_id` / `url` / `sort_order` / `caption`).

**STEP 01 결과를 그대로 적어 둔다**: 현재 검증된 출처는 전부 사진이 1장이고,
사진이 여러 장인 매물 포털은 약관이 복제를 금지한다. 그래서 이 표는 당장 0~1행만
갖는다. 지금 만드는 이유는 제휴(Masterise·Ecopark)가 성사되면 스키마를 바꾸지 않고
바로 담기 위한 것이다.

`image_count`를 `articles`에 비정규화한 이유: 카드의 「사진 N」 배지를 띄울 때
목록 조회마다 이미지 표를 조인하지 않기 위한 것이다.

### `research_jobs` — 실행 로그

`stats jsonb`에 정보원별 요청·수집·중복제거·분석·게시·실패 건수와 외부 API 사용량을
담는다. 항목이 늘어날 것이므로 컬럼으로 고정하지 않았다.

### `article_publish_settings` — 자동 게시 설정 (단일 행)

이 프로젝트에는 관리자 설정 테이블이 **없었다**(`app_settings`·`admin_settings` 모두
부재). key/value 표가 아니라 단일 행 표로 둔 이유는 항목이 고정이고, 타입이 살아야
DB가 상한을 검사할 수 있기 때문이다.

| 컬럼 | 기본값 | 근거 |
|---|---|---|
| `enabled` | `false` | 스키마 적용만으로 수집이 돌지 않게 |
| `run_hour` / `run_minute` / `timezone` | `8` / `0` / `Asia/Ho_Chi_Minh` | 요구사항 §9 |
| `daily_limit` | `10` | 사용자 지시 "10개 내외" |
| `per_source_limit` | `3` | CafeF 1곳이 공급량 70% 초과 |
| `max_age_days` | `7` | 실시간성 |
| `min_relevance` | `0.60` | 자동 게시이므로 이것이 품질 게이트 |
| `min_trust_score` | `0.50` | 출처 신뢰도 하한 |

사용자 결정(2026-10-20)으로 **관리자 검토 없이 자동 게시**하므로, 이 임계값들이
유일한 품질 장치다.

## 4. enum 4종

`article_source_status` · `article_content_permission` · `article_status` ·
`research_job_status`

**별도 파일로 분리했다.** Postgres는 새 enum 값을 추가한 트랜잭션 안에서 그 값을 쓸
수 없다. 지금은 같은 파일에 둬도 통과하지만, 나중에 값을 더하면서 같은 파일을 고치면
그 순간 깨진다(`20260930000000`에서 `user_permission_type`을 분리한 것과 같은 이유).

`article_status`에 `pending_review`를 두지 않았다 — 자동 게시이므로 사람이 보는 대기
큐가 없다. 게이트 탈락은 `rejected` + `reject_reason`으로 남는다.

## 5. 다국어 — `language_code` enum을 쓰지 않은 이유

`public.language_code` enum에는 **`'th'`가 없다**(`vi`/`ko`/`en`/`zh`/`ja`만).
앱은 6개 언어이므로 이 enum을 쓰면 타이어 번역이 저장되지 않는다.

`board_posts`도 같은 이유로 `source_lang text` + `title_i18n`/`body_i18n jsonb`를
썼다. 그 패턴을 그대로 따랐다.

## 6. RLS

| 표 | 공개 읽기 | 관리자 | 쓰기 |
|---|---|---|---|
| `article_sources` | **전체** (기관명을 화면에 노출해야 함) | 전체 | service_role |
| `articles` | `status='published'`만 | 전체 | service_role + 관리자 UPDATE |
| `article_images` | 부모 기사가 published인 경우만 | 전체 | service_role |
| `research_jobs` | 없음 | 읽기만 | service_role |
| `article_publish_settings` | 없음 | 전체 | 관리자 |

- 기사 읽기를 `anon`에도 열었다. 매물 상세와 같은 정책이고, 비로그인 사용자도
  홈 리스트를 본다.
- 수집·분석은 엣지 함수가 `service_role`로 수행한다. `service_role`은 RLS를
  우회하므로 `authenticated`용 INSERT 정책을 **두지 않았다** — 클라이언트가 기사를
  직접 넣을 수 있으면 아무 내용이나 홈 화면에 올릴 수 있다.
- `article_sources`를 공개 읽기로 연 대신, **접속 키·토큰은 이 표에 넣지 않는다.**
  `feed_url`은 공개 주소라 문제가 없다.

## 7. 예정작업과의 연결

| 예정작업 | 스키마 대응 |
|---|---|
| #2 출처 패널 | `article_sources.name` / `.domain` / `.trust_score`, `articles.source_published_at` / `.last_checked_at` / `.original_url` / `.content_permission` — **지금 다 들어 있다** |
| #3 북마커 | 기존 `favorites` 재사용. 착수 시 `target_type` CHECK에 `'article'` 추가 마이그레이션 1개만 필요 |
| #3 랜덤 정렬 | 스키마 영향 없음 (세션 시드 셔플) |

## 8. 검증 상태 — 아직 하지 않은 것

| 항목 | 상태 |
|---|---|
| SQL 문법·의미 검증 | **미실행.** 로컬에 Postgres가 없고, `supabase db push --dry-run`은 "어느 파일이 적용될지"만 출력하고 SQL을 검사하지 않는다 |
| 적용 | **미실행** |
| 데이터 입력 테스트 | 미실행 |

`supabase db push`는 마이그레이션 파일을 트랜잭션으로 적용하므로, **문법 오류가 있으면
아무것도 적용되지 않고 롤백된다.** 즉 적용 시도가 곧 검증이며, 실패해도 DB는 그대로다.

적용 전 변경 범위: **신규 표 5개 · 신규 enum 4개 · 기존 표 변경 0건.** 기존 데이터에
닿는 구문이 없다.
