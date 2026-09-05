-- 阶段8图片管理：把旧 images 内容表迁移为带名称、状态与派生信息的图片资源表。
-- 旧结构必须完整匹配且全部既有图片通过预检后才执行任何 DDL。
-- 最终结构完整时幂等通过；旧结构与最终结构混合时主动失败。

BEGIN;

-- 旧时间列是 timestamp without time zone；固定解释时区，避免不同会话产生不同结果。
SET LOCAL TIME ZONE 'Asia/Shanghai';

DO $image_shape$
DECLARE
    column_count integer;
    has_uri boolean;
    has_image_key boolean;
BEGIN
    IF to_regclass('public.images') IS NULL THEN
        RAISE EXCEPTION 'public.images does not exist';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'images'
          AND c.relkind = 'p'
    ) THEN
        RAISE EXCEPTION 'public.images is not a partitioned parent table';
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'images';

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'images' AND column_name = 'uri'
    ) INTO has_uri;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'images' AND column_name = 'image_key'
    ) INTO has_image_key;

    IF has_uri AND NOT has_image_key THEN
        IF column_count <> 5
            OR NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'images'
                  AND column_name = 'game_id'
                  AND data_type = 'character varying'
                  AND character_maximum_length = 64
                  AND is_nullable = 'NO'
            )
            OR NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'images'
                  AND column_name = 'uri'
                  AND data_type = 'character varying'
                  AND character_maximum_length = 255
                  AND is_nullable = 'NO'
            )
            OR NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'images'
                  AND column_name = 'image_base64'
                  AND data_type = 'text'
                  AND is_nullable = 'NO'
            )
            OR NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'images'
                  AND column_name IN ('created_at', 'updated_at')
                  AND data_type = 'timestamp without time zone'
            ) THEN
            RAISE EXCEPTION 'public.images old shape is incompatible';
        END IF;
    ELSIF has_image_key AND NOT has_uri THEN
        IF column_count <> 12 THEN
            RAISE EXCEPTION 'public.images final shape is incomplete';
        END IF;
    ELSE
        RAISE EXCEPTION 'public.images mixes old and final columns';
    END IF;
END
$image_shape$;

-- 内容预检会生成后续回填数据，必须先阻止并发图片写入，确保内容与派生字段同源。
LOCK TABLE public.images IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION pg_temp.dv_image_dimensions(content bytea)
RETURNS integer[]
LANGUAGE plpgsql
AS $image_dimensions$
DECLARE
    content_length integer := octet_length(content);
    position_index integer;
    marker integer;
    segment_length integer;
    width_value bigint;
    height_value bigint;
BEGIN
    IF content_length >= 24
        AND get_byte(content, 0) = 137
        AND get_byte(content, 1) = 80
        AND get_byte(content, 2) = 78
        AND get_byte(content, 3) = 71
        AND get_byte(content, 4) = 13
        AND get_byte(content, 5) = 10
        AND get_byte(content, 6) = 26
        AND get_byte(content, 7) = 10 THEN
        width_value :=
            get_byte(content, 16)::bigint * 16777216
            + get_byte(content, 17)::bigint * 65536
            + get_byte(content, 18)::bigint * 256
            + get_byte(content, 19)::bigint;
        height_value :=
            get_byte(content, 20)::bigint * 16777216
            + get_byte(content, 21)::bigint * 65536
            + get_byte(content, 22)::bigint * 256
            + get_byte(content, 23)::bigint;
        IF width_value > 2147483647 OR height_value > 2147483647 THEN
            RAISE EXCEPTION 'PNG dimensions exceed integer range';
        END IF;
        RETURN ARRAY[width_value::integer, height_value::integer];
    END IF;

    IF content_length < 4
        OR get_byte(content, 0) <> 255
        OR get_byte(content, 1) <> 216 THEN
        RAISE EXCEPTION 'unsupported image signature';
    END IF;

    position_index := 2;
    WHILE position_index < content_length LOOP
        IF get_byte(content, position_index) <> 255 THEN
            RAISE EXCEPTION 'invalid JPEG marker at byte %', position_index;
        END IF;
        WHILE position_index < content_length
          AND get_byte(content, position_index) = 255 LOOP
            position_index := position_index + 1;
        END LOOP;
        IF position_index >= content_length THEN
            EXIT;
        END IF;

        marker := get_byte(content, position_index);
        position_index := position_index + 1;
        IF marker IN (1, 216, 217)
            OR marker BETWEEN 208 AND 215 THEN
            CONTINUE;
        END IF;
        IF position_index + 1 >= content_length THEN
            RAISE EXCEPTION 'truncated JPEG segment';
        END IF;

        segment_length :=
            get_byte(content, position_index) * 256
            + get_byte(content, position_index + 1);
        IF segment_length < 2 OR position_index + segment_length > content_length THEN
            RAISE EXCEPTION 'invalid JPEG segment length';
        END IF;

        IF marker IN (192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207) THEN
            IF segment_length < 7 THEN
                RAISE EXCEPTION 'truncated JPEG dimension segment';
            END IF;
            height_value :=
                get_byte(content, position_index + 3) * 256
                + get_byte(content, position_index + 4);
            width_value :=
                get_byte(content, position_index + 5) * 256
                + get_byte(content, position_index + 6);
            RETURN ARRAY[width_value::integer, height_value::integer];
        END IF;
        IF marker = 218 THEN
            RAISE EXCEPTION 'JPEG start of scan found before dimensions';
        END IF;
        position_index := position_index + segment_length;
    END LOOP;

    RAISE EXCEPTION 'JPEG dimensions not found';
END
$image_dimensions$;

CREATE OR REPLACE FUNCTION pg_temp.dv_png_has_chunk(content bytea, chunk_name text)
RETURNS boolean
LANGUAGE plpgsql
AS $png_has_chunk$
DECLARE
    content_length integer := octet_length(content);
    position_index integer := 8;
    chunk_length bigint;
BEGIN
    IF octet_length(convert_to(chunk_name, 'UTF8')) <> 4 THEN
        RAISE EXCEPTION 'PNG chunk name must contain four bytes';
    END IF;
    WHILE position_index + 12 <= content_length LOOP
        chunk_length :=
            get_byte(content, position_index)::bigint * 16777216
            + get_byte(content, position_index + 1)::bigint * 65536
            + get_byte(content, position_index + 2)::bigint * 256
            + get_byte(content, position_index + 3)::bigint;
        IF chunk_length > 2147483647
            OR position_index::bigint + 12 + chunk_length > content_length THEN
            RETURN FALSE;
        END IF;
        IF substring(content FROM position_index + 5 FOR 4) = convert_to(chunk_name, 'UTF8') THEN
            RETURN TRUE;
        END IF;
        position_index := position_index + 12 + chunk_length::integer;
    END LOOP;
    RETURN FALSE;
END
$png_has_chunk$;

CREATE TEMP TABLE image_management_backfill (
    game_id varchar(64) NOT NULL,
    image_key varchar(128) NOT NULL,
    mime_type varchar(32) NOT NULL,
    byte_size integer NOT NULL,
    width smallint NOT NULL,
    height smallint NOT NULL,
    PRIMARY KEY (game_id, image_key)
) ON COMMIT DROP;

DO $image_preflight$
DECLARE
    image_row record;
    encoded_content text;
    decoded_content bytea;
    dimensions integer[];
    detected_mime_type varchar(32);
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'images' AND column_name = 'uri'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.images
        GROUP BY game_id, lower(btrim(uri))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'existing image keys conflict as normalized initial names';
    END IF;

    FOR image_row IN
        SELECT game_id, uri, image_base64, created_at, updated_at
        FROM public.images
        ORDER BY game_id, uri
    LOOP
        IF image_row.uri !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' THEN
            RAISE EXCEPTION 'image %/% has invalid key', image_row.game_id, image_row.uri;
        END IF;
        IF char_length(image_row.uri) > 100 THEN
            RAISE EXCEPTION 'image %/% cannot use key as initial name', image_row.game_id, image_row.uri;
        END IF;
        IF image_row.created_at IS NULL OR image_row.updated_at IS NULL THEN
            RAISE EXCEPTION 'image %/% has null timestamp', image_row.game_id, image_row.uri;
        END IF;

        IF image_row.image_base64 LIKE 'data:image/png;base64,%' THEN
            detected_mime_type := 'image/png';
            encoded_content := substring(
                image_row.image_base64 FROM char_length('data:image/png;base64,') + 1
            );
        ELSIF image_row.image_base64 LIKE 'data:image/jpeg;base64,%' THEN
            detected_mime_type := 'image/jpeg';
            encoded_content := substring(
                image_row.image_base64 FROM char_length('data:image/jpeg;base64,') + 1
            );
        ELSE
            RAISE EXCEPTION 'image %/% has unsupported data URI', image_row.game_id, image_row.uri;
        END IF;

        IF encoded_content = ''
            OR char_length(encoded_content) % 4 <> 0
            OR encoded_content !~ '^[A-Za-z0-9+/]*={0,2}$' THEN
            RAISE EXCEPTION 'image %/% has invalid Base64', image_row.game_id, image_row.uri;
        END IF;
        BEGIN
            decoded_content := decode(encoded_content, 'base64');
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'image %/% cannot decode Base64', image_row.game_id, image_row.uri;
        END;

        IF octet_length(decoded_content) NOT BETWEEN 1 AND 262144 THEN
            RAISE EXCEPTION 'image %/% exceeds byte limit', image_row.game_id, image_row.uri;
        END IF;
        IF detected_mime_type = 'image/png'
            AND pg_temp.dv_png_has_chunk(decoded_content, 'acTL') THEN
            RAISE EXCEPTION 'image %/% is animated PNG', image_row.game_id, image_row.uri;
        END IF;

        BEGIN
            dimensions := pg_temp.dv_image_dimensions(decoded_content);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'image %/% has invalid image content', image_row.game_id, image_row.uri;
        END;
        IF dimensions[1] NOT BETWEEN 1 AND 64
            OR dimensions[2] NOT BETWEEN 1 AND 64 THEN
            RAISE EXCEPTION
                'image %/% dimensions %x% exceed 64x64',
                image_row.game_id,
                image_row.uri,
                dimensions[1],
                dimensions[2];
        END IF;

        IF detected_mime_type = 'image/png'
            AND NOT (
                get_byte(decoded_content, 0) = 137
                AND get_byte(decoded_content, 1) = 80
                AND get_byte(decoded_content, 2) = 78
                AND get_byte(decoded_content, 3) = 71
            ) THEN
            RAISE EXCEPTION 'image %/% MIME does not match PNG content', image_row.game_id, image_row.uri;
        END IF;
        IF detected_mime_type = 'image/jpeg'
            AND NOT (
                get_byte(decoded_content, 0) = 255
                AND get_byte(decoded_content, 1) = 216
            ) THEN
            RAISE EXCEPTION 'image %/% MIME does not match JPEG content', image_row.game_id, image_row.uri;
        END IF;

        INSERT INTO image_management_backfill (
            game_id,
            image_key,
            mime_type,
            byte_size,
            width,
            height
        ) VALUES (
            image_row.game_id,
            image_row.uri,
            detected_mime_type,
            octet_length(decoded_content),
            dimensions[1],
            dimensions[2]
        );
    END LOOP;

    IF (SELECT COUNT(*) FROM public.images)
        <> (SELECT COUNT(*) FROM image_management_backfill) THEN
        RAISE EXCEPTION 'image preflight row count mismatch';
    END IF;
END
$image_preflight$;

DO $image_migration$
DECLARE
    old_foreign_key text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'images' AND column_name = 'uri'
    ) THEN
        RETURN;
    END IF;

    IF (SELECT COUNT(*) FROM public.images)
        <> (SELECT COUNT(*) FROM image_management_backfill) THEN
        RAISE EXCEPTION 'public.images changed after preflight';
    END IF;
    IF EXISTS (
        SELECT game_id, uri AS image_key FROM public.images
        EXCEPT
        SELECT game_id, image_key FROM image_management_backfill
    ) OR EXISTS (
        SELECT game_id, image_key FROM image_management_backfill
        EXCEPT
        SELECT game_id, uri AS image_key FROM public.images
    ) THEN
        RAISE EXCEPTION 'public.images keys changed after preflight';
    END IF;

    SELECT c.conname INTO old_foreign_key
    FROM pg_constraint c
    WHERE c.conrelid = 'public.images'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'public.games'::regclass
    LIMIT 1;
    IF old_foreign_key IS NULL THEN
        RAISE EXCEPTION 'public.images old game foreign key is missing';
    END IF;

    EXECUTE format('ALTER TABLE public.images DROP CONSTRAINT %I', old_foreign_key);
    ALTER TABLE public.images RENAME COLUMN uri TO image_key;
    ALTER TABLE public.images ALTER COLUMN image_key TYPE varchar(128);
    ALTER TABLE public.images
        ADD COLUMN name varchar(100),
        ADD COLUMN description varchar(2000),
        ADD COLUMN mime_type varchar(32),
        ADD COLUMN byte_size integer,
        ADD COLUMN width smallint,
        ADD COLUMN height smallint,
        ADD COLUMN enabled boolean;

    UPDATE public.images image
    SET name = image.image_key,
        description = NULL,
        mime_type = backfill.mime_type,
        byte_size = backfill.byte_size,
        width = backfill.width,
        height = backfill.height,
        enabled = TRUE
    FROM image_management_backfill backfill
    WHERE backfill.game_id = image.game_id
      AND backfill.image_key = image.image_key;

    ALTER TABLE public.images
        ALTER COLUMN name SET NOT NULL,
        ALTER COLUMN mime_type SET NOT NULL,
        ALTER COLUMN byte_size SET NOT NULL,
        ALTER COLUMN width SET NOT NULL,
        ALTER COLUMN height SET NOT NULL,
        ALTER COLUMN enabled SET DEFAULT TRUE,
        ALTER COLUMN enabled SET NOT NULL,
        ALTER COLUMN created_at TYPE timestamptz
            USING created_at AT TIME ZONE current_setting('TimeZone'),
        ALTER COLUMN created_at SET DEFAULT now(),
        ALTER COLUMN created_at SET NOT NULL,
        ALTER COLUMN updated_at TYPE timestamptz
            USING updated_at AT TIME ZONE current_setting('TimeZone'),
        ALTER COLUMN updated_at SET DEFAULT now(),
        ALTER COLUMN updated_at SET NOT NULL;

    ALTER TABLE public.images
        ADD CONSTRAINT fk_images_game
            FOREIGN KEY (game_id) REFERENCES public.games(game_id),
        ADD CONSTRAINT ck_images_key
            CHECK (image_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
        ADD CONSTRAINT ck_images_name
            CHECK (btrim(name) <> ''),
        ADD CONSTRAINT ck_images_mime_type
            CHECK (mime_type IN ('image/png', 'image/jpeg')),
        ADD CONSTRAINT ck_images_byte_size
            CHECK (byte_size BETWEEN 1 AND 262144),
        ADD CONSTRAINT ck_images_width
            CHECK (width BETWEEN 1 AND 64),
        ADD CONSTRAINT ck_images_height
            CHECK (height BETWEEN 1 AND 64);

    CREATE UNIQUE INDEX uq_images_name
        ON public.images (game_id, lower(btrim(name)));

    COMMENT ON TABLE public.images IS
        '图片资源表（保存最大64x64的Base64图片，不纳入版本管理）';
    COMMENT ON COLUMN public.images.image_key IS
        '同一游戏内稳定且不可修改的图片标识';
    COMMENT ON COLUMN public.images.name IS
        '同一游戏内忽略大小写唯一的图片名称';
    COMMENT ON COLUMN public.images.image_base64 IS
        '已由客户端处理且通过后端校验的PNG或JPEG数据地址';
    COMMENT ON COLUMN public.images.mime_type IS
        '后端从图片内容识别的真实媒体类型';
    COMMENT ON COLUMN public.images.byte_size IS
        'Base64解码后的文件字节数';
END
$image_migration$;

DO $image_final_check$
DECLARE
    column_count integer;
BEGIN
    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'images';
    IF column_count <> 12
        OR EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'images' AND column_name = 'uri'
        )
        OR NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'images'
              AND column_name = 'image_key'
              AND data_type = 'character varying'
              AND character_maximum_length = 128
              AND is_nullable = 'NO'
        )
        OR NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'images'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        )
        OR NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'images'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        ) THEN
        RAISE EXCEPTION 'public.images final columns are incompatible';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.images'::regclass
          AND conname = 'pk_images'
          AND contype = 'p'
    )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'fk_images_game'
              AND contype = 'f'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_key'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_name'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_mime_type'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_byte_size'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_width'
        )
        OR NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.images'::regclass
              AND conname = 'ck_images_height'
        )
        OR to_regclass('public.uq_images_name') IS NULL THEN
        RAISE EXCEPTION 'public.images final constraints or index are incomplete';
    END IF;
END
$image_final_check$;

COMMIT;
