package xyz.game.datamanage.service.skillconfiguration;

import com.fasterxml.jackson.databind.JsonNode;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
import java.util.function.Function;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skill.SkillUpdateRequest;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationChange;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectCreateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectUpdateRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleCreateRequest;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleUpdateRequest;
import xyz.game.datamanage.service.skill.SkillService;
import xyz.game.datamanage.service.skillparameter.SkillParameterService;
import xyz.game.datamanage.service.skillformula.SkillFormulaService;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
import xyz.game.datamanage.service.skillprocess.SkillProcessService;
import xyz.game.datamanage.service.skillinternalstate.SkillInternalStateService;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.authoring.SkillProcessBehaviorSemantics;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class SkillConfigurationService {

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> SKILL_FIELDS = Set.of(
        "name", "description", "maxLevel", "status", "sortOrder", "skillCategoryKeys");
    private static final Set<String> PARAMETER_CREATE_FIELDS = Set.of(
        "parameterKey", "name", "valueType", "valueMode", "fixedValue", "levelValues",
        "description", "sortOrder");
    private static final Set<String> PARAMETER_UPDATE_FIELDS = Set.of(
        "name", "valueType", "valueMode", "fixedValue", "levelValues",
        "description", "sortOrder");
    private static final Set<String> FORMULA_CREATE_FIELDS = Set.of(
        "formulaKey", "name", "description", "sortOrder", "expression");
    private static final Set<String> FORMULA_UPDATE_FIELDS = Set.of(
        "name", "description", "sortOrder", "expression");
    private static final Set<String> STATE_CREATE_FIELDS = Set.of(
        "stateKey", "name", "stateType", "scope", "description", "sortOrder", "detail");
    private static final Set<String> STATE_UPDATE_FIELDS = Set.of(
        "name", "stateType", "scope", "description", "sortOrder", "detail");
    private static final Set<String> EFFECT_CREATE_FIELDS = Set.of(
        "effectKey", "name", "description", "sortOrder", "lifecycle", "results");
    private static final Set<String> EFFECT_UPDATE_FIELDS = Set.of(
        "name", "description", "sortOrder", "lifecycle", "results");
    private static final Set<String> PROCESS_CREATE_FIELDS = Set.of(
        "processKey", "name", "activationType", "description", "sortOrder", "cooldown",
        "steps", "effectBindings", "stateOperations");
    private static final Set<String> PROCESS_UPDATE_FIELDS = Set.of(
        "name", "activationType", "description", "sortOrder", "cooldown",
        "steps", "effectBindings", "stateOperations");
    private static final Set<String> RULE_CREATE_FIELDS = Set.of(
        "ruleKey", "name", "description", "sortOrder", "eventSource", "conditionGroups",
        "actions", "perTargetCooldown", "maxTriggersPerProcess", "oncePerUse");
    private static final Set<String> RULE_UPDATE_FIELDS = Set.of(
        "name", "description", "sortOrder", "eventSource", "conditionGroups",
        "actions", "perTargetCooldown", "maxTriggersPerProcess", "oncePerUse");
    private static final Set<String> DECLARED_TYPES = Set.of(
        "PARAMETER", "FORMULA", "EFFECT", "PROCESS", "INTERNAL_STATE", "TRIGGER_RULE");

    private final GameConfigurationWriteGuard configurationWrites;
    private final SkillMapper skillMapper;
    private final SkillService skillService;
    private final SkillParameterService parameterService;
    private final SkillFormulaService formulaService;
    private final SkillEffectService effectService;
    private final SkillProcessService processService;
    private final SkillInternalStateService internalStateService;
    private final SkillTriggerRuleService triggerRuleService;
    private final ObjectMapper objectMapper;
    private final Validator validator;

    public SkillConfigurationService(
        GameConfigurationWriteGuard configurationWrites,
        SkillMapper skillMapper,
        SkillService skillService,
        SkillParameterService parameterService,
        SkillFormulaService formulaService,
        SkillEffectService effectService,
        SkillProcessService processService,
        SkillInternalStateService internalStateService,
        SkillTriggerRuleService triggerRuleService,
        ObjectMapper objectMapper,
        Validator validator
    ) {
        this.configurationWrites = configurationWrites;
        this.skillMapper = skillMapper;
        this.skillService = skillService;
        this.parameterService = parameterService;
        this.formulaService = formulaService;
        this.effectService = effectService;
        this.processService = processService;
        this.internalStateService = internalStateService;
        this.triggerRuleService = triggerRuleService;
        this.objectMapper = objectMapper;
        this.validator = validator;
    }

    /** All detail queries share one database snapshot. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SkillConfigurationResponse get(String gameId, String skillKey) {
        return readConfiguration(gameId, skillKey);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public SkillConfigurationResponse create(String gameId, String skillKey, SkillConfigurationSaveRequest request) {
        configurationWrites.begin(gameId);
        if (skillMapper.countByKey(gameId, skillKey) > 0) {
            throw conflict("409.SKILL_KEY_EXISTS", "技能标识已存在", "skill", skillKey);
        }
        requireRequest(request);
        if (request.baseDigest() != null) {
            throw invalid("baseDigest", "FORBIDDEN", "新建技能不能携带基线摘要", "skill", skillKey);
        }
        SkillUpdateRequest skill = parseSkill(request.skill(), true);
        PreparedConfiguration candidate = prepareChanges(gameId, skillKey, request.changes(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), null, skill.maxLevel());
        skillService.createWithinConfiguration(gameId, skillKey, skill);
        applyChanges(gameId, skillKey, skill.maxLevel(), candidate);
        return readConfiguration(gameId, skillKey);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public SkillConfigurationResponse update(String gameId, String skillKey, SkillConfigurationSaveRequest request) {
        configurationWrites.begin(gameId);
        requireRequest(request);
        if (request.baseDigest() == null || request.baseDigest().isBlank()) {
            throw invalid("baseDigest", "REQUIRED", "必须提供读取时的配置摘要", "skill", skillKey);
        }
        SkillConfigurationResponse baseline = readConfiguration(gameId, skillKey);
        if (!baseline.baseDigest().equals(request.baseDigest())) {
            throw conflict("409.SKILL_CONFIGURATION_CHANGED", "技能配置已被其他保存修改，请重新读取", "skill", skillKey);
        }
        SkillUpdateRequest skill = parseSkill(request.skill(), false);
        int finalMaxLevel = skill == null ? baseline.skill().maxLevel() : skill.maxLevel();
        PreparedConfiguration candidate = prepareChanges(gameId, skillKey, request.changes(),
            baseline.parameters(), baseline.formulas(), baseline.effects(), baseline.internalStates(),
            baseline.processes(), baseline.triggerRules(), baseline.skill().maxLevel(), finalMaxLevel);
        if (skill != null) {
            skillService.updateWithinConfiguration(gameId, skillKey, skill);
        }
        applyChanges(gameId, skillKey, finalMaxLevel, candidate);
        return readConfiguration(gameId, skillKey);
    }

    /** 只投影已有技能的候选；正式保存仍单独执行带锁引用及最终态校验。 */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public SkillConfigurationResponse previewUpdate(String gameId, String skillKey, SkillConfigurationSaveRequest request) {
        requireRequest(request);
        if (request.baseDigest() == null || request.baseDigest().isBlank()) {
            throw invalid("baseDigest", "REQUIRED", "必须提供读取时的配置摘要", "skill", skillKey);
        }
        SkillConfigurationResponse before = readConfiguration(gameId, skillKey);
        if (!before.baseDigest().equals(request.baseDigest())) {
            throw conflict("409.SKILL_CONFIGURATION_CHANGED", "技能配置已被其他保存修改，请重新读取", "skill", skillKey);
        }
        if (request.changes() != null && request.changes().stream().anyMatch(change -> change != null
            && "DELETE".equals(change.operation()))) {
            throw invalid("changes", "PREVIEW_DELETE_FORBIDDEN", "候选场景不接受删除操作", "skill", skillKey);
        }
        SkillUpdateRequest skill = parseSkill(request.skill(), false);
        int maximum = skill == null ? before.skill().maxLevel() : skill.maxLevel();
        PreparedConfiguration candidate = prepareChangeShapes(gameId, skillKey, request.changes(),
            before.parameters(), before.formulas(), before.effects(), before.internalStates(), before.processes(),
            before.triggerRules(), before.skill().maxLevel(), maximum);
        if (candidate.changes().stream().anyMatch(change -> "EFFECT".equals(change.type()))) {
            effectService.validateConfigurationFinalTargets(skillKey, candidate.finalEffects(), candidate.effectLifecycles());
        }
        return projectConfiguration(gameId, skillKey, before, skill, candidate);
    }

    private SkillConfigurationResponse projectConfiguration(String gameId, String skillKey,
        SkillConfigurationResponse before, SkillUpdateRequest skill, PreparedConfiguration candidate) {
        Map<String, SkillParameterResponse> parameters = indexed(before.parameters(), SkillParameterResponse::parameterKey);
        Map<String, SkillFormulaDetailResponse> formulas = indexed(before.formulas(), SkillFormulaDetailResponse::formulaKey);
        Map<String, SkillEffectDetailResponse> effects = indexed(before.effects(), SkillEffectDetailResponse::effectKey);
        Map<String, SkillProcessDetailResponse> processes = indexed(before.processes(), SkillProcessDetailResponse::processKey);
        Map<String, SkillInternalStateDetailResponse> states = indexed(before.internalStates(), SkillInternalStateDetailResponse::stateKey);
        Map<String, SkillTriggerRuleDetailResponse> rules = indexed(before.triggerRules(), SkillTriggerRuleDetailResponse::ruleKey);
        for (PreparedChange change : candidate.changes()) {
            String key = change.key();
            boolean creating = change.operation() == Operation.CREATE;
            switch (change.type()) {
                case "PARAMETER" -> {
                    SkillParameterResponse prior = parameters.get(key);
                    SkillParameterCreateRequest value = creating ? change.parameterCreate() : new SkillParameterCreateRequest(key,
                        change.parameterUpdate().name(), change.parameterUpdate().valueType(), change.parameterUpdate().valueMode(),
                        change.parameterUpdate().fixedValue(), change.parameterUpdate().levelValues(),
                        change.parameterUpdate().description(), change.parameterUpdate().sortOrder());
                    parameters.put(key, new SkillParameterResponse(gameId, skillKey, key, value.name(), value.valueType(),
                        value.valueMode(), value.fixedValue(), value.levelValues(), value.description(), value.sortOrder(),
                        prior == null ? null : prior.createdAt(), prior == null ? null : prior.updatedAt()));
                }
                case "FORMULA" -> {
                    SkillFormulaDetailResponse prior = formulas.get(key);
                    SkillFormulaCreateRequest value = creating ? change.formulaCreate() : new SkillFormulaCreateRequest(key,
                        change.formulaUpdate().name(), change.formulaUpdate().description(), change.formulaUpdate().sortOrder(),
                        change.formulaUpdate().expression());
                    formulas.put(key, new SkillFormulaDetailResponse(gameId, skillKey, key, value.name(), value.description(),
                        value.sortOrder(), value.expression(), prior == null ? null : prior.createdAt(), prior == null ? null : prior.updatedAt()));
                }
                case "EFFECT" -> effects.put(key, effectService.projectConfiguration(gameId, skillKey,
                    candidate.finalEffects().get(key), effects.get(key)));
                case "PROCESS" -> processes.put(key, processService.projectPrepared(gameId, skillKey,
                    change.processPrepared(), processes.get(key)));
                case "INTERNAL_STATE" -> {
                    SkillInternalStateCreateRequest value = creating ? change.stateCreate() : new SkillInternalStateCreateRequest(key,
                        change.stateUpdate().name(), change.stateUpdate().stateType(), change.stateUpdate().scope(),
                        change.stateUpdate().description(), change.stateUpdate().sortOrder(), change.stateUpdate().detail());
                    states.put(key, internalStateService.projectConfiguration(gameId, skillKey, value, states.get(key)));
                }
                case "TRIGGER_RULE" -> rules.put(key, triggerRuleService.projectPrepared(gameId, skillKey, change.rulePrepared()));
                default -> throw new IllegalStateException("已准备的候选包含未知组成");
            }
        }
        SkillResponse prior = before.skill();
        SkillResponse projectedSkill = skill == null ? prior : new SkillResponse(gameId, skillKey, skill.name(),
            skill.description(), skill.maxLevel(), skill.status(), skill.sortOrder(), skill.skillCategoryKeys(),
            prior.createdAt(), prior.updatedAt());
        SkillConfigurationResponse content = new SkillConfigurationResponse(projectedSkill, List.copyOf(parameters.values()),
            List.copyOf(formulas.values()), List.copyOf(effects.values()), List.copyOf(processes.values()),
            List.copyOf(states.values()), List.copyOf(rules.values()), null);
        List<Aggregate> behaviorContext = new ArrayList<>();
        content.processes().forEach(row -> behaviorContext.add(new Aggregate(SourceType.PROCESS, skillKey, row.processKey(), objectMapper.valueToTree(row))));
        content.effects().forEach(row -> behaviorContext.add(new Aggregate(SourceType.EFFECT, skillKey, row.effectKey(), objectMapper.valueToTree(row))));
        content.internalStates().forEach(row -> behaviorContext.add(new Aggregate(SourceType.STATE, skillKey, row.stateKey(), objectMapper.valueToTree(row))));
        content.triggerRules().forEach(row -> behaviorContext.add(new Aggregate(SourceType.TRIGGER, skillKey, row.ruleKey(), objectMapper.valueToTree(row))));
        SkillProcessBehaviorSemantics.validate(Set.of(skillKey), behaviorContext);
        return new SkillConfigurationResponse(content.skill(), content.parameters(), content.formulas(), content.effects(),
            content.processes(), content.internalStates(), content.triggerRules(), digest(content));
    }

    private static <T> Map<String, T> indexed(List<T> rows, Function<T, String> key) {
        Map<String, T> result = new TreeMap<>();
        rows.forEach(row -> result.put(key.apply(row), row));
        return result;
    }

    private SkillConfigurationResponse readConfiguration(String gameId, String skillKey) {
        SkillResponse skill = skillService.get(gameId, skillKey);
        List<SkillParameterResponse> parameters = parameterService.list(gameId, skillKey).stream()
            .sorted(Comparator.comparing(SkillParameterResponse::parameterKey)).toList();
        List<SkillFormulaDetailResponse> formulas = formulaService.list(gameId, skillKey).stream()
            .map(item -> formulaService.get(gameId, skillKey, item.formulaKey()))
            .sorted(Comparator.comparing(SkillFormulaDetailResponse::formulaKey)).toList();
        List<SkillEffectDetailResponse> effects = effectService.list(gameId, skillKey).stream()
            .map(item -> effectService.get(gameId, skillKey, item.effectKey()))
            .sorted(Comparator.comparing(SkillEffectDetailResponse::effectKey)).toList();
        List<SkillProcessDetailResponse> processes = processService.list(gameId, skillKey).stream()
            .map(item -> processService.get(gameId, skillKey, item.processKey()))
            .sorted(Comparator.comparing(SkillProcessDetailResponse::processKey)).toList();
        List<SkillInternalStateDetailResponse> internalStates = internalStateService.list(gameId, skillKey).stream()
            .map(item -> internalStateService.get(gameId, skillKey, item.stateKey()))
            .sorted(Comparator.comparing(SkillInternalStateDetailResponse::stateKey)).toList();
        List<SkillTriggerRuleDetailResponse> triggerRules = triggerRuleService.list(gameId, skillKey).stream()
            .map(item -> triggerRuleService.get(gameId, skillKey, item.ruleKey()))
            .sorted(Comparator.comparing(SkillTriggerRuleDetailResponse::ruleKey)).toList();
        SkillConfigurationResponse withoutDigest = new SkillConfigurationResponse(
            skill, parameters, formulas, effects, processes, internalStates, triggerRules, null);
        return new SkillConfigurationResponse(skill, parameters, formulas, effects, processes,
            internalStates, triggerRules, digest(withoutDigest));
    }

    private SkillUpdateRequest parseSkill(JsonNode node, boolean required) {
        if (node == null || node.isNull()) {
            if (required) {
                throw invalid("skill", "REQUIRED", "新建技能必须提供主体", "skill", "");
            }
            return null;
        }
        requireFields(node, SKILL_FIELDS, "skill", "skill", "");
        SkillUpdateRequest skill = convert(node, SkillUpdateRequest.class, "skill", "skill", "");
        validateBean(skill, "skill", "skill", "");
        return skill;
    }

    private PreparedConfiguration prepareChanges(
        String gameId, String skillKey, List<SkillConfigurationChange> submitted,
        List<SkillParameterResponse> currentParameters, List<SkillFormulaDetailResponse> currentFormulas,
        List<SkillEffectDetailResponse> currentEffects, List<SkillInternalStateDetailResponse> currentStates,
        List<SkillProcessDetailResponse> currentProcesses, List<SkillTriggerRuleDetailResponse> currentRules,
        Integer oldMaxLevel, int finalMaxLevel
    ) {
        PreparedConfiguration candidate = prepareChangeShapes(gameId, skillKey, submitted, currentParameters,
            currentFormulas, currentEffects, currentStates, currentProcesses, currentRules, oldMaxLevel, finalMaxLevel);
        validatePreparedReferences(gameId, skillKey, candidate);
        return candidate;
    }

    private PreparedConfiguration prepareChangeShapes(
        String gameId, String skillKey, List<SkillConfigurationChange> submitted,
        List<SkillParameterResponse> currentParameters, List<SkillFormulaDetailResponse> currentFormulas,
        List<SkillEffectDetailResponse> currentEffects, List<SkillInternalStateDetailResponse> currentStates,
        List<SkillProcessDetailResponse> currentProcesses, List<SkillTriggerRuleDetailResponse> currentRules,
        Integer oldMaxLevel, int finalMaxLevel
    ) {
        List<SkillConfigurationChange> source = submitted == null ? List.of() : submitted;
        boolean deferRelatedReferences = source.stream().anyMatch(change -> change != null
            && change.objectType() != null
            && Set.of("PROCESS", "TRIGGER_RULE").contains(change.objectType()));
        Map<String, SkillParameterResponse> currentParametersByKey = new HashMap<>();
        for (SkillParameterResponse parameter : currentParameters) {
            currentParametersByKey.put(parameter.parameterKey(), parameter);
        }
        Map<String, JsonNode> finalFormulas = new HashMap<>();
        for (SkillFormulaDetailResponse formula : currentFormulas) {
            finalFormulas.put(formula.formulaKey(), formula.expression());
        }
        Map<String, SkillEffectCreateRequest> finalEffects = new HashMap<>();
        for (SkillEffectDetailResponse effect : currentEffects) {
            SkillEffectLifecycleRequest lifecycle = effect.lifecycle() == null ? null
                : objectMapper.convertValue(effect.lifecycle(), SkillEffectLifecycleRequest.class);
            List<SkillEffectResultRequest> results = objectMapper.convertValue(effect.results(),
                new TypeReference<List<SkillEffectResultRequest>>() {});
            finalEffects.put(effect.effectKey(), new SkillEffectCreateRequest(effect.effectKey(),
                effect.name(), effect.description(), effect.sortOrder(), lifecycle, results));
        }
        Set<String> finalStateKeys = new HashSet<>();
        for (SkillInternalStateDetailResponse state : currentStates) finalStateKeys.add(state.stateKey());
        Map<String, SkillProcessDetailResponse> currentProcessesByKey = new HashMap<>();
        for (SkillProcessDetailResponse process : currentProcesses) {
            currentProcessesByKey.put(process.processKey(), process);
        }
        Map<String, SkillTriggerRuleDetailResponse> currentRulesByKey = new HashMap<>();
        for (SkillTriggerRuleDetailResponse rule : currentRules) {
            currentRulesByKey.put(rule.ruleKey(), rule);
        }
        Set<String> seen = new HashSet<>();
        Set<String> submittedParameters = new HashSet<>();
        List<PreparedChange> prepared = new ArrayList<>(source.size());
        for (int i = 0; i < source.size(); i++) {
            String path = "changes/" + i;
            SkillConfigurationChange change = source.get(i);
            if (change == null) {
                throw invalid(path, "REQUIRED", "变更项不能为空", "", "");
            }
            String type = change.objectType();
            if (type == null || !DECLARED_TYPES.contains(type)) {
                throw invalid(path + "/objectType", "ENUM_INVALID", "对象类型不受支持", "", change.key());
            }
            Operation operation;
            try {
                operation = Operation.valueOf(change.operation());
            } catch (IllegalArgumentException | NullPointerException ex) {
                throw invalid(path + "/operation", "ENUM_INVALID", "操作类型不受支持", type, change.key());
            }
            String key = change.key();
            if (key == null || !KEY_PATTERN.matcher(key).matches()) {
                throw invalid(path + "/key", "FORMAT_INVALID", "对象标识格式不合法", type, key);
            }
            if (!seen.add(type + "/" + key)) {
                throw invalid(path + "/key", "DUPLICATE", "同一对象不能重复提交", type, key);
            }
            if ("PARAMETER".equals(type)) submittedParameters.add(key);
            boolean exists = switch (type) {
                case "PARAMETER" -> currentParametersByKey.containsKey(key);
                case "FORMULA" -> finalFormulas.containsKey(key);
                case "EFFECT" -> finalEffects.containsKey(key);
                case "INTERNAL_STATE" -> finalStateKeys.contains(key);
                case "PROCESS" -> currentProcessesByKey.containsKey(key);
                case "TRIGGER_RULE" -> currentRulesByKey.containsKey(key);
                default -> false;
            };
            if (operation == Operation.CREATE && exists) {
                String code = switch (type) {
                    case "PARAMETER" -> "409.SKILL_PARAMETER_KEY_EXISTS";
                    case "FORMULA" -> "409.SKILL_FORMULA_KEY_EXISTS";
                    case "EFFECT" -> "409.SKILL_EFFECT_KEY_EXISTS";
                    case "INTERNAL_STATE" -> "409.SKILL_INTERNAL_STATE_KEY_EXISTS";
                    case "PROCESS" -> "409.SKILL_PROCESS_KEY_EXISTS";
                    default -> "409.SKILL_TRIGGER_RULE_KEY_EXISTS";
                };
                throw conflict(code, "对象标识已存在", type, key);
            }
            if (operation != Operation.CREATE && !exists) {
                String code = switch (type) {
                    case "PARAMETER" -> "404.SKILL_PARAMETER_NOT_FOUND";
                    case "FORMULA" -> "404.SKILL_FORMULA_NOT_FOUND";
                    case "EFFECT" -> "404.SKILL_EFFECT_NOT_FOUND";
                    case "INTERNAL_STATE" -> "404.SKILL_INTERNAL_STATE_NOT_FOUND";
                    case "PROCESS" -> "404.SKILL_PROCESS_NOT_FOUND";
                    default -> "404.SKILL_TRIGGER_RULE_NOT_FOUND";
                };
                throw new ApiException(HttpStatus.NOT_FOUND,
                    code,
                    "对象不存在", Map.of("fieldIssues", List.of(issue(path + "/key",
                        "NOT_FOUND", "对象不存在", type, key))));
            }
            SkillParameterCreateRequest parameterCreate = null;
            SkillParameterUpdateRequest parameterUpdate = null;
            SkillFormulaCreateRequest formulaCreate = null;
            SkillFormulaUpdateRequest formulaUpdate = null;
            SkillInternalStateCreateRequest stateCreate = null;
            SkillInternalStateUpdateRequest stateUpdate = null;
            SkillEffectCreateRequest effectCreate = null;
            SkillEffectUpdateRequest effectUpdate = null;
            SkillProcessService.Prepared processPrepared = null;
            SkillTriggerRuleService.Prepared rulePrepared = null;
            if (operation == Operation.DELETE) {
                if (change.value() != null && !change.value().isNull()) {
                    throw invalid(path + "/value", "FORBIDDEN", "删除操作不能携带值", type, key);
                }
            } else {
                if (change.value() == null || change.value().isNull()) {
                    throw invalid(path + "/value", "REQUIRED", "新增或修改必须提供完整值", type, key);
                }
                String valuePath = path + "/value";
                if ("PARAMETER".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), PARAMETER_CREATE_FIELDS, valuePath, type, key);
                    parameterCreate = convert(change.value(), SkillParameterCreateRequest.class, valuePath, type, key);
                    validateBean(parameterCreate, valuePath, type, key);
                    if (!key.equals(parameterCreate.parameterKey())) {
                        throw invalid(valuePath + "/parameterKey", "KEY_MISMATCH",
                            "参数标识必须与变更键一致", type, key);
                    }
                    SkillParameterCreateRequest candidate = parameterCreate;
                    validateParameter(() -> parameterService.validateConfigurationCreate(
                        gameId, candidate, finalMaxLevel), valuePath, type, key);
                } else if ("PARAMETER".equals(type)) {
                    requireFields(change.value(), PARAMETER_UPDATE_FIELDS, valuePath, type, key);
                    parameterUpdate = convert(change.value(), SkillParameterUpdateRequest.class, valuePath, type, key);
                    validateBean(parameterUpdate, valuePath, type, key);
                    SkillParameterUpdateRequest candidate = parameterUpdate;
                    validateParameter(() -> parameterService.validateConfigurationUpdate(
                        gameId, key, candidate, finalMaxLevel), valuePath, type, key);
                } else if ("FORMULA".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), FORMULA_CREATE_FIELDS, valuePath, type, key);
                    formulaCreate = convert(change.value(), SkillFormulaCreateRequest.class, valuePath, type, key);
                    validateBean(formulaCreate, valuePath, type, key);
                    if (!key.equals(formulaCreate.formulaKey())) {
                        throw invalid(valuePath + "/formulaKey", "KEY_MISMATCH",
                            "公式标识必须与变更键一致", type, key);
                    }
                } else if ("FORMULA".equals(type)) {
                    requireFields(change.value(), FORMULA_UPDATE_FIELDS, valuePath, type, key);
                    formulaUpdate = convert(change.value(), SkillFormulaUpdateRequest.class, valuePath, type, key);
                    validateBean(formulaUpdate, valuePath, type, key);
                } else if ("INTERNAL_STATE".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), STATE_CREATE_FIELDS, valuePath, type, key);
                    stateCreate = convert(change.value(), SkillInternalStateCreateRequest.class, valuePath, type, key);
                    validateBean(stateCreate, valuePath, type, key);
                    if (!key.equals(stateCreate.stateKey())) {
                        throw invalid(valuePath + "/stateKey", "KEY_MISMATCH",
                            "内部状态标识必须与变更键一致", type, key);
                    }
                } else if ("INTERNAL_STATE".equals(type)) {
                    requireFields(change.value(), STATE_UPDATE_FIELDS, valuePath, type, key);
                    stateUpdate = convert(change.value(), SkillInternalStateUpdateRequest.class, valuePath, type, key);
                    validateBean(stateUpdate, valuePath, type, key);
                } else if ("EFFECT".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), EFFECT_CREATE_FIELDS, valuePath, type, key);
                    effectCreate = convert(change.value(), SkillEffectCreateRequest.class, valuePath, type, key);
                    validateBean(effectCreate, valuePath, type, key);
                    if (!key.equals(effectCreate.effectKey())) {
                        throw invalid(valuePath + "/effectKey", "KEY_MISMATCH",
                            "效果标识必须与变更键一致", type, key);
                    }
                } else if ("EFFECT".equals(type)) {
                    requireFields(change.value(), EFFECT_UPDATE_FIELDS, valuePath, type, key);
                    effectUpdate = convert(change.value(), SkillEffectUpdateRequest.class, valuePath, type, key);
                    validateBean(effectUpdate, valuePath, type, key);
                } else if ("PROCESS".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), PROCESS_CREATE_FIELDS, valuePath, type, key);
                    SkillProcessCreateRequest request = convert(change.value(), SkillProcessCreateRequest.class,
                        valuePath, type, key);
                    validateBean(request, valuePath, type, key);
                    if (!key.equals(request.processKey())) {
                        throw invalid(valuePath + "/processKey", "KEY_MISMATCH",
                            "过程标识必须与变更键一致", type, key);
                    }
                    processPrepared = validateValue(() -> processService.prepareConfigurationCreate(request),
                        valuePath, type, key);
                } else if ("PROCESS".equals(type)) {
                    requireFields(change.value(), PROCESS_UPDATE_FIELDS, valuePath, type, key);
                    SkillProcessUpdateRequest request = convert(change.value(), SkillProcessUpdateRequest.class,
                        valuePath, type, key);
                    validateBean(request, valuePath, type, key);
                    processPrepared = validateValue(() -> processService.prepareConfigurationUpdate(
                        key, request, currentProcessesByKey.get(key)), valuePath, type, key);
                } else if ("TRIGGER_RULE".equals(type) && operation == Operation.CREATE) {
                    requireFields(change.value(), RULE_CREATE_FIELDS, valuePath, type, key);
                    SkillTriggerRuleCreateRequest request = convert(change.value(), SkillTriggerRuleCreateRequest.class,
                        valuePath, type, key);
                    validateBean(request, valuePath, type, key);
                    if (!key.equals(request.ruleKey())) {
                        throw invalid(valuePath + "/ruleKey", "KEY_MISMATCH",
                            "规则标识必须与变更键一致", type, key);
                    }
                    rulePrepared = validateValue(() -> triggerRuleService.prepareConfigurationCreate(request),
                        valuePath, type, key);
                } else {
                    requireFields(change.value(), RULE_UPDATE_FIELDS, valuePath, type, key);
                    SkillTriggerRuleUpdateRequest request = convert(change.value(), SkillTriggerRuleUpdateRequest.class,
                        valuePath, type, key);
                    validateBean(request, valuePath, type, key);
                    rulePrepared = validateValue(() -> triggerRuleService.prepareConfigurationUpdate(
                        key, request, currentRulesByKey.get(key)), valuePath, type, key);
                }
            }
            prepared.add(new PreparedChange(type, operation, key, i,
                parameterCreate, parameterUpdate, formulaCreate, formulaUpdate,
                stateCreate, stateUpdate, effectCreate, effectUpdate,
                processPrepared, rulePrepared));
            if ("FORMULA".equals(type)) {
                switch (operation) {
                    case CREATE -> finalFormulas.put(key, formulaCreate.expression());
                    case UPDATE -> finalFormulas.put(key, formulaUpdate.expression());
                    case DELETE -> finalFormulas.remove(key);
                }
            }
            if ("INTERNAL_STATE".equals(type)) {
                if (operation == Operation.DELETE) finalStateKeys.remove(key);
                else finalStateKeys.add(key);
            }
            if ("EFFECT".equals(type)) {
                switch (operation) {
                    case CREATE -> finalEffects.put(key, effectCreate);
                    case UPDATE -> finalEffects.put(key, new SkillEffectCreateRequest(key,
                        effectUpdate.name(), effectUpdate.description(), effectUpdate.sortOrder(),
                        effectUpdate.lifecycle(), effectUpdate.results()));
                    case DELETE -> finalEffects.remove(key);
                }
            }
        }
        if (oldMaxLevel != null && oldMaxLevel != finalMaxLevel) {
            for (SkillParameterResponse parameter : currentParameters) {
                if (parameter.valueMode() == SkillParameterValueMode.SKILL_LEVEL
                    && !submittedParameters.contains(parameter.parameterKey())) {
                    throw invalid("changes", "SKILL_LEVEL_UPDATE_REQUIRED",
                        "修改最高等级时必须显式提交此等级参数", "PARAMETER", parameter.parameterKey());
                }
            }
        }
        Set<String> finalParameterKeys = new HashSet<>(currentParametersByKey.keySet());
        for (PreparedChange change : prepared) {
            if (!"PARAMETER".equals(change.type())) continue;
            if (change.operation() == Operation.CREATE) finalParameterKeys.add(change.key());
            if (change.operation() == Operation.DELETE) finalParameterKeys.remove(change.key());
        }
        for (PreparedChange change : prepared) {
            if (!"FORMULA".equals(change.type()) || change.operation() == Operation.DELETE) continue;
            String valuePath = "changes/" + change.index() + "/value";
            if (change.operation() == Operation.CREATE) {
                validateParameter(() -> formulaService.validateConfigurationCreate(gameId, skillKey,
                    change.formulaCreate(), finalParameterKeys), valuePath, "FORMULA", change.key());
            } else {
                validateParameter(() -> formulaService.validateConfigurationUpdate(gameId, skillKey,
                    change.key(), change.formulaUpdate(), finalParameterKeys), valuePath, "FORMULA", change.key());
            }
        }
        if (prepared.stream().anyMatch(change -> "PARAMETER".equals(change.type())
            && change.operation() == Operation.DELETE)) {
            formulaService.validateFinalParameterReferences(gameId, skillKey, finalFormulas, finalParameterKeys);
        }
        Set<String> finalFormulaKeys = Set.copyOf(finalFormulas.keySet());
        Set<String> runtimeParameters = new HashSet<>();
        Map<String, SkillParameterValueMode> finalModes = new HashMap<>();
        currentParameters.forEach(parameter -> finalModes.put(parameter.parameterKey(), parameter.valueMode()));
        for (PreparedChange change : prepared) {
            if (!"PARAMETER".equals(change.type())) continue;
            switch (change.operation()) {
                case CREATE -> finalModes.put(change.key(), change.parameterCreate().valueMode());
                case UPDATE -> finalModes.put(change.key(), change.parameterUpdate().valueMode());
                case DELETE -> finalModes.remove(change.key());
            }
        }
        finalModes.forEach((key, mode) -> {
            if (mode == SkillParameterValueMode.RUNTIME_INPUT) runtimeParameters.add(key);
        });
        Set<String> runtimeFormulas = new HashSet<>();
        finalFormulas.forEach((key, expression) -> {
            if (formulaService.referencesAnyParameter(expression, runtimeParameters)) runtimeFormulas.add(key);
        });
        Map<String, SkillEffectLifecycleRequest> finalLifecycles = new HashMap<>();
        finalEffects.forEach((key, effect) -> finalLifecycles.put(key, effect.lifecycle()));
        return new PreparedConfiguration(List.copyOf(prepared), Set.copyOf(finalParameterKeys), finalFormulaKeys,
            Set.copyOf(runtimeFormulas), Collections.unmodifiableMap(new HashMap<>(finalLifecycles)),
            Set.copyOf(finalStateKeys), deferRelatedReferences,
            Map.copyOf(finalEffects));
    }

    /** 正式保存的引用与目录锁；只读候选不调用任何带写锁的保存校验。 */
    private void validatePreparedReferences(String gameId, String skillKey, PreparedConfiguration candidate) {
        List<PreparedChange> prepared = candidate.changes();
        Set<String> finalFormulaKeys = candidate.formulaKeys();
        Set<String> runtimeFormulas = candidate.runtimeFormulaKeys();
        Map<String, SkillEffectCreateRequest> finalEffects = candidate.finalEffects();
        Map<String, SkillEffectLifecycleRequest> finalLifecycles = candidate.effectLifecycles();
        boolean deferRelatedReferences = candidate.deferRelatedReferences();
        for (String type : List.of("INTERNAL_STATE", "EFFECT")) {
            for (PreparedChange change : prepared) {
                if (change.operation() == Operation.DELETE || !type.equals(change.type())) continue;
                String valuePath = "changes/" + change.index() + "/value";
                if ("INTERNAL_STATE".equals(type)) {
                    if (change.operation() == Operation.CREATE) {
                        validateParameter(() -> internalStateService.validateConfigurationCreate(gameId, skillKey,
                            change.stateCreate(), finalFormulaKeys), valuePath, change.type(), change.key());
                    } else {
                        validateParameter(() -> internalStateService.validateConfigurationUpdate(gameId, skillKey,
                            change.key(), change.stateUpdate(), finalFormulaKeys, deferRelatedReferences),
                            valuePath, change.type(), change.key());
                    }
                } else {
                    if (change.operation() == Operation.CREATE) {
                        validateParameter(() -> effectService.validateConfigurationCreate(gameId, skillKey,
                            change.effectCreate(), finalFormulaKeys, runtimeFormulas, finalLifecycles),
                            valuePath, change.type(), change.key());
                    } else {
                        validateParameter(() -> effectService.validateConfigurationUpdate(gameId, skillKey,
                            change.key(), change.effectUpdate(), finalFormulaKeys, runtimeFormulas, finalLifecycles,
                            deferRelatedReferences),
                            valuePath, change.type(), change.key());
                    }
                }
            }
        }
        if (prepared.stream().anyMatch(change -> "EFFECT".equals(change.type()))) {
            effectService.validateConfigurationFinalTargets(skillKey, finalEffects, finalLifecycles);
        }
    }

    private void applyChanges(String gameId, String skillKey, int finalMaxLevel, PreparedConfiguration candidate) {
        List<PreparedChange> changes = candidate.changes();
        for (PreparedChange change : changes) {
            if (!"PARAMETER".equals(change.type()) || change.operation() != Operation.CREATE) continue;
            parameterService.createWithinConfiguration(gameId, skillKey, change.parameterCreate(), finalMaxLevel);
        }
        for (PreparedChange change : changes) {
            if (!"PARAMETER".equals(change.type()) || change.operation() != Operation.UPDATE) continue;
            parameterService.updateWithinConfiguration(gameId, skillKey, change.key(),
                change.parameterUpdate(), finalMaxLevel);
        }
        for (PreparedChange change : changes) {
            if (!"FORMULA".equals(change.type()) || change.operation() != Operation.CREATE) continue;
            formulaService.createWithinConfiguration(gameId, skillKey,
                change.formulaCreate(), candidate.parameterKeys());
        }
        for (PreparedChange change : changes) {
            if (!"FORMULA".equals(change.type()) || change.operation() != Operation.UPDATE) continue;
            formulaService.updateWithinConfiguration(gameId, skillKey, change.key(),
                change.formulaUpdate(), candidate.parameterKeys());
        }
        for (PreparedChange change : changes) {
            if (!"INTERNAL_STATE".equals(change.type()) || change.operation() != Operation.CREATE) continue;
            internalStateService.createWithinConfiguration(gameId, skillKey,
                change.stateCreate(), candidate.formulaKeys());
        }
        for (PreparedChange change : changes) {
            if (!"INTERNAL_STATE".equals(change.type()) || change.operation() != Operation.UPDATE) continue;
            internalStateService.updateWithinConfiguration(gameId, skillKey, change.key(),
                change.stateUpdate(), candidate.formulaKeys(), candidate.deferRelatedReferences());
        }
        for (PreparedChange change : changes) {
            if (!"EFFECT".equals(change.type()) || change.operation() != Operation.CREATE) continue;
            effectService.createWithinConfiguration(gameId, skillKey, change.effectCreate(),
                candidate.formulaKeys(), candidate.runtimeFormulaKeys(), candidate.effectLifecycles());
        }
        for (PreparedChange change : changes) {
            if (!"EFFECT".equals(change.type()) || change.operation() != Operation.UPDATE) continue;
            effectService.updateWithinConfiguration(gameId, skillKey, change.key(), change.effectUpdate(),
                candidate.formulaKeys(), candidate.runtimeFormulaKeys(), candidate.effectLifecycles(),
                candidate.deferRelatedReferences());
        }
        for (PreparedChange change : changes) {
            if (!"PROCESS".equals(change.type()) || change.operation() == Operation.DELETE) continue;
            processService.writePreparedWithinConfiguration(gameId, skillKey, change.processPrepared());
        }
        for (PreparedChange change : changes) {
            if (!"TRIGGER_RULE".equals(change.type()) || change.operation() == Operation.DELETE) continue;
            triggerRuleService.writePreparedWithinConfiguration(gameId, skillKey, change.rulePrepared());
        }
        for (PreparedChange change : changes) {
            if ("TRIGGER_RULE".equals(change.type()) && change.operation() == Operation.DELETE) {
                triggerRuleService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("PROCESS".equals(change.type()) && change.operation() == Operation.DELETE) {
                processService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("EFFECT".equals(change.type()) && change.operation() == Operation.DELETE) {
                effectService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("INTERNAL_STATE".equals(change.type()) && change.operation() == Operation.DELETE) {
                internalStateService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("FORMULA".equals(change.type()) && change.operation() == Operation.DELETE) {
                formulaService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("PARAMETER".equals(change.type()) && change.operation() == Operation.DELETE) {
                parameterService.deleteWithinConfiguration(gameId, skillKey, change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("PROCESS".equals(change.type()) && change.operation() != Operation.DELETE) {
                validateParameter(() -> processService.validatePreparedAgainstFinalDatabase(
                    gameId, skillKey, change.processPrepared()),
                    "changes/" + change.index() + "/value", change.type(), change.key());
            }
        }
        for (PreparedChange change : changes) {
            if ("TRIGGER_RULE".equals(change.type()) && change.operation() != Operation.DELETE) {
                validateParameter(() -> triggerRuleService.validatePreparedAgainstFinalDatabase(
                    gameId, skillKey, change.rulePrepared()),
                    "changes/" + change.index() + "/value", change.type(), change.key());
            }
        }
        Set<String> changedEffectKeys = new HashSet<>();
        Set<String> changedProcessKeys = new HashSet<>();
        Set<String> changedStateKeys = new HashSet<>();
        for (PreparedChange change : changes) {
            switch (change.type()) {
                case "EFFECT" -> changedEffectKeys.add(change.key());
                case "PROCESS" -> changedProcessKeys.add(change.key());
                case "INTERNAL_STATE" -> changedStateKeys.add(change.key());
                default -> { }
            }
        }
        if (candidate.deferRelatedReferences()
            && (!changedEffectKeys.isEmpty() || !changedProcessKeys.isEmpty() || !changedStateKeys.isEmpty())) {
            triggerRuleService.validateAffectedConfigurationFinal(gameId, skillKey,
                changedEffectKeys, changedProcessKeys, changedStateKeys);
        }
        if (changes.stream().anyMatch(change -> Set.of("EFFECT", "PROCESS", "TRIGGER_RULE")
            .contains(change.type()))) {
            effectService.validateConfigurationFinalCycle(gameId, skillKey);
        }
    }

    private void requireFields(JsonNode node, Set<String> allowed, String path, String type, String key) {
        if (!node.isObject()) {
            throw invalid(path, "OBJECT_REQUIRED", "必须提供完整对象", type, key);
        }
        var fields = node.fieldNames();
        while (fields.hasNext()) {
            String field = fields.next();
            if (!allowed.contains(field)) {
                throw invalid(path + "/" + field, "FORBIDDEN", "此字段不能写入", type, key);
            }
        }
        for (String field : allowed) {
            if (!node.has(field)) {
                throw invalid(path + "/" + field, "REQUIRED", "完整对象缺少此字段", type, key);
            }
        }
    }

    private <T> T convert(JsonNode node, Class<T> type, String path, String module, String key) {
        try {
            return objectMapper.treeToValue(node, type);
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            throw invalid(path, "FORMAT_INVALID", "对象字段格式不合法", module, key);
        }
    }

    private <T> void validateBean(T value, String path, String type, String key) {
        List<Map<String, String>> issues = new ArrayList<>();
        for (ConstraintViolation<T> violation : validator.validate(value)) {
            issues.add(issue(path + "/" + violation.getPropertyPath(), "VALIDATION_ERROR",
                violation.getMessage(), type, key));
        }
        if (!issues.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED",
                "技能配置不合法", Map.of("fieldIssues", issues));
        }
    }

    private void validateParameter(Runnable validation, String path, String type, String key) {
        validateValue(() -> {
            validation.run();
            return null;
        }, path, type, key);
    }

    private <T> T validateValue(Supplier<T> validation, String path, String type, String key) {
        try {
            return validation.get();
        } catch (ApiException ex) {
            Object raw = ex.getDetails().get("fieldIssues");
            if (!(raw instanceof List<?> items)) {
                throw ex;
            }
            List<Map<String, String>> issues = new ArrayList<>();
            for (Object item : items) {
                if (item instanceof Map<?, ?> original) {
                    issues.add(issue(path + "/" + original.get("field"),
                        Objects.toString(original.get("code"), "VALIDATION_ERROR"),
                        Objects.toString(original.get("message"), "对象不合法"), type, key));
                }
            }
            throw new ApiException(ex.getStatus(), ex.getCode(), ex.getMessage(),
                Map.of("fieldIssues", issues));
        }
    }

    private String digest(SkillConfigurationResponse configuration) {
        try {
            JsonNode normalized = canonicalize(objectMapper.valueToTree(configuration), "");
            byte[] bytes = objectMapper.writeValueAsBytes(normalized);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException | JsonProcessingException ex) {
            throw new IllegalStateException("无法计算技能配置摘要", ex);
        }
    }

    private JsonNode canonicalize(JsonNode node, String fieldName) {
        if (node.isObject()) {
            ObjectNode result = objectMapper.createObjectNode();
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            names.stream().sorted().filter(name -> !Set.of("createdAt", "updatedAt", "baseDigest").contains(name))
                .forEach(name -> result.set(name, canonicalize(node.get(name), name)));
            return result;
        }
        if (node.isArray()) {
            ArrayNode result = objectMapper.createArrayNode();
            List<JsonNode> values = new ArrayList<>();
            node.forEach(values::add);
            if ("skillCategoryKeys".equals(fieldName)) {
                values.sort(Comparator.comparing(JsonNode::asText));
            }
            values.forEach(value -> result.add(canonicalize(value, "")));
            return result;
        }
        return node;
    }

    private static void requireRequest(SkillConfigurationSaveRequest request) {
        if (request == null) {
            throw invalid("request", "REQUIRED", "请求内容不能为空", "", "");
        }
    }

    private static ApiException invalid(String field, String code, String message, String type, String key) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "技能配置不合法",
            Map.of("fieldIssues", List.of(issue(field, code, message, type, key))));
    }

    private static ApiException conflict(String code, String message, String type, String key) {
        return new ApiException(HttpStatus.CONFLICT, code, message,
            Map.of("fieldIssues", List.of(issue("skill", "CONFLICT", message, type, key))));
    }

    private static Map<String, String> issue(
        String field, String code, String message, String type, String key
    ) {
        return Map.of("field", field, "code", code, "message", message,
            "module", type == null ? "" : type, "objectKey", key == null ? "" : key);
    }

    private enum Operation { CREATE, UPDATE, DELETE }

    private record PreparedChange(
        String type, Operation operation, String key, int index,
        SkillParameterCreateRequest parameterCreate, SkillParameterUpdateRequest parameterUpdate,
        SkillFormulaCreateRequest formulaCreate, SkillFormulaUpdateRequest formulaUpdate,
        SkillInternalStateCreateRequest stateCreate, SkillInternalStateUpdateRequest stateUpdate,
        SkillEffectCreateRequest effectCreate, SkillEffectUpdateRequest effectUpdate,
        SkillProcessService.Prepared processPrepared, SkillTriggerRuleService.Prepared rulePrepared
    ) {}

    private record PreparedConfiguration(
        List<PreparedChange> changes, Set<String> parameterKeys, Set<String> formulaKeys,
        Set<String> runtimeFormulaKeys, Map<String, SkillEffectLifecycleRequest> effectLifecycles,
        Set<String> stateKeys, boolean deferRelatedReferences,
        Map<String, SkillEffectCreateRequest> finalEffects
    ) {}
}
