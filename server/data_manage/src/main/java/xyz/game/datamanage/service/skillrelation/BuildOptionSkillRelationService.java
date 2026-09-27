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
import xyz.game.datamanage.mapper.build.BuildSystemMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.BuildOptionSkillRelationMapper;
import xyz.game.datamanage.model.build.BuildOptionRow;
import xyz.game.datamanage.model.build.BuildSystemRow;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class BuildOptionSkillRelationService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> CREATE_FIELDS = Set.of(
        "systemKey", "optionKey", "skillKey", "activationRank", "skillLevelMode", "fixedSkillLevel", "sortOrder");
    private static final Set<String> UPDATE_FIELDS = Set.of(
        "activationRank", "skillLevelMode", "fixedSkillLevel", "sortOrder");

    private final GamesMapper games;
    private final BuildSystemMapper builds;
    private final SkillMapper skills;
    private final BuildOptionSkillRelationMapper mapper;
    private final GameConfigurationWriteGuard writes;

    public BuildOptionSkillRelationService(
        GamesMapper games, BuildSystemMapper builds, SkillMapper skills, BuildOptionSkillRelationMapper mapper,
        GameConfigurationWriteGuard writes
    ) {
        this.games = games;
        this.builds = builds;
        this.skills = skills;
        this.mapper = mapper;
        this.writes = java.util.Objects.requireNonNull(writes);
    }

    @Transactional(readOnly = true)
    public BuildOptionSkillRelationListResponse list(String gameId, String systemKey, String optionKey, String skillKey) {
        requireGame(gameId);
        systemKey = blankToNull(systemKey);
        optionKey = blankToNull(optionKey);
        skillKey = blankToNull(skillKey);
        requireScope(systemKey, optionKey, skillKey);
        if (systemKey != null) {
            requireSystem(gameId, systemKey);
            requireOption(gameId, systemKey, optionKey);
        }
        if (skillKey != null) {
            requireSkill(gameId, skillKey, false);
        }
        List<BuildOptionSkillRelationResponse> items = safe(mapper.listRelations(gameId, systemKey, optionKey, skillKey));
        return new BuildOptionSkillRelationListResponse(items, items.size());
    }

    @Transactional
    public BuildOptionSkillRelationResponse create(String gameId, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        requireObject(body);
        rejectUnknown(body, CREATE_FIELDS);
        String systemKey = key(body.get("systemKey"), "systemKey");
        String optionKey = key(body.get("optionKey"), "optionKey");
        String skillKey = key(body.get("skillKey"), "skillKey");
        BuildSystemRow system = requireSystem(gameId, systemKey);
        BuildOptionRow option = requireOption(gameId, systemKey, optionKey);
        SkillRow skill = requireSkill(gameId, skillKey, true);
        Grant grant = parseGrant(body, system.configurationMode(), option.maxRank(), skill.maxLevel());
        if (skill.status() != SkillStatus.ENABLED) {
            throw new ApiException(HttpStatus.CONFLICT, "409.REFERENCE_DISABLED", "技能已停用，不能新增挂载",
                Map.of("fieldIssues", List.of(issue("skillKey", "CONFLICT", "技能已停用，不能新增挂载"))));
        }
        if (mapper.findRelation(gameId, systemKey, optionKey, skillKey) != null) {
            throw relationExists();
        }
        if (mapper.insertRelation(gameId, systemKey, optionKey, skillKey, grant.activationRank(),
            grant.skillLevelMode(), grant.fixedSkillLevel(), grant.sortOrder()) == 0) {
            throw relationExists();
        }
        return requireRelation(gameId, systemKey, optionKey, skillKey);
    }

    @Transactional
    public BuildOptionSkillRelationResponse update(
        String gameId, String systemKey, String optionKey, String skillKey, JsonNode body
    ) {
        writes.begin(gameId);
        requireGame(gameId);
        requireObject(body);
        rejectUnknown(body, UPDATE_FIELDS);
        systemKey = key(textNode(systemKey), "systemKey");
        optionKey = key(textNode(optionKey), "optionKey");
        skillKey = key(textNode(skillKey), "skillKey");
        BuildSystemRow system = requireSystem(gameId, systemKey);
        BuildOptionRow option = requireOption(gameId, systemKey, optionKey);
        SkillRow skill = requireSkill(gameId, skillKey, true);
        BuildOptionSkillRelationResponse current = requireRelation(gameId, systemKey, optionKey, skillKey);
        Grant grant = parseGrant(body, system.configurationMode(), option.maxRank(), skill.maxLevel());
        if (skill.status() != SkillStatus.ENABLED && (
            grant.activationRank() != current.activationRank()
                || !grant.skillLevelMode().equals(current.skillLevelMode())
                || !java.util.Objects.equals(grant.fixedSkillLevel(), current.fixedSkillLevel())
        )) {
            throw new ApiException(HttpStatus.CONFLICT, "409.REFERENCE_DISABLED",
                "技能已停用，只能调整既有授予排序或解绑",
                Map.of("fieldIssues", List.of(issue("skillKey", "CONFLICT", "技能已停用，只能调整既有授予排序或解绑"))));
        }
        if (mapper.updateRelation(gameId, systemKey, optionKey, skillKey, grant.activationRank(),
            grant.skillLevelMode(), grant.fixedSkillLevel(), grant.sortOrder()) == 0) {
            throw relationNotFound();
        }
        return requireRelation(gameId, systemKey, optionKey, skillKey);
    }

    @Transactional
    public void delete(String gameId, String systemKey, String optionKey, String skillKey) {
        writes.begin(gameId);
        requireGame(gameId);
        systemKey = key(textNode(systemKey), "systemKey");
        optionKey = key(textNode(optionKey), "optionKey");
        skillKey = key(textNode(skillKey), "skillKey");
        requireSystem(gameId, systemKey);
        requireOption(gameId, systemKey, optionKey);
        requireSkill(gameId, skillKey, true);
        if (mapper.deleteRelation(gameId, systemKey, optionKey, skillKey) == 0) {
            throw relationNotFound();
        }
    }

    private Grant parseGrant(JsonNode body, String mode, Integer maxRank, Integer skillMaxLevel) {
        List<Map<String, String>> issues = new ArrayList<>();
        int activationRank = integer(body.get("activationRank"), "activationRank", 1, issues);
        int sortOrder = integer(body.get("sortOrder"), "sortOrder", 0, issues);
        String levelMode = text(body.get("skillLevelMode"), "skillLevelMode", issues);
        if (levelMode != null && !"FIXED".equals(levelMode) && !"SAME_AS_OPTION".equals(levelMode)) {
            issues.add(issue("skillLevelMode", "ENUM_INVALID", "技能等级方式不合法"));
        }
        if ("SLOT_SELECTION".equals(mode) && "SAME_AS_OPTION".equals(levelMode)) {
            issues.add(issue("skillLevelMode", "ENUM_INVALID", "按位置选择只接受固定技能等级"));
        }
        Integer fixed = null;
        JsonNode rawFixed = body.get("fixedSkillLevel");
        if ("FIXED".equals(levelMode)) {
            if (rawFixed == null || rawFixed.isNull() || !rawFixed.isIntegralNumber() || !rawFixed.canConvertToInt()
                || rawFixed.intValue() < 1) {
                issues.add(issue("fixedSkillLevel", "RANGE_INVALID", "固定技能等级必须是大于等于 1 的整数"));
            } else if (skillMaxLevel != null && rawFixed.intValue() > skillMaxLevel) {
                issues.add(issue("fixedSkillLevel", "RANGE_INVALID", "固定技能等级不能超过技能最高等级"));
            } else {
                fixed = rawFixed.intValue();
            }
        } else if ("SAME_AS_OPTION".equals(levelMode)) {
            if (rawFixed == null || !rawFixed.isNull()) {
                issues.add(issue("fixedSkillLevel", "NULL_REQUIRED", "随投入等级时固定技能等级必须为空"));
            }
            if (maxRank != null && skillMaxLevel != null && maxRank > skillMaxLevel) {
                issues.add(issue("optionKey", "RANGE_INVALID", "可选项最高等级不能超过技能最高等级"));
            }
        }
        if (maxRank != null && body.get("activationRank") != null && body.get("activationRank").isIntegralNumber()
            && body.get("activationRank").canConvertToInt() && body.get("activationRank").intValue() > maxRank) {
            issues.add(issue("activationRank", "RANGE_INVALID", "授予等级不能超过可选项最高等级"));
        }
        if (!issues.isEmpty()) {
            throw invalid(issues);
        }
        return new Grant(activationRank, levelMode, fixed, sortOrder);
    }

    private BuildOptionSkillRelationResponse requireRelation(
        String gameId, String systemKey, String optionKey, String skillKey
    ) {
        BuildOptionSkillRelationResponse relation = mapper.findRelation(gameId, systemKey, optionKey, skillKey);
        if (relation == null) {
            throw relationNotFound();
        }
        return relation;
    }

    private BuildSystemRow requireSystem(String gameId, String systemKey) {
        BuildSystemRow system = builds.findSystem(gameId, systemKey);
        if (system == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.BUILD_SYSTEM_NOT_FOUND", "构筑系统不存在",
                Map.of("systemKey", systemKey == null ? "" : systemKey));
        }
        return system;
    }

    private BuildOptionRow requireOption(String gameId, String systemKey, String optionKey) {
        BuildOptionRow option = builds.findOption(gameId, systemKey, optionKey);
        if (option == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.BUILD_OPTION_NOT_FOUND", "构筑可选项不存在",
                Map.of("optionKey", optionKey == null ? "" : optionKey));
        }
        return option;
    }

    private SkillRow requireSkill(String gameId, String skillKey, boolean lock) {
        SkillRow skill = lock ? skills.findByIdForUpdate(gameId, skillKey) : skills.findById(gameId, skillKey);
        if (skill == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.SKILL_NOT_FOUND", "技能不存在", Map.of("skillKey", skillKey));
        }
        return skill;
    }

    private void requireGame(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId));
        }
    }

    private static void requireScope(String systemKey, String optionKey, String skillKey) {
        List<Map<String, String>> issues = new ArrayList<>();
        boolean pair = systemKey != null || optionKey != null;
        if (skillKey == null && (systemKey == null || optionKey == null)) {
            issues.add(issue("systemKey", "REQUIRED", "请提供技能标识，或同时提供系统标识和可选项标识"));
            issues.add(issue("optionKey", "REQUIRED", "请提供技能标识，或同时提供系统标识和可选项标识"));
            if (skillKey == null) {
                issues.add(issue("skillKey", "REQUIRED", "请提供技能标识，或同时提供系统标识和可选项标识"));
            }
        }
        if (pair && systemKey == null) {
            issues.add(issue("systemKey", "REQUIRED", "查询可选项时必须同时提供系统标识"));
        }
        if (pair && optionKey == null) {
            issues.add(issue("optionKey", "REQUIRED", "查询系统时必须同时提供可选项标识"));
        }
        if (systemKey != null) {
            validateKey(systemKey, "systemKey", issues);
        }
        if (optionKey != null) {
            validateKey(optionKey, "optionKey", issues);
        }
        if (skillKey != null) {
            validateKey(skillKey, "skillKey", issues);
        }
        if (!issues.isEmpty()) {
            throw invalid(issues);
        }
    }

    private static void requireObject(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid(List.of(issue("request", "OBJECT_REQUIRED", "必须提供完整对象")));
        }
    }

    private static void rejectUnknown(JsonNode body, Set<String> allowed) {
        List<Map<String, String>> issues = new ArrayList<>();
        List<String> names = new ArrayList<>();
        body.fieldNames().forEachRemaining(names::add);
        names.sort(String::compareTo);
        for (String name : names) {
            if (!allowed.contains(name)) {
                issues.add(issue(name, "UNKNOWN_FIELD", "请求不支持此字段"));
            }
        }
        if (!issues.isEmpty()) {
            throw invalid(issues);
        }
    }

    private static String key(JsonNode value, String field) {
        List<Map<String, String>> issues = new ArrayList<>();
        String result = text(value, field, issues);
        if (result != null) {
            validateKey(result, field, issues);
        }
        if (!issues.isEmpty()) {
            throw invalid(issues);
        }
        return result;
    }

    private static JsonNode textNode(String value) {
        return com.fasterxml.jackson.databind.node.TextNode.valueOf(value == null ? "" : value);
    }

    private static String text(JsonNode value, String field, List<Map<String, String>> issues) {
        if (value == null || value.isNull() || !value.isTextual() || value.textValue().isBlank()) {
            issues.add(issue(field, "REQUIRED", "标识不能为空"));
            return null;
        }
        return value.textValue().trim();
    }

    private static int integer(JsonNode value, String field, int minimum, List<Map<String, String>> issues) {
        if (value == null || value.isNull() || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < minimum) {
            issues.add(issue(field, "RANGE_INVALID", "必须是大于等于 " + minimum + " 的整数"));
            return minimum;
        }
        return value.intValue();
    }

    private static void validateKey(String key, String field, List<Map<String, String>> issues) {
        if (key == null || !KEY.matcher(key).matches()) {
            issues.add(issue(field, "FORMAT_INVALID", "标识格式不合法"));
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static List<BuildOptionSkillRelationResponse> safe(List<BuildOptionSkillRelationResponse> values) {
        return values == null ? List.of() : List.copyOf(values);
    }

    private static ApiException invalid(List<Map<String, String>> issues) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "技能授予信息不合法",
            Map.of("fieldIssues", List.copyOf(issues)));
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }

    private static ApiException relationExists() {
        return new ApiException(HttpStatus.CONFLICT, "409.RELATION_EXISTS", "技能授予已存在");
    }

    private static ApiException relationNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "404.RELATION_NOT_FOUND", "技能授予不存在");
    }

    private record Grant(int activationRank, String skillLevelMode, Integer fixedSkillLevel, int sortOrder) {}
}
