-- =============================================================================
-- Wasm Canonical Catalog compatibility migration (idempotent)
-- =============================================================================
--
-- For already-deployed databases that do not yet have Wasm catalog tables.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- Does not execute against a live DB from application code; operators run manually.

CREATE TABLE IF NOT EXISTS public.wasm_catalog_sources (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_wasm_catalog_sources PRIMARY KEY (game_id),
    CONSTRAINT fk_wasm_catalog_sources_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

CREATE TABLE IF NOT EXISTS public.wasm_catalog_sources_log (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    CONSTRAINT pk_wasm_catalog_sources_log PRIMARY KEY (game_id, start_version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_log_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_log_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

CREATE INDEX IF NOT EXISTS idx_wasm_catalog_sources_log_version
    ON public.wasm_catalog_sources_log (game_id, start_version_id, end_version_id);

CREATE TABLE IF NOT EXISTS public.published_wasm_catalog_snapshots (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    version_code varchar(64) NOT NULL,
    schema_version varchar(64) NOT NULL,
    schema_hash varchar(80) NOT NULL,
    rules_hash varchar(80) NOT NULL,
    catalog_json jsonb NOT NULL,
    created_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_published_wasm_catalog_snapshots PRIMARY KEY (game_id, version_code),
    CONSTRAINT uq_published_wasm_catalog_snapshots_version UNIQUE (game_id, version_id),
    CONSTRAINT fk_published_wasm_catalog_snapshots_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_published_wasm_catalog_snapshots_json_object CHECK (jsonb_typeof(catalog_json) = 'object')
);

-- Ensure partitions exist for all known games (idempotent via ensure_game_partitions).
DO $$
DECLARE
    v_game_id varchar;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'ensure_game_partitions'
    ) THEN
        FOR v_game_id IN
            SELECT game_id FROM public.games
        LOOP
            PERFORM public.ensure_game_partitions(v_game_id);
        END LOOP;
    END IF;
END $$;
