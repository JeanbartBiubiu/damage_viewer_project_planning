-- 状态基本管理：独立 public.statuses 表。
-- 目标表不存在时创建冻结结构；已存在时严格预检列、类型、可空性、主键、游戏外键、
-- 检查约束与唯一索引，完全一致才幂等通过，否则主动报错停止。
-- 已存在表缺少任一约束或 uq_statuses_name 也视为结构不一致，不得补建。
-- 不写默认记录，不改已有行。

BEGIN;

DO $status_mig$
DECLARE
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'statuses'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'statuses';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.statuses is incompatible: unexpected column set';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'statuses'
              AND (
                    data_type = 'ARRAY'
                    OR udt_name LIKE '%[]'
              )
        ) THEN
            RAISE EXCEPTION 'public.statuses is incompatible: array column is not allowed';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'status_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'status' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'statuses'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.statuses is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'pk_statuses' AND c.contype = 'p'
              AND cardinality(c.conkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'status_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'fk_statuses_game' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.games'::regclass
              AND cardinality(c.conkey) = 1
              AND cardinality(c.confkey) = 1
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'ck_statuses_key' AND c.contype = 'c'
              AND position('status_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'ck_statuses_name' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%btrim%name%'
              AND position('<>' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'ck_statuses_status' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%status%'
              AND position('ENABLED' IN pg_get_constraintdef(c.oid)) > 0
              AND position('DISABLED' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'statuses'
              AND c.conname = 'ck_statuses_sort_order' AND c.contype = 'c'
              AND position(
                    'sort_order>=0'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.statuses is incompatible: missing or wrong PK/FK/check constraint';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx
              ON idx.relname = xi.indexname
            JOIN pg_namespace n
              ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i
              ON i.indexrelid = idx.oid
            JOIN pg_class t
              ON t.oid = i.indrelid
            JOIN pg_namespace tn
              ON tn.oid = t.relnamespace
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'uq_statuses_name'
              AND xi.tablename = 'statuses'
              AND tn.nspname = 'public'
              AND t.relname = 'statuses'
              AND i.indisunique = true
              AND i.indpred IS NULL
              AND i.indnkeyatts = 2
              AND i.indnatts = 2
              AND (
                    SELECT array_agg(ord.attnum::integer ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                  ) = ARRAY[
                    (
                        SELECT att.attnum
                        FROM pg_attribute att
                        WHERE att.attrelid = t.oid
                          AND att.attname = 'game_id'
                          AND NOT att.attisdropped
                    )::integer,
                    0
                  ]
              AND regexp_replace(
                    regexp_replace(
                        replace(pg_get_expr(i.indexprs, i.indrelid), '::text', ''),
                        '\s+',
                        '',
                        'g'
                    ),
                    '[()]',
                    '',
                    'g'
                  ) = regexp_replace(
                    regexp_replace(
                        replace('lower(btrim(name))', '::text', ''),
                        '\s+',
                        '',
                        'g'
                    ),
                    '[()]',
                    '',
                    'g'
                  )
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.statuses is incompatible: missing or wrong unique index uq_statuses_name';
        END IF;
    ELSE
        CREATE TABLE public.statuses (
            game_id varchar(64) NOT NULL,
            status_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            description varchar(2000),
            status varchar(16) NOT NULL DEFAULT 'ENABLED',
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_statuses PRIMARY KEY (game_id, status_key),
            CONSTRAINT fk_statuses_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
            CONSTRAINT ck_statuses_key CHECK (status_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_statuses_name CHECK (btrim(name) <> ''),
            CONSTRAINT ck_statuses_status CHECK (status IN ('ENABLED', 'DISABLED')),
            CONSTRAINT ck_statuses_sort_order CHECK (sort_order >= 0)
        );

        CREATE UNIQUE INDEX uq_statuses_name
            ON public.statuses (game_id, lower(btrim(name)));

        COMMENT ON TABLE public.statuses IS '状态';
    END IF;
END
$status_mig$;

COMMIT;
