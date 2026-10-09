-- 本次迁移只改变引用来源的所属约束；调用者必须在同事务完成既有公式转换与来源索引插入。
-- 不包含 BEGIN/COMMIT，不批量重放初始化，不重建既有引用；新结构存在时拒绝重放。
ALTER TABLE public.skill_object_references
    ADD COLUMN source_owner_skill_key varchar(64) GENERATED ALWAYS AS
        (CASE WHEN source_type <> 'DAMAGE_TYPE' THEN source_skill_key END) STORED,
    ADD COLUMN source_owner_damage_type_key varchar(64) GENERATED ALWAYS AS
        (CASE WHEN source_type = 'DAMAGE_TYPE' THEN source_key END) STORED;

ALTER TABLE public.skill_object_references
    DROP CONSTRAINT fk_skill_object_references_skill,
    DROP CONSTRAINT ck_skill_object_references_source_type,
    ADD CONSTRAINT fk_skill_object_references_skill FOREIGN KEY (game_id, source_owner_skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE CASCADE,
    ADD CONSTRAINT fk_skill_object_references_damage_type FOREIGN KEY (game_id, source_owner_damage_type_key)
        REFERENCES public.damage_types (game_id, damage_type_key) ON DELETE CASCADE,
    ADD CONSTRAINT ck_skill_object_references_source_type CHECK
        (source_type IN ('FORMULA', 'EFFECT', 'STATE', 'PROCESS', 'TRIGGER', 'DAMAGE_TYPE')),
    ADD CONSTRAINT ck_skill_object_references_source_shape CHECK
        ((source_type = 'DAMAGE_TYPE' AND source_skill_key = '' AND btrim(source_key) <> '')
        OR (source_type <> 'DAMAGE_TYPE' AND btrim(source_skill_key) <> '' AND btrim(source_key) <> ''));

COMMENT ON TABLE public.skill_object_references IS '从技能组成及伤害类型共同公式提取的系统引用明细';
