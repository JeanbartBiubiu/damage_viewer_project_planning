-- =============================================================================
-- Manual Partitions for LOL - status_action_control_rules
-- =============================================================================
--
-- 说明：
-- 1. 当前仅为 game_id = 'lol' 手动建分区。
-- 2. 如果后续要自动建分区，再把这两段逻辑补进 db/game_manage/triggers.sql
--    的 public.ensure_game_partitions(p_game_id) 里。

CREATE TABLE IF NOT EXISTS public.status_action_control_rules_lol
PARTITION OF public.status_action_control_rules
FOR VALUES IN ('lol');

CREATE TABLE IF NOT EXISTS public.status_action_control_rules_log_lol
PARTITION OF public.status_action_control_rules_log
FOR VALUES IN ('lol');
