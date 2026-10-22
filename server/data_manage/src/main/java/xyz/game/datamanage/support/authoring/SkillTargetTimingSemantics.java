package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateTargetTiming;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

/** 显式目标时序的事务最终图；不根据技能或状态名称推断运行机制。 */
public final class SkillTargetTimingSemantics {
    private SkillTargetTimingSemantics() {}

    enum NumberKind { STATIC, ZERO, ONE, POSITIVE_SAFE, NON_NEGATIVE_SAFE }
    @FunctionalInterface interface Numbers {
        boolean check(Aggregate source, JsonNode value, String path, NumberKind kind, Aggregate capacity);
    }

    static void validate(List<Aggregate> sources, List<Aggregate> context, Numbers numbers) {
        Set<String> skills = new HashSet<>();
        sources.forEach(source -> skills.add(source.skillKey()));
        for (Aggregate source : sources) if (source.type() == SourceType.PROCESS)
            for (JsonNode operation : source.data().path("stateOperations")) {
                String targetSkill = text(operation, "stateSkillKey");
                if (context.stream().anyMatch(a -> a.type() == SourceType.STATE && a.skillKey().equals(targetSkill)
                    && a.key().equals(text(operation, "stateKey")) && a.data().path("detail").has("targetTiming"))) skills.add(targetSkill);
            }
        for (String skill : skills) {
            List<Aggregate> own = context.stream().filter(a -> a.skillKey().equals(skill)).toList();
            List<Aggregate> anchors = own.stream().filter(a -> a.type() == SourceType.STATE
                && a.data().path("detail").has("targetTiming")).toList();
            if (anchors.isEmpty()) continue;
            // 休眠不能隐藏有效时序声明之外的坏命中规则或过程引用。
            SkillObjectReferences.validateExistingTargets(SkillObjectReferences.extract("target_timing", own).stream()
                .filter(reference -> !reference.target().skillKey().isEmpty()
                    && reference.target().type() != SkillObjectReferences.TargetType.PARAMETER).toList(), context, Set.of());
            for (Aggregate source : context) if (source.type() == SourceType.PROCESS && !source.skillKey().equals(skill))
                for (JsonNode operation : source.data().path("stateOperations")) if (skill.equals(text(operation, "stateSkillKey"))
                    && anchors.stream().anyMatch(a -> a.key().equals(text(operation, "stateKey"))))
                    throw invalid(source, "stateOperations", "外来技能不能写目标时序状态");
            new Graph(skill, own, numbers).validate(anchors);
        }
    }

    /** 快照用显式声明排除旧完整图休眠识别，不把声明本身视作有效图证明。 */
    public static boolean declared(JsonNode configuration) {
        for (JsonNode state : configuration.path("internalStates"))
            if (state.path("detail").has("targetTiming")) return true;
        return false;
    }

    /** 只对没有独立其它自然入口的完整时序来源应用整图休眠。 */
    @FunctionalInterface interface QualifierNumber { boolean is(JsonNode rule, JsonNode value, int expected); }

    static boolean deferrableRoots(String skill, JsonNode configuration, QualifierNumber number) {
        if (!declared(configuration)) return false;
        Set<String> hitSkills = new HashSet<>();
        for (JsonNode rule : configuration.path("triggerRules")) if ("SKILL_HIT".equals(text(rule.path("eventSource"), "eventType"))) {
            String source = text(rule.path("eventSource").path("detail"), "sourceSkillKey");
            if (!source.isBlank()) hitSkills.add(source);
        }
        boolean hit = false;
        for (JsonNode rule : configuration.path("triggerRules")) {
            String event = text(rule.path("eventSource"), "eventType");
            if (!Set.of("SKILL_HIT", "PROCESS_MOMENT", "DAMAGE_DEALT").contains(event)) return false;
            if (event.equals("DAMAGE_DEALT")) {
                if (rule.path("conditionGroups").isEmpty() || rule.path("actions").size() != 1) return false;
                for (JsonNode group : rule.path("conditionGroups")) {
                    boolean before = false, killed = false;
                    for (JsonNode condition : group.path("conditions")) {
                        JsonNode detail = condition.path("detail");
                        if ("INTERNAL_STATE_CHECK".equals(text(condition, "conditionType")) && "DAMAGE_BEFORE_VALUE".equals(text(detail, "valueKind"))
                            && number.is(rule, detail.path("comparisonValue"), 0)) {
                            JsonNode source = rule.path("eventSource").path("detail");
                            String sourceSkill = text(source, "sourceSkillKey");
                            boolean filtered = "SKILL".equals(text(source, "deliveryKind")) && "DIRECT".equals(text(source, "originKind"))
                                && !sourceSkill.isBlank() && (skill.equals(sourceSkill) || hitSkills.contains(sourceSkill));
                            if ("GT".equals(text(detail, "comparator")) || filtered && "EQ".equals(text(detail, "comparator"))) before = true;
                        }
                        if ("EVENT_VALUE_COMPARE".equals(text(condition, "conditionType")) && "KILLED".equals(text(detail, "eventValueKey"))
                            && "EQ".equals(text(detail, "comparator")) && number.is(rule, detail.path("comparisonValue"), 1)) killed = true;
                    }
                    if (!before || !killed) return false;
                }
                JsonNode action = rule.path("actions").get(0);
                if (!"EXECUTE_EFFECT".equals(text(action, "actionType")) || !"CURRENT_TARGET".equals(text(action, "targetContext"))
                    || !action.path("runtimeInputBindings").isEmpty() || !action.path("resultModifiers").isEmpty()) return false;
                JsonNode effect = null;
                for (JsonNode candidate : configuration.path("effects")) if (text(candidate, "effectKey").equals(text(action.path("detail"), "effectKey"))) effect = candidate;
                if (effect == null || effect.hasNonNull("lifecycle") || effect.path("results").size() != 1) return false;
                JsonNode result = effect.path("results").get(0), detail = result.path("detail");
                if (!"RESOURCE_CHANGE".equals(text(result, "resultType")) || !"SOURCE".equals(text(result, "target"))
                    || !"RESTORE".equals(text(detail, "operation")) || "hp".equals(text(detail, "attributeKey"))) return false;
            }
            if (event.equals("SKILL_HIT")) for (JsonNode action : rule.path("actions"))
                if (!Set.of("START_PROCESS", "MODIFY_INTERNAL_STATE").contains(text(action, "actionType"))) return false;
            if (event.equals("SKILL_HIT") && rule.path("eventSource").path("detail").path("sourceSkillKey").isTextual()) hit = true;
        }
        return hit;
    }

    private static final class Graph {
        private final String skill;
        private final List<Aggregate> own;
        private final Numbers numbers;
        private final Map<String, Aggregate> states = new LinkedHashMap<>(), processes = new LinkedHashMap<>(), effects = new LinkedHashMap<>(), formulas = new LinkedHashMap<>();
        private final Set<String> phased = new HashSet<>();

        Graph(String skill, List<Aggregate> own, Numbers numbers) {
            this.skill = skill; this.own = own; this.numbers = numbers;
            for (Aggregate a : own) switch (a.type()) {
                case STATE -> states.put(a.key(), a);
                case PROCESS -> processes.put(a.key(), a);
                case EFFECT -> effects.put(a.key(), a);
                case FORMULA -> formulas.put(a.key(), a);
                default -> { }
            }
        }

        void validate(List<Aggregate> anchors) {
            int ticks = 0, expiries = 0;
            for (Aggregate anchor : anchors) {
                JsonNode data = anchor.data(), detail = data.path("detail"), timing = detail.path("targetTiming");
                try { AggregateJson.read(AggregateJson.write(timing), SkillInternalStateTargetTiming.class); }
                catch (RuntimeException error) { throw invalid(anchor, "detail.targetTiming", "目标时序判别字段不合法"); }
                if (!"COUNTER".equals(text(data, "stateType")) || !"TARGET".equals(text(data, "scope"))
                    || detail.has("initialValueBinding")) throw invalid(anchor, "detail.targetTiming", "目标时序只允许无初值绑定的自身目标计数");
                number(anchor, detail, "detail", "initialValue", NumberKind.ZERO, null);
                number(anchor, detail, "detail", "maxValue", NumberKind.ONE, null);
                number(anchor, detail, "detail", "durationValue", NumberKind.POSITIVE_SAFE, null);
                if ("PHASED_TICK".equals(text(timing, "kind"))) {
                    phased.add(anchor.key()); ticks++;
                    number(anchor, timing, "detail.targetTiming", "intervalValue", NumberKind.POSITIVE_SAFE, null);
                } else expiries++;
            }
            if (ticks < 1 || ticks > 3 || expiries > 1) throw invalid(anchors.getFirst(), "detail.targetTiming", "同一来源需要一至三个周期锚且最多一个预约锚");
            for (Aggregate anchor : anchors) {
                JsonNode timing = anchor.data().path("detail").path("targetTiming");
                Aggregate process = require(processes, text(timing, "processKey"), anchor, "detail.targetTiming.processKey");
                JsonNode step = immediate(process);
                if (phased.contains(anchor.key())) tick(process, step);
                else expiry(anchor, process, step);
            }
            // 新状态写入口只允许同父明确静态SET，不为旧来源增加此限制。
            for (Aggregate source : own) if (source.type() == SourceType.PROCESS) {
                for (JsonNode op : source.data().path("stateOperations")) if (phased.contains(text(op, "stateKey"))
                    || anchors.stream().anyMatch(a -> a.key().equals(text(op, "stateKey")))) {
                    immediate(source);
                    stateWrite(source, op, "stateOperations", null);
                }
            }
        }

        JsonNode immediate(Aggregate process) {
            JsonNode data = process.data(), steps = data.path("steps");
            if (!"PASSIVE".equals(text(data, "activationType")) || data.hasNonNull("cooldown")
                || !steps.isArray() || steps.size() != 1) throw invalid(process, "steps", "目标时序过程必须为无冷却的单即时被动过程");
            JsonNode step = steps.get(0);
            if (!"IMMEDIATE".equals(text(step, "stepType")) || !step.path("detail").isObject()
                || !step.path("detail").isEmpty() || !step.path("occupiesAction").isBoolean()
                || step.path("occupiesAction").booleanValue()) throw invalid(process, "steps", "目标时序步骤必须明确即时且不占行动");
            return step;
        }

        List<Aggregate> momentRules(Aggregate process) {
            return own.stream().filter(a -> a.type() == SourceType.TRIGGER
                && "PROCESS_MOMENT".equals(text(a.data().path("eventSource"), "eventType"))
                && process.key().equals(text(a.data().path("eventSource").path("detail"), "processKey"))).toList();
        }

        void tick(Aggregate process, JsonNode step) {
            JsonNode data = process.data(), bindings = data.path("effectBindings");
            if (!data.path("stateOperations").isEmpty() || !momentRules(process).isEmpty()
                || !bindings.isArray() || bindings.size() != 1) throw invalid(process, "effectBindings", "每个保相位周期只允许一笔无条件伤害");
            JsonNode binding = bindings.get(0);
            if (!moment(binding.path("moment"), "STEP_EXECUTION", text(step, "stepKey"))) throw invalid(process, "effectBindings", "周期效果只允许即时步骤执行时点");
            damage(require(effects, text(binding, "effectKey"), process, "effectBindings"), false);
        }

        void expiry(Aggregate anchor, Aggregate process, JsonNode step) {
            JsonNode data = process.data(), bindings = data.path("effectBindings");
            if (!bindings.isArray() || bindings.size() != 1 || !moment(bindings.get(0).path("moment"), "STEP_EXECUTION", text(step, "stepKey")))
                throw invalid(process, "effectBindings", "预约到期必须恰好绑定一笔即时爆炸");
            damage(require(effects, text(bindings.get(0), "effectKey"), process, "effectBindings"), true);
            int leaves = 1;
            Set<String> orders = new HashSet<>();
            order(process, bindings.get(0), orders);
            for (JsonNode op : data.path("stateOperations")) {
                if (!moment(op.path("moment"), "PROCESS_START", null) && !moment(op.path("moment"), "PROCESS_COMPLETE", null))
                    throw invalid(process, "stateOperations", "预约状态写只允许过程开始或过程完成");
                stateWrite(process, op, "stateOperations", anchor);
                order(process, op, orders); leaves++;
            }
            List<Aggregate> tails = momentRules(process);
            if (tails.size() > 1) throw invalid(process, "steps", "预约仅允许一个存活重挂尾规则");
            if (!tails.isEmpty()) {
                Aggregate tail = tails.getFirst(); JsonNode rule = tail.data();
                if (!moment(rule.path("eventSource").path("detail").path("moment"), "PROCESS_COMPLETE", null)) throw invalid(tail, "eventSource", "重挂规则只能指向预约过程完成时点");
                JsonNode groups = rule.path("conditionGroups"), actions = rule.path("actions");
                if (groups.size() != 1 || groups.get(0).path("conditions").size() != 1 || actions.size() != 1
                    || rule.hasNonNull("oncePerUse") || rule.hasNonNull("perTargetCooldown") || rule.hasNonNull("maxTriggersPerProcess")) throw invalid(tail, "conditionGroups", "预约尾部仅允许一个完整存活门和一个内联子过程");
                JsonNode condition = groups.get(0).path("conditions").get(0), check = condition.path("detail");
                if (!"ATTRIBUTE_COMPARE".equals(text(condition, "conditionType")) || !"CURRENT_TARGET".equals(text(check, "subject"))
                    || !"hp".equals(text(check, "attributeKey")) || !"CURRENT".equals(text(check, "attributeValueKind")) || !"GT".equals(text(check, "comparator"))) throw invalid(tail, "conditionGroups", "预约重挂只能判断目标当前生命大于零");
                number(tail, check, "conditionGroups.conditions.detail", "comparisonValue", NumberKind.ZERO, null);
                JsonNode action = actions.get(0);
                if (!"START_PROCESS".equals(text(action, "actionType")) || !"CURRENT_TARGET".equals(text(action, "targetContext"))
                    || !action.path("runtimeInputBindings").isEmpty() || !action.path("resultModifiers").isEmpty()) throw invalid(tail, "actions", "预约重挂只允许静态当前目标子过程");
                Aggregate child = require(processes, text(action.path("detail"), "processKey"), tail, "actions");
                immediate(child);
                if (child.key().equals(process.key()) || !momentRules(child).isEmpty() || !child.data().path("effectBindings").isEmpty()
                    || child.data().path("stateOperations").size() != 2) throw invalid(child, "stateOperations", "重挂子过程只允许两次SET1且不能再次调用");
                Set<String> targets = new HashSet<>(); int slots = 0;
                for (JsonNode op : child.data().path("stateOperations")) {
                    if (!moment(op.path("moment"), "PROCESS_START", null)) throw invalid(child, "stateOperations", "重挂只允许过程开始写入");
                    Aggregate target = stateWrite(child, op, "stateOperations", anchor);
                    number(child, op, "stateOperations", "value", NumberKind.ONE, target);
                    if (!targets.add(target.key())) throw invalid(child, "stateOperations", "重挂必须写两个不同目标计数");
                    if (phased.contains(target.key())) slots++;
                }
                if (slots != 1) throw invalid(child, "stateOperations", "重挂必须恰好写一个已声明周期槽和一个普通总计数");
                order(process, tail.data().path("eventSource").path("detail").path("moment"), tail.data().path("sortOrder").asInt(-1), orders);
                leaves += 2;
            }
            if (leaves > 12) throw invalid(process, "stateOperations", "预约负载最多十二条作者叶操作");
        }

        Aggregate stateWrite(Aggregate process, JsonNode op, String path, Aggregate anchor) {
            Aggregate target = require(states, text(op, "stateKey"), process, path);
            if (!skill.equals(text(op, "stateSkillKey")) || !"COUNTER".equals(text(target.data(), "stateType"))
                || !"TARGET".equals(text(target.data(), "scope")) || !"SET".equals(text(op, "operation")) || op.hasNonNull("optionKey")) throw invalid(process, path, "目标时序只允许同父普通目标计数的静态SET");
            boolean zero = number(process, op, path, "value", NumberKind.NON_NEGATIVE_SAFE, target);
            if (anchor != null && anchor.key().equals(target.key()) && !zero) throw invalid(process, path, "预约负载不能重新开启自身预约");
            return target;
        }

        void damage(Aggregate effect, boolean expiry) {
            JsonNode data = effect.data(), results = data.path("results");
            if (data.hasNonNull("lifecycle") || !results.isArray() || results.size() != 1) throw invalid(effect, "results", "时序负载必须为一笔无生命周期的即时伤害");
            JsonNode result = results.get(0), detail = result.path("detail");
            if (!"DAMAGE".equals(text(result, "resultType")) || !"TARGET".equals(text(result, "target"))
                || result.hasNonNull("lifecycleBehavior") || result.hasNonNull("spellShieldBlockScope")
                || !"DISALLOWED".equals(text(detail.path("critical"), "mode")) || !"RESOLVED".equals(text(detail, "vampQualification"))
                || !"SKILL".equals(text(detail, "deliveryKind")) || !"DIRECT".equals(text(detail, "originKind"))) throw invalid(effect, "results", "时序伤害需完整非暴击SKILL/DIRECT与明确吸血资格");
            numericDamage(effect, result.path("valueRule").path("value"), "results.valueRule.value", expiry);
            for (JsonNode override : detail.path("vampOverrides")) if (override.hasNonNull("efficiencyValue"))
                numbers.check(effect, override.get("efficiencyValue"), "results.detail.vampOverrides.efficiencyValue", NumberKind.STATIC, null);
        }

        void numericDamage(Aggregate owner, JsonNode value, String path, boolean expiry) {
            if ("FORMULA".equals(text(value, "kind"))) {
                Aggregate formula = require(formulas, text(value, "formulaKey"), owner, path);
                if (xyz.game.datamanage.service.skillformula.SkillFormulaParser.structuralIssue(skill, formula.data().path("expression")) != null)
                    throw invalid(formula, "expression", "目标时序伤害公式结构不合法");
                for (JsonNode binding : xyz.game.datamanage.support.formula.SkillFormulaBindings.reachableBindings(formula.data().path("expression"))) {
                    String kind = text(binding, "kind");
                    if ("parameter".equals(kind)) {
                        if (!skill.equals(text(binding, "skillKey"))) throw invalid(formula, "expression", "时序伤害禁止外来参数");
                        var numeric = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode().put("kind", "PARAMETER").put("parameterKey", text(binding, "parameterKey"));
                        numbers.check(formula, numeric, "expression.inputs", NumberKind.STATIC, null);
                    } else if (!("attribute".equals(kind) && "current_frame".equals(text(binding, "view"))
                        && ("target".equals(text(binding, "object")) && "hp".equals(text(binding, "attributeKey")) && "MAX".equals(text(binding, "valueKind"))
                        || expiry && "source".equals(text(binding, "object")) && "ability_power".equals(text(binding, "attributeKey")) && "TOTAL".equals(text(binding, "valueKind"))))) throw invalid(formula, "expression", "时序伤害只允许当次目标最大生命与爆炸来源法强");
                }
            } else numbers.check(owner, value, path, NumberKind.STATIC, null);
        }

        boolean number(Aggregate source, JsonNode parent, String prefix, String field, NumberKind kind, Aggregate capacity) {
            return numbers.check(source, parent.path(field), prefix + "." + field, kind, capacity);
        }

        void order(Aggregate process, JsonNode node, Set<String> orders) {
            order(process, node.path("moment"), node.path("sortOrder").asInt(-1), orders);
        }
        void order(Aggregate process, JsonNode moment, int order, Set<String> orders) {
            String key = text(moment, "momentType") + "/" + text(moment, "stepKey") + "/" + order;
            if (order < 0 || !orders.add(key)) throw invalid(process, "sortOrder", "同一时点跨节点排序必须明确且唯一");
        }
    }

    private static boolean moment(JsonNode moment, String kind, String step) {
        return kind.equals(text(moment, "momentType")) && (step == null ? !moment.hasNonNull("stepKey") : step.equals(text(moment, "stepKey")))
            && !moment.hasNonNull("failureReason");
    }
    private static Aggregate require(Map<String, Aggregate> map, String key, Aggregate source, String path) {
        Aggregate found = map.get(key);
        if (found == null) throw invalid(source, path, "目标时序引用的组成不存在或不属于本技能");
        return found;
    }
    private static String text(JsonNode node, String field) { return node.path(field).asText(""); }
    private static ApiException invalid(Aggregate source, String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.SKILL_TARGET_TIMING_INVALID", message, Map.of("fieldIssues", List.of(Map.of(
            "field", field, "code", "COMBINATION_INVALID", "message", message, "sourceSkillKey", source.skillKey(), "sourceType", source.type().name(), "sourceKey", source.key()))));
    }
}
