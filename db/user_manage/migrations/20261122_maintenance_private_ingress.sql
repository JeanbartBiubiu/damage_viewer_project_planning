BEGIN;

-- 前置为 20261113 维护结构或用同版 schema 初始化的库。
DO $precondition$
BEGIN
    IF to_regclass('auth.maintenance_principals') IS NULL
       OR to_regclass('auth.maintenance_sessions') IS NULL
       OR to_regclass('auth.maintenance_batches') IS NULL
       OR to_regclass('auth.maintenance_commits') IS NULL
       OR to_regclass('auth.accounts') IS NULL
       OR to_regclass('"user".edit_log') IS NULL
       OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute
           WHERE attrelid = to_regclass('auth.accounts') AND attname = 'can_edit' AND NOT attisdropped
       ) OR 2 <> (
           SELECT count(*) FROM pg_catalog.pg_attribute
           WHERE attrelid = to_regclass('auth.maintenance_principals')
             AND attname IN ('credential_version', 'token_hash') AND NOT attisdropped
       ) THEN
        RAISE EXCEPTION '私有维护入口迁移前置结构不匹配';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('auth.maintenance_batches'::regclass, 'principal_id', 'auth.maintenance_principals'::regclass, 'a'),
            ('auth.maintenance_commits'::regclass, 'batch_id', 'auth.maintenance_batches'::regclass, 'a'),
            ('auth.maintenance_commits'::regclass, 'principal_id', 'auth.maintenance_principals'::regclass, 'a'),
            ('"user".edit_log'::regclass, 'maintenance_principal_id', 'auth.maintenance_principals'::regclass, 'a'),
            ('"user".edit_log'::regclass, 'account_id', 'auth.accounts'::regclass, 'n'),
            ('auth.sessions'::regclass, 'account_id', 'auth.accounts'::regclass, 'c')
        ) AS expected(source_table, source_column, target_table, delete_action)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint AS fk
            JOIN pg_catalog.pg_attribute AS source ON source.attrelid = fk.conrelid AND fk.conkey = ARRAY[source.attnum]
            JOIN pg_catalog.pg_attribute AS target ON target.attrelid = fk.confrelid AND fk.confkey = ARRAY[target.attnum]
            WHERE fk.contype = 'f' AND fk.convalidated AND fk.confdeltype::text = expected.delete_action
              AND fk.conrelid = expected.source_table AND source.attname = expected.source_column
              AND fk.confrelid = expected.target_table AND target.attname = 'id'
        )
    ) THEN
        RAISE EXCEPTION '维护及玩家历史记录的外键不匹配';
    END IF;
END
$precondition$;

-- 独立维护主体的编号与引用保持原样。遇到额外依赖时中止整个事务。
DROP TABLE auth.maintenance_sessions RESTRICT;
ALTER TABLE auth.maintenance_principals
    DROP COLUMN credential_version RESTRICT,
    DROP COLUMN token_hash RESTRICT;

COMMIT;
