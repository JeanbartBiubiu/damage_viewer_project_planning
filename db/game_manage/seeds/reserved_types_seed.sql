-- =============================================================================
-- Reserved Type Registry Seed
-- =============================================================================
--
-- reserved_type.type_id is the cross-module stable semantic identifier.
-- Reserved type ID ranges:
-- - 10000-19999: first-level reserved groups.
-- - 20000-29999: second-level reserved semantics.
-- public.types.type_id is still game-local business data; allocate it from 30000.
-- Application code should resolve a game's concrete typeId by matching
-- types.reserved_type_id.

INSERT INTO public.reserved_type (type_id, name)
VALUES
    (10000, '属性录入分组'),
    (10002, 'Wasm 模拟验证状态'),
    (20000, '人物成长属性'),
    (20001, '机制属性'),
    (20010, '单攻击方 DPS 已验证可选')
ON CONFLICT (type_id) DO UPDATE SET
    name = EXCLUDED.name;

INSERT INTO public.reserved_type_relation (type_id, parent_type_id)
VALUES
    (20000, 10000),
    (20001, 10000),
    (20010, 10002)
ON CONFLICT (type_id, parent_type_id) DO NOTHING;
