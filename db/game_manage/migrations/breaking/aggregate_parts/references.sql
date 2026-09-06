-- 系统派生的引用明细，没有独立业务编辑入口；由游戏配置写事务整体重建。
CREATE TABLE public.skill_object_references (
    game_id varchar(64) NOT NULL,
    source_skill_key varchar(64) NOT NULL,
    source_type varchar(16) NOT NULL,
    source_key varchar(64) NOT NULL,
    field_path text NOT NULL,
    target_type varchar(16) NOT NULL,
    target_skill_key varchar(64) NOT NULL,
    target_key varchar(64) NOT NULL,
    target_sub_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_object_references PRIMARY KEY (
        game_id, source_skill_key, source_type, source_key, field_path,
        target_type, target_skill_key, target_key, target_sub_key
    ),
    CONSTRAINT fk_skill_object_references_game FOREIGN KEY (game_id)
        REFERENCES public.games (game_id) ON DELETE CASCADE,
    CONSTRAINT fk_skill_object_references_skill FOREIGN KEY (game_id, source_skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE CASCADE,
    CONSTRAINT ck_skill_object_references_source_type CHECK (
        source_type IN ('FORMULA', 'EFFECT', 'STATE', 'PROCESS', 'TRIGGER')
    ),
    CONSTRAINT ck_skill_object_references_target_type CHECK (
        target_type IN ('ATTRIBUTE', 'PARAMETER', 'FORMULA', 'SKILL', 'CATEGORY', 'DAMAGE_TYPE',
            'MODIFIER_ZONE', 'STATUS', 'EFFECT', 'RESULT', 'LIFECYCLE', 'STATE', 'OPTION',
            'PROCESS', 'STEP', 'ACTION')
    ),
    CONSTRAINT ck_skill_object_references_path CHECK (btrim(field_path) <> ''),
    CONSTRAINT ck_skill_object_references_target CHECK (btrim(target_key) <> '')
);

CREATE INDEX ix_skill_object_references_target ON public.skill_object_references
    (game_id, target_type, target_skill_key, target_key, target_sub_key);

COMMENT ON TABLE public.skill_object_references IS '从技能组成提取的系统引用明细';
