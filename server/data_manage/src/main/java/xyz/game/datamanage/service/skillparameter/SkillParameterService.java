package xyz.game.datamanage.service.skillparameter;

import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skillparameter.SkillParameterCreateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.model.skillparameter.SkillParameterUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class SkillParameterService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final String PRIMARY_KEY_CONSTRAINT = "pk_skill_parameters";
    private static final String PARAMETER_REFERENCE_CONSTRAINT = "fk_skill_formula_nodes_parameter";
    private static final String TRIGGER_PARAMETER_CONSTRAINT = "fk_skill_trigger_runtime_bindings_parameter";

    private final GamesMapper gamesMapper;
    private final SkillMapper skillMapper;
    private final SkillParameterMapper parameterMapper;
    private final SkillParameterLevelService levelService;
    private final SkillTriggerRuleService triggerRuleService;

    public SkillParameterService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillParameterMapper parameterMapper,
        SkillParameterLevelService levelService,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this(gamesMapper, skillMapper, parameterMapper, levelService, null, configurationWrites);
    }

    @Autowired
    public SkillParameterService(
        GamesMapper gamesMapper,
        SkillMapper skillMapper,
        SkillParameterMapper parameterMapper,
        SkillParameterLevelService levelService,
        SkillTriggerRuleService triggerRuleService,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.skillMapper = skillMapper;
        this.parameterMapper = parameterMapper;
        this.levelService = levelService;
        this.triggerRuleService = triggerRuleService;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public List<SkillParameterResponse> list(String gameId, String skillKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        List<SkillParameterRow> rows = parameterMapper.list(gameId, skillKey);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        List<SkillParameterResponse> items = new ArrayList<>(rows.size());
        for (SkillParameterRow row : rows) {
            items.add(toResponse(row));
        }
        return items;
    }

    @Transactional(readOnly = true)
    public SkillParameterResponse get(String gameId, String skillKey, String parameterKey) {
        requireGame(gameId);
        requireSkillExists(gameId, skillKey);
        SkillParameterRow row = parameterMapper.findById(gameId, skillKey, parameterKey);
        if (row == null) {
            throw parameterNotFound(parameterKey);
        }
        return toResponse(row);
    }

    @Transactional
    public SkillParameterResponse create(
        String gameId,
        String skillKey,
        @Valid SkillParameterCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedValues values = validateCreate(request);
        LevelConfigResponse levelConfig = null;
        if (values.valueMode() == SkillParameterValueMode.CHARACTER_LEVEL) {
            if (parameterMapper.lockGame(gameId) == null) {
                throw gameNotFound(gameId);
            }
            levelConfig = parameterMapper.findLevelConfigForUpdate(gameId);
            if (levelConfig == null) {
                throw levelConfigRequired(gameId);
            }
        }
        SkillRow skill = skillMapper.findByIdForUpdate(gameId, skillKey);
        if (skill == null) {
            throw skillNotFound(skillKey);
        }
        Map<String, BigDecimal> normalizedLevels = normalizeValues(
            values.valueMode(),
            values.valueType(),
            values.fixedValue(),
            values.levelValues(),
            skill.maxLevel(),
            levelConfig
        );
        if (parameterMapper.countByKey(gameId, skillKey, values.parameterKey()) > 0) {
            throw keyExists();
        }
        try {
            parameterMapper.insert(
                gameId,
                skillKey,
                values.parameterKey(),
                values.name(),
                values.valueType().name(),
                values.valueMode().name(),
                values.fixedValue(),
                levelService.toLevelValuesJson(normalizedLevels),
                values.description(),
                values.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireParameter(gameId, skillKey, values.parameterKey());
    }

    @Transactional
    public SkillParameterResponse update(
        String gameId,
        String skillKey,
        String parameterKey,
        @Valid SkillParameterUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        ValidatedValues values = validateUpdate(request, parameterKey);
        LevelConfigResponse levelConfig = null;
        if (values.valueMode() == SkillParameterValueMode.CHARACTER_LEVEL) {
            if (parameterMapper.lockGame(gameId) == null) {
                throw gameNotFound(gameId);
            }
            levelConfig = parameterMapper.findLevelConfigForUpdate(gameId);
            if (levelConfig == null) {
                throw levelConfigRequired(gameId);
            }
        }
        SkillRow skill = skillMapper.findByIdForUpdate(gameId, skillKey);
        if (skill == null) {
            throw skillNotFound(skillKey);
        }
        if (parameterMapper.findByIdForUpdate(gameId, skillKey, parameterKey) == null) {
            throw parameterNotFound(parameterKey);
        }
        Map<String, BigDecimal> normalizedLevels = normalizeValues(
            values.valueMode(),
            values.valueType(),
            values.fixedValue(),
            values.levelValues(),
            skill.maxLevel(),
            levelConfig
        );
        try {
            if (parameterMapper.update(
                gameId,
                skillKey,
                parameterKey,
                values.name(),
                values.valueType().name(),
                values.valueMode().name(),
                values.fixedValue(),
                levelService.toLevelValuesJson(normalizedLevels),
                values.description(),
                values.sortOrder()
            ) == 0) {
                throw parameterNotFound(parameterKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireParameter(gameId, skillKey, parameterKey);
    }

    @Transactional
    public void delete(String gameId, String skillKey, String parameterKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        if (skillMapper.findByIdForUpdate(gameId, skillKey) == null) {
            throw skillNotFound(skillKey);
        }
        if (parameterMapper.findByIdForUpdate(gameId, skillKey, parameterKey) == null) {
            throw parameterNotFound(parameterKey);
        }
        if (parameterMapper.countFormulaReferences(gameId, skillKey, parameterKey) > 0) {
            throw parameterInUse();
        }
        if (triggerRuleService != null) {
            triggerRuleService.assertParameterDeletable(gameId, skillKey, parameterKey);
        }
        configurationWrites.assertNotReferenced(gameId, "PARAMETER", skillKey, parameterKey,
            "409.SKILL_PARAMETER_IN_USE", "技能参数已被引用，不能删除");
        try {
            if (parameterMapper.delete(gameId, skillKey, parameterKey) == 0) {
                throw parameterNotFound(parameterKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
    }

    private Map<String, BigDecimal> normalizeValues(
        SkillParameterValueMode valueMode,
        SkillParameterValueType valueType,
        BigDecimal fixedValue,
        Map<String, BigDecimal> levelValues,
        Integer maxLevel,
        LevelConfigResponse levelConfig
    ) {
        return switch (valueMode) {
            case FIXED -> {
                levelService.validateFixedValue(fixedValue, valueType, "fixedValue");
                yield null;
            }
            case SKILL_LEVEL -> levelService.validateCompleteMap(
                levelValues,
                1,
                maxLevel,
                valueType,
                "levelValues"
            );
            case CHARACTER_LEVEL -> levelService.validateCompleteMap(
                levelValues,
                levelConfig.minLevel(),
                levelConfig.maxLevel(),
                valueType,
                "levelValues"
            );
            case RUNTIME_INPUT -> null;
        };
    }

    private ValidatedValues validateCreate(SkillParameterCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能参数不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.valueType() == null) {
            issues.add(fieldIssue("valueType", "REQUIRED", "值类型不能为空或不受支持"));
        }
        if (request.valueMode() == null) {
            issues.add(fieldIssue("valueMode", "REQUIRED", "取值方式不能为空或不受支持"));
        }
        validateShape(request.valueMode(), request.fixedValue(), request.levelValues(), issues);
        throwIfInvalid(issues);
        return new ValidatedValues(
            request.parameterKey(),
            request.name(),
            request.valueType(),
            request.valueMode(),
            request.fixedValue(),
            request.levelValues(),
            request.description(),
            request.sortOrder()
        );
    }

    private ValidatedValues validateUpdate(SkillParameterUpdateRequest request, String pathKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "技能参数不能为空"));
            throwIfInvalid(issues);
            return null;
        }
        if (request.parameterKey() != null) {
            issues.add(fieldIssue("parameterKey", "IMMUTABLE", "参数标识不能修改"));
        }
        if (request.valueType() == null) {
            issues.add(fieldIssue("valueType", "REQUIRED", "值类型不能为空或不受支持"));
        }
        if (request.valueMode() == null) {
            issues.add(fieldIssue("valueMode", "REQUIRED", "取值方式不能为空或不受支持"));
        }
        validateShape(request.valueMode(), request.fixedValue(), request.levelValues(), issues);
        throwIfInvalid(issues);
        return new ValidatedValues(
            pathKey,
            request.name(),
            request.valueType(),
            request.valueMode(),
            request.fixedValue(),
            request.levelValues(),
            request.description(),
            request.sortOrder()
        );
    }

    private static void validateShape(
        SkillParameterValueMode valueMode,
        BigDecimal fixedValue,
        Map<String, BigDecimal> levelValues,
        List<Map<String, String>> issues
    ) {
        if (valueMode == null) {
            return;
        }
        switch (valueMode) {
            case FIXED -> {
                if (fixedValue == null) {
                    issues.add(fieldIssue("fixedValue", "REQUIRED", "固定值模式必须提供 fixedValue"));
                }
                if (levelValues != null) {
                    issues.add(fieldIssue("levelValues", "FORBIDDEN", "固定值模式不允许 levelValues"));
                }
            }
            case SKILL_LEVEL, CHARACTER_LEVEL -> {
                if (fixedValue != null) {
                    issues.add(fieldIssue("fixedValue", "FORBIDDEN", "等级模式不允许 fixedValue"));
                }
                if (levelValues == null) {
                    issues.add(fieldIssue("levelValues", "REQUIRED", "等级模式必须提供 levelValues"));
                }
            }
            case RUNTIME_INPUT -> {
                if (fixedValue != null) {
                    issues.add(fieldIssue("fixedValue", "FORBIDDEN", "计算时传入模式不允许 fixedValue"));
                }
                if (levelValues != null) {
                    issues.add(fieldIssue("levelValues", "FORBIDDEN", "计算时传入模式不允许 levelValues"));
                }
            }
        }
    }

    private SkillParameterResponse requireParameter(
        String gameId,
        String skillKey,
        String parameterKey
    ) {
        SkillParameterRow row = parameterMapper.findById(gameId, skillKey, parameterKey);
        if (row == null) {
            throw parameterNotFound(parameterKey);
        }
        return toResponse(row);
    }

    private SkillParameterResponse toResponse(SkillParameterRow row) {
        Map<String, BigDecimal> levelValues = row.levelValuesJson() == null
            ? null
            : levelService.parseLevelValuesJson(row.levelValuesJson());
        return new SkillParameterResponse(
            row.gameId(),
            row.skillKey(),
            row.parameterKey(),
            row.name(),
            row.valueType(),
            row.valueMode(),
            row.fixedValue(),
            levelValues,
            row.description(),
            row.sortOrder(),
            row.createdAt(),
            row.updatedAt()
        );
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

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能参数不合法",
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

    private static ApiException parameterNotFound(String parameterKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.SKILL_PARAMETER_NOT_FOUND",
            "技能参数不存在",
            Map.of("parameterKey", parameterKey == null ? "" : parameterKey)
        );
    }

    private static ApiException levelConfigRequired(String gameId) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.LEVEL_CONFIG_REQUIRED",
            "请先配置游戏等级范围",
            Map.of("gameId", gameId)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.SKILL_PARAMETER_KEY_EXISTS", "技能参数标识已存在", "parameterKey");
    }

    private static ApiException parameterInUse() {
        return conflict("409.SKILL_PARAMETER_IN_USE", "技能参数仍被公式引用", "parameterKey");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "CONFLICT", message)))
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        if (text.contains(PARAMETER_REFERENCE_CONSTRAINT) || text.contains(TRIGGER_PARAMETER_CONSTRAINT)) {
            return parameterInUse();
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

    private record ValidatedValues(
        String parameterKey,
        String name,
        SkillParameterValueType valueType,
        SkillParameterValueMode valueMode,
        BigDecimal fixedValue,
        Map<String, BigDecimal> levelValues,
        String description,
        Integer sortOrder
    ) {
    }
}
