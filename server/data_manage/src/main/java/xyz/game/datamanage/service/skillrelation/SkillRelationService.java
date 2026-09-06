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
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.SkillRelationMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationListResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class SkillRelationService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");

    private final GamesMapper gamesMapper;
    private final CharacterMapper characterMapper;
    private final EquipmentMapper equipmentMapper;
    private final SkillMapper skillMapper;
    private final SkillRelationMapper mapper;

    public SkillRelationService(
        GamesMapper gamesMapper,
        CharacterMapper characterMapper,
        EquipmentMapper equipmentMapper,
        SkillMapper skillMapper,
        SkillRelationMapper mapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.characterMapper = characterMapper;
        this.equipmentMapper = equipmentMapper;
        this.skillMapper = skillMapper;
        this.mapper = mapper;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public CharacterSkillRelationListResponse listCharacterRelations(
        String gameId, String characterKey, String skillKey
    ) {
        requireGame(gameId);
        characterKey = normalizeFilter(characterKey);
        skillKey = normalizeFilter(skillKey);
        validateFilters("characterKey", characterKey, skillKey);
        if (characterKey != null) {
            requireCharacter(gameId, characterKey, false);
        }
        if (skillKey != null) {
            requireSkill(gameId, skillKey, false);
        }
        List<CharacterSkillRelationResponse> rows = mapper.listCharacterRelations(gameId, characterKey, skillKey);
        List<CharacterSkillRelationResponse> items = rows == null ? List.of() : rows;
        return new CharacterSkillRelationListResponse(items, items.size());
    }

    @Transactional
    public CharacterSkillRelationResponse createCharacterRelation(
        String gameId, CharacterSkillRelationCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite(
            "characterKey", request.characterKey(), request.skillKey(), request.sortOrder(), request.unknownFields()
        );
        requireCharacter(gameId, request.characterKey(), true);
        SkillRow skill = requireSkill(gameId, request.skillKey(), true);
        if (mapper.findCharacterRelation(gameId, request.characterKey(), request.skillKey()) != null) {
            throw relationExists();
        }
        requireEnabled(skill);
        if (mapper.insertCharacterRelation(gameId, request.characterKey(), request.skillKey(), sortOrder) == 0) {
            throw relationExists();
        }
        return requireCharacterRelation(gameId, request.characterKey(), request.skillKey());
    }

    @Transactional
    public CharacterSkillRelationResponse updateCharacterRelation(
        String gameId, String characterKey, String skillKey, SkillRelationUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite("characterKey", characterKey, skillKey, request.sortOrder(), request.unknownFields());
        requireCharacter(gameId, characterKey, true);
        requireSkill(gameId, skillKey, true);
        if (mapper.updateCharacterRelation(gameId, characterKey, skillKey, sortOrder) == 0) {
            throw relationNotFound();
        }
        return requireCharacterRelation(gameId, characterKey, skillKey);
    }

    @Transactional
    public void deleteCharacterRelation(String gameId, String characterKey, String skillKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateKeys("characterKey", characterKey, skillKey);
        requireCharacter(gameId, characterKey, true);
        requireSkill(gameId, skillKey, true);
        if (mapper.deleteCharacterRelation(gameId, characterKey, skillKey) == 0) {
            throw relationNotFound();
        }
    }

    private CharacterSkillRelationResponse requireCharacterRelation(String gameId, String characterKey, String skillKey) {
        CharacterSkillRelationResponse relation = mapper.findCharacterRelation(gameId, characterKey, skillKey);
        if (relation == null) {
            throw relationNotFound();
        }
        return relation;
    }

    private void requireCharacter(String gameId, String key, boolean lock) {
        Object source = lock
            ? characterMapper.findByIdForUpdate(gameId, key)
            : characterMapper.findById(gameId, key);
        if (source == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.CHARACTER_NOT_FOUND", "角色不存在", Map.of("characterKey", key));
        }
    }

    @Transactional(readOnly = true)
    public EquipmentSkillRelationListResponse listEquipmentRelations(
        String gameId, String equipmentKey, String skillKey
    ) {
        requireGame(gameId);
        equipmentKey = normalizeFilter(equipmentKey);
        skillKey = normalizeFilter(skillKey);
        validateFilters("equipmentKey", equipmentKey, skillKey);
        if (equipmentKey != null) {
            requireEquipment(gameId, equipmentKey, false);
        }
        if (skillKey != null) {
            requireSkill(gameId, skillKey, false);
        }
        List<EquipmentSkillRelationResponse> rows = mapper.listEquipmentRelations(gameId, equipmentKey, skillKey);
        List<EquipmentSkillRelationResponse> items = rows == null ? List.of() : rows;
        return new EquipmentSkillRelationListResponse(items, items.size());
    }

    @Transactional
    public EquipmentSkillRelationResponse createEquipmentRelation(
        String gameId, EquipmentSkillRelationCreateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite(
            "equipmentKey", request.equipmentKey(), request.skillKey(), request.sortOrder(), request.unknownFields()
        );
        requireEquipment(gameId, request.equipmentKey(), true);
        SkillRow skill = requireSkill(gameId, request.skillKey(), true);
        if (mapper.findEquipmentRelation(gameId, request.equipmentKey(), request.skillKey()) != null) {
            throw relationExists();
        }
        requireEnabled(skill);
        if (mapper.insertEquipmentRelation(gameId, request.equipmentKey(), request.skillKey(), sortOrder) == 0) {
            throw relationExists();
        }
        return requireEquipmentRelation(gameId, request.equipmentKey(), request.skillKey());
    }

    @Transactional
    public EquipmentSkillRelationResponse updateEquipmentRelation(
        String gameId, String equipmentKey, String skillKey, SkillRelationUpdateRequest request
    ) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        requireRequest(request);
        int sortOrder = validateWrite("equipmentKey", equipmentKey, skillKey, request.sortOrder(), request.unknownFields());
        requireEquipment(gameId, equipmentKey, true);
        requireSkill(gameId, skillKey, true);
        if (mapper.updateEquipmentRelation(gameId, equipmentKey, skillKey, sortOrder) == 0) {
            throw relationNotFound();
        }
        return requireEquipmentRelation(gameId, equipmentKey, skillKey);
    }

    @Transactional
    public void deleteEquipmentRelation(String gameId, String equipmentKey, String skillKey) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateKeys("equipmentKey", equipmentKey, skillKey);
        requireEquipment(gameId, equipmentKey, true);
        requireSkill(gameId, skillKey, true);
        if (mapper.deleteEquipmentRelation(gameId, equipmentKey, skillKey) == 0) {
            throw relationNotFound();
        }
    }

    private EquipmentSkillRelationResponse requireEquipmentRelation(String gameId, String equipmentKey, String skillKey) {
        EquipmentSkillRelationResponse relation = mapper.findEquipmentRelation(gameId, equipmentKey, skillKey);
        if (relation == null) {
            throw relationNotFound();
        }
        return relation;
    }

    private void requireEquipment(String gameId, String key, boolean lock) {
        Object source = lock
            ? equipmentMapper.findByIdForUpdate(gameId, key)
            : equipmentMapper.findById(gameId, key);
        if (source == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.EQUIPMENT_NOT_FOUND", "装备不存在", Map.of("equipmentKey", key));
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
