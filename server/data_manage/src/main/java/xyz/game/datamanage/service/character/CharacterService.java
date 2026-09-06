package xyz.game.datamanage.service.character;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.CharacterAttributeDefinition;
import xyz.game.datamanage.model.character.CharacterAttributesRequest;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterCreateRequest;
import xyz.game.datamanage.model.character.CharacterListQuery;
import xyz.game.datamanage.model.character.CharacterListResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.CharacterUpdateRequest;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.character.LevelConfigUpdateRequest;
import xyz.game.datamanage.model.skillparameter.SkillParameterRow;
import xyz.game.datamanage.service.skillparameter.SkillParameterLevelService;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class CharacterService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern CHARACTER_KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Pattern LEVEL_KEY_PATTERN = Pattern.compile("[1-9][0-9]*");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_characters";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_characters_name";

    private final GamesMapper gamesMapper;
    private final CharacterMapper characterMapper;
    private final SkillParameterMapper parameterMapper;
    private final SkillParameterLevelService levelService;
    private final ObjectMapper objectMapper;
    private final ImageRelationMapper imageRelationMapper;

    public CharacterService(
        GamesMapper gamesMapper,
        CharacterMapper characterMapper,
        SkillParameterMapper parameterMapper,
        SkillParameterLevelService levelService,
        ObjectMapper objectMapper,
        ImageRelationMapper imageRelationMapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.characterMapper = characterMapper;
        this.parameterMapper = parameterMapper;
        this.levelService = levelService;
        this.objectMapper = objectMapper;
        this.imageRelationMapper = imageRelationMapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public LevelConfigResponse getLevelConfig(String gameId) {
        requireGame(gameId);
        return requireLevelConfig(gameId);
    }

    @Transactional
    public LevelConfigResponse updateLevelConfig(
        String gameId,
        @Valid LevelConfigUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateLevelConfig(request);
        if (characterMapper.lockGame(gameId) == null) {
            throw gameNotFound(gameId);
        }
        LevelConfigResponse previousConfig = characterMapper.findLevelConfigForUpdate(gameId);
        LevelConfigResponse nextConfig = new LevelConfigResponse(
            gameId,
            request.minLevel(),
            request.maxLevel()
        );
        if (previousConfig == null) {
            rejectInconsistentFirstLevelConfig(gameId);
            characterMapper.upsertLevelConfig(gameId, request.minLevel(), request.maxLevel());
            return requireLevelConfig(gameId);
        }
        if (levelService.isSameRange(
            previousConfig.minLevel(),
            previousConfig.maxLevel(),
            nextConfig.minLevel(),
            nextConfig.maxLevel()
        )) {
            characterMapper.upsertLevelConfig(gameId, request.minLevel(), request.maxLevel());
            return requireLevelConfig(gameId);
        }

        parameterMapper.lockSkillsForGame(gameId);
        List<SkillParameterRow> characterLevelParams =
            parameterMapper.lockCharacterLevelParamsForGame(gameId);
        characterMapper.lockCharactersForGame(gameId);
        List<String> attributeKeys = characterMapper.lockCharacterAttributesForGame(gameId);
        List<CharacterAttributeDefinition> definitions = attributeDefinitions(gameId);

        if (attributeKeys != null) {
            for (String characterKey : attributeKeys) {
                JsonNode stored = parseStored(characterMapper.findLevelValuesJson(gameId, characterKey));
                String normalizedJson = toJson(remapForLevelConfig(
                    stored,
                    previousConfig,
                    nextConfig,
                    definitions
                ));
                if (characterMapper.updateLevelValues(gameId, characterKey, normalizedJson) != 1) {
                    throw new IllegalStateException(
                        "Failed to update character attributes for " + characterKey
                    );
                }
            }
        }
        if (characterLevelParams != null) {
            for (SkillParameterRow row : characterLevelParams) {
                Map<String, BigDecimal> previous = levelService.parseLevelValuesJson(row.levelValuesJson());
                Map<String, BigDecimal> remapped = levelService.remap(
                    previous,
                    nextConfig.minLevel(),
                    nextConfig.maxLevel()
                );
                if (parameterMapper.updateLevelValuesJson(
                    gameId,
                    row.skillKey(),
                    row.parameterKey(),
                    levelService.toLevelValuesJson(remapped)
                ) != 1) {
                    throw new IllegalStateException(
                        "Failed to update CHARACTER_LEVEL parameter for " + row.parameterKey()
                    );
                }
            }
        }
        characterMapper.upsertLevelConfig(gameId, request.minLevel(), request.maxLevel());
        return requireLevelConfig(gameId);
    }

    @Transactional(readOnly = true)
    public CharacterListResponse list(String gameId, @Valid CharacterListQuery query) {
        requireGame(gameId);
        CharacterListQuery normalized = query == null ? new CharacterListQuery(null) : query;
        List<CharacterResponse> items = characterMapper.list(gameId, normalized.keyword());
        List<CharacterResponse> safeItems = items == null ? List.of() : items;
        return new CharacterListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public CharacterResponse get(String gameId, String characterKey) {
        requireGame(gameId);
        return requireCharacter(gameId, characterKey);
    }

    @Transactional
    public CharacterResponse create(String gameId, @Valid CharacterCreateRequest request) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockGameAndLevelConfig(gameId);
        LevelConfigResponse levelConfig = requireLevelConfigLocked(gameId);
        validateCreateRequest(request);
        if (characterMapper.countByKey(gameId, request.characterKey()) > 0) {
            throw characterKeyExists();
        }
        if (characterMapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw characterNameExists();
        }

        try {
            characterMapper.insertCharacter(
                gameId,
                request.characterKey(),
                request.name(),
                request.description()
            );
            List<CharacterAttributeDefinition> definitions = attributeDefinitions(gameId);
            ObjectNode emptyMap = buildEmptyMap(levelConfig);
            ObjectNode normalized = normalizeForWrite(emptyMap, levelConfig, definitions);
            characterMapper.insertLevelValues(
                gameId,
                request.characterKey(),
                toJson(normalized)
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }
        return requireCharacter(gameId, request.characterKey());
    }

    @Transactional
    public CharacterResponse update(
        String gameId,
        String characterKey,
        @Valid CharacterUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateUpdateRequest(request);
        if (characterMapper.findByIdForUpdate(gameId, characterKey) == null) {
            throw characterNotFound(characterKey);
        }
        if (characterMapper.countByNormalizedName(gameId, request.name(), characterKey) > 0) {
            throw characterNameExists();
        }
        try {
            if (characterMapper.updateCharacter(
                gameId,
                characterKey,
                request.name(),
                request.description()
            ) == 0) {
                throw characterNotFound(characterKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapUniqueConstraint(ex);
        }
        return requireCharacter(gameId, characterKey);
    }

    @Transactional
    public void delete(String gameId, String characterKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        if (characterMapper.deleteCharacter(gameId, characterKey) == 0) {
            throw characterNotFound(characterKey);
        }
        imageRelationMapper.deleteForSource(gameId, "CHARACTER", "", characterKey);
    }

    @Transactional(readOnly = true)
    public CharacterAttributesResponse getAttributes(String gameId, String characterKey) {
        requireGame(gameId);
        requireCharacter(gameId, characterKey);
        LevelConfigResponse config = requireLevelConfig(gameId);
        List<CharacterAttributeDefinition> definitions = attributeDefinitions(gameId);
        JsonNode stored = parseStored(characterMapper.findLevelValuesJson(gameId, characterKey));
        ObjectNode materialized = materializeForRead(stored, config, definitions);
        return new CharacterAttributesResponse(
            characterKey,
            config.minLevel(),
            config.maxLevel(),
            materialized
        );
    }

    @Transactional
    public CharacterAttributesResponse updateAttributes(
        String gameId,
        String characterKey,
        @Valid CharacterAttributesRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        lockGameAndLevelConfig(gameId);
        LevelConfigResponse config = requireLevelConfigLocked(gameId);
        if (characterMapper.findByIdForUpdate(gameId, characterKey) == null) {
            throw characterNotFound(characterKey);
        }
        List<CharacterAttributeDefinition> definitions = attributeDefinitions(gameId);
        JsonNode raw = request == null ? null : request.levelValues();
        ObjectNode normalized = normalizeForWrite(raw, config, definitions);
        String json = toJson(normalized);
        int updated = characterMapper.updateLevelValues(gameId, characterKey, json);
        if (updated == 0) {
            characterMapper.insertLevelValues(gameId, characterKey, json);
        }
        return new CharacterAttributesResponse(
            characterKey,
            config.minLevel(),
            config.maxLevel(),
            normalized
        );
    }

    private void rejectInconsistentFirstLevelConfig(String gameId) {
        if (characterMapper.countCharacterAttributes(gameId) > 0) {
            throw inconsistentFirstLevelConfig(gameId);
        }
        List<SkillParameterRow> params = parameterMapper.listCharacterLevelParamsForGame(gameId);
        if (params != null && !params.isEmpty()) {
            throw inconsistentFirstLevelConfig(gameId);
        }
    }

    private void lockGameAndLevelConfig(String gameId) {
        if (characterMapper.lockGame(gameId) == null) {
            throw gameNotFound(gameId);
        }
        if (characterMapper.findLevelConfigForUpdate(gameId) == null) {
            throw levelConfigRequired(gameId);
        }
    }

    private LevelConfigResponse requireLevelConfigLocked(String gameId) {
        LevelConfigResponse response = characterMapper.findLevelConfig(gameId);
        if (response == null) {
            throw levelConfigRequired(gameId);
        }
        return response;
    }

    private ObjectNode normalizeForWrite(
        JsonNode raw,
        LevelConfigResponse config,
        List<CharacterAttributeDefinition> definitions
    ) {
        if (raw == null || !raw.isObject()) {
            throw levelValuesInvalid("levelValues", "OBJECT_REQUIRED", "等级属性必须是对象");
        }
        Set<String> expectedLevels = expectedLevels(config);
        Set<String> actualLevels = new HashSet<>();
        raw.fieldNames().forEachRemaining(actualLevels::add);
        for (String levelKey : actualLevels) {
            if (!LEVEL_KEY_PATTERN.matcher(levelKey).matches()) {
                throw levelValuesInvalid("/levelValues/" + levelKey, "LEVEL_KEY_INVALID", "等级键格式不合法");
            }
        }
        if (!actualLevels.equals(expectedLevels)) {
            throw levelValuesInvalid("levelValues", "LEVEL_RANGE_INVALID", "等级必须完整覆盖当前配置范围");
        }

        Set<String> knownAttributes = new HashSet<>();
        definitions.forEach(definition -> knownAttributes.add(definition.attributeKey()));
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            String levelKey = Integer.toString(level);
            JsonNode rawLevel = raw.get(levelKey);
            if (rawLevel == null || !rawLevel.isObject()) {
                throw levelValuesInvalid(
                    "/levelValues/" + levelKey,
                    "OBJECT_REQUIRED",
                    "每个等级的属性必须是对象"
                );
            }
            rawLevel.fieldNames().forEachRemaining(attributeKey -> {
                if (!knownAttributes.contains(attributeKey)) {
                    throw unknownAttribute(levelKey, attributeKey);
                }
            });
        }

        Set<String> configuredAttributes = new HashSet<>();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            raw.get(Integer.toString(level)).fieldNames().forEachRemaining(configuredAttributes::add);
        }
        for (String attributeKey : configuredAttributes) {
            for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
                String levelKey = Integer.toString(level);
                if (!raw.get(levelKey).has(attributeKey)) {
                    throw levelValuesInvalid(
                        "/levelValues/" + levelKey + "/" + attributeKey,
                        "ATTRIBUTE_ROW_INCOMPLETE",
                        "已配置属性必须覆盖全部等级"
                    );
                }
            }
        }

        ObjectNode result = objectMapper.createObjectNode();
        List<Map<String, String>> valueIssues = new ArrayList<>();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            String levelKey = Integer.toString(level);
            JsonNode rawLevel = raw.get(levelKey);

            ObjectNode normalizedLevel = result.putObject(levelKey);
            for (CharacterAttributeDefinition definition : definitions) {
                if (!configuredAttributes.contains(definition.attributeKey())) {
                    continue;
                }
                String path = "/levelValues/" + levelKey + "/" + definition.attributeKey();
                JsonNode valueNode = rawLevel.get(definition.attributeKey());
                BigDecimal value = numericValue(valueNode, path, valueIssues);
                if (value == null) {
                    continue;
                }
                validateValue(definition, value, path, valueIssues);
                normalizedLevel.set(definition.attributeKey(), DecimalNode.valueOf(value));
            }
        }
        if (!valueIssues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.ATTRIBUTE_VALUE_INVALID",
                "角色属性值不合法",
                Map.of("fieldIssues", List.copyOf(valueIssues))
            );
        }
        return result;
    }

    private ObjectNode materializeForRead(
        JsonNode stored,
        LevelConfigResponse config,
        List<CharacterAttributeDefinition> definitions
    ) {
        Set<String> configuredAttributes = completeConfiguredAttributes(stored, config, definitions);
        ObjectNode result = objectMapper.createObjectNode();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            String levelKey = Integer.toString(level);
            JsonNode storedLevel = stored == null ? null : stored.get(levelKey);
            ObjectNode outputLevel = result.putObject(levelKey);
            for (CharacterAttributeDefinition definition : definitions) {
                if (!configuredAttributes.contains(definition.attributeKey())) {
                    continue;
                }
                JsonNode value = storedLevel != null && storedLevel.isObject()
                    ? storedLevel.get(definition.attributeKey())
                    : null;
                outputLevel.set(definition.attributeKey(), DecimalNode.valueOf(value.decimalValue()));
            }
        }
        return result;
    }

    private ObjectNode buildEmptyMap(LevelConfigResponse config) {
        ObjectNode result = objectMapper.createObjectNode();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            result.putObject(Integer.toString(level));
        }
        return result;
    }

    private ObjectNode remapForLevelConfig(
        JsonNode stored,
        LevelConfigResponse previousConfig,
        LevelConfigResponse nextConfig,
        List<CharacterAttributeDefinition> definitions
    ) {
        if (previousConfig == null) {
            return buildEmptyMap(nextConfig);
        }
        ObjectNode previous = materializeForRead(stored, previousConfig, definitions);
        Set<String> configuredAttributes = completeConfiguredAttributes(
            previous,
            previousConfig,
            definitions
        );
        ObjectNode result = objectMapper.createObjectNode();
        for (int level = nextConfig.minLevel(); level <= nextConfig.maxLevel(); level++) {
            String levelKey = Integer.toString(level);
            ObjectNode levelValues = result.putObject(levelKey);
            JsonNode previousLevel = previous.get(levelKey);
            for (CharacterAttributeDefinition definition : definitions) {
                if (!configuredAttributes.contains(definition.attributeKey())) {
                    continue;
                }
                JsonNode value = previousLevel == null ? null : previousLevel.get(definition.attributeKey());
                if (value != null && value.isNumber()) {
                    levelValues.set(definition.attributeKey(), DecimalNode.valueOf(value.decimalValue()));
                } else {
                    levelValues.put(definition.attributeKey(), 0);
                }
            }
        }
        return result;
    }

    private static Set<String> completeConfiguredAttributes(
        JsonNode stored,
        LevelConfigResponse config,
        List<CharacterAttributeDefinition> definitions
    ) {
        Set<String> result = new HashSet<>();
        if (stored == null || !stored.isObject()) {
            return result;
        }
        for (CharacterAttributeDefinition definition : definitions) {
            boolean complete = true;
            for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
                JsonNode levelNode = stored.get(Integer.toString(level));
                JsonNode value = levelNode == null || !levelNode.isObject()
                    ? null
                    : levelNode.get(definition.attributeKey());
                if (value == null || !value.isNumber()) {
                    complete = false;
                    break;
                }
            }
            if (complete) {
                result.add(definition.attributeKey());
            }
        }
        return result;
    }

    private static BigDecimal numericValue(
        JsonNode node,
        String path,
        List<Map<String, String>> issues
    ) {
        if (!node.isNumber()) {
            issues.add(fieldIssue(path, "NUMBER_REQUIRED", "属性值必须是数字"));
            return null;
        }
        return node.decimalValue();
    }

    private static void validateValue(
        CharacterAttributeDefinition definition,
        BigDecimal value,
        String path,
        List<Map<String, String>> issues
    ) {
        if (definition.valueType() == AttributeValueType.INTEGER
            && value.stripTrailingZeros().scale() > 0) {
            issues.add(fieldIssue(path, "INTEGER_REQUIRED", "该属性只允许整数"));
        }
        if (definition.minValue() != null && value.compareTo(definition.minValue()) < 0) {
            issues.add(fieldIssue(path, "RANGE_INVALID", "属性值小于最小值"));
        }
        if (definition.maxValue() != null && value.compareTo(definition.maxValue()) > 0) {
            issues.add(fieldIssue(path, "RANGE_INVALID", "属性值大于最大值"));
        }
    }

    private static Set<String> expectedLevels(LevelConfigResponse config) {
        Set<String> levels = new HashSet<>();
        for (int level = config.minLevel(); level <= config.maxLevel(); level++) {
            levels.add(Integer.toString(level));
        }
        return levels;
    }

    private List<CharacterAttributeDefinition> attributeDefinitions(String gameId) {
        List<CharacterAttributeDefinition> definitions = characterMapper.listAttributeDefinitions(gameId);
        return definitions == null ? List.of() : definitions;
    }

    private JsonNode parseStored(String raw) {
        if (raw == null || raw.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode parsed = objectMapper.readTree(raw);
            return parsed != null && parsed.isObject() ? parsed : objectMapper.createObjectNode();
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Stored character attributes are not valid JSON", ex);
        }
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialize character attributes", ex);
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw gameNotFound(gameId);
        }
    }

    private LevelConfigResponse requireLevelConfig(String gameId) {
        LevelConfigResponse response = characterMapper.findLevelConfig(gameId);
        if (response == null) {
            throw levelConfigRequired(gameId);
        }
        return response;
    }

    private CharacterResponse requireCharacter(String gameId, String characterKey) {
        CharacterResponse response = characterMapper.findById(gameId, characterKey);
        if (response == null) {
            throw characterNotFound(characterKey);
        }
        return response;
    }

    private static void validateCreateRequest(CharacterCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "角色信息不能为空"));
        } else {
            if (request.characterKey() == null || request.characterKey().isBlank()) {
                issues.add(fieldIssue("characterKey", "REQUIRED", "角色标识不能为空"));
            } else if (!CHARACTER_KEY_PATTERN.matcher(request.characterKey()).matches()) {
                issues.add(fieldIssue("characterKey", "FORMAT_INVALID", "角色标识格式不合法"));
            }
            validateEditable(request.name(), request.description(), issues);
        }
        throwIfInvalid(issues);
    }

    private static void validateLevelConfig(LevelConfigUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "等级配置不能为空"));
        } else {
            if (request.minLevel() == null) {
                issues.add(fieldIssue("minLevel", "REQUIRED", "最小等级不能为空"));
            } else if (request.minLevel() < 1 || request.minLevel() > 100) {
                issues.add(fieldIssue("minLevel", "RANGE_INVALID", "最小等级必须在1到100之间"));
            }
            if (request.maxLevel() == null) {
                issues.add(fieldIssue("maxLevel", "REQUIRED", "最大等级不能为空"));
            } else if (request.maxLevel() < 1 || request.maxLevel() > 100) {
                issues.add(fieldIssue("maxLevel", "RANGE_INVALID", "最大等级必须在1到100之间"));
            }
            if (request.minLevel() != null && request.maxLevel() != null
                && request.maxLevel() < request.minLevel()) {
                issues.add(fieldIssue("maxLevel", "RANGE_INVALID", "最大等级不能小于最小等级"));
            }
        }
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "等级配置不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static void validateUpdateRequest(CharacterUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "角色信息不能为空"));
        } else {
            if (request.characterKey() != null) {
                issues.add(fieldIssue("characterKey", "IMMUTABLE", "角色标识不能修改"));
            }
            validateEditable(request.name(), request.description(), issues);
        }
        throwIfInvalid(issues);
    }

    private static void validateEditable(
        String name,
        String description,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "角色名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "角色名称不能超过100个字符"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "说明不能超过2000个字符"));
        }
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "角色信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException levelValuesInvalid(String field, String code, String message) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.LEVEL_VALUES_INVALID",
            "等级属性格式不合法",
            Map.of("fieldIssues", List.of(fieldIssue(field, code, message)))
        );
    }

    private static ApiException unknownAttribute(String level, String attributeKey) {
        String field = "/levelValues/" + level + "/" + attributeKey;
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.UNKNOWN_ATTRIBUTE",
            "存在未定义的属性",
            Map.of("fieldIssues", List.of(fieldIssue(field, "UNKNOWN_ATTRIBUTE", "属性未定义")))
        );
    }

    private static ApiException characterNotFound(String characterKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.CHARACTER_NOT_FOUND",
            "角色不存在",
            Map.of("characterKey", characterKey == null ? "" : characterKey)
        );
    }

    private static ApiException gameNotFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", gameId == null ? "" : gameId)
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

    private static ApiException inconsistentFirstLevelConfig(String gameId) {
        return new ApiException(
            HttpStatus.CONFLICT,
            "409.LEVEL_CONFIG_REQUIRED",
            "首次配置等级范围前不能已有角色等级属性或角色等级参数",
            Map.of("gameId", gameId)
        );
    }

    private static ApiException characterKeyExists() {
        return conflict("409.CHARACTER_KEY_EXISTS", "角色标识已存在", "characterKey");
    }

    private static ApiException characterNameExists() {
        return conflict("409.CHARACTER_NAME_EXISTS", "角色名称已存在", "name");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of("fieldIssues", List.of(fieldIssue(field, "ALREADY_EXISTS", message)))
        );
    }

    private static RuntimeException mapUniqueConstraint(DataIntegrityViolationException ex) {
        String constraintText = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (constraintText.contains(PRIMARY_KEY_CONSTRAINT)) {
            return characterKeyExists();
        }
        if (constraintText.contains(NAME_UNIQUE_CONSTRAINT)) {
            return characterNameExists();
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
}
