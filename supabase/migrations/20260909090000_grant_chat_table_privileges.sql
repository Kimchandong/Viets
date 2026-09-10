-- STEP S-1 (STABILIZATION_PLAN.md): 1:1 상담채팅 전송/이미지첨부 불가 버그(B1, B2) 수정
--
-- 원인: property_conversations / property_messages 테이블이 SQL Editor로 생성될 때
-- authenticated 롤에 대한 테이블 권한(GRANT)이 누락되어, 모든 쿼리가
-- "42501 permission denied for table ..." 로 실패하고 있었음(RLS 정책 이전 단계에서 차단).
-- 실기기 재현 진단(2026-09-09) curl 테스트로 확인:
--   GET .../property_conversations -> 42501
--   GET .../property_messages      -> 42501
--
-- 조치: 누락된 GRANT를 명시적으로 부여. RLS는 기존 정책이 그대로 행 단위 접근을 제어하므로
-- 데이터/스키마 변경 없음(권한 추가만 수행하는 비파괴적 변경).

GRANT SELECT, INSERT, UPDATE ON public.property_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_messages TO authenticated;

-- 추가 원인(B2, 이미지 첨부 미작동): chat-images Storage 버킷 자체가 생성된 적 없음.
-- storage.objects 에 대한 RLS 정책("authenticated users upload to own folder",
-- "public read chat images")은 이미 존재하나, 대상 버킷이 없어 업로드가 항상 실패하고 있었음.
-- 진단(2026-09-09): GET /storage/v1/bucket/chat-images -> 404 NoSuchBucket
--
-- 조치: 버킷 생성(public read 정책과 일치하도록 public=true).
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;
