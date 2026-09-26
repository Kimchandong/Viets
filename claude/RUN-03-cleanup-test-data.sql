-- ############################################################################
-- 2026-09-17 정리(선택) — 웹 검증 중 운영 DB에 만든 테스트 데이터
--
-- 급하지 않다. 다만 **투자 신청 2건은 지워 두는 편이 좋다** — 관리자 화면에
-- 실제 신청처럼 보이고, 나중에 "첫 신청이 언제였나"를 세는 기준을 흐린다.
--
-- ⚠ 지우기 전에 1번을 먼저 실행해 무엇이 지워질지 눈으로 확인할 것.
-- ############################################################################

-- 1) 무엇이 지워지는지 먼저 본다
select o.id, o.amount, o.status, o.contact_phone, o.created_at, p.title
from public.investment_orders o
join public.investment_products p on p.id = o.product_id
where o.contact_phone in ('0900000000', '0900000001')
order by o.created_at;

-- 2) 위 결과가 웹 검증 건 2건이 맞으면 이것을 실행한다
-- delete from public.investment_orders
-- where contact_phone in ('0900000000', '0900000001');

-- 3) 웹 검증용 테스트 매물과 그 상담 — 매물을 지우면 대화도 FK로 함께 지워진다
--    (property_conversations.property_id는 on delete cascade)
--    먼저 확인:
select id, title, status, created_at
from public.properties
where title = '웹검증 건물정보 테스트';

-- 맞으면:
-- delete from public.properties where title = '웹검증 건물정보 테스트';
