-- 只替换既有七天会话上限；不延长、撤销或重建已有会话。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE auth.sessions IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
    existing_definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO existing_definition
    FROM pg_constraint
    WHERE conrelid = 'auth.sessions'::regclass
      AND conname = 'sessions_expiry' AND contype = 'c' AND convalidated;
    IF existing_definition IS DISTINCT FROM
       'CHECK (((expires_at > created_at) AND (expires_at <= (created_at + ''7 days''::interval))))' THEN
        RAISE EXCEPTION '会话期限约束不是已核对的七天版本，停止迁移';
    END IF;
END
$preflight$;

ALTER TABLE auth.sessions DROP CONSTRAINT sessions_expiry;
ALTER TABLE auth.sessions ADD CONSTRAINT sessions_expiry CHECK (
    expires_at > created_at AND expires_at <= created_at + INTERVAL '30 days'
);
COMMIT;
