-- 由系统精简主迁移在外层事务及停写窗口中执行；此片段不删除旧表。
-- 先核对所有树，避免将孤儿、环或超限节点静默丢弃。
DO $formula_preflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.skill_formulas f
        LEFT JOIN public.skill_formula_nodes n USING (game_id, skill_key, formula_key)
        GROUP BY f.game_id, f.skill_key, f.formula_key
        HAVING count(n.node_id) NOT BETWEEN 1 AND 256
            OR count(n.node_id) FILTER (WHERE n.parent_node_id IS NULL) <> 1
    ) THEN
        RAISE EXCEPTION '公式迁移失败：每个公式必须有一个根及 1 至 256 个节点';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.skill_formula_nodes n
        LEFT JOIN public.skill_formula_nodes c
          ON c.game_id = n.game_id AND c.skill_key = n.skill_key
         AND c.formula_key = n.formula_key AND c.parent_node_id = n.node_id
        GROUP BY n.game_id, n.skill_key, n.formula_key, n.node_id, n.node_type,
                 n.parent_node_id, n.child_order
        HAVING (n.node_type = 'OPERATION' AND
                    (count(c.node_id) <> 2 OR min(c.child_order) <> 0 OR max(c.child_order) <> 1))
            OR (n.node_type IN ('PARAMETER', 'ATTRIBUTE') AND count(c.node_id) <> 0)
            OR n.node_type NOT IN ('OPERATION', 'PARAMETER', 'ATTRIBUTE')
            OR (n.parent_node_id IS NULL AND n.child_order <> 0)
    ) THEN
        RAISE EXCEPTION '公式迁移失败：运算节点必须按顺序包含两个子节点，引用节点不能有子节点';
    END IF;

    IF EXISTS (
        WITH RECURSIVE reachable AS (
            SELECT n.game_id, n.skill_key, n.formula_key, n.node_id, 1 AS depth,
                   ARRAY[n.node_id] AS visited
            FROM public.skill_formula_nodes n
            WHERE n.parent_node_id IS NULL
            UNION ALL
            SELECT c.game_id, c.skill_key, c.formula_key, c.node_id, p.depth + 1,
                   p.visited || c.node_id
            FROM reachable p
            JOIN public.skill_formula_nodes c
              ON c.game_id = p.game_id AND c.skill_key = p.skill_key
             AND c.formula_key = p.formula_key AND c.parent_node_id = p.node_id
            WHERE p.depth < 33 AND NOT c.node_id = ANY(p.visited)
        )
        SELECT 1
        FROM public.skill_formula_nodes n
        LEFT JOIN reachable r USING (game_id, skill_key, formula_key, node_id)
        WHERE r.node_id IS NULL OR r.depth > 32
    ) THEN
        RAISE EXCEPTION '公式迁移失败：表达式包含环、孤儿或超过 32 层的节点';
    END IF;
END;
$formula_preflight$;

ALTER TABLE public.skill_formulas ADD COLUMN expression jsonb;

-- 会话临时函数仅用于保持运算顺序地重建现有接口表达式。
CREATE FUNCTION pg_temp.damage_formula_expression(
    p_game_id varchar, p_skill_key varchar, p_formula_key varchar,
    p_node_id uuid, p_depth integer
) RETURNS jsonb LANGUAGE plpgsql AS $formula_expression$
DECLARE
    current_node public.skill_formula_nodes%ROWTYPE;
    children jsonb;
BEGIN
    IF p_depth > 32 THEN
        RAISE EXCEPTION '公式迁移失败：表达式超过 32 层';
    END IF;
    SELECT * INTO STRICT current_node
    FROM public.skill_formula_nodes
    WHERE game_id = p_game_id AND skill_key = p_skill_key
      AND formula_key = p_formula_key AND node_id = p_node_id;
    CASE current_node.node_type
        WHEN 'OPERATION' THEN
            SELECT jsonb_agg(pg_temp.damage_formula_expression(
                p_game_id, p_skill_key, p_formula_key, n.node_id, p_depth + 1
            ) ORDER BY n.child_order) INTO children
            FROM public.skill_formula_nodes n
            WHERE n.game_id = p_game_id AND n.skill_key = p_skill_key
              AND n.formula_key = p_formula_key AND n.parent_node_id = p_node_id;
            RETURN jsonb_build_object('nodeType', 'OPERATION',
                'operation', current_node.operation, 'operands', children);
        WHEN 'PARAMETER' THEN
            RETURN jsonb_build_object('nodeType', 'PARAMETER',
                'parameterKey', current_node.parameter_key);
        WHEN 'ATTRIBUTE' THEN
            RETURN jsonb_build_object('nodeType', 'ATTRIBUTE',
                'attributeOwner', current_node.attribute_owner,
                'attributeKey', current_node.attribute_key,
                'attributeValueKind', current_node.attribute_value_kind);
        ELSE
            RAISE EXCEPTION '公式迁移失败：未知节点类型';
    END CASE;
END;
$formula_expression$;

UPDATE public.skill_formulas f
SET expression = pg_temp.damage_formula_expression(f.game_id, f.skill_key, f.formula_key, n.node_id, 1)
FROM public.skill_formula_nodes n
WHERE n.game_id = f.game_id AND n.skill_key = f.skill_key AND n.formula_key = f.formula_key
  AND n.parent_node_id IS NULL;

ALTER TABLE public.skill_formulas
    ALTER COLUMN expression SET NOT NULL,
    ADD CONSTRAINT ck_skill_formulas_expression CHECK (jsonb_typeof(expression) = 'object');
