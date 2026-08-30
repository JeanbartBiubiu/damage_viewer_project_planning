package xyz.game.datamanage.service.skillinternalstate;

import jakarta.validation.Valid;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateAmmoDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCooldownDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCounterDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateCreateRequest;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateFlagDetailRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeDetail;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOption;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateModeOptionRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateRow;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateScope;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateSummaryResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateUpdateRequest;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillInternalStateService {

    private static final Logger log = LoggerFactory.getLogger(SkillInternalStateService.class);
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_internal_states";
    private static final String STATE_IN_USE_CONSTRAINT = "fk_skill_process_state_operations_state";
    private static final String OPTION_IN_USE_CONSTRAINT = "fk_skill_process_state_operations_option";
    private static final Set<String> TRIGGER_STATE_IN_USE_CONSTRAINTS = Set.of(
        "fk_skill_trigger_istate_events_state",
        "fk_skill_trigger_istate_cond_state",
        "fk_skill_trigger_istate_bind_state"
    );
    private static final Set<String> TRIGGER_OPTION_IN_USE_CONSTRAINTS = Set.of(
        "fk_skill_trigger_istate_cond_option",
        "fk_skill_trigger_istate_bind_option"
    );

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillInternalStateMapper mapper;
    private final SkillTriggerRuleService triggerRuleService;

    public SkillInternalStateService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillInternalStateMapper mapper
    ) {
        this(gamesMapper, skillMapper, mapper, null);
    }

    @Autowired
    public SkillInternalStateService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillInternalStateMapper mapper,
        SkillTriggerRuleService triggerRuleService
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;
        this.triggerRuleService = triggerRuleService;
    }

    @Transactional(readOnly = true)
    public List<SkillInternalStateSummaryResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillInternalStateSummaryResponse> items = mapper.listSummaries(gameId, skillKey);
        return items == null ? List.of() : items;
    }

    @Transactional(readOnly = true)
    public SkillInternalStateDetailResponse get(String gameId, String skillKey, String stateKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        return requireDetail(gameId, skillKey, stateKey);
    }

    @Transactional
    public SkillInternalStateDetailResponse create(
        String gameId,
        String skillKey,
        @Valid SkillInternalStateCreateRequest request
    ) {
        requireGame(gameId);
        ValidatedState values = validateCreate(request);
        lockParentSkill(gameId, skillKey);
        if (mapper.countByKey(gameId, skillKey, values.stateKey()) > 0) {
            throw keyExists();
        }
        List<FormulaRef> refs = collectAndValidateDetail(values, true);
        lockAndValidateFormulas(gameId, skillKey, refs);
        try {
            mapper.insertState(
                gameId,
                skillKey,
                values.stateKey(),
                values.name(),
                values.stateType(),
                values.scope(),
                values.description(),
                values.sortOrder()
            );
            insertDetail(gameId, skillKey, values.stateKey(), values);
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, values.stateKey());
    }

    @Transactional
    public SkillInternalStateDetailResponse update(
        String gameId,
        String skillKey,
        String stateKey,
        @Valid SkillInternalStateUpdateRequest request
    ) {
        requireGame(gameId);
        ValidatedState values = validateUpdate(request, stateKey);
        lockParentSkill(gameId, skillKey);
        SkillInternalStateRow existing = mapper.findStateForUpdate(gameId, skillKey, stateKey);
        if (existing == null) {
            throw stateNotFound(stateKey);
        }
        List<Map<String, String>> issues = new ArrayList<>();
        if (existing.stateType() != values.stateType()) {
            issues.add(fieldIssue("stateType", "IMMUTABLE", "内部状态种类不能修改"));
        }
        if (existing.scope() != values.scope()) {
            issues.add(fieldIssue("scope", "IMMUTABLE", "内部状态范围不能修改"));
        }
        throwIfInvalid(issues);
        List<FormulaRef> refs = collectAndValidateDetail(values, false);
        lockAndValidateFormulas(gameId, skillKey, refs);
        try {
            if (values.stateType() == SkillInternalStateType.MODE) {
                replaceModeOptions(gameId, skillKey, stateKey, ((SkillInternalStateModeDetail) values.detail()).options());
            } else {
                updateTypedDetail(gameId, skillKey, stateKey, values);
            }
            if (mapper.updateState(
                gameId,
                skillKey,
                stateKey,
                values.name(),
                values.description(),
                values.sortOrder()
            ) == 0) {
                throw stateNotFound(stateKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireDetail(gameId, skillKey, stateKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String stateKey) {
        requireGame(gameId);
        lockParentSkill(gameId, skillKey);
        if (mapper.findStateForUpdate(gameId, skillKey, stateKey) == null) {
            throw stateNotFound(stateKey);
        }
        if (mapper.countStateOperations(gameId, skillKey, stateKey) > 0) {
            throw stateInUse();
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertInternalStateDeletable(gameId, skillKey, stateKey);
        }
        try {
            if (mapper.deleteState(gameId, skillKey, stateKey) == 0) {
                throw stateNotFound(stateKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    private SkillInternalStateDetailResponse requireDetail(String gameId, String skillKey, String stateKey) {
        SkillInternalStateRow state = mapper.findState(gameId, skillKey, stateKey);
        if (state == null) {
            throw stateNotFound(stateKey);
        }
        return assembleDetail(state);
    }

    private SkillInternalStateDetailResponse assembleDetail(SkillInternalStateRow state) {
        String gameId = state.gameId();
        String skillKey = state.skillKey();
        String stateKey = state.stateKey();
        SkillInternalStateCounterDetailRow counter = mapper.findCounterDetail(gameId, skillKey, stateKey);
        SkillInternalStateAmmoDetailRow ammo = mapper.findAmmoDetail(gameId, skillKey, stateKey);
        SkillInternalStateFlagDetailRow flag = mapper.findFlagDetail(gameId, skillKey, stateKey);
        SkillInternalStateCooldownDetailRow cooldown = mapper.findCooldownDetail(gameId, skillKey, stateKey);
        List<SkillInternalStateModeOptionRow> options =
            nullToEmpty(mapper.listModeOptions(gameId, skillKey, stateKey));
        int present = countPresent(counter, ammo, flag, cooldown) + (options.isEmpty() ? 0 : 1);
        SkillInternalStateDetail detail = switch (state.stateType()) {
            case COUNTER -> {
                if (counter == null || ammo != null || flag != null || cooldown != null || !options.isEmpty()
                    || present != 1) {
                    throw corrupt(gameId, skillKey, stateKey, "COUNTER形状损坏");
                }
                yield new SkillInternalStateCounterDetail(
                    counter.initialValueFormulaKey(),
                    counter.maxValueFormulaKey()
                );
            }
            case AMMO -> {
                if (ammo == null || counter != null || flag != null || cooldown != null || !options.isEmpty()
                    || present != 1) {
                    throw corrupt(gameId, skillKey, stateKey, "AMMO形状损坏");
                }
                yield new SkillInternalStateAmmoDetail(
                    ammo.initialValueFormulaKey(),
                    ammo.maxValueFormulaKey(),
                    ammo.recoveryIntervalFormulaKey(),
                    ammo.recoveryMode()
                );
            }
            case MODE -> {
                if (counter != null || ammo != null || flag != null || cooldown != null || options.size() < 2) {
                    throw corrupt(gameId, skillKey, stateKey, "MODE形状损坏");
                }
                long initialCount = options.stream().filter(row -> Boolean.TRUE.equals(row.initial())).count();
                if (initialCount != 1) {
                    throw corrupt(gameId, skillKey, stateKey, "MODE初始选项损坏");
                }
                yield new SkillInternalStateModeDetail(options.stream()
                    .map(row -> new SkillInternalStateModeOption(
                        row.optionKey(),
                        row.name(),
                        row.sortOrder(),
                        row.initial()
                    ))
                    .toList());
            }
            case FLAG -> {
                if (flag == null || counter != null || ammo != null || cooldown != null || !options.isEmpty()
                    || present != 1) {
                    throw corrupt(gameId, skillKey, stateKey, "FLAG形状损坏");
                }
                yield new SkillInternalStateFlagDetail(flag.initialEnabled());
            }
            case INTERNAL_COOLDOWN -> {
                if (cooldown == null || counter != null || ammo != null || flag != null || !options.isEmpty()
                    || present != 1) {
                    throw corrupt(gameId, skillKey, stateKey, "INTERNAL_COOLDOWN形状损坏");
                }
                yield new SkillInternalStateCooldownDetail(cooldown.durationFormulaKey());
            }
        };
        return new SkillInternalStateDetailResponse(
            state.gameId(),
            state.skillKey(),
            state.stateKey(),
            state.name(),
            state.stateType(),
            state.scope(),
            state.description(),
            state.sortOrder(),
            detail,
            state.createdAt(),
            state.updatedAt()
        );
    }

    private ValidatedState validateCreate(SkillInternalStateCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "内部状态不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        return validateCommon(
            request.stateKey(),
            request.name(),
            request.stateType(),
            request.scope(),
            request.description(),
            request.sortOrder(),
            request.detail(),
            true
        );
    }

    private ValidatedState validateUpdate(SkillInternalStateUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "内部状态不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.stateKey() != null) {
            issues.add(fieldIssue("stateKey", "IMMUTABLE", "内部状态标识不能修改"));
            throwIfInvalid(issues);
        }
        return validateCommon(
            pathKey,
            request.name(),
            request.stateType(),
            request.scope(),
            request.description(),
            request.sortOrder(),
            request.detail(),
            false
        );
    }

    private ValidatedState validateCommon(
        String stateKey,
        String name,
        SkillInternalStateType stateType,
        SkillInternalStateScope scope,
        String description,
        Integer sortOrder,
        SkillInternalStateDetail detail,
        boolean creating
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<Map<String, String>> bodyIssues = new ArrayList<>();
        if (stateType == null) {
            issues.add(fieldIssue("stateType", "REQUIRED", "内部状态种类不能为空"));
        }
        if (scope == null) {
            issues.add(fieldIssue("scope", "REQUIRED", "内部状态范围不能为空"));
        } else if (stateType != null && stateType != SkillInternalStateType.COUNTER
            && scope != SkillInternalStateScope.SKILL) {
            issues.add(fieldIssue("scope", "SCOPE_INVALID", "该内部状态种类只能使用技能自身范围"));
        }
        if (detail == null) {
            issues.add(fieldIssue("detail", "REQUIRED", "内部状态明细不能为空"));
        } else {
            collectMutexFields(detail, bodyIssues);
        }
        throwIfInvalidBody(bodyIssues);
        throwIfInvalid(issues);
        return new ValidatedState(stateKey, name, stateType, scope, description, sortOrder, detail);
    }

    private List<FormulaRef> collectAndValidateDetail(ValidatedState values, boolean creating) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<FormulaRef> refs = new ArrayList<>();
        SkillInternalStateDetail detail = values.detail();
        switch (values.stateType()) {
            case COUNTER -> {
                if (!(detail instanceof SkillInternalStateCounterDetail counter)) {
                    issues.add(fieldIssue("detail", "TYPE_MISMATCH", "计数状态明细形状不合法"));
                    break;
                }
                addFormula(refs, issues, "detail.initialValueFormulaKey", counter.initialValueFormulaKey());
                addFormula(refs, issues, "detail.maxValueFormulaKey", counter.maxValueFormulaKey());
            }
            case AMMO -> {
                if (!(detail instanceof SkillInternalStateAmmoDetail ammo)) {
                    issues.add(fieldIssue("detail", "TYPE_MISMATCH", "弹药状态明细形状不合法"));
                    break;
                }
                addFormula(refs, issues, "detail.initialValueFormulaKey", ammo.initialValueFormulaKey());
                addFormula(refs, issues, "detail.maxValueFormulaKey", ammo.maxValueFormulaKey());
                addFormula(refs, issues, "detail.recoveryIntervalFormulaKey", ammo.recoveryIntervalFormulaKey());
                if (ammo.recoveryMode() == null) {
                    issues.add(fieldIssue("detail.recoveryMode", "REQUIRED", "弹药恢复方式不能为空"));
                }
            }
            case MODE -> validateMode(detail, issues);
            case FLAG -> {
                if (!(detail instanceof SkillInternalStateFlagDetail flag)) {
                    issues.add(fieldIssue("detail", "TYPE_MISMATCH", "准备标记明细形状不合法"));
                    break;
                }
                if (flag.initialEnabled() == null) {
                    issues.add(fieldIssue("detail.initialEnabled", "REQUIRED", "初始启用状态不能为空"));
                }
            }
            case INTERNAL_COOLDOWN -> {
                if (!(detail instanceof SkillInternalStateCooldownDetail cooldown)) {
                    issues.add(fieldIssue("detail", "TYPE_MISMATCH", "内部冷却明细形状不合法"));
                    break;
                }
                addFormula(refs, issues, "detail.durationFormulaKey", cooldown.durationFormulaKey());
            }
        }
        throwIfInvalid(issues);
        return refs;
    }

    private void validateMode(SkillInternalStateDetail detail, List<Map<String, String>> issues) {
        if (!(detail instanceof SkillInternalStateModeDetail mode)) {
            issues.add(fieldIssue("detail", "TYPE_MISMATCH", "模式状态明细形状不合法"));
            return;
        }
        List<SkillInternalStateModeOption> options = mode.options();
        if (options == null || options.size() < 2) {
            issues.add(fieldIssue("detail.options", "LENGTH_INVALID", "模式至少包含两个选项"));
            return;
        }
        Set<String> seen = new HashSet<>();
        int initialCount = 0;
        for (int i = 0; i < options.size(); i++) {
            SkillInternalStateModeOption option = options.get(i);
            if (option == null) {
                issues.add(fieldIssue(optionPath(i, null), "REQUIRED", "模式选项不能为空"));
                continue;
            }
            if (option.optionKey() != null && !seen.add(option.optionKey())) {
                issues.add(fieldIssue(optionPath(i, "optionKey"), "DUPLICATE", "同一模式内选项标识不能重复"));
            }
            if (Boolean.TRUE.equals(option.initial())) {
                initialCount++;
            }
        }
        if (initialCount != 1) {
            for (int i = 0; i < options.size(); i++) {
                issues.add(fieldIssue(optionPath(i, "initial"), "INITIAL_INVALID", "模式必须恰好一个初始选项"));
            }
        }
    }

    private void insertDetail(String gameId, String skillKey, String stateKey, ValidatedState values) {
        switch (values.stateType()) {
            case COUNTER -> {
                SkillInternalStateCounterDetail counter = (SkillInternalStateCounterDetail) values.detail();
                mapper.insertCounterDetail(
                    gameId, skillKey, stateKey, counter.initialValueFormulaKey(), counter.maxValueFormulaKey()
                );
            }
            case AMMO -> {
                SkillInternalStateAmmoDetail ammo = (SkillInternalStateAmmoDetail) values.detail();
                mapper.insertAmmoDetail(
                    gameId,
                    skillKey,
                    stateKey,
                    ammo.initialValueFormulaKey(),
                    ammo.maxValueFormulaKey(),
                    ammo.recoveryIntervalFormulaKey(),
                    ammo.recoveryMode()
                );
            }
            case MODE -> {
                for (SkillInternalStateModeOption option : ((SkillInternalStateModeDetail) values.detail()).options()) {
                    mapper.insertModeOption(
                        gameId,
                        skillKey,
                        stateKey,
                        option.optionKey(),
                        option.name(),
                        option.sortOrder(),
                        option.initial()
                    );
                }
            }
            case FLAG -> mapper.insertFlagDetail(
                gameId,
                skillKey,
                stateKey,
                ((SkillInternalStateFlagDetail) values.detail()).initialEnabled()
            );
            case INTERNAL_COOLDOWN -> mapper.insertCooldownDetail(
                gameId,
                skillKey,
                stateKey,
                ((SkillInternalStateCooldownDetail) values.detail()).durationFormulaKey()
            );
        }
    }

    private void updateTypedDetail(String gameId, String skillKey, String stateKey, ValidatedState values) {
        switch (values.stateType()) {
            case COUNTER -> {
                SkillInternalStateCounterDetail counter = (SkillInternalStateCounterDetail) values.detail();
                mapper.updateCounterDetail(
                    gameId, skillKey, stateKey, counter.initialValueFormulaKey(), counter.maxValueFormulaKey()
                );
            }
            case AMMO -> {
                SkillInternalStateAmmoDetail ammo = (SkillInternalStateAmmoDetail) values.detail();
                mapper.updateAmmoDetail(
                    gameId,
                    skillKey,
                    stateKey,
                    ammo.initialValueFormulaKey(),
                    ammo.maxValueFormulaKey(),
                    ammo.recoveryIntervalFormulaKey(),
                    ammo.recoveryMode()
                );
            }
            case FLAG -> mapper.updateFlagDetail(
                gameId,
                skillKey,
                stateKey,
                ((SkillInternalStateFlagDetail) values.detail()).initialEnabled()
            );
            case INTERNAL_COOLDOWN -> mapper.updateCooldownDetail(
                gameId,
                skillKey,
                stateKey,
                ((SkillInternalStateCooldownDetail) values.detail()).durationFormulaKey()
            );
            case MODE -> {
            }
        }
    }

    private void replaceModeOptions(
        String gameId,
        String skillKey,
        String stateKey,
        List<SkillInternalStateModeOption> options
    ) {
        List<SkillInternalStateModeOptionRow> existing =
            nullToEmpty(mapper.listModeOptionsForUpdate(gameId, skillKey, stateKey));
        Set<String> existingKeys = new LinkedHashSet<>();
        for (SkillInternalStateModeOptionRow row : existing) {
            existingKeys.add(row.optionKey());
        }
        Set<String> requestedKeys = new LinkedHashSet<>();
        for (SkillInternalStateModeOption option : options) {
            requestedKeys.add(option.optionKey());
        }
        List<String> removed = new ArrayList<>();
        for (String key : existingKeys) {
            if (!requestedKeys.contains(key)) {
                removed.add(key);
            }
        }
        if (!removed.isEmpty() && mapper.countOptionOperations(gameId, skillKey, stateKey, removed) > 0) {
            throw optionInUse();
        }
        if (!removed.isEmpty() && triggerRuleService != null) {
            triggerRuleService.assertOptionsNotReferenced(gameId, skillKey, stateKey, removed);
        }
        if (!removed.isEmpty()) {
            mapper.deleteModeOptions(gameId, skillKey, stateKey, removed);
        }
        for (SkillInternalStateModeOption option : options) {
            if (existingKeys.contains(option.optionKey())) {
                mapper.updateModeOption(
                    gameId,
                    skillKey,
                    stateKey,
                    option.optionKey(),
                    option.name(),
                    option.sortOrder(),
                    option.initial()
                );
            } else {
                mapper.insertModeOption(
                    gameId,
                    skillKey,
                    stateKey,
                    option.optionKey(),
                    option.name(),
                    option.sortOrder(),
                    option.initial()
                );
            }
        }
    }

    private void lockAndValidateFormulas(String gameId, String skillKey, List<FormulaRef> refs) {
        Set<String> keys = new LinkedHashSet<>();
        for (FormulaRef ref : refs) {
            keys.add(ref.formulaKey());
        }
        if (keys.isEmpty()) {
            return;
        }
        List<String> lockKeys = new ArrayList<>(keys);
        lockKeys.sort(String::compareTo);
        Set<String> found = new HashSet<>(nullToEmpty(mapper.lockFormulas(gameId, skillKey, lockKeys)));
        List<Map<String, String>> unknown = new ArrayList<>();
        for (FormulaRef ref : refs) {
            if (!found.contains(ref.formulaKey())) {
                unknown.add(fieldIssue(ref.field(), "UNKNOWN_FORMULA", "技能公式不存在或不属于当前技能"));
            }
        }
        if (!unknown.isEmpty()) {
            unknown.sort(Comparator.comparing(issue -> issue.get("field")));
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_SKILL_INTERNAL_STATE_REFERENCE",
                "内部状态引用不合法",
                Map.of("fieldIssues", List.copyOf(unknown))
            );
        }
    }

    private void collectMutexFields(SkillInternalStateDetail detail, List<Map<String, String>> bodyIssues) {
        for (String field : nullToEmptySet(detail.foreignFields())) {
            bodyIssues.add(fieldIssue("detail." + field, "FIELD_MUTEX", "内部状态明细字段互斥"));
        }
        for (String field : nullToEmptySet(detail.unknownFields())) {
            bodyIssues.add(fieldIssue("detail." + field, "UNKNOWN_FIELD", "内部状态明细包含未知字段"));
        }
    }

    private static void addFormula(
        List<FormulaRef> refs,
        List<Map<String, String>> issues,
        String field,
        String formulaKey
    ) {
        if (formulaKey == null || formulaKey.isBlank()) {
            issues.add(fieldIssue(field, "REQUIRED", "公式不能为空"));
            return;
        }
        refs.add(new FormulaRef(field, formulaKey));
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

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "内部状态不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void throwIfInvalidBody(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.INVALID_BODY",
                "内部状态明细不合法",
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

    private static ApiException stateNotFound(String stateKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_INTERNAL_STATE_NOT_FOUND",
            "技能内部状态不存在",
            Map.of("stateKey", stateKey == null ? "" : stateKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_INTERNAL_STATE_KEY_EXISTS", "技能内部状态标识已存在", "stateKey");
    }

    private static ApiException stateInUse() {
        return conflict("409.SKILL_INTERNAL_STATE_IN_USE", "技能内部状态已被过程操作引用，不能删除", "stateKey");
    }

    private static ApiException optionInUse() {
        return conflict("409.SKILL_INTERNAL_STATE_OPTION_IN_USE", "模式选项已被过程操作引用，不能移除", "detail.options");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private ApiException corrupt(String gameId, String skillKey, String stateKey, String reason) {
        log.error(
            "Skill internal state data corruption detected. gameId={}, skillKey={}, stateKey={}, reason={}",
            gameId,
            skillKey,
            stateKey,
            reason
        );
        return new ApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "500.INTERNAL_ERROR",
            "技能内部状态数据损坏",
            Map.of(
                "gameId", gameId,
                "skillKey", skillKey,
                "stateKey", stateKey,
                "reason", reason
            )
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        if (text.contains(STATE_IN_USE_CONSTRAINT)) {
            return stateInUse();
        }
        if (text.contains(OPTION_IN_USE_CONSTRAINT)) {
            return optionInUse();
        }
        for (String constraint : TRIGGER_OPTION_IN_USE_CONSTRAINTS) {
            if (text.contains(constraint)) {
                return optionInUse();
            }
        }
        for (String constraint : TRIGGER_STATE_IN_USE_CONSTRAINTS) {
            if (text.contains(constraint)) {
                return stateInUse();
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

    private static String optionPath(int index, String suffix) {
        if (suffix == null || suffix.isEmpty()) {
            return "detail.options[" + index + "]";
        }
        return "detail.options[" + index + "]." + suffix;
    }

    private static int countPresent(Object... values) {
        int count = 0;
        for (Object value : values) {
            if (value != null) {
                count++;
            }
        }
        return count;
    }

    private static <T> List<T> nullToEmpty(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static Set<String> nullToEmptySet(Set<String> values) {
        return values == null ? Set.of() : values;
    }

    private record ValidatedState(
        String stateKey,
        String name,
        SkillInternalStateType stateType,
        SkillInternalStateScope scope,
        String description,
        Integer sortOrder,
        SkillInternalStateDetail detail
    ) {
    }

    private record FormulaRef(String field, String formulaKey) {
    }
}
