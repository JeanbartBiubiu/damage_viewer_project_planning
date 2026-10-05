package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiFunction;
import java.util.regex.Pattern;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.InactiveReason;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.service.simulation.SnapshotSources.Source;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Reference;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Target;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.TargetType;
import xyz.game.datamanage.support.error.ApiException;

final class SnapshotSkillClosure {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> NATURAL_EVENTS = Set.of("SOURCE_INITIALIZED", "BASIC_ATTACK_START", "BASIC_ATTACK_HIT",
        "BASIC_ATTACK_RECEIVED", "DAMAGE_PENDING", "DAMAGE_DEALT", "DAMAGE_TAKEN", "HIT_LINK_APPLIED", "ATTACK_LINK_APPLIED");
    private final String gameId;
    private final String attackKey;
    private final ObjectMapper json;
    private final List<Source> sources;
    private final Map<String, SkillConfigurationResponse> configurations;
    private final BiFunction<String, String, SkillConfigurationResponse> reader;
    private final Map<ObjectKey, Aggregate> objects = new HashMap<>();
    private final Map<ObjectKey, List<Reference>> extracted = new HashMap<>();
    private final Set<Invocation> visited = new LinkedHashSet<>();
    private final ArrayDeque<Invocation> pending = new ArrayDeque<>();
    private final Set<Source> active = new HashSet<>();
    private boolean levelsChanged;

    SnapshotSkillClosure(String gameId, String attackKey, ObjectMapper json, List<Source> sources,
                         Map<String, SkillConfigurationResponse> configurations,
                         BiFunction<String, String, SkillConfigurationResponse> reader) {
        this.gameId = gameId;
        this.attackKey = attackKey;
        this.json = json;
        this.sources = sources;
        this.configurations = configurations;
        this.reader = reader;
        configurations.values().forEach(this::index);
    }

    Result collect() {
        for (Source source : sources) {
            if (source.inactive != null) continue;
            for (Aggregate rule : rules(source)) {
                if (!natural(source, rule) || rule.data().path("actions").isEmpty()) continue;
                if (requiresLevel(source, rule)) {
                    source.inactive = InactiveReason.LEVEL_REQUIRED;
                    break;
                }
                source.ruleKeys.add(rule.key());
            }
            if (source.inactive == null) {
                for (String key : source.ruleKeys) enqueue(source, objects.get(new ObjectKey(source.skillKey, SourceType.TRIGGER, key)), true);
            } else source.ruleKeys.clear();
        }
        while (!pending.isEmpty()) {
            Invocation invocation = pending.removeFirst();
            Aggregate object = invocation.object();
            for (Reference reference : references(object)) {
                follow(invocation, reference);
            }
            if (invocation.executes()) subscribe(invocation);
            if (levelsChanged) {
                visited.clear();
                pending.clear();
                active.clear();
                sources.forEach(source -> source.ruleKeys.clear());
                levelsChanged = false;
                return collect();
            }
        }
        for (Source source : sources) {
            if (source.inactive != null) continue;
            if (active.contains(source)) continue;
            boolean deferred = rules(source).stream().anyMatch(rule ->
                Set.of("SKILL_USED", "SKILL_HIT").contains(rule.data().path("eventSource").path("eventType").asText())
                    && !rule.data().path("actions").isEmpty());
            Set<String> attackEvents = Set.of("BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "HIT_LINK_APPLIED", "ATTACK_LINK_APPLIED");
            boolean withoutAttackDriver = source.side.equals("target") && rules(source).stream().anyMatch(rule ->
                attackEvents.contains(rule.data().path("eventSource").path("eventType").asText()) && !rule.data().path("actions").isEmpty())
                && rules(source).stream().noneMatch(rule -> NATURAL_EVENTS.contains(rule.data().path("eventSource").path("eventType").asText())
                    && !attackEvents.contains(rule.data().path("eventSource").path("eventType").asText()) && !rule.data().path("actions").isEmpty());
            source.inactive = withoutAttackDriver ? InactiveReason.NO_AUTONOMOUS_ATTACK
                : deferred ? InactiveReason.ACTIVE_DEFERRED : InactiveReason.CONFIGURATION_INCOMPLETE;
        }
        List<Aggregate> needed = visited.stream().map(Invocation::object).distinct().toList();
        Set<Target> targets = new HashSet<>();
        for (SkillConfigurationResponse configuration : configurations.values()) {
            targets.add(new Target(TargetType.SKILL, "", configuration.skill().skillKey(), ""));
            for (SkillParameterResponse parameter : configuration.parameters()) {
                targets.add(new Target(TargetType.PARAMETER, configuration.skill().skillKey(), parameter.parameterKey(), ""));
            }
        }
        List<Reference> references = needed.stream().flatMap(object -> references(object).stream()).distinct().toList();
        references.stream().map(Reference::target).filter(target -> target.skillKey().isEmpty()).forEach(targets::add);
        try {
            SkillObjectReferences.extractAndValidate(gameId, needed, List.copyOf(objects.values()), targets);
        } catch (ApiException exception) {
            throw translate(exception);
        }
        return new Result(configurations.values().stream().sorted(Comparator.comparing(configuration -> configuration.skill().skillKey())).toList(),
            references.stream().sorted(Comparator.comparing(Reference::sourceSkillKey).thenComparing(reference -> reference.sourceType().name())
                .thenComparing(Reference::sourceKey).thenComparing(Reference::fieldPath)
                .thenComparing(reference -> reference.target().toString())).toList(), needed);
    }

    private void follow(Invocation invocation, Reference reference) {
        Target target = reference.target();
        String path = path(reference);
        if (target.type() == TargetType.SKILL) {
            load(target.key(), path);
            return;
        }
        if (target.skillKey().isEmpty()) return;
        SkillConfigurationResponse configuration = load(target.skillKey(), path);
        if (target.type() == TargetType.PARAMETER) {
            SkillParameterResponse parameter = configuration.parameters().stream()
                .filter(candidate -> candidate.parameterKey().equals(target.key())).findFirst().orElse(null);
            if (parameter == null) throw SnapshotIssues.invalid(path, "REFERENCE_MISSING", "必要参数不存在");
            validateParameter(invocation.owner(), configuration, parameter);
            return;
        }
        ObjectKey key = objectKey(target);
        if (key == null) return;
        Aggregate dependency = objects.get(key);
        if (dependency == null) throw SnapshotIssues.invalid(path, "REFERENCE_MISSING", "开启闭包中的必要组成不存在");
        Source owner = invocation.owner();
        if (key.type() != SourceType.FORMULA && !key.skillKey().equals(owner.skillKey)) owner = ownerFor(owner, key.skillKey(), path);
        boolean executes = invocation.executes() && executesDependency(invocation.object(), reference);
        enqueue(owner, dependency, executes);
    }

    private Source ownerFor(Source source, String skillKey, String path) {
        List<Source> candidates = sources.stream().filter(candidate -> candidate.side.equals(source.side) && candidate.skillKey.equals(skillKey)).toList();
        Source target = candidates.stream().filter(candidate -> candidate.origin.equals(source.origin)).findFirst().orElse(null);
        if (target == null) {
            if (candidates.size() != 1) throw SnapshotIssues.invalid(path, "REFERENCE_OUT_OF_SCOPE", "必要运行组成没有同侧唯一的真实来源，读取定义不能授予来源");
            target = candidates.getFirst();
        }
        if (target.status != SkillStatus.ENABLED || !target.enabled || Integer.valueOf(0).equals(target.level)
            || target.inactive == InactiveReason.NO_AUTONOMOUS_ATTACK) {
            throw SnapshotIssues.invalid(path, "SOURCE_DEPENDENCY_INACTIVE", "必要组成所属实际来源已禁用、未学或不属于本次自主主体");
        }
        return target;
    }

    private static boolean executesDependency(Aggregate object, Reference reference) {
        String field = reference.fieldPath();
        if (object.type() == SourceType.TRIGGER && field.startsWith("actions[")) {
            int close = field.indexOf(']');
            int index = Integer.parseInt(field.substring("actions[".length(), close));
            String action = object.data().path("actions").path(index).path("actionType").asText();
            return (reference.target().type() == TargetType.EFFECT && "EXECUTE_EFFECT".equals(action))
                || (reference.target().type() == TargetType.PROCESS && "START_PROCESS".equals(action));
        }
        return object.type() == SourceType.PROCESS && (field.startsWith("effectBindings[") || field.startsWith("stateOperations["));
    }

    private void subscribe(Invocation producer) {
        for (Source source : sources) {
            if (!source.side.equals(producer.owner().side) || source.inactive != null) continue;
            for (Aggregate rule : rules(source)) {
                if (!matches(source, rule, producer) || rule.data().path("actions").isEmpty()) continue;
                if (requiresLevel(source, rule)) {
                    source.inactive = InactiveReason.LEVEL_REQUIRED;
                    source.ruleKeys.clear();
                    levelsChanged = true;
                    continue;
                }
                enqueue(source, rule, true);
            }
        }
    }

    private static boolean matches(Source subscriber, Aggregate rule, Invocation producer) {
        JsonNode event = rule.data().path("eventSource");
        JsonNode detail = event.path("detail");
        Aggregate object = producer.object();
        boolean local = subscriber == producer.owner() && subscriber.skillKey.equals(object.skillKey());
        return switch (event.path("eventType").asText()) {
            case "PROCESS_MOMENT" -> local && object.type() == SourceType.PROCESS && detail.path("processKey").asText().equals(object.key());
            case "RESULT_AVAILABLE" -> local && object.type() == SourceType.EFFECT && detail.path("effectKey").asText().equals(object.key())
                && object.data().path("results").findValuesAsText("resultKey").contains(detail.path("resultKey").asText());
            case "LIFECYCLE_MOMENT" -> local && object.type() == SourceType.EFFECT && object.data().hasNonNull("lifecycle")
                && detail.path("effectKey").asText().equals(object.key())
                && lifecycleEventPossible(detail.path("moment").asText(), object.data().path("lifecycle"));
            case "SPELL_SHIELD_BLOCKED" -> local && object.type() == SourceType.EFFECT
                && detail.path("shieldEffectKey").asText().equals(object.key())
                && object.data().path("results").findValuesAsText("resultType").contains("SPELL_SHIELD");
            case "INTERNAL_STATE_CHANGED" -> object.type() == SourceType.STATE
                && detail.path("stateSkillKey").asText(subscriber.skillKey).equals(object.skillKey())
                && detail.path("stateKey").asText().equals(object.key())
                && stateEventPossible(detail.path("changeKind").asText(), object.data().path("stateType").asText())
                && (subscriber.origin.equals(producer.owner().origin) || !subscriber.skillKey.equals(object.skillKey()));
            default -> false;
        };
    }

    private static boolean lifecycleEventPossible(String moment, JsonNode lifecycle) {
        return switch (moment) {
            case "PERIODIC" -> lifecycle.hasNonNull("periodicIntervalValue");
            case "NATURAL_END" -> lifecycle.hasNonNull("durationValue");
            case "FULL_STACKS" -> lifecycle.hasNonNull("maxStacksValue");
            case "APPLICATION", "EARLY_REMOVE" -> true;
            default -> false;
        };
    }

    private static boolean stateEventPossible(String change, String type) {
        return switch (type) {
            case "COUNTER", "AMMO" -> change.equals("VALUE_CHANGED");
            case "FLAG" -> change.equals("FLAG_CHANGED");
            case "MODE" -> change.equals("OPTION_SELECTED");
            case "INTERNAL_COOLDOWN" -> change.equals("COOLDOWN_READY");
            default -> false;
        };
    }

    private boolean natural(Source source, Aggregate rule) {
        JsonNode event = rule.data().path("eventSource");
        String type = event.path("eventType").asText();
        if (Set.of("SKILL_USED", "SKILL_HIT").contains(type)) {
            if (!source.side.equals("source") || !event.path("detail").path("sourceSkillKey").asText().equals(attackKey)) return false;
            return !type.equals("SKILL_USED") || event.path("detail").path("castPhase").asText().equals("INITIAL");
        }
        if (!NATURAL_EVENTS.contains(type)) return false;
        if (type.equals("BASIC_ATTACK_RECEIVED")) return source.side.equals("target");
        if (Set.of("BASIC_ATTACK_START", "BASIC_ATTACK_HIT", "HIT_LINK_APPLIED", "ATTACK_LINK_APPLIED").contains(type)) {
            return source.side.equals("source");
        }
        return true;
    }

    private boolean requiresLevel(Source source, Aggregate root) {
        if (source.level != null) return false;
        Set<Invocation> checked = new HashSet<>();
        ArrayDeque<Invocation> remaining = new ArrayDeque<>();
        remaining.add(new Invocation(source, root, true));
        while (!remaining.isEmpty()) {
            Invocation invocation = remaining.removeFirst();
            Aggregate object = invocation.object();
            if (!checked.add(invocation)) continue;
            for (Reference reference : references(object)) {
                Target target = reference.target();
                if (!target.skillKey().equals(source.skillKey)) continue;
                if (target.type() == TargetType.PARAMETER && source.configuration.parameters().stream()
                    .anyMatch(parameter -> parameter.parameterKey().equals(target.key()) && parameter.valueMode() == SkillParameterValueMode.SKILL_LEVEL)) return true;
                ObjectKey key = objectKey(target);
                if (key != null && objects.containsKey(key)) remaining.add(new Invocation(source, objects.get(key),
                    invocation.executes() && executesDependency(object, reference)));
            }
            if (invocation.executes()) rules(source).stream().filter(rule -> matches(source, rule, invocation))
                .forEach(rule -> remaining.add(new Invocation(source, rule, true)));
        }
        return false;
    }

    private void validateParameter(Source source, SkillConfigurationResponse configuration, SkillParameterResponse parameter) {
        String path = "skillConfigurations[" + indexOf(configuration.skill().skillKey()) + "].parameters." + parameter.parameterKey();
        SkillParameterValueMode mode = parameter.valueMode();
        if (mode == SkillParameterValueMode.RUNTIME_INPUT) return;
        if (mode == SkillParameterValueMode.FIXED) {
            if (parameter.fixedValue() == null) throw SnapshotIssues.invalid(path + ".fixedValue", "NUMBER_MISSING", "必要固定参数没有数值");
            return;
        }
        Integer level = mode == SkillParameterValueMode.CHARACTER_LEVEL ? source.characterLevel : source.level;
        if (mode == SkillParameterValueMode.SKILL_LEVEL && level == null) {
            source.inactive = InactiveReason.LEVEL_REQUIRED;
            source.ruleKeys.clear();
            return;
        }
        BigDecimal value = parameter.levelValues() == null || level == null ? null : parameter.levelValues().get(level.toString());
        if (value == null) throw SnapshotIssues.invalid(path + ".levelValues." + level, "NUMBER_MISSING", "必要参数缺少实际拥有方的等级数值");
    }

    private void enqueue(Source source, Aggregate object, boolean executes) {
        Invocation invocation = new Invocation(source, object, executes);
        if (visited.add(invocation)) pending.add(invocation);
        if (executes) active.add(source);
    }

    private List<Aggregate> rules(Source source) {
        return source.configuration.triggerRules().stream().map(rule -> objects.get(new ObjectKey(source.skillKey, SourceType.TRIGGER, rule.ruleKey()))).toList();
    }

    private SkillConfigurationResponse load(String skillKey, String path) {
        if (!configurations.containsKey(skillKey)) {
            if (configurations.size() >= 32) throw SnapshotIssues.invalid("skillConfigurations", "CONFIGURATION_LIMIT_EXCEEDED", "完整作者配置与必要只读定义不能超过32份");
            SkillConfigurationResponse configuration = reader.apply(skillKey, path);
            configurations.put(skillKey, configuration);
            index(configuration);
        }
        SkillConfigurationResponse configuration = configurations.get(skillKey);
        if (configuration.skill().status() != SkillStatus.ENABLED) throw SnapshotIssues.invalid(path, "SKILL_DISABLED", "开启闭包引用的技能定义全局禁用");
        return configuration;
    }

    private void index(SkillConfigurationResponse configuration) {
        String skillKey = configuration.skill().skillKey();
        JsonNode data = json.valueToTree(configuration);
        Set<String> parameters = new HashSet<>();
        for (SkillParameterResponse parameter : configuration.parameters()) {
            if (parameter.parameterKey() == null || !KEY.matcher(parameter.parameterKey()).matches() || !parameters.add(parameter.parameterKey())) {
                throw SnapshotIssues.invalid("skillConfigurations[" + indexOf(skillKey) + "].parameters." + parameter.parameterKey(),
                    "DUPLICATE_KEY", "参数标识缺失、不合法或重复");
            }
        }
        Map<SourceType, String> fields = Map.of(SourceType.FORMULA, "formulas", SourceType.EFFECT, "effects", SourceType.STATE, "internalStates",
            SourceType.PROCESS, "processes", SourceType.TRIGGER, "triggerRules");
        for (SourceType type : SourceType.values()) {
            String keyField = switch (type) {
                case FORMULA -> "formulaKey";
                case EFFECT -> "effectKey";
                case STATE -> "stateKey";
                case PROCESS -> "processKey";
                case TRIGGER -> "ruleKey";
            };
            for (JsonNode row : data.path(fields.get(type))) {
                String key = row.path(keyField).asText();
                ObjectKey identity = new ObjectKey(skillKey, type, key);
                if (!KEY.matcher(key).matches() || objects.containsKey(identity)) {
                    throw SnapshotIssues.invalid(objectPath(identity) + "." + keyField, "DUPLICATE_KEY", "作者对象标识缺失、不合法或重复");
                }
                ObjectNode aggregate = row.deepCopy();
                if (type == SourceType.TRIGGER) {
                    ObjectNode limits = aggregate.putObject("limits");
                    for (String field : List.of("perTargetCooldown", "maxTriggersPerProcess", "oncePerUse")) limits.set(field, aggregate.get(field));
                }
                objects.put(identity, new Aggregate(type, skillKey, key, aggregate));
            }
        }
    }

    private List<Reference> references(Aggregate object) {
        try {
            return extracted.computeIfAbsent(new ObjectKey(object.skillKey(), object.type(), object.key()),
                identity -> SkillObjectReferences.extract(gameId, List.of(object)));
        } catch (ApiException exception) {
            throw translate(exception);
        }
    }

    private ApiException translate(ApiException exception) {
        if (exception.getDetails().get("fieldIssues") instanceof List<?> issues && !issues.isEmpty() && issues.getFirst() instanceof Map<?, ?> issue) {
            SourceType type = issue.get("sourceType") == null ? null : SourceType.valueOf(String.valueOf(issue.get("sourceType")));
            if (type == null) return SnapshotIssues.invalid("skillConfigurations", "INVALID_STORED_DATA", exception.getMessage());
            String field = String.valueOf(issue.get("field"));
            if (type == SourceType.TRIGGER && field.startsWith("limits.")) field = field.substring("limits.".length());
            return SnapshotIssues.invalid(objectPath(new ObjectKey(String.valueOf(issue.get("sourceSkillKey")), type,
                String.valueOf(issue.get("sourceKey")))) + "." + field,
                "MISSING_REFERENCE_TARGET".equals(issue.get("code")) ? "REFERENCE_MISSING" : "INVALID_STORED_DATA", exception.getMessage());
        }
        return SnapshotIssues.invalid("skillConfigurations", "INVALID_STORED_DATA", "开启闭包中的作者结构不合法");
    }

    String path(Reference reference) {
        String field = reference.fieldPath();
        if (reference.sourceType() == SourceType.TRIGGER && field.startsWith("limits.")) field = field.substring("limits.".length());
        return objectPath(new ObjectKey(reference.sourceSkillKey(), reference.sourceType(), reference.sourceKey())) + "." + field;
    }

    String objectPath(Aggregate object) {
        return objectPath(new ObjectKey(object.skillKey(), object.type(), object.key()));
    }

    private String objectPath(ObjectKey object) {
        String field = switch (object.type()) {
            case FORMULA -> "formulas";
            case EFFECT -> "effects";
            case STATE -> "internalStates";
            case PROCESS -> "processes";
            case TRIGGER -> "triggerRules";
        };
        return "skillConfigurations[" + indexOf(object.skillKey()) + "]." + field + "." + object.key();
    }

    private int indexOf(String skillKey) {
        return new ArrayList<>(configurations.keySet().stream().sorted().toList()).indexOf(skillKey);
    }

    private static ObjectKey objectKey(Target target) {
        SourceType type = switch (target.type()) {
            case FORMULA -> SourceType.FORMULA;
            case EFFECT, RESULT, LIFECYCLE -> SourceType.EFFECT;
            case STATE, OPTION -> SourceType.STATE;
            case PROCESS, STEP -> SourceType.PROCESS;
            case ACTION -> SourceType.TRIGGER;
            default -> null;
        };
        return type == null ? null : new ObjectKey(target.skillKey(), type, target.key());
    }

    private record ObjectKey(String skillKey, SourceType type, String key) { }
    private record Invocation(Source owner, Aggregate object, boolean executes) { }
    record Result(List<SkillConfigurationResponse> configurations, List<Reference> references, List<Aggregate> objects) { }
}
