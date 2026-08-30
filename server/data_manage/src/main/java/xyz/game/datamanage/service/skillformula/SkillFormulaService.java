package xyz.game.datamanage.service.skillformula;

import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeRef;
import xyz.game.datamanage.model.skillformula.SkillFormulaAttributeStatusRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaExpressionNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaNodeType;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperationNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaParameterNode;
import xyz.game.datamanage.model.skillformula.SkillFormulaRow;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillFormulaService {

    private static final Logger log = LoggerFactory.getLogger(SkillFormulaService.class);

    private static final int ROOT_DEPTH = 1;
    private static final int MAX_DEPTH = 32;
    private static final int MAX_NODES = 256;
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_formulas";
    private static final Set<String> FORMULA_IN_USE_CONSTRAINTS = Set.of(
        "fk_skill_effect_result_values_formula",
        "fk_skill_internal_counter_initial_formula",
        "fk_skill_internal_counter_max_formula",
        "fk_skill_internal_ammo_initial_formula",
        "fk_skill_internal_ammo_max_formula",
        "fk_skill_internal_ammo_recovery_formula",
        "fk_skill_internal_cooldown_duration_formula",
        "fk_skill_process_delay_formula",
        "fk_skill_process_multi_count_formula",
        "fk_skill_process_multi_interval_formula",
        "fk_skill_process_periodic_count_formula",
        "fk_skill_process_periodic_interval_formula",
        "fk_skill_process_channel_duration_formula",
        "fk_skill_process_channel_count_formula",
        "fk_skill_process_charge_min_formula",
        "fk_skill_process_charge_max_formula",
        "fk_skill_process_recast_window_formula",
        "fk_skill_process_recast_count_formula",
        "fk_skill_process_empowered_window_formula",
        "fk_skill_process_cooldown_duration_formula",
        "fk_skill_process_state_operation_value_formula",
        "fk_skill_effect_lifecycles_duration_formula",
        "fk_skill_effect_lifecycles_max_stacks_formula",
        "fk_skill_effect_lifecycles_application_stacks_formula",
        "fk_skill_effect_lifecycles_periodic_interval_formula",
        "fk_skill_trigger_health_threshold_formula",
        "fk_skill_trigger_attr_cond_formula",
        "fk_skill_trigger_status_cond_formula",
        "fk_skill_trigger_istate_cond_formula",
        "fk_skill_trigger_event_value_cond_formula",
        "fk_skill_trigger_per_target_cd_formula",
        "fk_skill_trigger_process_limit_formula"
    );

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillFormulaMapper formulaMapper;
    private final SkillTriggerRuleService triggerRuleService;

    public SkillFormulaService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillFormulaMapper formulaMapper
    ) {
        this(gamesMapper, skillMapper, formulaMapper, null);
    }

    @Autowired
    public SkillFormulaService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillFormulaMapper formulaMapper,
        SkillTriggerRuleService triggerRuleService
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.formulaMapper = formulaMapper;
        this.triggerRuleService = triggerRuleService;
    }

    @Transactional(readOnly = true)
    public List<SkillFormulaSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillFormulaRow> rows = formulaMapper.listSummaries(gameId, skillKey);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        List<SkillFormulaSummaryResponse> items = new ArrayList<>(rows.size());
        for (SkillFormulaRow row : rows) {
            items.add(toSummary(row));
        }
        return items;
    }

    @Transactional(readOnly = true)
    public SkillFormulaDetailResponse get(String gameId, String skillKey, String formulaKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, formulaKey);
    }

    @Transactional
    public SkillFormulaDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillFormulaCreateRequest request
    ) {
        requireGame(gameId);
        ValidatedFormula values = validateCreate(request);
        CollectedRefs refs = validateAndCollectExpression(values.expression());

        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.countByKey(gameId, skillKey, values.formulaKey()) > 0) {
            throw keyExists();
        }

        validateReferences(gameId, skillKey, refs);
        validateAttributeEnabled(gameId, refs, Set.of());

        List<SkillFormulaNodeRow> nodes = flatten(
            gameId,
            skillKey,
            values.formulaKey(),
            values.expression()
        );
        try {
            formulaMapper.insert(
                gameId,
                skillKey,
                values.formulaKey(),
                values.name(),
                values.description(),
                values.sortOrder()
            );
            formulaMapper.batchInsertNodes(nodes);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, values.formulaKey());
    }

    @Transactional
    public SkillFormulaDetailResponse update(
        String gameId,
        String skillKey,
        String formulaKey,
        @Valid SkillFormulaUpdateRequest request
    ) {
        requireGame(gameId);
        ValidatedFormula values = validateUpdate(request, formulaKey);
        CollectedRefs refs = validateAndCollectExpression(values.expression());

        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }

        Set<SkillFormulaAttributeRef> existingRefs = new HashSet<>(
            nullToEmpty(formulaMapper.listAttributeRefs(gameId, skillKey, formulaKey))
        );
        validateReferences(gameId, skillKey, refs);
        validateAttributeEnabled(gameId, refs, existingRefs);

        List<SkillFormulaNodeRow> nodes = flatten(gameId, skillKey, formulaKey, values.expression());
        try {
            formulaMapper.deleteNodes(gameId, skillKey, formulaKey);
            if (formulaMapper.update(
                gameId,
                skillKey,
                formulaKey,
                values.name(),
                values.description(),
                values.sortOrder()
            ) == 0) {
                throw formulaNotFound(formulaKey);
            }
            formulaMapper.batchInsertNodes(nodes);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, formulaKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String formulaKey) {
        requireGame(gameId);
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (formulaMapper.findByIdForUpdate(gameId, skillKey, formulaKey) == null) {
            throw formulaNotFound(formulaKey);
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertFormulaDeletable(gameId, skillKey, formulaKey);
        }
        try {
            if (formulaMapper.delete(gameId, skillKey, formulaKey) == 0) {
                throw formulaNotFound(formulaKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    private SkillFormulaDetailResponse requireDetail(String gameId, String skillKey, String formulaKey) {
        SkillFormulaRow row = formulaMapper.findById(gameId, skillKey, formulaKey);
        if (row == null) {
            throw formulaNotFound(formulaKey);
        }
        List<SkillFormulaNodeRow> nodes = formulaMapper.listNodes(gameId, skillKey, formulaKey);
        SkillFormulaExpressionNode expression = rebuildExpression(gameId, skillKey, formulaKey, nodes);
        return toDetail(row, expression);
    }

    private ValidatedFormula validateCreate(SkillFormulaCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能公式不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.expression() == null) {
            issues.add(fieldIssue("expression", "REQUIRED", "公式表达式不能为空"));
        }
        throwIfInvalid(issues);
        return new ValidatedFormula(
            request.formulaKey(),
            request.name(),
            request.description(),
            request.sortOrder(),
            request.expression()
        );
    }

    private ValidatedFormula validateUpdate(SkillFormulaUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能公式不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.formulaKey() != null) {
            issues.add(fieldIssue("formulaKey", "IMMUTABLE", "公式标识不能修改"));
        }
        if (request.expression() == null) {
            issues.add(fieldIssue("expression", "REQUIRED", "公式表达式不能为空"));
        }
        throwIfInvalid(issues);
        return new ValidatedFormula(
            pathKey,
            request.name(),
            request.description(),
            request.sortOrder(),
            request.expression()
        );
    }

    private CollectedRefs validateAndCollectExpression(SkillFormulaExpressionNode root) {
        List<Map<String, String>> issues = new ArrayList<>();
        CollectedRefs refs = new CollectedRefs();
        IntCounter nodeCount = new IntCounter();
        walkValidate(root, "expression", ROOT_DEPTH, nodeCount, refs, issues);
        throwIfInvalid(issues);
        return refs;
    }

    private void walkValidate(
        SkillFormulaExpressionNode node,
        String path,
        int depth,
        IntCounter nodeCount,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (node == null) {
            issues.add(fieldIssue(path, "REQUIRED", "公式节点不能为空"));
            return;
        }
        nodeCount.value++;
        if (nodeCount.value > MAX_NODES) {
            issues.add(fieldIssue(path, "NODE_LIMIT", "公式节点总数不能超过" + MAX_NODES));
            return;
        }
        if (depth > MAX_DEPTH) {
            issues.add(fieldIssue(path, "DEPTH_LIMIT", "公式节点深度不能超过" + MAX_DEPTH));
            return;
        }

        validateForeignFields(node, path, issues);

        switch (node) {
            case SkillFormulaOperationNode operationNode ->
                validateOperation(operationNode, path, depth, nodeCount, refs, issues);
            case SkillFormulaParameterNode parameterNode ->
                validateParameter(parameterNode, path, refs, issues);
            case SkillFormulaAttributeNode attributeNode ->
                validateAttribute(attributeNode, path, refs, issues);
        }
    }

    private void validateForeignFields(
        SkillFormulaExpressionNode node,
        String path,
        List<Map<String, String>> issues
    ) {
        Set<String> foreignFields = node.foreignFields();
        if (foreignFields == null || foreignFields.isEmpty()) {
            return;
        }
        for (String field : foreignFields) {
            issues.add(fieldIssue(path + "." + field, "FIELD_MUTEX", "节点字段互斥"));
        }
    }

    private void validateOperation(
        SkillFormulaOperationNode node,
        String path,
        int depth,
        IntCounter nodeCount,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (node.nodeType() != null && node.nodeType() != SkillFormulaNodeType.OPERATION) {
            issues.add(fieldIssue(path + ".nodeType", "TYPE_MISMATCH", "运算节点类型必须为 OPERATION"));
        }
        if (node.operation() == null) {
            issues.add(fieldIssue(path + ".operation", "REQUIRED", "运算类型不能为空或不受支持"));
        } else if (!isSupportedOperation(node.operation())) {
            issues.add(fieldIssue(path + ".operation", "ENUM_INVALID", "运算类型不受支持"));
        }
        List<SkillFormulaExpressionNode> operands = node.operands();
        if (operands == null) {
            issues.add(fieldIssue(path + ".operands", "REQUIRED", "运算节点必须提供两个有序操作数"));
            return;
        }
        if (operands.size() != 2) {
            issues.add(fieldIssue(path + ".operands", "OPERAND_COUNT", "运算节点必须恰好有两个有序操作数"));
            return;
        }
        walkValidate(operands.get(0), path + ".operands[0]", depth + 1, nodeCount, refs, issues);
        walkValidate(operands.get(1), path + ".operands[1]", depth + 1, nodeCount, refs, issues);
    }

    private void validateParameter(
        SkillFormulaParameterNode node,
        String path,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (node.nodeType() != null && node.nodeType() != SkillFormulaNodeType.PARAMETER) {
            issues.add(fieldIssue(path + ".nodeType", "TYPE_MISMATCH", "参数节点类型必须为 PARAMETER"));
        }
        String parameterKey = node.parameterKey();
        if (parameterKey == null || parameterKey.isBlank()) {
            issues.add(fieldIssue(path + ".parameterKey", "REQUIRED", "参数引用不能为空"));
            return;
        }
        refs.parameterRefs.add(new PathRef(path + ".parameterKey", parameterKey));
        refs.parameterKeys.add(parameterKey);
    }

    private void validateAttribute(
        SkillFormulaAttributeNode node,
        String path,
        CollectedRefs refs,
        List<Map<String, String>> issues
    ) {
        if (node.nodeType() != null && node.nodeType() != SkillFormulaNodeType.ATTRIBUTE) {
            issues.add(fieldIssue(path + ".nodeType", "TYPE_MISMATCH", "属性节点类型必须为 ATTRIBUTE"));
        }
        if (node.attributeOwner() == null) {
            issues.add(fieldIssue(path + ".attributeOwner", "REQUIRED", "属性对象范围不能为空或不受支持"));
        }
        if (node.attributeValueKind() == null) {
            issues.add(fieldIssue(
                path + ".attributeValueKind",
                "REQUIRED",
                "属性取值方式不能为空或不受支持"
            ));
        }
        String attributeKey = node.attributeKey();
        if (attributeKey == null || attributeKey.isBlank()) {
            issues.add(fieldIssue(path + ".attributeKey", "REQUIRED", "属性键不能为空"));
            return;
        }
        if (node.attributeOwner() == null || node.attributeValueKind() == null) {
            return;
        }
        SkillFormulaAttributeRef ref = new SkillFormulaAttributeRef(
            node.attributeOwner(),
            attributeKey,
            node.attributeValueKind()
        );
        refs.attributeRefs.add(new AttributePathRef(path + ".attributeKey", ref));
        refs.attributeKeys.add(attributeKey);
    }

    private void validateReferences(String gameId, String skillKey, CollectedRefs refs) {
        Set<String> existingParameters = new HashSet<>();
        if (!refs.parameterKeys.isEmpty()) {
            existingParameters.addAll(nullToEmpty(
                formulaMapper.findExistingParameterKeys(gameId, skillKey, refs.parameterKeys)
            ));
        }
        Map<String, String> attributeStatusByKey = new LinkedHashMap<>();
        if (!refs.attributeKeys.isEmpty()) {
            for (SkillFormulaAttributeStatusRow row : nullToEmpty(
                formulaMapper.findAttributesByKeys(gameId, refs.attributeKeys)
            )) {
                attributeStatusByKey.put(row.attributeKey(), row.status());
            }
        }

        List<Map<String, String>> issues = new ArrayList<>();
        for (PathRef ref : refs.parameterRefs) {
            if (!existingParameters.contains(ref.value())) {
                issues.add(fieldIssue(
                    ref.path(),
                    "UNKNOWN_SKILL_PARAMETER",
                    "技能参数不存在或不属于当前技能"
                ));
            }
        }
        for (AttributePathRef ref : refs.attributeRefs) {
            if (!attributeStatusByKey.containsKey(ref.ref().attributeKey())) {
                issues.add(fieldIssue(
                    ref.path(),
                    "UNKNOWN_ATTRIBUTE",
                    "属性不存在或不属于当前游戏"
                ));
            }
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_FORMULA_REFERENCE",
                "公式引用不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
        refs.attributeStatusByKey.putAll(attributeStatusByKey);
    }

    private void validateAttributeEnabled(
        String gameId,
        CollectedRefs refs,
        Set<SkillFormulaAttributeRef> existingRefs
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        Set<SkillFormulaAttributeRef> reported = new HashSet<>();
        for (AttributePathRef pathRef : refs.attributeRefs) {
            SkillFormulaAttributeRef ref = pathRef.ref();
            if (existingRefs.contains(ref) || !reported.add(ref)) {
                continue;
            }
            String status = refs.attributeStatusByKey.get(ref.attributeKey());
            if (!AttributeStatus.ENABLED.name().equals(status)) {
                issues.add(fieldIssue(
                    pathRef.path(),
                    "FORMULA_ATTRIBUTE_DISABLED",
                    "不能新增停用属性引用"
                ));
            }
        }
        if (!issues.isEmpty()) {
            issues.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.CONFLICT,
                "409.FORMULA_ATTRIBUTE_DISABLED",
                "不能新增停用属性引用",
                Map.of("fieldIssues", List.copyOf(issues), "gameId", gameId)
            );
        }
    }

    private List<SkillFormulaNodeRow> flatten(
        String gameId,
        String skillKey,
        String formulaKey,
        SkillFormulaExpressionNode root
    ) {
        List<SkillFormulaNodeRow> rows = new ArrayList<>();
        flattenNode(gameId, skillKey, formulaKey, root, null, (short) 0, rows);
        return rows;
    }

    private void flattenNode(
        String gameId,
        String skillKey,
        String formulaKey,
        SkillFormulaExpressionNode node,
        UUID parentNodeId,
        short childOrder,
        List<SkillFormulaNodeRow> rows
    ) {
        UUID nodeId = UUID.randomUUID();
        switch (node) {
            case SkillFormulaOperationNode operationNode -> {
                rows.add(new SkillFormulaNodeRow(
                    gameId,
                    skillKey,
                    formulaKey,
                    nodeId,
                    parentNodeId,
                    childOrder,
                    SkillFormulaNodeType.OPERATION,
                    operationNode.operation(),
                    null,
                    null,
                    null,
                    null
                ));
                flattenNode(
                    gameId,
                    skillKey,
                    formulaKey,
                    operationNode.operands().get(0),
                    nodeId,
                    (short) 0,
                    rows
                );
                flattenNode(
                    gameId,
                    skillKey,
                    formulaKey,
                    operationNode.operands().get(1),
                    nodeId,
                    (short) 1,
                    rows
                );
            }
            case SkillFormulaParameterNode parameterNode -> rows.add(new SkillFormulaNodeRow(
                gameId,
                skillKey,
                formulaKey,
                nodeId,
                parentNodeId,
                childOrder,
                SkillFormulaNodeType.PARAMETER,
                null,
                parameterNode.parameterKey(),
                null,
                null,
                null
            ));
            case SkillFormulaAttributeNode attributeNode -> rows.add(new SkillFormulaNodeRow(
                gameId,
                skillKey,
                formulaKey,
                nodeId,
                parentNodeId,
                childOrder,
                SkillFormulaNodeType.ATTRIBUTE,
                null,
                null,
                attributeNode.attributeOwner(),
                attributeNode.attributeKey(),
                attributeNode.attributeValueKind()
            ));
        }
    }

    private SkillFormulaExpressionNode rebuildExpression(
        String gameId,
        String skillKey,
        String formulaKey,
        List<SkillFormulaNodeRow> nodes
    ) {
        if (nodes == null || nodes.isEmpty()) {
            throw corrupt(gameId, skillKey, formulaKey, "公式缺少节点");
        }

        Map<UUID, SkillFormulaNodeRow> byId = new HashMap<>();
        Map<UUID, SkillFormulaNodeRow[]> childrenByParent = new HashMap<>();
        SkillFormulaNodeRow root = null;

        for (SkillFormulaNodeRow node : nodes) {
            if (node == null || node.nodeId() == null || node.nodeType() == null) {
                throw corrupt(gameId, skillKey, formulaKey, "公式节点字段缺失");
            }
            if (byId.put(node.nodeId(), node) != null) {
                throw corrupt(gameId, skillKey, formulaKey, "公式节点 UUID 重复");
            }
            if (node.parentNodeId() == null) {
                if (root != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "公式存在多个根节点");
                }
                if (node.childOrder() == null || node.childOrder() != 0) {
                    throw corrupt(gameId, skillKey, formulaKey, "根节点 child_order 必须为 0");
                }
                root = node;
                continue;
            }
            if (node.childOrder() == null || (node.childOrder() != 0 && node.childOrder() != 1)) {
                throw corrupt(gameId, skillKey, formulaKey, "子节点 child_order 非法");
            }
            SkillFormulaNodeRow[] siblings = childrenByParent.computeIfAbsent(
                node.parentNodeId(),
                ignored -> new SkillFormulaNodeRow[2]
            );
            if (siblings[node.childOrder()] != null) {
                throw corrupt(gameId, skillKey, formulaKey, "同级 child_order 重复");
            }
            siblings[node.childOrder()] = node;
        }

        if (root == null) {
            throw corrupt(gameId, skillKey, formulaKey, "公式缺少根节点");
        }

        Set<UUID> visited = new HashSet<>();
        SkillFormulaExpressionNode expression = rebuildNode(
            gameId,
            skillKey,
            formulaKey,
            root,
            childrenByParent,
            visited
        );
        if (visited.size() != nodes.size()) {
            throw corrupt(gameId, skillKey, formulaKey, "公式存在环、孤儿或重复访问节点");
        }
        return expression;
    }

    private SkillFormulaExpressionNode rebuildNode(
        String gameId,
        String skillKey,
        String formulaKey,
        SkillFormulaNodeRow node,
        Map<UUID, SkillFormulaNodeRow[]> childrenByParent,
        Set<UUID> visited
    ) {
        if (!visited.add(node.nodeId())) {
            throw corrupt(gameId, skillKey, formulaKey, "公式节点被重复访问");
        }

        SkillFormulaNodeRow[] children = childrenByParent.get(node.nodeId());
        return switch (node.nodeType()) {
            case OPERATION -> {
                if (node.operation() == null
                    || node.parameterKey() != null
                    || node.attributeOwner() != null
                    || node.attributeKey() != null
                    || node.attributeValueKind() != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "运算节点载荷不一致");
                }
                if (children == null || children[0] == null || children[1] == null) {
                    throw corrupt(gameId, skillKey, formulaKey, "运算节点必须恰好有两个子节点");
                }
                yield new SkillFormulaOperationNode(
                    node.operation(),
                    List.of(
                        rebuildNode(gameId, skillKey, formulaKey, children[0], childrenByParent, visited),
                        rebuildNode(gameId, skillKey, formulaKey, children[1], childrenByParent, visited)
                    )
                );
            }
            case PARAMETER -> {
                if (children != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "参数节点不能有子节点");
                }
                if (node.parameterKey() == null
                    || node.operation() != null
                    || node.attributeOwner() != null
                    || node.attributeKey() != null
                    || node.attributeValueKind() != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "参数节点载荷不一致");
                }
                yield new SkillFormulaParameterNode(node.parameterKey());
            }
            case ATTRIBUTE -> {
                if (children != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "属性节点不能有子节点");
                }
                if (node.attributeOwner() == null
                    || node.attributeKey() == null
                    || node.attributeValueKind() == null
                    || node.operation() != null
                    || node.parameterKey() != null) {
                    throw corrupt(gameId, skillKey, formulaKey, "属性节点载荷不一致");
                }
                yield new SkillFormulaAttributeNode(
                    node.attributeOwner(),
                    node.attributeKey(),
                    node.attributeValueKind()
                );
            }
        };
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private void requireSkillExists(String gameId, String skillKey) {
        if (skillMapper.findById(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private static SkillFormulaSummaryResponse toSummary(SkillFormulaRow row) {
        return new SkillFormulaSummaryResponse(
            row.gameId(),
            row.skillKey(),
            row.formulaKey(),
            row.name(),
            row.description(),
            row.sortOrder(),
            row.createdAt(),
            row.updatedAt()
        );
    }

    private static SkillFormulaDetailResponse toDetail(
        SkillFormulaRow row,
        SkillFormulaExpressionNode expression
    ) {
        return new SkillFormulaDetailResponse(
            row.gameId(),
            row.skillKey(),
            row.formulaKey(),
            row.name(),
            row.description(),
            row.sortOrder(),
            expression,
            row.createdAt(),
            row.updatedAt()
        );
    }

    private static boolean isSupportedOperation(SkillFormulaOperation operation) {
        return operation == SkillFormulaOperation.ADD
            || operation == SkillFormulaOperation.SUBTRACT
            || operation == SkillFormulaOperation.MULTIPLY
            || operation == SkillFormulaOperation.DIVIDE
            || operation == SkillFormulaOperation.MIN
            || operation == SkillFormulaOperation.MAX;
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能公式不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
        );
    }

    private static ApiException skillNotFound(String skillKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_NOT_FOUND",
            "技能不存在",
            Map.of("skillKey", skillKey == null ? "" : skillKey)
        );
    }

    private static ApiException formulaNotFound(String formulaKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_FORMULA_NOT_FOUND",
            "技能公式不存在",
            Map.of("formulaKey", formulaKey == null ? "" : formulaKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_FORMULA_KEY_EXISTS", "技能公式标识已存在", "formulaKey");
    }

    private static ApiException formulaInUse() {
        return conflict("409.SKILL_FORMULA_IN_USE", "技能公式已被引用，不能删除", "formulaKey");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private ApiException corrupt(
        String gameId,
        String skillKey,
        String formulaKey,
        String reason
    ) {
        log.error(
            "Skill formula data corruption detected. gameId={}, skillKey={}, formulaKey={}, reason={}",
            gameId,
            skillKey,
            formulaKey,
            reason
        );
        return new ApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "500.INTERNAL_ERROR",
            "技能公式数据损坏",
            Map.of(
                "gameId", gameId,
                "skillKey", skillKey,
                "formulaKey", formulaKey,
                "reason", reason
            )
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        for (String constraint : FORMULA_IN_USE_CONSTRAINTS) {
            if (text.contains(constraint)) {
                return formulaInUse();
            }
        }
        return ex;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
        }
        return result.toString();
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private record ValidatedFormula(
        String formulaKey,
        String name,
        String description,
        Integer sortOrder,
        SkillFormulaExpressionNode expression
    ) {
    }

    private static final class CollectedRefs {
        private final List<PathRef> parameterRefs = new ArrayList<>();
        private final List<AttributePathRef> attributeRefs = new ArrayList<>();
        private final LinkedHashSet<String> parameterKeys = new LinkedHashSet<>();
        private final LinkedHashSet<String> attributeKeys = new LinkedHashSet<>();
        private final Map<String, String> attributeStatusByKey = new HashMap<>();
    }

    private record PathRef(String path, String value) {
    }

    private record AttributePathRef(String path, SkillFormulaAttributeRef ref) {
    }

    private static final class IntCounter {
        private int value;
    }
}
