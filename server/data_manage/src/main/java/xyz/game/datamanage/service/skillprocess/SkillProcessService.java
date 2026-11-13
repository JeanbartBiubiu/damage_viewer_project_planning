package xyz.game.datamanage.service.skillprocess;

import xyz.game.datamanage.model.value.SkillNumericValue;
import xyz.game.datamanage.model.skillprocess.SkillProcessFirstExecution;

import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillprocess.SkillProcessActivationType;
import xyz.game.datamanage.model.skillprocess.SkillProcessChannelStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessChargeStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessCooldown;
import xyz.game.datamanage.model.skillprocess.SkillProcessCreateRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessDelayStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessEffectBindingRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessEffectBindingResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredAttackStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessImmediateStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessInternalStateLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessModeOptionLockRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessMoment;
import xyz.game.datamanage.model.skillprocess.SkillProcessMomentType;
import xyz.game.datamanage.model.skillprocess.SkillProcessMultiHitStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessPeriodicStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessRecastStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepDetail;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRequest;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepRow;
import xyz.game.datamanage.model.skillprocess.SkillProcessStepType;
import xyz.game.datamanage.model.skillprocess.SkillProcessSummaryResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessUpdateRequest;
import xyz.game.datamanage.service.skilltrigger.reference.SkillTriggerReferenceGuard;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerCycleValidator;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.authoring.AggregateJson;

@Service
@Validated
public class SkillProcessService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Logger log = LoggerFactory.getLogger(SkillProcessService.class);
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_processes";
    private static final Set<SkillProcessMomentType> PROCESS_MOMENTS = EnumSet.of(
        SkillProcessMomentType.PROCESS_START,
        SkillProcessMomentType.PROCESS_COMPLETE,
        SkillProcessMomentType.PROCESS_FAILURE
    );
    private static final Set<SkillProcessMomentType> STEP_MOMENTS = EnumSet.of(
        SkillProcessMomentType.STEP_START,
        SkillProcessMomentType.STEP_EXECUTION,
        SkillProcessMomentType.STEP_COMPLETE,
        SkillProcessMomentType.STEP_TIMEOUT
    );
    private static final Set<SkillProcessStepType> TIMEOUT_STEPS = EnumSet.of(
        SkillProcessStepType.CHARGE,
        SkillProcessStepType.RECAST,
        SkillProcessStepType.EMPOWERED_BASIC_ATTACK
    );
    private static final Set<SkillProcessStateOperationKind> VALUE_OPS = EnumSet.of(
        SkillProcessStateOperationKind.INCREASE,
        SkillProcessStateOperationKind.DECREASE,
        SkillProcessStateOperationKind.CONSUME,
        SkillProcessStateOperationKind.SET
    );
    private static final Set<SkillProcessStateOperationKind> FLAG_OPS = EnumSet.of(
        SkillProcessStateOperationKind.ENABLE,
        SkillProcessStateOperationKind.DISABLE,
        SkillProcessStateOperationKind.TOGGLE
    );
    private static final Set<SkillProcessStateOperationKind> COOLDOWN_OPS = EnumSet.of(
        SkillProcessStateOperationKind.START,
        SkillProcessStateOperationKind.RESET
    );

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillProcessMapper mapper;
    private final SkillTriggerReferenceGuard triggerReferences;
    private final SkillTriggerCycleValidator triggerCycles;

    public SkillProcessService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillProcessMapper mapper,
        SkillTriggerReferenceGuard triggerReferences,
        SkillTriggerCycleValidator triggerCycles,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.triggerReferences = java.util.Objects.requireNonNull(triggerReferences);
        this.triggerCycles = java.util.Objects.requireNonNull(triggerCycles);

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillProcessSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillProcessSummaryResponse> items = mapper.listSummaries(gameId, skillKey);
        return items == null ? List.of() : items;
    }

    @Transactional(readOnly = true)
    public SkillProcessDetailResponse get(String gameId, String skillKey, String processKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, processKey);
    }

    /** 统一配置先校验本对象形状，待全部根行写入后再核对最终引用。 */
    public Prepared prepareConfigurationCreate(SkillProcessCreateRequest request) {
        ValidatedProcess values = validateCreate(request);
        return new Prepared(values, collectAndValidateAggregate(values, Map.of(), Map.of(), true), true);
    }

    public Prepared prepareConfigurationUpdate(
        String processKey, SkillProcessUpdateRequest request, SkillProcessDetailResponse baselineDetail
    ) {
        ValidatedProcess values = validateUpdate(request, processKey);
        if (baselineDetail == null) throw processNotFound(processKey);
        List<Map<String, String>> issues = new ArrayList<>();
        Map<String, SkillProcessStepResponse> oldSteps = new LinkedHashMap<>();
        for (SkillProcessStepResponse step : baselineDetail.steps()) oldSteps.put(step.stepKey(), step);
        for (int i = 0; i < values.steps().size(); i++) {
            SkillProcessStepRequest step = values.steps().get(i);
            SkillProcessStepResponse old = oldSteps.get(step.stepKey());
            if (old != null && old.stepType() != step.stepType())
                issues.add(fieldIssue(stepPath(i, "stepType"), "IMMUTABLE", "步骤种类不能修改"));
        }
        Map<String, SkillProcessStateOperationResponse> oldOperations = new LinkedHashMap<>();
        for (SkillProcessStateOperationResponse operation : baselineDetail.stateOperations())
            oldOperations.put(operation.operationKey(), operation);
        for (int i = 0; i < values.stateOperations().size(); i++) {
            SkillProcessStateOperationRequest operation = values.stateOperations().get(i);
            SkillProcessStateOperationResponse old = oldOperations.get(operation.operationKey());
            if (old != null && old.operation() != operation.operation())
                issues.add(fieldIssue(operationPath(i, "operation"), "IMMUTABLE", "内部状态操作种类不能修改"));
        }
        throwIfInvalid(issues);
        return new Prepared(values, collectAndValidateAggregate(values, Map.of(), Map.of(), true), false);
    }

    /** 经相同存储顺序和读取装配投影，不调用持久化或目录加锁。 */
    public SkillProcessDetailResponse projectPrepared(String gameId, String skillKey, Prepared prepared,
        SkillProcessDetailResponse before) {
        ValidatedProcess values = prepared.values;
        return assembleDetail(new SkillProcessRow(gameId, skillKey, values.processKey(), values.name(),
            values.activationType(), values.description(), values.sortOrder(),
            before == null ? null : before.createdAt(), before == null ? null : before.updatedAt(),
            writeSteps(values.steps()), AggregateJson.write(values.cooldown()), writeBindings(values.effectBindings()),
            writeOperations(values.stateOperations())));
    }

    public void writePreparedWithinConfiguration(String gameId, String skillKey, Prepared prepared) {
        ValidatedProcess values = prepared.values;
        try {
            int written = prepared.creating
                ? mapper.insertProcess(gameId, skillKey, values.processKey(), values.name(), values.activationType(),
                    values.description(), values.sortOrder(), writeSteps(values.steps()), AggregateJson.write(values.cooldown()),
                    writeBindings(values.effectBindings()), writeOperations(values.stateOperations()))
                : mapper.updateProcess(gameId, skillKey, values.processKey(), values.name(), values.activationType(),
                    values.description(), values.sortOrder(), writeSteps(values.steps()), AggregateJson.write(values.cooldown()),
                    writeBindings(values.effectBindings()), writeOperations(values.stateOperations()));
            if (written == 0) throw processNotFound(values.processKey());
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    public void validatePreparedAgainstFinalDatabase(String gameId, String skillKey, Prepared prepared) {
        lockAndValidateCatalogs(gameId, skillKey, prepared.refs);
        triggerCycles.validateCurrentSkill(gameId, skillKey);
    }

    public void deleteWithinConfiguration(String gameId, String skillKey, String processKey) {
        if (mapper.deleteProcess(gameId, skillKey, processKey) == 0) throw processNotFound(processKey);
    }

    public static final class Prepared {
        private final ValidatedProcess values;
        private final CollectedRefs refs;
        private final boolean creating;

        private Prepared(ValidatedProcess values, CollectedRefs refs, boolean creating) {
            this.values = values;
            this.refs = refs;
            this.creating = creating;
        }
    }

    @Transactional
    public SkillProcessDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillProcessCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedProcess values = validateCreate(request);
        lockParentSkill(gameId, skillKey);
        if (mapper.countByKey(gameId, skillKey, values.processKey()) > 0) {
            throw keyExists();
        }
        CollectedRefs refs = collectAndValidateAggregate(values, Map.of(), Map.of(), true);
        lockAndValidateCatalogs(gameId, skillKey, refs);
        try {
            mapper.insertProcess(
                gameId,
                skillKey,
                values.processKey(),
                values.name(),
                values.activationType(),
                values.description(),
                values.sortOrder(),
                writeSteps(values.steps()),
                AggregateJson.write(values.cooldown()),
                writeBindings(values.effectBindings()),
                writeOperations(values.stateOperations())
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, values.processKey());
    }

    @Transactional
    public SkillProcessDetailResponse update(
        String gameId,
        String skillKey,
        String processKey,
        @Valid SkillProcessUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedProcess values = validateUpdate(request, processKey);
        lockParentSkill(gameId, skillKey);
        if (mapper.findProcessForUpdate(gameId, skillKey, processKey) == null) {
            throw processNotFound(processKey);
        }
        List<SkillProcessStepRow> existingSteps = nullToEmpty(mapper.listStepsForUpdate(gameId, skillKey, processKey));
        List<SkillProcessStateOperationRow> existingOps =
            nullToEmpty(mapper.listOperationsForUpdate(gameId, skillKey, processKey));
        Map<String, SkillProcessStepRow> existingStepByKey = indexSteps(existingSteps);
        Map<String, SkillProcessStateOperationRow> existingOpByKey = indexOperations(existingOps);
        List<Map<String, String>> issues = new ArrayList<>();
        for (int i = 0; i < values.steps().size(); i++) {
            SkillProcessStepRequest step = values.steps().get(i);
            SkillProcessStepRow existing = existingStepByKey.get(step.stepKey());
            if (existing != null && existing.stepType() != step.stepType()) {
                issues.add(fieldIssue(stepPath(i, "stepType"), "IMMUTABLE", "步骤种类不能修改"));
            }
        }
        for (int i = 0; i < values.stateOperations().size(); i++) {
            SkillProcessStateOperationRequest operation = values.stateOperations().get(i);
            SkillProcessStateOperationRow existing = existingOpByKey.get(operation.operationKey());
            if (existing != null && existing.operation() != operation.operation()) {
                issues.add(fieldIssue(operationPath(i, "operation"), "IMMUTABLE", "内部状态操作种类不能修改"));
            }
        }
        throwIfInvalid(issues);
        CollectedRefs refs = collectAndValidateAggregate(values, existingStepByKey, existingOpByKey, true);
        lockAndValidateCatalogs(gameId, skillKey, refs);
        Set<String> requestedSteps = new LinkedHashSet<>();
        for (SkillProcessStepRequest step : values.steps()) {
            requestedSteps.add(step.stepKey());
        }
        List<String> removedSteps = new ArrayList<>();
        for (SkillProcessStepRow existing : existingSteps) {
            if (!requestedSteps.contains(existing.stepKey())) {
                removedSteps.add(existing.stepKey());
            }
        }
        try {
            if (!removedSteps.isEmpty()) {
                triggerReferences.assertStepsNotReferenced(gameId, skillKey, processKey, removedSteps);
            }
            if (mapper.updateProcess(
                gameId,
                skillKey,
                processKey,
                values.name(),
                values.activationType(),
                values.description(),
                values.sortOrder(),
                writeSteps(values.steps()),
                AggregateJson.write(values.cooldown()),
                writeBindings(values.effectBindings()),
                writeOperations(values.stateOperations())
            ) == 0) {
                throw processNotFound(processKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        triggerCycles.validateCurrentSkill(gameId, skillKey);
        return requireDetail(gameId, skillKey, processKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String processKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockParentSkill(gameId, skillKey);
        if (mapper.findProcessForUpdate(gameId, skillKey, processKey) == null) {
            throw processNotFound(processKey);
        }
        triggerReferences.assertProcessDeletable(gameId, skillKey, processKey);
        try {
            if (mapper.deleteProcess(gameId, skillKey, processKey) == 0) {
                throw processNotFound(processKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    private SkillProcessDetailResponse requireDetail(String gameId, String skillKey, String processKey) {
        SkillProcessRow process = mapper.findProcess(gameId, skillKey, processKey);
        if (process == null) {
            throw processNotFound(processKey);
        }
        return assembleDetail(process);
    }

    private SkillProcessDetailResponse assembleDetail(SkillProcessRow process) {
        try {
            List<SkillProcessStepRequest> steps = AggregateJson.readList(process.stepsJson(), SkillProcessStepRequest.class);
            SkillProcessCooldown cooldown = AggregateJson.read(process.cooldownJson(), SkillProcessCooldown.class);
            List<SkillProcessEffectBindingRequest> bindings = AggregateJson.readList(
                process.effectBindingsJson(), SkillProcessEffectBindingRequest.class
            );
            List<SkillProcessStateOperationRequest> operations = AggregateJson.readList(
                process.stateOperationsJson(), SkillProcessStateOperationRequest.class
            );
            ValidatedProcess values = validateCommon(process.processKey(), process.name(), process.activationType(),
                process.description(), process.sortOrder(), cooldown, steps, bindings, operations, false);
            CollectedRefs refs = collectAndValidateAggregate(values, Map.of(), Map.of(), false);
            throwIfInvalidReference(refs.referenceIssues);
            return new SkillProcessDetailResponse(
                process.gameId(), process.skillKey(), process.processKey(), process.name(), process.activationType(),
                process.description(), process.sortOrder(), cooldown,
                steps.stream().map(step -> new SkillProcessStepResponse(
                    step.stepKey(), step.name(), step.stepType(), step.description(), step.sortOrder(),
                    step.occupiesAction(), step.detail()
                )).toList(),
                bindings.stream().map(binding -> new SkillProcessEffectBindingResponse(
                    binding.bindingKey(), binding.effectKey(), binding.moment(), binding.sortOrder()
                )).toList(),
                operations.stream().map(operation -> new SkillProcessStateOperationResponse(
                    operation.operationKey(), operation.name(), operation.stateSkillKey(), operation.stateKey(), operation.operation(),
                    operation.value(), operation.optionKey(), operation.moment(), operation.sortOrder()
                )).toList(),
                process.createdAt(), process.updatedAt()
            );
        } catch (RuntimeException ex) {
            throw corrupt(process.gameId(), process.skillKey(), process.processKey(), null, "过程聚合内容损坏");
        }
    }

    private String writeSteps(List<SkillProcessStepRequest> steps) {
        return AggregateJson.write(steps.stream().sorted(Comparator.comparing(SkillProcessStepRequest::sortOrder)
            .thenComparing(SkillProcessStepRequest::stepKey)).toList());
    }

    private String writeBindings(List<SkillProcessEffectBindingRequest> bindings) {
        return AggregateJson.write(bindings.stream().sorted(Comparator.comparing(SkillProcessEffectBindingRequest::sortOrder)
            .thenComparing(SkillProcessEffectBindingRequest::bindingKey)).toList());
    }

    private String writeOperations(List<SkillProcessStateOperationRequest> operations) {
        return AggregateJson.write(operations.stream().sorted(Comparator.comparing(SkillProcessStateOperationRequest::sortOrder)
            .thenComparing(SkillProcessStateOperationRequest::operationKey)).toList());
    }

    private ValidatedProcess validateCreate(SkillProcessCreateRequest request) {
        if (request == null) {
            throwIfInvalid(List.of(fieldIssue("request", "REQUIRED", "技能过程不能为空")));
            return null;
        }
        return validateCommon(
            request.processKey(),
            request.name(),
            request.activationType(),
            request.description(),
            request.sortOrder(),
            request.cooldown(),
            request.steps(),
            request.effectBindings(),
            request.stateOperations(),
            true
        );
    }

    private ValidatedProcess validateUpdate(SkillProcessUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能过程不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.processKey() != null) {
            issues.add(fieldIssue("processKey", "IMMUTABLE", "过程标识不能修改"));
            throwIfInvalid(issues);
        }
        return validateCommon(
            pathKey,
            request.name(),
            request.activationType(),
            request.description(),
            request.sortOrder(),
            request.cooldown(),
            request.steps(),
            request.effectBindings(),
            request.stateOperations(),
            false
        );
    }

    private ValidatedProcess validateCommon(
        String processKey,
        String name,
        SkillProcessActivationType activationType,
        String description,
        Integer sortOrder,
        SkillProcessCooldown cooldown,
        List<SkillProcessStepRequest> steps,
        List<SkillProcessEffectBindingRequest> effectBindings,
        List<SkillProcessStateOperationRequest> stateOperations,
        boolean creating
    ) {
        List<SkillProcessEffectBindingRequest> bindings =
            effectBindings == null ? List.of() : List.copyOf(effectBindings);
        List<SkillProcessStateOperationRequest> operations =
            stateOperations == null ? List.of() : List.copyOf(stateOperations);
        // 被动过程的时点规则在完整最终图检查；局部形状不能提前否定同批新增尾行为。
        if (cooldown == null && bindings.isEmpty() && operations.isEmpty()
            && activationType != SkillProcessActivationType.PASSIVE) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能过程不合法",
                Map.of("fieldIssues", List.of(
                    fieldIssue("effectBindings", "PROCESS_BEHAVIOR_REQUIRED", "过程至少需要普通冷却、效果挂接或内部状态操作之一"),
                    fieldIssue("stateOperations", "PROCESS_BEHAVIOR_REQUIRED", "过程至少需要普通冷却、效果挂接或内部状态操作之一")
                ))
            );
        }
        return new ValidatedProcess(
            processKey,
            name,
            activationType,
            description,
            sortOrder,
            cooldown,
            steps == null ? List.of() : List.copyOf(steps),
            bindings,
            operations
        );
    }

    private CollectedRefs collectAndValidateAggregate(
        ValidatedProcess values,
        Map<String, SkillProcessStepRow> existingSteps,
        Map<String, SkillProcessStateOperationRow> existingOps,
        boolean requireStateSkillKey
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> bodyIssues = new ArrayList<>();
        List<Map<String, String>> referenceIssues = new ArrayList<>();
        CollectedRefs refs = new CollectedRefs();
        Map<String, SkillProcessStepType> finalSteps = new LinkedHashMap<>();
        Set<String> seenSteps = new HashSet<>();
        if (values.steps().isEmpty()) {
            issues.add(fieldIssue("steps", "REQUIRED", "过程至少包含一个步骤"));
        }
        for (int i = 0; i < values.steps().size(); i++) {
            SkillProcessStepRequest step = values.steps().get(i);
            if (step == null) {
                issues.add(fieldIssue(stepPath(i, null), "REQUIRED", "步骤不能为空"));
                continue;
            }
            if (step.stepKey() != null && !seenSteps.add(step.stepKey())) {
                issues.add(fieldIssue(stepPath(i, "stepKey"), "DUPLICATE", "同一过程内步骤标识不能重复"));
            }
            if (step.stepType() != null && step.stepKey() != null) {
                finalSteps.put(step.stepKey(), step.stepType());
            }
            validateStepDetail(step, i, refs, issues, bodyIssues);
        }
        Set<String> seenBindings = new HashSet<>();
        for (int i = 0; i < values.effectBindings().size(); i++) {
            validateBinding(values.effectBindings().get(i), i, seenBindings, finalSteps, refs, issues, referenceIssues);
        }
        Set<String> seenOps = new HashSet<>();
        for (int i = 0; i < values.stateOperations().size(); i++) {
            validateOperation(
                values.stateOperations().get(i), i, seenOps, finalSteps, refs, issues, referenceIssues,
                requireStateSkillKey
            );
        }
        if (values.cooldown() != null) {
            addFormula(refs, issues, "cooldown.durationValue", values.cooldown().durationValue());
            validateMoment(
                values.cooldown().startMoment(),
                "cooldown.startMoment",
                finalSteps,
                issues,
                referenceIssues
            );
        }
        throwIfInvalidBody(bodyIssues);
        throwIfInvalid(issues);
        refs.referenceIssues.addAll(referenceIssues);
        return refs;
    }

    private void validateStepDetail(
        SkillProcessStepRequest step,
        int index,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> bodyIssues
    ) {
        if (step.detail() == null) {
            issues.add(fieldIssue(stepPath(index, "detail"), "REQUIRED", "步骤明细不能为空"));
            return;
        }
        collectMutexFields(step.detail(), index, bodyIssues);
        if (step.stepType() == null) {
            return;
        }
        switch (step.stepType()) {
            case IMMEDIATE -> {
                if (!(step.detail() instanceof SkillProcessImmediateStepDetail)) {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "立即步骤明细形状不合法"));
                }
            }
            case DELAY -> {
                if (step.detail() instanceof SkillProcessDelayStepDetail delay) {
                    addFormula(refs, issues, stepPath(index, "detail.delayValue"), delay.delayValue());
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "延迟步骤明细形状不合法"));
                }
            }
            case MULTI_HIT -> {
                if (step.detail() instanceof SkillProcessMultiHitStepDetail multi) {
                    addFormula(refs, issues, stepPath(index, "detail.repeatCountValue"), multi.repeatCountValue());
                    if (multi.intervalValue() != null) {
                        addFormula(refs, issues, stepPath(index, "detail.intervalValue"), multi.intervalValue());
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "多段步骤明细形状不合法"));
                }
            }
            case PERIODIC -> {
                if (step.detail() instanceof SkillProcessPeriodicStepDetail periodic) {
                    addFormula(refs, issues, stepPath(index, "detail.repeatCountValue"), periodic.repeatCountValue());
                    addFormula(refs, issues, stepPath(index, "detail.intervalValue"), periodic.intervalValue());
                    if (periodic.firstExecution() == null) {
                        issues.add(fieldIssue(stepPath(index, "detail.firstExecution"), "REQUIRED", "首次执行方式不能为空"));
                    } else if (periodic.firstExecution() == SkillProcessFirstExecution.CUSTOM_WINDOW) {
                        issues.add(fieldIssue(stepPath(index, "detail.firstExecution"), "TYPE_MISMATCH", "周期步骤不支持指定首末执行窗口"));
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "周期步骤明细形状不合法"));
                }
            }
            case CHANNEL -> {
                if (step.detail() instanceof SkillProcessChannelStepDetail channel) {
                    addFormula(refs, issues, stepPath(index, "detail.durationValue"), channel.durationValue());
                    addFormula(refs, issues, stepPath(index, "detail.executionCountValue"), channel.executionCountValue());
                    if (channel.firstExecution() == null) {
                        issues.add(fieldIssue(stepPath(index, "detail.firstExecution"), "REQUIRED", "首次执行方式不能为空"));
                    }
                    if (channel.firstExecution() == SkillProcessFirstExecution.CUSTOM_WINDOW) {
                        addFormula(refs, issues, stepPath(index, "detail.firstExecutionOffsetValue"), channel.firstExecutionOffsetValue());
                        addFormula(refs, issues, stepPath(index, "detail.lastExecutionOffsetValue"), channel.lastExecutionOffsetValue());
                    } else {
                        if (channel.firstExecutionOffsetValue() != null) {
                            bodyIssues.add(fieldIssue(stepPath(index, "detail.firstExecutionOffsetValue"), "FIELD_NOT_ALLOWED", "只有指定窗口引导允许首段偏移"));
                        }
                        if (channel.lastExecutionOffsetValue() != null) {
                            bodyIssues.add(fieldIssue(stepPath(index, "detail.lastExecutionOffsetValue"), "FIELD_NOT_ALLOWED", "只有指定窗口引导允许末段偏移"));
                        }
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "引导步骤明细形状不合法"));
                }
            }
            case CHARGE -> {
                if (step.detail() instanceof SkillProcessChargeStepDetail charge) {
                    addFormula(refs, issues, stepPath(index, "detail.minimumChargeValue"), charge.minimumChargeValue());
                    addFormula(refs, issues, stepPath(index, "detail.maximumChargeValue"), charge.maximumChargeValue());
                    if (charge.releaseAtMaximum() == null) {
                        issues.add(fieldIssue(stepPath(index, "detail.releaseAtMaximum"), "REQUIRED", "达到最大蓄力是否释放不能为空"));
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "蓄力步骤明细形状不合法"));
                }
            }
            case RECAST -> {
                if (step.detail() instanceof SkillProcessRecastStepDetail recast) {
                    addFormula(refs, issues, stepPath(index, "detail.windowValue"), recast.windowValue());
                    addFormula(refs, issues, stepPath(index, "detail.maximumRecastCountValue"), recast.maximumRecastCountValue());
                    if (recast.intervalValue() != null) {
                        addFormula(refs, issues, stepPath(index, "detail.intervalValue"), recast.intervalValue());
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "重施步骤明细形状不合法"));
                }
            }
            case EMPOWERED_BASIC_ATTACK -> {
                if (step.detail() instanceof SkillProcessEmpoweredAttackStepDetail empowered) {
                    addFormula(refs, issues, stepPath(index, "detail.windowValue"), empowered.windowValue());
                    if (empowered.maximumAttackCountValue() != null) {
                        addFormula(refs, issues, stepPath(index, "detail.maximumAttackCountValue"), empowered.maximumAttackCountValue());
                        if (empowered.consumeMoment() != xyz.game.datamanage.model.skillprocess.SkillProcessEmpoweredConsumeMoment.ATTACK_START) {
                            issues.add(fieldIssue(stepPath(index, "detail.consumeMoment"), "COMBINATION_INVALID", "多次强化必须在真实普攻发动时消费"));
                        }
                    }
                    if (empowered.consumeMoment() == null) {
                        issues.add(fieldIssue(stepPath(index, "detail.consumeMoment"), "REQUIRED", "消耗时点不能为空"));
                    }
                } else {
                    issues.add(fieldIssue(stepPath(index, "detail"), "TYPE_MISMATCH", "强化普攻步骤明细形状不合法"));
                }
            }
        }
    }

    private void validateBinding(
        SkillProcessEffectBindingRequest binding,
        int index,
        Set<String> seen,
        Map<String, SkillProcessStepType> finalSteps,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        if (binding == null) {
            issues.add(fieldIssue(bindingPath(index, null), "REQUIRED", "效果挂接不能为空"));
            return;
        }
        if (binding.bindingKey() != null && !seen.add(binding.bindingKey())) {
            issues.add(fieldIssue(bindingPath(index, "bindingKey"), "DUPLICATE", "同一过程内挂接标识不能重复"));
        }
        if (binding.effectKey() == null || binding.effectKey().isBlank()) {
            issues.add(fieldIssue(bindingPath(index, "effectKey"), "REQUIRED", "效果标识不能为空"));
        } else {
            refs.effects.add(new CatalogRef(bindingPath(index, "effectKey"), binding.effectKey()));
            refs.effectKeys.add(binding.effectKey());
        }
        validateMoment(binding.moment(), bindingPath(index, "moment"), finalSteps, issues, referenceIssues);
    }

    private void validateOperation(
        SkillProcessStateOperationRequest operation,
        int index,
        Set<String> seen,
        Map<String, SkillProcessStepType> finalSteps,
        CollectedRefs refs,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues,
        boolean requireStateSkillKey
    ) {
        if (operation == null) {
            issues.add(fieldIssue(operationPath(index, null), "REQUIRED", "内部状态操作不能为空"));
            return;
        }
        if (operation.operationKey() != null && !seen.add(operation.operationKey())) {
            issues.add(fieldIssue(operationPath(index, "operationKey"), "DUPLICATE", "同一过程内操作标识不能重复"));
        }
        if (requireStateSkillKey && (operation.stateSkillKey() == null || operation.stateSkillKey().isBlank())) {
            issues.add(fieldIssue(operationPath(index, "stateSkillKey"), "REQUIRED", "内部状态所属技能不能为空"));
        }
        if (operation.stateKey() == null || operation.stateKey().isBlank()) {
            issues.add(fieldIssue(operationPath(index, "stateKey"), "REQUIRED", "内部状态标识不能为空"));
        } else if (operation.stateSkillKey() != null) {
            refs.states.add(new StateRef(operationPath(index, "stateKey"), operation.stateSkillKey(), operation.stateKey()));
        }
        if (operation.operation() == null) {
            issues.add(fieldIssue(operationPath(index, "operation"), "REQUIRED", "内部状态操作种类不能为空"));
        }
        if (operation.value() != null) {
            addFormula(refs, issues, operationPath(index, "value"), operation.value());
        }
        if (operation.optionKey() != null && operation.stateKey() != null) {
            refs.options.add(new OptionRef(
                operationPath(index, "optionKey"),
                operation.stateSkillKey(),
                operation.stateKey(),
                operation.optionKey()
            ));
        }
        refs.operationShapes.add(new OperationShape(
            index,
            operation.stateSkillKey(),
            operation.stateKey(),
            operation.operation(),
            operation.value(),
            operation.optionKey()
        ));
        validateMoment(operation.moment(), operationPath(index, "moment"), finalSteps, issues, referenceIssues);
    }

    private void validateMoment(
        SkillProcessMoment moment,
        String prefix,
        Map<String, SkillProcessStepType> finalSteps,
        List<Map<String, String>> issues,
        List<Map<String, String>> referenceIssues
    ) {
        if (moment == null || moment.momentType() == null) {
            issues.add(fieldIssue(prefix + ".momentType", "REQUIRED", "过程时点种类不能为空"));
            return;
        }
        SkillProcessMomentType type = moment.momentType();
        if (!moment.unknownFields().isEmpty()) {
            for (String field : moment.unknownFields()) {
                issues.add(fieldIssue(prefix + "." + field, "UNKNOWN_FIELD", "过程时点包含未知字段"));
            }
        }
        if (moment.failureReason() != null && type != SkillProcessMomentType.PROCESS_FAILURE) {
            issues.add(fieldIssue(prefix + ".failureReason", "FORBIDDEN", "失败原因筛选只能用于过程失败时点"));
        }
        if (PROCESS_MOMENTS.contains(type)) {
            if (moment.stepKey() != null) {
                issues.add(fieldIssue(prefix + ".stepKey", "STEP_FORBIDDEN", "该过程时点不能指定步骤"));
            }
            return;
        }
        if (STEP_MOMENTS.contains(type)) {
            if (moment.stepKey() == null) {
                issues.add(fieldIssue(prefix + ".stepKey", "REQUIRED", "该过程时点必须指定步骤"));
                return;
            }
            SkillProcessStepType stepType = finalSteps.get(moment.stepKey());
            if (stepType == null) {
                referenceIssues.add(fieldIssue(prefix + ".stepKey", "UNKNOWN_STEP", "步骤不存在或不属于当前过程"));
                return;
            }
            if (type == SkillProcessMomentType.STEP_TIMEOUT && !TIMEOUT_STEPS.contains(stepType)) {
                issues.add(fieldIssue(prefix + ".stepKey", "TIMEOUT_STEP_INVALID", "超时时点只能引用蓄力、重施或强化普攻步骤"));
            }
        }
    }

    private void lockAndValidateCatalogs(String gameId, String skillKey, CollectedRefs refs) {
        Set<String> formulas = lockSorted(refs.formulaKeys, keys -> mapper.lockFormulas(gameId, skillKey, keys));
        Set<String> effects = lockSorted(refs.effectKeys, keys -> mapper.lockEffects(gameId, skillKey, keys));
        Map<String, SkillInternalStateType> states = new LinkedHashMap<>();
        List<StateRef> sortedStates = refs.states.stream()
            .distinct()
            .sorted(Comparator.comparing(StateRef::stateSkillKey).thenComparing(StateRef::stateKey))
            .toList();
        for (StateRef ref : sortedStates) {
            for (SkillProcessInternalStateLockRow row : nullToEmpty(
                mapper.lockInternalStates(gameId, ref.stateSkillKey(), List.of(ref.stateKey()))
            )) {
                states.put(ref.stateSkillKey() + "\0" + row.stateKey(), row.stateType());
            }
        }
        Set<String> optionIds = new HashSet<>();
        List<OptionRef> sortedOptions = refs.options.stream()
            .filter(ref -> ref.stateSkillKey() != null)
            .distinct()
            .sorted(Comparator.comparing(OptionRef::stateSkillKey)
                .thenComparing(OptionRef::stateKey).thenComparing(OptionRef::optionKey))
            .toList();
        for (OptionRef ref : sortedOptions) {
            for (SkillProcessModeOptionLockRow row : nullToEmpty(mapper.lockModeOptions(
                gameId, ref.stateSkillKey(), List.of(new SkillProcessModeOptionLockRow(ref.stateKey(), ref.optionKey()))
            ))) {
                optionIds.add(ref.stateSkillKey() + "\0" + row.stateKey() + "\0" + row.optionKey());
            }
        }
        List<Map<String, String>> unknown = new ArrayList<>();
        for (CatalogRef ref : refs.formulas) {
            if (!formulas.contains(ref.key())) {
                unknown.add(fieldIssue(ref.field(), "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能"));
            }
        }
        for (CatalogRef ref : refs.effects) {
            if (!effects.contains(ref.key())) {
                unknown.add(fieldIssue(ref.field(), "UNKNOWN_EFFECT", "技能效果不存在或不属于当前技能"));
            }
        }
        for (StateRef ref : refs.states) {
            if (!states.containsKey(ref.stateSkillKey() + "\0" + ref.stateKey())) {
                unknown.add(fieldIssue(ref.field(), "UNKNOWN_INTERNAL_STATE", "内部状态不存在或不属于指定技能"));
            }
        }
        for (OptionRef ref : refs.options) {
            if (!optionIds.contains(ref.stateSkillKey() + "\0" + ref.stateKey() + "\0" + ref.optionKey())) {
                unknown.add(fieldIssue(ref.field(), "UNKNOWN_MODE_OPTION", "模式选项不存在或不属于当前内部状态"));
            }
        }
        unknown.addAll(refs.referenceIssues);
        if (!unknown.isEmpty()) {
            unknown.sort(Comparator.comparing(issue -> issue.get("field")));
            throwIfInvalidReference(unknown);
        }
        List<Map<String, String>> shapeIssues = new ArrayList<>();
        for (OperationShape shape : refs.operationShapes) {
            if (shape.stateKey() == null || shape.operation() == null) {
                continue;
            }
            SkillInternalStateType stateType = states.get(shape.stateSkillKey() + "\0" + shape.stateKey());
            if (stateType == null) {
                continue;
            }
            validateOperationShape(shape, stateType, shapeIssues);
        }
        throwIfInvalid(shapeIssues);
    }

    private void validateOperationShape(
        OperationShape shape,
        SkillInternalStateType stateType,
        List<Map<String, String>> issues
    ) {
        int index = shape.index();
        boolean hasValue = shape.value() != null;
        boolean hasOption = shape.optionKey() != null;
        if (stateType == SkillInternalStateType.COUNTER || stateType == SkillInternalStateType.AMMO) {
            if (VALUE_OPS.contains(shape.operation())) {
                if (!hasValue) {
                    issues.add(fieldIssue(operationPath(index, "value"), "REQUIRED", "该操作必须提供数值公式"));
                }
                if (hasOption) {
                    issues.add(fieldIssue(operationPath(index, "optionKey"), "FORBIDDEN", "该操作不能指定模式选项"));
                }
                return;
            }
            if (shape.operation() == SkillProcessStateOperationKind.RESET) {
                if (hasValue) {
                    issues.add(fieldIssue(operationPath(index, "value"), "FORBIDDEN", "重置操作不能提供数值公式"));
                }
                if (hasOption) {
                    issues.add(fieldIssue(operationPath(index, "optionKey"), "FORBIDDEN", "该操作不能指定模式选项"));
                }
                return;
            }
            issues.add(fieldIssue(operationPath(index, "operation"), "OPERATION_MISMATCH", "操作与内部状态种类不匹配"));
            return;
        }
        if (stateType == SkillInternalStateType.MODE) {
            if (shape.operation() != SkillProcessStateOperationKind.SELECT) {
                issues.add(fieldIssue(operationPath(index, "operation"), "OPERATION_MISMATCH", "操作与内部状态种类不匹配"));
                return;
            }
            if (hasValue) {
                issues.add(fieldIssue(operationPath(index, "value"), "FORBIDDEN", "模式选择不能提供数值公式"));
            }
            if (!hasOption) {
                issues.add(fieldIssue(operationPath(index, "optionKey"), "REQUIRED", "模式选择必须指定选项"));
            }
            return;
        }
        if (stateType == SkillInternalStateType.FLAG) {
            if (!FLAG_OPS.contains(shape.operation())) {
                issues.add(fieldIssue(operationPath(index, "operation"), "OPERATION_MISMATCH", "操作与内部状态种类不匹配"));
                return;
            }
            if (hasValue) {
                issues.add(fieldIssue(operationPath(index, "value"), "FORBIDDEN", "该操作不能提供数值公式"));
            }
            if (hasOption) {
                issues.add(fieldIssue(operationPath(index, "optionKey"), "FORBIDDEN", "该操作不能指定模式选项"));
            }
            return;
        }
        if (stateType == SkillInternalStateType.INTERNAL_COOLDOWN) {
            if (!COOLDOWN_OPS.contains(shape.operation())) {
                issues.add(fieldIssue(operationPath(index, "operation"), "OPERATION_MISMATCH", "操作与内部状态种类不匹配"));
                return;
            }
            if (hasValue) {
                issues.add(fieldIssue(operationPath(index, "value"), "FORBIDDEN", "该操作不能提供数值公式"));
            }
            if (hasOption) {
                issues.add(fieldIssue(operationPath(index, "optionKey"), "FORBIDDEN", "该操作不能指定模式选项"));
            }
        }
    }

    private void collectMutexFields(
        SkillProcessStepDetail detail,
        int index,
        List<Map<String, String>> bodyIssues
    ) {
        for (String field : nullToEmptySet(detail.foreignFields())) {
            bodyIssues.add(fieldIssue(stepPath(index, "detail." + field), "FIELD_MUTEX", "步骤明细字段互斥"));
        }
        for (String field : nullToEmptySet(detail.unknownFields())) {
            bodyIssues.add(fieldIssue(stepPath(index, "detail." + field), "UNKNOWN_FIELD", "步骤明细包含未知字段"));
        }
    }

    private static void addFormula(
        CollectedRefs refs,
        List<Map<String, String>> issues,
        String field,
        SkillNumericValue value
    ) {
        if (value == null) {
            issues.add(fieldIssue(field, "REQUIRED", "公式不能为空"));
            return;
        }
        if (value.formulaKey() != null) {
            refs.formulas.add(new CatalogRef(field, value.formulaKey()));
            refs.formulaKeys.add(value.formulaKey());
        }
    }

    private Set<String> lockSorted(Set<String> keys, java.util.function.Function<List<String>, List<String>> locker) {
        if (keys.isEmpty()) {
            return Set.of();
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        return new HashSet<>(nullToEmpty(locker.apply(lockKeys)));
    }

    private void lockParentSkill(String gameId, String skillKey) {
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireSkillExists(String gameId, String skillKey) {
        if (skillMapper.findById(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private static Map<String, SkillProcessStepRow> indexSteps(List<SkillProcessStepRow> rows) {
        Map<String, SkillProcessStepRow> indexed = new LinkedHashMap<>();
        for (SkillProcessStepRow row : rows) {
            indexed.put(row.stepKey(), row);
        }
        return indexed;
    }

    private static Map<String, SkillProcessStateOperationRow> indexOperations(List<SkillProcessStateOperationRow> rows) {
        Map<String, SkillProcessStateOperationRow> indexed = new LinkedHashMap<>();
        for (SkillProcessStateOperationRow row : rows) {
            indexed.put(row.operationKey(), row);
        }
        return indexed;
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能过程不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfInvalidBody(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_BODY",
                "技能过程步骤明细不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfInvalidReference(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_PROCESS_REFERENCE",
                "技能过程引用不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
        );
    }

    private static ApiException skillNotFound(String skillKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND, "404.SKILL_NOT_FOUND", "技能不存在",
            Map.of("skillKey", skillKey == null ? "" : skillKey)
        );
    }

    private static ApiException processNotFound(String processKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND, "404.SKILL_PROCESS_NOT_FOUND", "技能过程不存在",
            Map.of("processKey", processKey == null ? "" : processKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_PROCESS_KEY_EXISTS", "技能过程标识已存在", "processKey");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private ApiException corrupt(String gameId, String skillKey, String processKey, String stepKey, String reason) {
        log.error(
            "Skill process data corruption detected. gameId={}, skillKey={}, processKey={}, stepKey={}, reason={}",
            gameId, skillKey, processKey, stepKey, reason
        );
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("gameId", gameId);
        details.put("skillKey", skillKey);
        details.put("processKey", processKey);
        if (stepKey != null) {
            details.put("stepKey", stepKey);
        }
        details.put("reason", reason);
        return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "500.INTERNAL_ERROR", "技能过程数据损坏", details);
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
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

    private static String stepPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty() ? "steps[" + index + "]" : "steps[" + index + "]." + suffix;
    }

    private static String bindingPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty()
            ? "effectBindings[" + index + "]"
            : "effectBindings[" + index + "]." + suffix;
    }

    private static String operationPath(int index, String suffix) {
        return suffix == null || suffix.isEmpty()
            ? "stateOperations[" + index + "]"
            : "stateOperations[" + index + "]." + suffix;
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    private record ValidatedProcess(
        String processKey,
        String name,
        SkillProcessActivationType activationType,
        String description,
        Integer sortOrder,
        SkillProcessCooldown cooldown,
        List<SkillProcessStepRequest> steps,
        List<SkillProcessEffectBindingRequest> effectBindings,
        List<SkillProcessStateOperationRequest> stateOperations
    ) {
    }

    private static final class CollectedRefs {
        private final List<CatalogRef> formulas = new ArrayList<>();
        private final List<CatalogRef> effects = new ArrayList<>();
        private final List<StateRef> states = new ArrayList<>();
        private final List<OptionRef> options = new ArrayList<>();
        private final Set<String> formulaKeys = new LinkedHashSet<>();
        private final Set<String> effectKeys = new LinkedHashSet<>();
        private final List<OperationShape> operationShapes = new ArrayList<>();
        private final List<Map<String, String>> referenceIssues = new ArrayList<>();
    }

    private record CatalogRef(String field, String key) {
    }

    private record StateRef(String field, String stateSkillKey, String stateKey) {
    }

    private record OptionRef(String field, String stateSkillKey, String stateKey, String optionKey) {
    }

    private record OperationShape(
        int index,
        String stateSkillKey,
        String stateKey,
        SkillProcessStateOperationKind operation,
        SkillNumericValue value,
        String optionKey
    ) {
    }
}
