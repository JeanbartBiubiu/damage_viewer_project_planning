package xyz.game.datamanage.service.skillrelation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.RuneRelationMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class RuneRelationService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

    private final GamesMapper gamesMapper;
    private final RuneMapper runeMapper;
    private final SkillMapper skillMapper;
    private final RuneRelationMapper mapper;

    public RuneRelationService(
        GamesMapper gamesMapper,
        RuneMapper runeMapper,
        SkillMapper skillMapper,
        RuneRelationMapper mapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.runeMapper = runeMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public RuneSkillRelationListResponse listRuneRelations(
        String gameId, String runeKey, String skillKey
    ) {
        requireGame(gameId);
        runeKey = normalizeFilter(runeKey);
        skillKey = normalizeFilter(skillKey);
        validateFilters("runeKey", runeKey, skillKey);
        if (runeKey != null) {
            requireRune(gameId, runeKey);
        }
        if (skillKey != null) {
            requireSkill(gameId, skillKey, false);
        }
        List<RuneSkillRelationResponse> rows = mapper.listRuneRelations(gameId, runeKey, skillKey);
        List<RuneSkillRelationResponse> items = rows == null ? List.of() : rows;
        return new RuneSkillRelationListResponse(items, items.size());
    }

    @Transactional
    public RuneSkillRelationResponse createRuneRelation(
        String gameId, RuneSkillRelationCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite(
            "runeKey", request.runeKey(), request.skillKey(), request.sortOrder(), request.unknownFields()
        );
        requireRune(gameId, request.runeKey());
        SkillRow skill = requireSkill(gameId, request.skillKey(), true);
        if (mapper.findRuneRelation(gameId, request.runeKey(), request.skillKey()) != null) {
            throw relationExists();
        }
        requireEnabled(skill);
        if (mapper.insertRuneRelation(gameId, request.runeKey(), request.skillKey(), sortOrder) == 0) {
            throw relationExists();
        }
        return requireRuneRelation(gameId, request.runeKey(), request.skillKey());
    }

    @Transactional
    public RuneSkillRelationResponse updateRuneRelation(
        String gameId, String runeKey, String skillKey, SkillRelationUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite("runeKey", runeKey, skillKey, request.sortOrder(), request.unknownFields());
        requireRune(gameId, runeKey);
        requireSkill(gameId, skillKey, true);
        if (mapper.updateRuneRelation(gameId, runeKey, skillKey, sortOrder) == 0) {
            throw relationNotFound();
        }
        return requireRuneRelation(gameId, runeKey, skillKey);
    }

    @Transactional
    public void deleteRuneRelation(String gameId, String runeKey, String skillKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateKeys("runeKey", runeKey, skillKey);
        requireRune(gameId, runeKey);
        requireSkill(gameId, skillKey, true);
        if (mapper.deleteRuneRelation(gameId, runeKey, skillKey) == 0) {
            throw relationNotFound();
        }
    }

    private RuneSkillRelationResponse requireRuneRelation(String gameId, String runeKey, String skillKey) {
        RuneSkillRelationResponse relation = mapper.findRuneRelation(gameId, runeKey, skillKey);
        if (relation == null) {
            throw relationNotFound();
        }
        return relation;
    }

    private void requireRune(String gameId, String key) {
        Object source = runeMapper.findRune(gameId, key);
        if (source == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.RUNE_NOT_FOUND", "符文不存在", Map.of("runeKey", key));
        }
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(
                HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId)
            );
        }
    }

    private SkillRow requireSkill(String gameId, String key, boolean lock) {
        SkillRow skill = lock ? skillMapper.findByIdForUpdate(gameId, key) : skillMapper.findById(gameId, key);
        if (skill == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.SKILL_NOT_FOUND", "技能不存在", Map.of("skillKey", key));
        }
        return skill;
    }

    private static void requireEnabled(SkillRow skill) {
        if (skill.status() != SkillStatus.ENABLED) {
            throw new ApiException(
                HttpStatus.CONFLICT, "409.REFERENCE_DISABLED", "技能已停用，不能新增挂载",
                Map.of("fieldIssues", List.of(fieldIssue("skillKey", "CONFLICT", "技能已停用，不能新增挂载")))
            );
        }
    }

    private static String normalizeFilter(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static void validateFilters(String field, String sourceKey, String skillKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (sourceKey == null && skillKey == null) {
            issues.add(fieldIssue(field, "REQUIRED", "所属对象标识和技能标识至少填写一个"));
            issues.add(fieldIssue("skillKey", "REQUIRED", "所属对象标识和技能标识至少填写一个"));
        }
        if (sourceKey != null) {
            validateKey(field, sourceKey, issues);
        }
        if (skillKey != null) {
            validateKey("skillKey", skillKey, issues);
        }
        throwIfInvalid(issues);
    }

    private static void validateKeys(String field, String sourceKey, String skillKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        validateKey(field, sourceKey, issues);
        validateKey("skillKey", skillKey, issues);
        throwIfInvalid(issues);
    }

    private static int validateWrite(
        String field, String sourceKey, String skillKey, JsonNode sortOrder, Set<String> unknownFields
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        validateKey(field, sourceKey, issues);
        validateKey("skillKey", skillKey, issues);
        if (sortOrder == null || sortOrder.isNull()) {
            issues.add(fieldIssue("sortOrder", "REQUIRED", "排序不能为空"));
        } else if (!sortOrder.isIntegralNumber() || !sortOrder.canConvertToInt() || sortOrder.intValue() < 0) {
            issues.add(fieldIssue("sortOrder", "RANGE_INVALID", "排序必须是 0 到 2147483647 的整数"));
        }
        if (unknownFields != null) {
            unknownFields.stream().sorted().forEach(
                key -> issues.add(fieldIssue(key, "UNKNOWN_FIELD", "请求不支持此字段"))
            );
        }
        throwIfInvalid(issues);
        return sortOrder.intValue();
    }

    private static void requireRequest(Object request) {
        if (request == null) {
            throwIfInvalid(List.of(fieldIssue("request", "REQUIRED", "挂载信息不能为空")));
        }
    }

    private static void validateKey(String field, String key, List<Map<String, String>> issues) {
        if (key == null || key.isBlank()) {
            issues.add(fieldIssue(field, "REQUIRED", "标识不能为空"));
        } else if (!KEY_PATTERN.matcher(key).matches()) {
            issues.add(fieldIssue(field, "FORMAT_INVALID", "标识格式不合法"));
        }
    }

    private static void throwIfInvalid(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "技能挂载信息不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException relationExists() {
        return new ApiException(HttpStatus.CONFLICT, "409.RELATION_EXISTS", "技能挂载已存在");
    }

    private static ApiException relationNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "404.RELATION_NOT_FOUND", "技能挂载不存在");
    }
}
