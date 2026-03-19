-- =============================================================================
-- Damage Viewer System - Coefficient Bucket Schema Draft
-- =============================================================================
--
-- 设计说明：
-- 1. 本文件单独维护，先不直接并入 schema.sql。
-- 2. 本文件只管理“乘区桶定义”，不直接承载某个技能/状态/装备的具体数值贡献。
-- 3. 具体数值贡献第一版仍建议保留在 mechanics_config / effect config 中，
--    由 bucket_key 引用这里的注册表。
-- 4. 该注册表既服务 hp/damage/heal，也服务 move_speed / attack_speed 等普通属性。
-- 5. 通过 aggregation_mode 可覆盖移动速度中的 add/multiply/pick_max/set_final 等特殊聚合。
-- 6. 正式接入时，需要同步补充 triggers.sql 的自动分区逻辑。

CREATE TABLE public.coefficient_buckets (
    game_id varchar(64) NOT NULL,
    bucket_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    resolution_domain varchar(16) NOT NULL
        CHECK (resolution_domain IN ('attribute', 'hp_change')),
    stage_key varchar(32) NOT NULL,
    target_attr_key varchar(64),
    aggregation_mode varchar(16) NOT NULL
        CHECK (aggregation_mode IN ('add', 'multiply', 'pick_max', 'set_final')),
    provisional boolean NOT NULL DEFAULT false,
    name varchar(100),
    description varchar(255),
    editor_hint jsonb NOT NULL DEFAULT '{}',
    bucket_config jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_coefficient_buckets PRIMARY KEY (game_id, bucket_key),
    CONSTRAINT ck_coefficient_buckets_bucket_key_format
        CHECK (bucket_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_coefficient_buckets_target_attr_key
        CHECK (
            (resolution_domain = 'attribute' AND target_attr_key IS NOT NULL)
            OR
            (resolution_domain = 'hp_change' AND target_attr_key IS NULL)
        ),
    CONSTRAINT fk_coefficient_buckets_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_coefficient_buckets_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.coefficient_buckets IS '乘区桶注册表；定义同组相加、异组相乘时的桶语义，供 hp 与普通属性共用';
COMMENT ON COLUMN public.coefficient_buckets.bucket_key IS '桶唯一 key，例如 lol.hp.source.damage_amp / lol.move_speed.percent_bonus';
COMMENT ON COLUMN public.coefficient_buckets.resolution_domain IS '桶服务的结算域：attribute(普通属性) / hp_change(生命值变动)';
COMMENT ON COLUMN public.coefficient_buckets.stage_key IS '所属结算阶段；不同游戏可自行定义 stage 名';
COMMENT ON COLUMN public.coefficient_buckets.target_attr_key IS '仅 attribute 域使用；表示该桶服务哪个 attr_key';
COMMENT ON COLUMN public.coefficient_buckets.aggregation_mode IS '该桶在运行时如何聚合：add/multiply/pick_max/set_final；用于覆盖移动速度等特殊属性';
COMMENT ON COLUMN public.coefficient_buckets.provisional IS '是否为临时桶；用于先拆开记录、后续经实测再合并';
COMMENT ON COLUMN public.coefficient_buckets.editor_hint IS '给前端编辑器的提示信息，例如中文组名、说明、示例';
COMMENT ON COLUMN public.coefficient_buckets.bucket_config IS '桶扩展配置；预留未来承载更复杂规则';

CREATE TABLE public.coefficient_buckets_log (
    game_id varchar(64) NOT NULL,
    bucket_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    resolution_domain varchar(16) NOT NULL
        CHECK (resolution_domain IN ('attribute', 'hp_change')),
    stage_key varchar(32) NOT NULL,
    target_attr_key varchar(64),
    aggregation_mode varchar(16) NOT NULL
        CHECK (aggregation_mode IN ('add', 'multiply', 'pick_max', 'set_final')),
    provisional boolean NOT NULL DEFAULT false,
    name varchar(100),
    description varchar(255),
    editor_hint jsonb NOT NULL DEFAULT '{}',
    bucket_config jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT pk_coefficient_buckets_log PRIMARY KEY (game_id, bucket_key, start_version_id),
    CONSTRAINT ck_coefficient_buckets_log_target_attr_key
        CHECK (
            (resolution_domain = 'attribute' AND target_attr_key IS NOT NULL)
            OR
            (resolution_domain = 'hp_change' AND target_attr_key IS NULL)
        ),
    CONSTRAINT fk_coefficient_buckets_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_coefficient_buckets_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.coefficient_buckets_log IS 'coefficient_buckets 日志表，用于多版本差异分析';

CREATE INDEX idx_coefficient_buckets_domain_stage
    ON public.coefficient_buckets (game_id, resolution_domain, stage_key);

CREATE INDEX idx_coefficient_buckets_attr
    ON public.coefficient_buckets (game_id, target_attr_key);

CREATE INDEX idx_coefficient_buckets_log_version
    ON public.coefficient_buckets_log (game_id, start_version_id, end_version_id);
