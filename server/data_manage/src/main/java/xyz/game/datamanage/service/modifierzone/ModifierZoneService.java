package xyz.game.datamanage.service.modifierzone;

import jakarta.validation.Valid;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.modifierzone.ModifierZoneMapper;
import xyz.game.datamanage.model.modifierzone.ModifierZoneApplicationStage;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCalculationMode;
import xyz.game.datamanage.model.modifierzone.ModifierZoneCreateRequest;
import xyz.game.datamanage.model.modifierzone.ModifierZoneDomain;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListQuery;
import xyz.game.datamanage.model.modifierzone.ModifierZoneListResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneResponse;
import xyz.game.datamanage.model.modifierzone.ModifierZoneStatus;
import xyz.game.datamanage.model.modifierzone.ModifierZoneUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class ModifierZoneService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_modifier_zones";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_modifier_zones_name";

    private final GamesMapper gamesMapper;
    private final ModifierZoneMapper mapper;

    public ModifierZoneService(GamesMapper gamesMapper, ModifierZoneMapper mapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public ModifierZoneListResponse list(String gameId, @Valid ModifierZoneListQuery query) {
        requireGame(gameId);
        ModifierZoneListQuery normalized = query == null
            ? new ModifierZoneListQuery(null, null, null)
            : query;
        List<Map<String, String>> issues = new ArrayList<>();
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            issues.add(fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符"));
        }
        String domain = normalizeEnum(
            normalized.domain(),
            ModifierZoneDomain.class,
            "domain",
            "作用域只允许 ATTRIBUTE、DAMAGE 或 HEALING",
            issues
        );
        String status = normalizeEnum(
            normalized.status(),
            ModifierZoneStatus.class,
            "status",
            "状态只允许 ENABLED 或 DISABLED",
            issues
        );
        throwIfInvalid(issues);
        List<ModifierZoneResponse> items = mapper.list(gameId, normalized.keyword(), domain, status);
        List<ModifierZoneResponse> safeItems = items == null ? List.of() : items;
        return new ModifierZoneListResponse(safeItems, safeItems.size());
    }

    @Transactional(readOnly = true)
    public ModifierZoneResponse get(String gameId, String modifierZoneKey) {
        requireGame(gameId);
        return requireModifierZone(gameId, modifierZoneKey);
    }

    @Transactional
    public ModifierZoneResponse create(String gameId, @Valid ModifierZoneCreateRequest request) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateCreate(request);
        if (mapper.countByKey(gameId, request.modifierZoneKey()) > 0) {
            throw keyExists();
        }
        if (mapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw nameExists();
        }
        try {
            mapper.insert(
                gameId,
                request.modifierZoneKey(),
                request.name(),
                request.domain().name(),
                request.calculationMode().name(),
                request.applicationStage().name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireModifierZone(gameId, request.modifierZoneKey());
    }

    @Transactional
    public ModifierZoneResponse update(
        String gameId,
        String modifierZoneKey,
        @Valid ModifierZoneUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateUpdate(request);
        ModifierZoneResponse current = mapper.findByIdForUpdate(gameId, modifierZoneKey);
        if (current == null) {
            throw notFound(modifierZoneKey);
        }
        if (structuralFieldsChanged(current, request) && referenceCount(gameId, modifierZoneKey) > 0) {
            throw inUse("乘区已被结果引用，不能修改作用域、计算方式或应用阶段");
        }
        if (mapper.countByNormalizedName(gameId, request.name(), modifierZoneKey) > 0) {
            throw nameExists();
        }
        try {
            if (mapper.update(
                gameId,
                modifierZoneKey,
                request.name(),
                request.domain().name(),
                request.calculationMode().name(),
                request.applicationStage().name(),
                request.description(),
                request.status().name(),
                request.sortOrder()
            ) == 0) {
                throw notFound(modifierZoneKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireModifierZone(gameId, modifierZoneKey);
    }

    @Transactional
    public void delete(String gameId, String modifierZoneKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        if (mapper.findByIdForUpdate(gameId, modifierZoneKey) == null) {
            throw notFound(modifierZoneKey);
        }
        if (referenceCount(gameId, modifierZoneKey) > 0) {
            throw inUse("乘区已被结果引用，不能删除");
        }
        try {
            if (mapper.delete(gameId, modifierZoneKey) == 0) {
                throw notFound(modifierZoneKey);
            }
        } catch (DataIntegrityViolationException ex) {
            if (hasSqlState(ex, "23503")) {
                throw inUse("乘区已被结果引用，不能删除");
            }
            throw ex;
        }
    }

    private long referenceCount(String gameId, String modifierZoneKey) {
        return mapper.countAttributeReferences(gameId, modifierZoneKey)
            + mapper.countDamageReferences(gameId, modifierZoneKey)
            + mapper.countHealingReferences(gameId, modifierZoneKey);
    }

    private static boolean structuralFieldsChanged(
        ModifierZoneResponse current,
        ModifierZoneUpdateRequest request
    ) {
        return current.domain() != request.domain()
            || current.calculationMode() != request.calculationMode()
            || current.applicationStage() != request.applicationStage();
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(
                HttpStatus.NOT_FOUND,
                "404.GAME_NOT_FOUND",
                "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId)
            );
        }
    }

    private ModifierZoneResponse requireModifierZone(String gameId, String modifierZoneKey) {
        ModifierZoneResponse response = mapper.findById(gameId, modifierZoneKey);
        if (response == null) {
            throw notFound(modifierZoneKey);
        }
        return response;
    }

    private static void validateCreate(ModifierZoneCreateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "乘区信息不能为空"));
        } else {
            validateKey(request.modifierZoneKey(), issues);
            validateEditable(
                request.name(),
                request.domain(),
                request.calculationMode(),
                request.applicationStage(),
                request.description(),
                request.status(),
                request.sortOrder(),
                issues
            );
        }
        throwIfInvalid(issues);
    }

    private static void validateUpdate(ModifierZoneUpdateRequest request) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (request == null) {
            issues.add(fieldIssue("request", "REQUIRED", "乘区信息不能为空"));
        } else {
            if (request.modifierZoneKey() != null) {
                issues.add(fieldIssue("modifierZoneKey", "IMMUTABLE", "乘区标识不能修改"));
            }
            validateEditable(
                request.name(),
                request.domain(),
                request.calculationMode(),
                request.applicationStage(),
                request.description(),
                request.status(),
                request.sortOrder(),
                issues
            );
        }
        throwIfInvalid(issues);
    }

    private static void validateKey(String key, List<Map<String, String>> issues) {
        if (key == null || key.isBlank()) {
            issues.add(fieldIssue("modifierZoneKey", "REQUIRED", "乘区标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue("modifierZoneKey", "FORMAT_INVALID", "乘区标识格式不合法"));
        }
    }

    private static void validateEditable(
        String name,
        ModifierZoneDomain domain,
        ModifierZoneCalculationMode calculationMode,
        ModifierZoneApplicationStage applicationStage,
        String description,
        ModifierZoneStatus status,
        Integer sortOrder,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "乘区名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "乘区名称不能超过100个字符"));
        }
        if (domain == null) {
            issues.add(fieldIssue("domain", "REQUIRED", "作用域不能为空"));
        }
        if (calculationMode == null) {
            issues.add(fieldIssue("calculationMode", "REQUIRED", "计算方式不能为空"));
        }
        if (applicationStage == null) {
            issues.add(fieldIssue("applicationStage", "REQUIRED", "应用阶段不能为空"));
        }
        if (domain != null && calculationMode != null && applicationStage != null
            && !validCombination(domain, calculationMode, applicationStage)) {
            issues.add(fieldIssue("applicationStage", "COMBINATION_INVALID", "作用域、计算方式和应用阶段组合不合法"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "说明不能超过2000个字符"));
        }
        if (status == null) {
            issues.add(fieldIssue("status", "REQUIRED", "状态不能为空"));
        }
        if (sortOrder == null) {
            issues.add(fieldIssue("sortOrder", "REQUIRED", "排序不能为空"));
        } else if (sortOrder < 0) {
            issues.add(fieldIssue("sortOrder", "RANGE_INVALID", "排序不能小于0"));
        }
    }

    private static boolean validCombination(
        ModifierZoneDomain domain,
        ModifierZoneCalculationMode mode,
        ModifierZoneApplicationStage stage
    ) {
        return (domain == ModifierZoneDomain.ATTRIBUTE
                && mode == ModifierZoneCalculationMode.FLAT_ADD
                && stage == ModifierZoneApplicationStage.ATTRIBUTE_FLAT)
            || (domain == ModifierZoneDomain.ATTRIBUTE
                && mode == ModifierZoneCalculationMode.RATIO_ADD
                && stage == ModifierZoneApplicationStage.ATTRIBUTE_PERCENT)
            || (domain == ModifierZoneDomain.DAMAGE
                && mode == ModifierZoneCalculationMode.RATIO_ADD
                && (stage == ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE
                    || stage == ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE))
            || (domain == ModifierZoneDomain.HEALING
                && mode == ModifierZoneCalculationMode.RATIO_ADD
                && stage == ModifierZoneApplicationStage.HEALING_RESULT);
    }

    private static <E extends Enum<E>> String normalizeEnum(
        String value,
        Class<E> enumClass,
        String field,
        String message,
        List<Map<String, String>> issues
    ) {
        if (value == null) {
            return null;
        }
        try {
            return Enum.valueOf(enumClass, value).name();
        } catch (IllegalArgumentException ex) {
            issues.add(fieldIssue(field, "ENUM_INVALID", message));
            return null;
        }
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "乘区信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static ApiException notFound(String key) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.MODIFIER_ZONE_NOT_FOUND",
            "乘区不存在",
            Map.of("modifierZoneKey", key == null ? "" : key)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.MODIFIER_ZONE_KEY_EXISTS", "乘区标识已存在", "modifierZoneKey");
    }

    private static ApiException nameExists() {
        return conflict("409.MODIFIER_ZONE_NAME_EXISTS", "乘区名称已存在", "name");
    }

    private static ApiException inUse(String message) {
        return conflict("409.MODIFIER_ZONE_IN_USE", message, "modifierZoneKey");
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
        if (text.contains(NAME_UNIQUE_CONSTRAINT)) {
            return nameExists();
        }
        return ex;
    }

    private static boolean hasSqlState(Throwable throwable, String state) {
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current instanceof SQLException sqlException && state.equals(sqlException.getSQLState())) {
                return true;
            }
        }
        return false;
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
