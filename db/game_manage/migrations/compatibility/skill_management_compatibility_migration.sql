-- 技能基本管理：独立 skills 表与 skill_category_relations 多对多关系表。
-- 该脚本只补齐结构，不写种子、不拷贝旧战斗数据、不改写已有行。
-- 已存在表/索引必须通过 information_schema / pg_constraint / pg_index 预检：
-- 列、空值、PK/FK 列映射、删除动作、CHECK 表达式与索引定义均须与冻结 DDL 兼容，
-- 否则 RAISE 停止。缺失对象再由 CREATE TABLE/INDEX IF NOT EXISTS 创建。

BEGIN;

DO $$
DECLARE
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
BEGIN
    -- public.skills: existing table must be structurally complete.
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skills'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skills';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skills is incompatible: unexpected column set';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'skills'
              AND (
                    data_type IN ('jsonb', 'json', 'ARRAY')
                    OR udt_name LIKE '%[]'
                    OR column_name IN ('skill_category_keys', 'category_keys', 'types')
              )
        ) THEN
            RAISE EXCEPTION 'public.skills is incompatible: array/jsonb or category column is not allowed';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'max_level' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'status' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skills'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skills is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'pk_skills' AND c.contype = 'p'
              AND cardinality(c.conkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'fk_skills_game' AND c.contype = 'f'
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
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'ck_skills_key' AND c.contype = 'c'
              AND position('skill_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'ck_skills_name' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%btrim%name%'
              AND position('<>' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'ck_skills_max_level' AND c.contype = 'c'
              AND position(
                    'max_level>=1'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'ck_skills_status' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%status%'
              AND position('ENABLED' IN pg_get_constraintdef(c.oid)) > 0
              AND position('DISABLED' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skills'
              AND c.conname = 'ck_skills_sort_order' AND c.contype = 'c'
              AND position(
                    'sort_order>=0'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skills is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
    END IF;

    -- public.skill_category_relations: existing table must be structurally complete.
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_category_relations'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_category_relations';
        IF col_count <> 3 THEN
            RAISE EXCEPTION 'public.skill_category_relations is incompatible: unexpected column set';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'skill_category_relations'
              AND (
                    data_type IN ('jsonb', 'json', 'ARRAY')
                    OR udt_name LIKE '%[]'
                    OR column_name IN ('created_at', 'updated_at', 'status', 'name', 'sort_order')
              )
        ) THEN
            RAISE EXCEPTION 'public.skill_category_relations is incompatible: extra or array/jsonb column is not allowed';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_category_relations'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_category_relations'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_category_relations'
              AND column_name = 'skill_category_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_category_relations is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_category_relations'
              AND c.conname = 'pk_skill_category_relations' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'skill_category_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_category_relations'
              AND c.conname = 'fk_skill_category_relations_skill' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skills'::regclass
              AND cardinality(c.conkey) = 2
              AND cardinality(c.confkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_category_relations'
              AND c.conname = 'fk_skill_category_relations_category' AND c.contype = 'f'
              AND c.confdeltype IN ('r', 'a')
              AND c.confrelid = 'public.skill_categories'::regclass
              AND cardinality(c.conkey) = 2
              AND cardinality(c.confkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_category_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_category_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_category_relations is incompatible: missing or wrong PK/FK';
        END IF;
    END IF;

    -- Existing same-name indexes must match frozen coverage; missing indexes are created later.
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skills_list'
    ) THEN
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
              AND xi.indexname = 'ix_skills_list'
              AND xi.tablename = 'skills'
              AND tn.nspname = 'public'
              AND t.relname = 'skills'
              AND NOT i.indisunique
              AND i.indpred IS NULL
              AND i.indnkeyatts = 5
              AND i.indnatts = 5
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'status', 'sort_order', 'name', 'skill_key']::text[]
              AND regexp_replace(pg_get_indexdef(idx.oid), '\s+', ' ', 'g')
                  ILIKE '%(game_id, status, sort_order, name, skill_key)%'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skills is incompatible: index ix_skills_list has wrong table or column definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_category_relations_category'
    ) THEN
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
              AND xi.indexname = 'ix_skill_category_relations_category'
              AND xi.tablename = 'skill_category_relations'
              AND tn.nspname = 'public'
              AND t.relname = 'skill_category_relations'
              AND NOT i.indisunique
              AND i.indpred IS NULL
              AND i.indnkeyatts = 3
              AND i.indnatts = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_category_key', 'skill_key']::text[]
              AND regexp_replace(pg_get_indexdef(idx.oid), '\s+', ' ', 'g')
                  ILIKE '%(game_id, skill_category_key, skill_key)%'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_category_relations is incompatible: index ix_skill_category_relations_category has wrong table or column definition';
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.skills (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    max_level integer NOT NULL,
    status varchar(16) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skills PRIMARY KEY (game_id, skill_key),
    CONSTRAINT fk_skills_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_skills_key
        CHECK (skill_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skills_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skills_max_level
        CHECK (max_level >= 1),
    CONSTRAINT ck_skills_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_skills_sort_order
        CHECK (sort_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.skill_category_relations (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    skill_category_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_category_relations PRIMARY KEY (game_id, skill_key, skill_category_key),
    CONSTRAINT fk_skill_category_relations_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_category_relations_category
        FOREIGN KEY (game_id, skill_category_key)
        REFERENCES public.skill_categories (game_id, skill_category_key)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_skills_list
    ON public.skills (game_id, status, sort_order, name, skill_key);

CREATE INDEX IF NOT EXISTS ix_skill_category_relations_category
    ON public.skill_category_relations (game_id, skill_category_key, skill_key);

COMMENT ON TABLE public.skills IS '技能';
COMMENT ON TABLE public.skill_category_relations IS '技能与技能分类多对多关系';

COMMIT;
