-- =============================================================================
-- Damage Viewer System - Wasm Canonical Catalog Schema (fresh install)
-- =============================================================================
--
-- 设计说明：
-- 1. 本文件单独维护，先不直接并入 schema.sql。
-- 2. wasm_catalog_sources / wasm_catalog_sources_log 按 game_id 分区；
--    published_wasm_catalog_snapshots 为非分区冻结快照表。
-- 3. 正式接入时，需同步补充 triggers.sql 的 ensure_game_partitions 分区创建。
-- 4. 不得复用 published_bundle_snapshots 承载 catalog。

CREATE TABLE public.wasm_catalog_sources (
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

COMMENT ON TABLE public.wasm_catalog_sources IS 'Wasm Canonical Catalog 编辑态 source；每个 game 一行当前草稿';
COMMENT ON COLUMN public.wasm_catalog_sources.schema_version IS 'Wasm schema 版本；首期固定 generic-p0；不重复写入 catalog_json';
COMMENT ON COLUMN public.wasm_catalog_sources.catalog_json IS 'source body（排除根 schemaVersion、meta 与 hash）';

CREATE TABLE public.wasm_catalog_sources_log (
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

COMMENT ON TABLE public.wasm_catalog_sources_log IS 'wasm_catalog_sources 发布历史；仅变更过的 source 写入';

CREATE INDEX idx_wasm_catalog_sources_log_version
    ON public.wasm_catalog_sources_log (game_id, start_version_id, end_version_id);

CREATE TABLE public.published_wasm_catalog_snapshots (
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

COMMENT ON TABLE public.published_wasm_catalog_snapshots IS '已发布 Wasm Canonical Catalog 快照；Public 只读此表';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.catalog_json IS '完整 WasmCatalogV1（含 meta）';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.schema_hash IS 'schema 契约指纹，形如 sha256:...';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.rules_hash IS 'catalog 规则与定义指纹，形如 sha256:...';
