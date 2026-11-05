BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                   WHERE e.extname='pgcrypto' AND n.nspname='public')
       OR to_regprocedure('public.crypt(text,text)') IS NULL
       OR to_regprocedure('public.gen_salt(text,integer)') IS NULL
       OR to_regprocedure('public.gen_random_bytes(integer)') IS NULL THEN
        RAISE EXCEPTION '账号密码扩展必须安装在 public，且所需函数完整';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.accounts
               WHERE password_hash !~ '^\$2a\$12\$[./A-Za-z0-9]{53}$') THEN
        RAISE EXCEPTION '存在本版不支持的密码编码；必须先安排本人重设，迁移不转换或删除账号';
    END IF;
END
$migration$;

COMMIT;
