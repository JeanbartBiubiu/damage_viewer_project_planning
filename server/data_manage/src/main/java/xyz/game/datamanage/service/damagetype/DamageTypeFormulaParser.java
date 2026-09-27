package xyz.game.datamanage.service.damagetype;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.damagetype.DamageTypeCalculationFormula;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaAttributeNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaFixedNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaOperationNode;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaStage;
import xyz.game.datamanage.model.damagetype.DamageTypeFormulaStageResultNode;
import xyz.game.datamanage.model.skillformula.AttributeOwner;
import xyz.game.datamanage.model.skillformula.AttributeValueKind;
import xyz.game.datamanage.model.skillformula.SkillFormulaOperation;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.error.ApiException;

/** 校验伤害类型结算公式的形状，并收集属性与阶段引用。不计算公式。 */
final class DamageTypeFormulaParser {

    static final int MAX_DEPTH = 32;
    static final int MAX_NODES = 256;

    private static final List<StageSlot> STAGES = List.of(
        new StageSlot("resistanceBeforePenetration", DamageTypeFormulaStage.RESISTANCE_BEFORE_PENETRATION),
        new StageSlot("penetrationPercent", DamageTypeFormulaStage.PENETRATION_PERCENT),
        new StageSlot("penetrationFlat", DamageTypeFormulaStage.PENETRATION_FLAT),
        new StageSlot("effectiveResistance", DamageTypeFormulaStage.EFFECTIVE_RESISTANCE),
        new StageSlot("resistanceFactor", DamageTypeFormulaStage.RESISTANCE_FACTOR)
    );

    private static final Set<String> ROOT_FIELDS = Set.of(
        "resistanceBeforePenetration",
        "penetrationPercent",
        "penetrationFlat",
        "effectiveResistance",
        "resistanceFactor"
    );
    private static final Set<String> OPERATION_FIELDS = Set.of("nodeType", "operation", "operands");
    private static final Set<String> FIXED_FIELDS = Set.of("nodeType", "value");
    private static final Set<String> ATTRIBUTE_FIELDS = Set.of(
        "nodeType", "attributeOwner", "attributeKey", "attributeValueKind"
    );
    private static final Set<String> STAGE_FIELDS = Set.of("nodeType", "stageKey");
    private static final Set<String> KNOWN_NODE_FIELDS = Set.of(
        "nodeType",
        "operation",
        "operands",
        "value",
        "attributeOwner",
        "attributeKey",
        "attributeValueKind",
        "stageKey",
        "parameterKey"
    );

    private DamageTypeFormulaParser() {
    }

    static Shape parseShape(JsonNode formula) {
        IssueBag issues = new IssueBag();
        if (formula == null || formula.isNull() || formula.isMissingNode()) {
            issues.validation("formula", "REQUIRED", "结算公式不能为空");
            issues.throwIfAny();
        }
        if (!formula.isObject()) {
            issues.binding("formula", "TYPE_INVALID", "结算公式必须是 JSON 对象");
            issues.throwIfAny();
        }
        List<AttributeUse> attributes = new ArrayList<>();
        List<StageUse> stageUses = new ArrayList<>();
        RawNode resistance = parseSlot(formula, STAGES.get(0), issues, attributes, stageUses);
        RawNode percent = parseSlot(formula, STAGES.get(1), issues, attributes, stageUses);
        RawNode flat = parseSlot(formula, STAGES.get(2), issues, attributes, stageUses);
        RawNode effective = parseSlot(formula, STAGES.get(3), issues, attributes, stageUses);
        RawNode factor = parseSlot(formula, STAGES.get(4), issues, attributes, stageUses);
        Iterator<String> names = formula.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!ROOT_FIELDS.contains(name)) {
                issues.validation("formula." + name, "UNKNOWN_FIELD", "不能包含未定义字段");
            }
        }
        issues.throwIfAny();
        return new Shape(
            new RawFormula(resistance, percent, flat, effective, factor),
            List.copyOf(attributes),
            List.copyOf(stageUses)
        );
    }

    static DamageTypeCalculationFormula readStored(String json) {
        if (json == null || json.isBlank()) {
            throw new IllegalStateException("伤害类型结算公式数据损坏");
        }
        JsonNode node = AggregateJson.tree(json);
        Shape shape;
        try {
            shape = parseShape(node);
        } catch (ApiException ex) {
            throw new IllegalStateException("伤害类型结算公式数据损坏", ex);
        }
        for (StageUse use : shape.stages()) {
            DamageTypeFormulaStage target = DamageTypeFormulaStage.fromText(use.stageKey());
            if (target == null || !use.owner().allows(target)) {
                throw new IllegalStateException("伤害类型结算公式数据损坏");
            }
        }
        return shape.toModel();
    }

    static Set<AttributeIdentity> identities(DamageTypeCalculationFormula formula) {
        Set<AttributeIdentity> result = new HashSet<>();
        collect(formula.resistanceBeforePenetration(), result);
        collect(formula.penetrationPercent(), result);
        collect(formula.penetrationFlat(), result);
        collect(formula.effectiveResistance(), result);
        collect(formula.resistanceFactor(), result);
        return result;
    }

    private static void collect(DamageTypeFormulaNode node, Set<AttributeIdentity> result) {
        switch (node) {
            case DamageTypeFormulaOperationNode operation -> {
                for (DamageTypeFormulaNode operand : operation.operands()) {
                    collect(operand, result);
                }
            }
            case DamageTypeFormulaAttributeNode attribute -> result.add(new AttributeIdentity(
                attribute.attributeOwner(),
                attribute.attributeKey(),
                attribute.attributeValueKind()
            ));
            case DamageTypeFormulaFixedNode ignored -> {
            }
            case DamageTypeFormulaStageResultNode ignored -> {
            }
        }
    }

    private static RawNode parseSlot(
        JsonNode formula,
        StageSlot slot,
        IssueBag issues,
        List<AttributeUse> attributes,
        List<StageUse> stageUses
    ) {
        JsonNode node = formula.get(slot.name());
        if (node == null || node.isNull()) {
            issues.validation("formula." + slot.name(), "REQUIRED", "结算阶段不能为空");
            return null;
        }
        if (!node.isObject()) {
            issues.binding("formula." + slot.name(), "TYPE_INVALID", "结算阶段必须是 JSON 对象");
            return null;
        }
        return parseNode(node, "formula." + slot.name(), 1, new Counter(), issues, slot.stage(), attributes, stageUses);
    }

    private static RawNode parseNode(
        JsonNode node,
        String path,
        int depth,
        Counter nodeCount,
        IssueBag issues,
        DamageTypeFormulaStage owner,
        List<AttributeUse> attributes,
        List<StageUse> stageUses
    ) {
        if (node == null || node.isNull()) {
            issues.validation(path, "REQUIRED", "公式节点不能为空");
            return null;
        }
        if (!node.isObject()) {
            issues.binding(path, "TYPE_INVALID", "公式节点必须是 JSON 对象");
            return null;
        }
        nodeCount.value++;
        if (nodeCount.value > MAX_NODES) {
            issues.validation(path, "NODE_LIMIT", "公式节点总数不能超过" + MAX_NODES);
            return null;
        }
        if (depth > MAX_DEPTH) {
            issues.validation(path, "DEPTH_LIMIT", "公式节点深度不能超过" + MAX_DEPTH);
            return null;
        }
        JsonNode typeNode = node.get("nodeType");
        if (typeNode == null || typeNode.isNull()) {
            issues.validation(path + ".nodeType", "REQUIRED", "节点类型不能为空");
            return null;
        }
        if (!typeNode.isTextual()) {
            issues.binding(path + ".nodeType", "TYPE_INVALID", "节点类型不正确");
            return null;
        }
        String typeName = typeNode.textValue();
        Set<String> allowed = switch (typeName) {
            case "OPERATION" -> OPERATION_FIELDS;
            case "FIXED" -> FIXED_FIELDS;
            case "ATTRIBUTE" -> ATTRIBUTE_FIELDS;
            case "STAGE_RESULT" -> STAGE_FIELDS;
            default -> null;
        };
        if (allowed == null) {
            issues.binding(path + ".nodeType", "ENUM_INVALID", "节点类型不受支持");
            return null;
        }
        rejectUnexpectedFields(node, path, allowed, issues);
        return switch (typeName) {
            case "OPERATION" -> parseOperation(node, path, depth, nodeCount, issues, owner, attributes, stageUses);
            case "FIXED" -> parseFixed(node, path, issues);
            case "ATTRIBUTE" -> parseAttribute(node, path, issues, attributes);
            case "STAGE_RESULT" -> parseStage(node, path, owner, issues, stageUses);
            default -> null;
        };
    }

    private static void rejectUnexpectedFields(JsonNode node, String path, Set<String> allowed, IssueBag issues) {
        Iterator<String> names = node.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (allowed.contains(name)) {
                continue;
            }
            if (KNOWN_NODE_FIELDS.contains(name)) {
                issues.validation(path + "." + name, "FIELD_MUTEX", "节点字段互斥");
            } else {
                issues.validation(path + "." + name, "UNKNOWN_FIELD", "不能包含未定义字段");
            }
        }
    }

    private static RawNode parseOperation(
        JsonNode node,
        String path,
        int depth,
        Counter nodeCount,
        IssueBag issues,
        DamageTypeFormulaStage owner,
        List<AttributeUse> attributes,
        List<StageUse> stageUses
    ) {
        JsonNode operationNode = node.get("operation");
        SkillFormulaOperation operation = null;
        if (operationNode == null || operationNode.isNull()) {
            issues.validation(path + ".operation", "REQUIRED", "运算类型不能为空");
        } else if (!operationNode.isTextual()) {
            issues.binding(path + ".operation", "TYPE_INVALID", "运算类型不正确");
        } else {
            operation = SkillFormulaOperation.fromJson(operationNode.textValue());
            if (operation == null) {
                issues.binding(path + ".operation", "ENUM_INVALID", "运算类型不受支持");
            }
        }
        JsonNode operands = node.get("operands");
        List<RawNode> children = List.of();
        if (operands == null || operands.isNull()) {
            issues.validation(path + ".operands", "REQUIRED", "运算节点必须提供两个有序操作数");
        } else if (!operands.isArray()) {
            issues.binding(path + ".operands", "TYPE_INVALID", "运算操作数必须是数组");
        } else {
            if (operands.size() != 2) {
                issues.validation(path + ".operands", "OPERAND_COUNT", "运算节点必须恰好有两个有序操作数");
            }
            List<RawNode> parsed = new ArrayList<>(operands.size());
            for (int index = 0; index < operands.size(); index++) {
                parsed.add(parseNode(
                    operands.get(index),
                    path + ".operands[" + index + "]",
                    depth + 1,
                    nodeCount,
                    issues,
                    owner,
                    attributes,
                    stageUses
                ));
            }
            children = parsed;
        }
        return new RawOperation(operation, children);
    }

    private static RawNode parseFixed(JsonNode node, String path, IssueBag issues) {
        JsonNode value = node.get("value");
        if (value == null || value.isMissingNode()) {
            issues.validation(path + ".value", "REQUIRED", "固定值不能为空");
            return new RawFixed(null);
        }
        BigDecimal number = finiteNumber(value);
        if (number == null) {
            issues.validation(path + ".value", "VALUE_SHAPE", "固定值必须是有限数值");
            return new RawFixed(null);
        }
        return new RawFixed(number);
    }

    private static BigDecimal finiteNumber(JsonNode value) {
        if (value == null || value.isNull() || !value.isNumber()) {
            return null;
        }
        try {
            BigDecimal decimal = value.decimalValue();
            return decimal == null ? null : decimal;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static RawNode parseAttribute(
        JsonNode node,
        String path,
        IssueBag issues,
        List<AttributeUse> attributes
    ) {
        AttributeOwner owner = readOwner(node.get("attributeOwner"), path + ".attributeOwner", issues);
        AttributeValueKind kind = readKind(node.get("attributeValueKind"), path + ".attributeValueKind", issues);
        JsonNode keyNode = node.get("attributeKey");
        String key = null;
        if (keyNode == null || keyNode.isNull()) {
            issues.validation(path + ".attributeKey", "REQUIRED", "属性键不能为空");
        } else if (!keyNode.isTextual()) {
            issues.binding(path + ".attributeKey", "TYPE_INVALID", "属性键必须是字符串");
        } else {
            key = keyNode.textValue().trim();
            if (key.isEmpty()) {
                issues.validation(path + ".attributeKey", "REQUIRED", "属性键不能为空");
                key = null;
            }
        }
        if (owner != null && kind != null && key != null) {
            attributes.add(new AttributeUse(path + ".attributeKey", owner, key, kind));
        }
        return new RawAttribute(owner, key, kind);
    }

    private static AttributeOwner readOwner(JsonNode node, String path, IssueBag issues) {
        if (node == null || node.isNull()) {
            issues.validation(path, "REQUIRED", "属性对象不能为空");
            return null;
        }
        if (!node.isTextual()) {
            issues.binding(path, "TYPE_INVALID", "属性对象类型不正确");
            return null;
        }
        AttributeOwner owner = AttributeOwner.fromJson(node.textValue());
        if (owner == null) {
            issues.binding(path, "ENUM_INVALID", "属性对象不受支持");
        }
        return owner;
    }

    private static AttributeValueKind readKind(JsonNode node, String path, IssueBag issues) {
        if (node == null || node.isNull()) {
            issues.validation(path, "REQUIRED", "属性取值方式不能为空");
            return null;
        }
        if (!node.isTextual()) {
            issues.binding(path, "TYPE_INVALID", "属性取值方式类型不正确");
            return null;
        }
        AttributeValueKind kind = AttributeValueKind.fromJson(node.textValue());
        if (kind == null) {
            issues.binding(path, "ENUM_INVALID", "属性取值方式不受支持");
        }
        return kind;
    }

    private static RawNode parseStage(
        JsonNode node,
        String path,
        DamageTypeFormulaStage owner,
        IssueBag issues,
        List<StageUse> stageUses
    ) {
        JsonNode stageNode = node.get("stageKey");
        if (stageNode == null || stageNode.isNull()) {
            issues.validation(path + ".stageKey", "REQUIRED", "阶段结果不能为空");
            return new RawStage(null);
        }
        if (!stageNode.isTextual()) {
            issues.binding(path + ".stageKey", "TYPE_INVALID", "阶段结果类型不正确");
            return new RawStage(null);
        }
        String stageKey = stageNode.textValue();
        if (stageKey.isBlank()) {
            issues.validation(path + ".stageKey", "REQUIRED", "阶段结果不能为空");
            return new RawStage(null);
        }
        stageUses.add(new StageUse(path + ".stageKey", stageKey, owner));
        return new RawStage(stageKey);
    }

    record AttributeIdentity(AttributeOwner attributeOwner, String attributeKey, AttributeValueKind attributeValueKind) {
    }

    record AttributeUse(
        String path,
        AttributeOwner attributeOwner,
        String attributeKey,
        AttributeValueKind attributeValueKind
    ) {
        AttributeIdentity identity() {
            return new AttributeIdentity(attributeOwner, attributeKey, attributeValueKind);
        }
    }

    record StageUse(String path, String stageKey, DamageTypeFormulaStage owner) {
    }

    static final class Shape {
        private final RawFormula formula;
        private final List<AttributeUse> attributes;
        private final List<StageUse> stages;

        private Shape(RawFormula formula, List<AttributeUse> attributes, List<StageUse> stages) {
            this.formula = formula;
            this.attributes = attributes;
            this.stages = stages;
        }

        List<AttributeUse> attributes() {
            return attributes;
        }

        List<StageUse> stages() {
            return stages;
        }

        Set<String> attributeKeys() {
            LinkedHashSet<String> keys = new LinkedHashSet<>();
            for (AttributeUse use : attributes) {
                keys.add(use.attributeKey());
            }
            return keys;
        }

        DamageTypeCalculationFormula toModel() {
            return new DamageTypeCalculationFormula(
                formula.resistanceBeforePenetration().toModel(),
                formula.penetrationPercent().toModel(),
                formula.penetrationFlat().toModel(),
                formula.effectiveResistance().toModel(),
                formula.resistanceFactor().toModel()
            );
        }
    }

    private record StageSlot(String name, DamageTypeFormulaStage stage) {
    }

    private sealed interface RawNode permits RawOperation, RawFixed, RawAttribute, RawStage {
        DamageTypeFormulaNode toModel();
    }

    private record RawFormula(
        RawNode resistanceBeforePenetration,
        RawNode penetrationPercent,
        RawNode penetrationFlat,
        RawNode effectiveResistance,
        RawNode resistanceFactor
    ) {
    }

    private record RawOperation(SkillFormulaOperation operation, List<RawNode> operands) implements RawNode {
        @Override
        public DamageTypeFormulaNode toModel() {
            List<DamageTypeFormulaNode> children = new ArrayList<>(operands.size());
            for (RawNode operand : operands) {
                children.add(operand.toModel());
            }
            return new DamageTypeFormulaOperationNode(operation, children);
        }
    }

    private record RawFixed(BigDecimal value) implements RawNode {
        @Override
        public DamageTypeFormulaNode toModel() {
            return new DamageTypeFormulaFixedNode(value);
        }
    }

    private record RawAttribute(
        AttributeOwner attributeOwner,
        String attributeKey,
        AttributeValueKind attributeValueKind
    ) implements RawNode {
        @Override
        public DamageTypeFormulaNode toModel() {
            return new DamageTypeFormulaAttributeNode(attributeOwner, attributeKey, attributeValueKind);
        }
    }

    private record RawStage(String stageKey) implements RawNode {
        @Override
        public DamageTypeFormulaNode toModel() {
            DamageTypeFormulaStage stage = DamageTypeFormulaStage.fromText(stageKey);
            if (stage == null) {
                throw new IllegalStateException("伤害类型结算公式数据损坏");
            }
            return new DamageTypeFormulaStageResultNode(stage);
        }
    }

    private static final class Counter {
        private int value;
    }

    private static final class IssueBag {
        private final List<Issue> binding = new ArrayList<>();
        private final List<Issue> validation = new ArrayList<>();

        private void binding(String field, String code, String message) {
            binding.add(new Issue(field, code, message));
        }

        private void validation(String field, String code, String message) {
            validation.add(new Issue(field, code, message));
        }

        private void throwIfAny() {
            if (binding.isEmpty() && validation.isEmpty()) {
                return;
            }
            List<Map<String, String>> all = new ArrayList<>(binding.size() + validation.size());
            for (Issue issue : binding) {
                all.add(issue.toMap());
            }
            for (Issue issue : validation) {
                all.add(issue.toMap());
            }
            all.sort(Comparator.comparing((Map<String, String> issue) -> issue.get("field"))
                .thenComparing(issue -> issue.get("code")));
            if (!binding.isEmpty()) {
                throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "400.INVALID_BODY",
                    "伤害类型结算公式无法绑定",
                    Map.of("fieldIssues", List.copyOf(all))
                );
            }
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "伤害类型结算公式不合法",
                Map.of("fieldIssues", List.copyOf(all))
            );
        }
    }

    private record Issue(String field, String code, String message) {
        private Map<String, String> toMap() {
            return Map.of("field", field, "code", code, "message", message);
        }
    }
}
