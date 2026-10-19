package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 普攻伤害角色只检查作者可证明的形状；所选普攻和实际等待冲突由计算端核对。 */
public final class SkillAttackDamageRoleSemantics {
    private SkillAttackDamageRoleSemantics() { }

    public static void validateEffectShape(SkillEffectLifecycleRequest lifecycle,
                                          List<SkillEffectResultRequest> results,
                                          List<Map<String, String>> issues) {
        if (results.stream().noneMatch(result -> result != null
            && result.detail() instanceof SkillEffectDamageDetail damage && damage.attackDamageRole() != null)) return;
        JsonNode encoded = AggregateJson.tree(AggregateJson.write(results));
        issues.addAll(effectIssues(lifecycle != null, encoded));
    }

    public static void validate(List<Aggregate> affected, List<Aggregate> context) {
        Set<String> skills = new LinkedHashSet<>();
        affected.forEach(object -> skills.add(object.skillKey()));
        Map<Identity, RoleEffect> effects = new LinkedHashMap<>();
        for (Aggregate effect : context) {
            if (effect.type() != SourceType.EFFECT || !skills.contains(effect.skillKey())) continue;
            JsonNode results = effect.data().path("results");
            boolean marked = false;
            for (JsonNode result : results) marked |= result.path("detail").has("attackDamageRole");
            if (!marked) continue;
            List<Map<String, String>> issues = effectIssues(effect.data().hasNonNull("lifecycle"), results);
            if (!issues.isEmpty()) throw invalid(effect, issues);
            for (JsonNode result : results) {
                if (result.path("detail").has("attackDamageRole")) {
                    effects.put(new Identity(effect.skillKey(), effect.key()), new RoleEffect(effect,
                        result.path("detail").path("attackDamageRole").textValue()));
                }
            }
        }
        if (effects.isEmpty()) return;
        Map<Identity, RoleEffect> processRoles = new LinkedHashMap<>();
        for (Aggregate process : context) {
            if (process.type() != SourceType.PROCESS || !skills.contains(process.skillKey())) continue;
            JsonNode bindings = process.data().path("effectBindings");
            for (int index = 0; index < bindings.size(); index++) {
                JsonNode binding = bindings.get(index);
                RoleEffect role = effects.get(new Identity(process.skillKey(), binding.path("effectKey").asText()));
                if (role == null) continue;
                validateProcess(process, binding, index, role);
                Identity identity = new Identity(process.skillKey(), process.key());
                RoleEffect previous = processRoles.putIfAbsent(identity, role);
                if (previous != null) throw invalid(process, List.of(issue("effectBindings[" + index + "]",
                    "ATTACK_DAMAGE_ROLE_INVALID", "同一过程不能重复挂接普攻主体角色")));
            }
        }
        for (Aggregate rule : context) {
            if (rule.type() != SourceType.TRIGGER || !skills.contains(rule.skillKey())) continue;
            JsonNode actions = rule.data().path("actions");
            for (int index = 0; index < actions.size(); index++) {
                JsonNode action = actions.get(index);
                String type = action.path("actionType").asText();
                JsonNode detail = action.path("detail");
                String path = "actions[" + index + "]";
                if ("EXECUTE_EFFECT".equals(type)) {
                    RoleEffect role = effects.get(new Identity(rule.skillKey(), detail.path("effectKey").asText()));
                    if (role != null) validateDirectAction(rule, action, path, role);
                } else if ("START_PROCESS".equals(type) || "ADVANCE_PROCESS".equals(type)) {
                    RoleEffect role = processRoles.get(new Identity(rule.skillKey(), detail.path("processKey").asText()));
                    if (role != null) validateProcessAction(rule, action, path, role);
                }
            }
        }
    }

    private static List<Map<String, String>> effectIssues(boolean lifecycle, JsonNode results) {
        List<Map<String, String>> issues = new ArrayList<>();
        int damageCount = 0;
        int roleCount = 0;
        boolean primary = false;
        for (JsonNode result : results) {
            if ("DAMAGE".equals(result.path("resultType").asText())) damageCount++;
            primary |= "PRIMARY".equals(result.path("detail").path("attackDamageRole").asText());
        }
        for (int index = 0; index < results.size(); index++) {
            JsonNode result = results.get(index);
            JsonNode detail = result.path("detail");
            if (primary && result.hasNonNull("spellShieldBlockScope")) {
                issues.add(issue("results[" + index + "].spellShieldBlockScope", "ATTACK_DAMAGE_ROLE_INVALID",
                    "含普通攻击主体的效果不能提前消费法术护盾，替换负载按自己的资格处理"));
            }
            if (!detail.has("attackDamageRole")) continue;
            roleCount++;
            String path = "results[" + index + "]";
            JsonNode role = detail.get("attackDamageRole");
            if (!role.isTextual() || !Set.of("PRIMARY", "REPLACE_PRIMARY").contains(role.textValue())) {
                issues.add(issue(path + ".detail.attackDamageRole", "ENUM_INVALID", "普攻伤害角色必须是明确的合法字符串"));
                continue;
            }
            if (!"DAMAGE".equals(result.path("resultType").asText())
                || !"TARGET".equals(result.path("target").asText())
                || !"BASIC_ATTACK".equals(detail.path("deliveryKind").asText())
                || !"DIRECT".equals(detail.path("originKind").asText())) {
                issues.add(issue(path + ".detail.attackDamageRole", "ATTACK_DAMAGE_ROLE_INVALID",
                    "普攻伤害角色只允许直接对当前目标造成的普通攻击伤害"));
            }
            if (lifecycle || result.hasNonNull("lifecycleBehavior")) {
                issues.add(issue(path + ".lifecycleBehavior", "ATTACK_DAMAGE_ROLE_INVALID", "普攻主体角色必须是即时伤害"));
            }
            if ("REPLACE_PRIMARY".equals(role.textValue()) && results.size() != 1
                || "PRIMARY".equals(role.textValue()) && damageCount != 1) {
                issues.add(issue("results", "ATTACK_DAMAGE_ROLE_INVALID",
                    "普通攻击主体必须是唯一伤害，替换负载必须只有一个伤害结果"));
            }
        }
        if (roleCount > 1) issues.add(issue("results", "ATTACK_DAMAGE_ROLE_INVALID", "同一效果只能声明一个普攻主体角色"));
        return issues;
    }

    private static void validateProcess(Aggregate process, JsonNode binding, int index, RoleEffect role) {
        JsonNode data = process.data();
        JsonNode steps = data.path("steps");
        String path = "effectBindings[" + index + "]";
        boolean replacement = role.replacement();
        if (!"ACTIVE".equals(data.path("activationType").asText()) || steps.size() != 1
            || !"STEP_EXECUTION".equals(binding.path("moment").path("momentType").asText())) {
            throw invalid(process, List.of(issue(path, "ATTACK_DAMAGE_ROLE_INVALID", "普攻主体角色必须挂接单步骤主动过程的执行时点")));
        }
        JsonNode step = steps.get(0);
        String expected = replacement ? "EMPOWERED_BASIC_ATTACK" : "IMMEDIATE";
        if (!expected.equals(step.path("stepType").asText())
            || !step.path("stepKey").asText().equals(binding.path("moment").path("stepKey").asText())
            || replacement && !"ATTACK_HIT".equals(step.path("detail").path("consumeMoment").asText())) {
            throw invalid(process, List.of(issue(path, "ATTACK_DAMAGE_ROLE_INVALID", "普攻主体角色与过程步骤或消费时点不匹配")));
        }
        if (replacement) {
            int payloadBindings = 0;
            for (JsonNode item : data.path("effectBindings")) {
                if ("STEP_EXECUTION".equals(item.path("moment").path("momentType").asText())) payloadBindings++;
            }
            boolean payloadOperation = false;
            for (JsonNode item : data.path("stateOperations")) {
                payloadOperation |= "STEP_EXECUTION".equals(item.path("moment").path("momentType").asText());
            }
            if (payloadBindings != 1 || payloadOperation) throw invalid(process, List.of(issue(path,
                "ATTACK_DAMAGE_ROLE_INVALID", "替换主体的待击执行负载必须只有一个伤害效果且不能附带状态操作")));
        }
    }

    private static void validateDirectAction(Aggregate rule, JsonNode action, String path, RoleEffect role) {
        if (role.replacement() || !"BASIC_ATTACK_HIT".equals(rule.data().path("eventSource").path("eventType").asText())
            || !unconditional(rule) || !"CURRENT_TARGET".equals(action.path("targetContext").asText())
            || !action.path("resultModifiers").isEmpty()) {
            throw invalid(rule, List.of(issue(path, "ATTACK_DAMAGE_ROLE_INVALID",
                "普通攻击主体只能由无条件普通攻击命中执行，待击替换不能直接执行效果")));
        }
    }

    private static void validateProcessAction(Aggregate rule, JsonNode action, String path, RoleEffect role) {
        JsonNode event = rule.data().path("eventSource");
        JsonNode detail = event.path("detail");
        boolean valid = "START_PROCESS".equals(action.path("actionType").asText());
        if (role.replacement()) {
            valid &= "SKILL_USED".equals(event.path("eventType").asText())
                && rule.skillKey().equals(detail.path("sourceSkillKey").asText())
                && "ACTIVE".equals(detail.path("useKind").asText()) && "INITIAL".equals(detail.path("castPhase").asText())
                && selfOnly(rule, action);
        } else {
            valid &= "BASIC_ATTACK_HIT".equals(event.path("eventType").asText()) && unconditional(rule);
        }
        if (!valid || !action.path("resultModifiers").isEmpty()) throw invalid(rule, List.of(issue(path,
            "ATTACK_DAMAGE_ROLE_INVALID", "主体替换必须由本技能明确自身首次主动使用启动，普通主体只允许无条件普通攻击命中")));
    }

    private static boolean unconditional(Aggregate rule) {
        return rule.data().path("conditionGroups").isEmpty();
    }

    private static boolean selfOnly(Aggregate rule, JsonNode action) {
        JsonNode groups = rule.data().path("conditionGroups");
        if (groups.isEmpty()) return "EVENT_SOURCE".equals(action.path("targetContext").asText());
        for (JsonNode group : groups) {
            JsonNode conditions = group.path("conditions");
            if (conditions.size() != 1 || !"EXPLICIT_TARGET_IS_SOURCE".equals(conditions.get(0).path("conditionType").asText())) return false;
        }
        return "CURRENT_TARGET".equals(action.path("targetContext").asText())
            || "EVENT_SOURCE".equals(action.path("targetContext").asText());
    }

    private static ApiException invalid(Aggregate source, List<Map<String, String>> issues) {
        List<Map<String, String>> located = issues.stream().map(issue -> {
            Map<String, String> row = new LinkedHashMap<>(issue);
            row.put("sourceType", source.type().name());
            row.put("sourceSkillKey", source.skillKey());
            row.put("sourceKey", source.key());
            return row;
        }).toList();
        return new ApiException(HttpStatus.CONFLICT, "409.SKILL_OBJECT_REFERENCE_INVALID",
            "普攻伤害角色与最终作者配置不匹配", Map.of("fieldIssues", located));
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private record Identity(String skill, String key) { }
    private record RoleEffect(Aggregate effect, String role) {
        boolean replacement() { return "REPLACE_PRIMARY".equals(role); }
    }
}
