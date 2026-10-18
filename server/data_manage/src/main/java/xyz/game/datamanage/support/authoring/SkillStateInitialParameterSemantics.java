package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBinding;

/** 状态声明只授权对应初值，不把本场输入借给容量或运行期操作。 */
public final class SkillStateInitialParameterSemantics {
    private SkillStateInitialParameterSemantics() {}

    public static List<Map<String, String>> detailIssues(String stateType, String scope, SkillInternalStateDetail detail) {
        List<Map<String, String>> issues = new ArrayList<>(detailIssues(stateType, scope,
            AggregateJson.tree(AggregateJson.write(detail))));
        if (detail instanceof SkillInternalStateCounterDetail counter) {
            capturedFields(counter.initialValueBinding(), "detail.initialValueBinding.detail", issues);
        }
        if (detail instanceof SkillInternalStateAmmoDetail ammo) {
            capturedFields(ammo.initialValueBinding(), "detail.initialValueBinding.detail", issues);
            capturedFields(ammo.initialRemainingMsBinding(), "detail.initialRemainingMsBinding.detail", issues);
        }
        return List.copyOf(issues);
    }

    private static void capturedFields(SkillTriggerRuntimeInputBinding binding, String path, List<Map<String, String>> issues) {
        if (binding == null || binding.detail() == null) return;
        for (String key : binding.detail().unknownFields()) issues.add(issue(path + "." + key, "UNKNOWN_FIELD", "状态初值声明不接受其它明细"));
        for (String key : binding.detail().foreignFields()) issues.add(issue(path + "." + key, "FORBIDDEN", "状态初值声明包含其它来源明细"));
    }

    public static List<Map<String, String>> detailIssues(String stateType, String scope, JsonNode detail) {
        List<Map<String, String>> issues = new ArrayList<>();
        bindingIssues(stateType, scope, detail, "initialValueBinding", "initialValue", issues);
        bindingIssues(stateType, scope, detail, "initialRemainingMsBinding", "initialRemainingValue", issues);
        if (detail.hasNonNull("initialRemainingValue") || detail.hasNonNull("initialRemainingMsBinding")) {
            if (!"AMMO".equals(stateType) || !"ONE_BY_ONE".equals(detail.path("recoveryMode").asText())
                || !"AFTER_CONSUME".equals(detail.path("recoveryStartCondition").asText())) {
                issues.add(issue("detail.initialRemainingValue", "FORBIDDEN", "初始回充余时只适用于消费后逐枚恢复的弹药"));
            }
        }
        return List.copyOf(issues);
    }

    private static void bindingIssues(String stateType, String scope, JsonNode detail, String field, String valueField,
                                     List<Map<String, String>> issues) {
        JsonNode binding = detail.path(field);
        if (binding.isMissingNode() || binding.isNull()) return;
        String path = "detail." + field;
        if (!Set.of("COUNTER", "AMMO").contains(stateType) || !"SKILL".equals(scope)) {
            issues.add(issue(path, "FORBIDDEN", "状态初值声明只适用于技能自身的计数或弹药"));
        }
        if (!binding.isObject()) {
            issues.add(issue(path, "TYPE_MISMATCH", "状态初值声明必须是输入绑定对象"));
            return;
        }
        for (String key : List.of("bindingKey", "parameterKey")) {
            if (!binding.path(key).isTextual() || !binding.path(key).asText().matches("^[a-z][a-z0-9_]{0,63}$")) {
                issues.add(issue(path + "." + key, "VALUE_SHAPE_INVALID", "状态初值绑定标识不合法"));
            }
        }
        if (!"SCENE_INITIAL_PARAMETER".equals(binding.path("sourceType").asText())) {
            issues.add(issue(path + ".sourceType", "FORBIDDEN", "状态初值只接受场景显式初值来源"));
        }
        issues.addAll(SkillSceneInitialParameterSemantics.detailIssues(binding.path("detail"), "INTEGER", path + ".detail"));
        for (String key : List.of("minValue", "maxValue")) {
            if (binding.path("detail").path(key).isNumber() && binding.path("detail").path(key).decimalValue().signum() < 0) {
                issues.add(issue(path + ".detail." + key, "RANGE_INVALID", "状态初值边界必须为非负安全整数"));
            }
        }
        JsonNode value = detail.path(valueField);
        if (!"PARAMETER".equals(value.path("kind").asText())
            || !binding.path("parameterKey").asText().equals(value.path("parameterKey").asText())) {
            issues.add(issue(path + ".parameterKey", "BINDING_EXTRA", "状态初值声明必须由对应初值直接引用同一参数"));
        }
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
