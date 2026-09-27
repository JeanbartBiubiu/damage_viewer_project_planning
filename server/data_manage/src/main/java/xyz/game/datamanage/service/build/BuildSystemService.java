package xyz.game.datamanage.service.build;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.build.BuildSystemMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.BuildOptionSkillRelationMapper;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
import xyz.game.datamanage.model.build.BuildGroupListResponse;
import xyz.game.datamanage.model.build.BuildGroupResponse;
import xyz.game.datamanage.model.build.BuildGroupRow;
import xyz.game.datamanage.model.build.BuildOptionListResponse;
import xyz.game.datamanage.model.build.BuildOptionResponse;
import xyz.game.datamanage.model.build.BuildOptionRow;
import xyz.game.datamanage.model.build.BuildSlot;
import xyz.game.datamanage.model.build.BuildSystemListResponse;
import xyz.game.datamanage.model.build.BuildSystemResponse;
import xyz.game.datamanage.model.build.BuildSystemResponse.Budget;
import xyz.game.datamanage.model.build.BuildSystemResponse.Exclusion;
import xyz.game.datamanage.model.build.BuildSystemResponse.GroupRole;
import xyz.game.datamanage.model.build.BuildSystemResponse.Prerequisite;
import xyz.game.datamanage.model.build.BuildSystemResponse.SelectionRules;
import xyz.game.datamanage.model.build.BuildSystemResponse.SlotRule;
import xyz.game.datamanage.model.build.BuildSystemRow;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class BuildSystemService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> MODES = Set.of("SLOT_SELECTION", "POINT_ALLOCATION");
    private static final Set<String> BUDGET_SOURCES = Set.of("FIXED", "SCENARIO_INPUT");
    private static final Set<String> SYSTEM_CREATE = Set.of(
        "systemKey", "name", "description", "configurationMode", "sortOrder", "selectionRules");
    private static final Set<String> SYSTEM_UPDATE = Set.of(
        "name", "description", "configurationMode", "sortOrder", "selectionRules");
    private static final Set<String> GROUP_CREATE = Set.of("groupKey", "name", "description", "sortOrder", "slots");
    private static final Set<String> GROUP_UPDATE = Set.of("name", "description", "sortOrder", "slots");
    private static final Set<String> OPTION_CREATE = Set.of("optionKey", "name", "description", "maxRank", "rankCosts");
    private static final Set<String> OPTION_UPDATE = Set.of("name", "description", "maxRank", "rankCosts");
    private static final Set<String> ROLE_FIELDS = Set.of(
        "roleKey", "name", "groupKeys", "minimumGroups", "maximumGroups", "minimumSelectedSlots",
        "maximumSelectedSlots", "distinctFromRoleKeys", "slotRules");
    private static final Set<String> SLOT_FIELDS = Set.of(
        "slotKey", "name", "minimumSelections", "maximumSelections", "optionKeys");
    private static final Set<String> SLOT_RULE_FIELDS = Set.of(
        "groupKey", "slotKey", "minimumSelections", "maximumSelections");
    private static final Set<String> BUDGET_FIELDS = Set.of("budgetKey", "name", "maximumSource", "fixedMaximum");
    private static final Set<String> PREREQUISITE_FIELDS = Set.of(
        "optionKey", "minimumRank", "requiredOptionKey", "requiredMinimumRank");
    private static final Set<String> EXCLUSION_FIELDS = Set.of("optionKeys", "maximumSelected");
    private static final Set<String> RULE_FIELDS = Set.of("groupRoles", "budget", "prerequisites", "exclusions");

    private final GamesMapper games;
    private final BuildSystemMapper mapper;
    private final BuildOptionSkillRelationMapper relations;
    private final SkillMapper skills;
    private final ImageRelationMapper images;
    private final ObjectMapper json;
    private final GameConfigurationWriteGuard writes;

    public BuildSystemService(
        GamesMapper games, BuildSystemMapper mapper, BuildOptionSkillRelationMapper relations, SkillMapper skills,
        ImageRelationMapper images, ObjectMapper json, GameConfigurationWriteGuard writes
    ) {
        this.games = games;
        this.mapper = mapper;
        this.relations = relations;
        this.skills = skills;
        this.images = images;
        this.json = json;
        this.writes = java.util.Objects.requireNonNull(writes);
    }

    @Transactional(readOnly = true)
    public BuildSystemListResponse listSystems(String gameId, String keyword) {
        requireGame(gameId);
        List<BuildSystemResponse> items = safe(mapper.listSystems(gameId, filter(keyword, Kind.SYSTEM))).stream()
            .map(row -> system(row, stored(row.systemKey()))).toList();
        return new BuildSystemListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public BuildSystemResponse getSystem(String gameId, String systemKey) {
        requireGame(gameId);
        return system(requireSystemRow(gameId, systemKey), stored(systemKey));
    }

    @Transactional
    public BuildSystemResponse createSystem(String gameId, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.SYSTEM, null);
        SystemDraft draft = parseSystem(body, true, check);
        if (mapper.findSystem(gameId, draft.key()) != null) {
            throw conflict(Kind.SYSTEM, "KEY_EXISTS");
        }
        if (mapper.countSystemName(gameId, draft.name(), null) > 0) {
            throw conflict(Kind.SYSTEM, "NAME_EXISTS");
        }
        validateRules(draft.mode(), draft.rules(), List.of(), List.of(), check);
        try {
            mapper.insertSystem(gameId, draft.key(), draft.name(), draft.description(), draft.mode(),
                draft.sortOrder(), writeJson(draft.rules()));
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.SYSTEM);
        }
        return getSystem(gameId, draft.key());
    }

    @Transactional
    public BuildSystemResponse updateSystem(String gameId, String systemKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(systemKey, "systemKey", request(Kind.SYSTEM, systemKey));
        Check check = request(Kind.SYSTEM, systemKey);
        SystemDraft draft = parseSystem(body, false, check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        if (!current.system().configurationMode().equals(draft.mode())) {
            requireModeChangeAllowed(current, draft.mode());
        }
        if (mapper.countSystemName(gameId, draft.name(), systemKey) > 0) {
            throw conflict(Kind.SYSTEM, "NAME_EXISTS");
        }
        validateRules(draft.mode(), draft.rules(), current.groups(), current.options(), check);
        if (draft.rules().budget() == null) {
            requireZeroCosts(current.options(), check, "selectionRules.budget");
        }
        try {
            if (mapper.updateSystem(gameId, systemKey, draft.name(), draft.description(), draft.mode(),
                draft.sortOrder(), writeJson(draft.rules())) == 0) {
                throw notFound(Kind.SYSTEM, systemKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.SYSTEM);
        }
        return getSystem(gameId, systemKey);
    }

    @Transactional
    public void deleteSystem(String gameId, String systemKey) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(systemKey, "systemKey", request(Kind.SYSTEM, systemKey));
        requireSystemRow(gameId, systemKey);
        images.deleteForBuildSystem(gameId, systemKey);
        if (mapper.deleteSystem(gameId, systemKey) == 0) {
            throw notFound(Kind.SYSTEM, systemKey);
        }
    }

    @Transactional(readOnly = true)
    public BuildGroupListResponse listGroups(String gameId, String systemKey, String keyword) {
        requireGame(gameId);
        requireSystemRow(gameId, systemKey);
        Check check = stored(systemKey);
        List<BuildGroupResponse> items = safe(mapper.listGroups(gameId, systemKey, filter(keyword, Kind.GROUP))).stream()
            .map(row -> group(row, check)).toList();
        return new BuildGroupListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public BuildGroupResponse getGroup(String gameId, String systemKey, String groupKey) {
        requireGame(gameId);
        requireSystemRow(gameId, systemKey);
        return group(requireGroupRow(gameId, systemKey, groupKey), stored(systemKey));
    }

    @Transactional
    public BuildGroupResponse createGroup(String gameId, String systemKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.GROUP, systemKey);
        validateKey(systemKey, "systemKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        GroupDraft draft = parseGroup(body, true, check);
        if (mapper.findGroup(gameId, systemKey, draft.key()) != null) {
            throw conflict(Kind.GROUP, "KEY_EXISTS");
        }
        if (mapper.countGroupName(gameId, systemKey, draft.name(), null) > 0) {
            throw conflict(Kind.GROUP, "NAME_EXISTS");
        }
        validateLayout(current.system().configurationMode(), draft.key(), draft.slots(), current.groups(),
            indexOptions(current.options()), check);
        try {
            mapper.insertGroup(gameId, systemKey, draft.key(), draft.name(), draft.description(),
                draft.sortOrder(), writeJson(draft.slots()));
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.GROUP);
        }
        return getGroup(gameId, systemKey, draft.key());
    }

    @Transactional
    public BuildGroupResponse updateGroup(String gameId, String systemKey, String groupKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.GROUP, systemKey);
        validateKey(systemKey, "systemKey", check);
        validateKey(groupKey, "groupKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        requireGroup(current, groupKey);
        GroupDraft draft = parseGroup(body, false, check);
        if (mapper.countGroupName(gameId, systemKey, draft.name(), groupKey) > 0) {
            throw conflict(Kind.GROUP, "NAME_EXISTS");
        }
        List<BuildGroupResponse> others = current.groups().stream()
            .filter(group -> !group.groupKey().equals(groupKey)).toList();
        validateLayout(current.system().configurationMode(), groupKey, draft.slots(), others,
            indexOptions(current.options()), check);
        requireGroupStillSatisfiesRules(systemKey, groupKey, draft.slots(), current.system().selectionRules());
        try {
            if (mapper.updateGroup(gameId, systemKey, groupKey, draft.name(), draft.description(),
                draft.sortOrder(), writeJson(draft.slots())) == 0) {
                throw notFound(Kind.GROUP, groupKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.GROUP);
        }
        return getGroup(gameId, systemKey, groupKey);
    }

    @Transactional
    public void deleteGroup(String gameId, String systemKey, String groupKey) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.GROUP, systemKey);
        validateKey(systemKey, "systemKey", check);
        validateKey(groupKey, "groupKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        requireGroup(current, groupKey);
        List<Map<String, Object>> references = groupReferences(systemKey, groupKey, current.system().selectionRules());
        if (!references.isEmpty()) {
            throw occupied("409.BUILD_GROUP_IN_USE", "分组仍被规则引用", "groupKey", groupKey, references);
        }
        if (mapper.deleteGroup(gameId, systemKey, groupKey) == 0) {
            throw notFound(Kind.GROUP, groupKey);
        }
        images.deleteForSource(gameId, "BUILD_GROUP", systemKey, groupKey);
    }

    @Transactional(readOnly = true)
    public BuildOptionListResponse listOptions(String gameId, String systemKey, String keyword) {
        requireGame(gameId);
        requireSystemRow(gameId, systemKey);
        Check check = stored(systemKey);
        List<BuildOptionResponse> items = safe(mapper.listOptions(gameId, systemKey, filter(keyword, Kind.OPTION))).stream()
            .map(row -> option(row, check)).toList();
        return new BuildOptionListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public BuildOptionResponse getOption(String gameId, String systemKey, String optionKey) {
        requireGame(gameId);
        requireSystemRow(gameId, systemKey);
        return option(requireOptionRow(gameId, systemKey, optionKey), stored(systemKey));
    }

    @Transactional
    public BuildOptionResponse createOption(String gameId, String systemKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.OPTION, systemKey);
        validateKey(systemKey, "systemKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        OptionDraft draft = parseOption(body, true, current.system().configurationMode(), check);
        if (current.system().selectionRules().budget() == null) {
            requireZeroCosts(List.of(draft.asOption(gameId, systemKey)), check, "rankCosts");
        }
        if (mapper.findOption(gameId, systemKey, draft.key()) != null) {
            throw conflict(Kind.OPTION, "KEY_EXISTS");
        }
        if (mapper.countOptionName(gameId, systemKey, draft.name(), null) > 0) {
            throw conflict(Kind.OPTION, "NAME_EXISTS");
        }
        try {
            mapper.insertOption(gameId, systemKey, draft.key(), draft.name(), draft.description(),
                draft.maxRank(), writeJson(draft.rankCosts()));
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.OPTION);
        }
        return getOption(gameId, systemKey, draft.key());
    }

    @Transactional
    public BuildOptionResponse updateOption(String gameId, String systemKey, String optionKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.OPTION, systemKey);
        validateKey(systemKey, "systemKey", check);
        validateKey(optionKey, "optionKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        requireOption(current, optionKey);
        OptionDraft draft = parseOption(body, false, current.system().configurationMode(), check);
        if (current.system().selectionRules().budget() == null) {
            requireZeroCosts(List.of(draft.asOption(gameId, systemKey)), check, "rankCosts");
        }
        if (mapper.countOptionName(gameId, systemKey, draft.name(), optionKey) > 0) {
            throw conflict(Kind.OPTION, "NAME_EXISTS");
        }
        requireOptionRankStillUsable(systemKey, optionKey, draft.maxRank(), current);
        try {
            if (mapper.updateOption(gameId, systemKey, optionKey, draft.name(), draft.description(),
                draft.maxRank(), writeJson(draft.rankCosts())) == 0) {
                throw notFound(Kind.OPTION, optionKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, Kind.OPTION);
        }
        return getOption(gameId, systemKey, optionKey);
    }

    @Transactional
    public void deleteOption(String gameId, String systemKey, String optionKey) {
        writes.begin(gameId);
        requireGame(gameId);
        Check check = request(Kind.OPTION, systemKey);
        validateKey(systemKey, "systemKey", check);
        validateKey(optionKey, "optionKey", check);
        Catalog current = load(gameId, systemKey, stored(systemKey));
        requireOption(current, optionKey);
        List<Map<String, Object>> references = optionReferences(systemKey, optionKey, current);
        if (!references.isEmpty()) {
            throw occupied("409.BUILD_OPTION_IN_USE", "可选项仍被位置或规则引用", "optionKey", optionKey, references);
        }
        if (mapper.deleteOption(gameId, systemKey, optionKey) == 0) {
            throw notFound(Kind.OPTION, optionKey);
        }
        images.deleteForSource(gameId, "BUILD_OPTION", systemKey, optionKey);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public BuildDefinitionResponse definition(String gameId, String systemKey) {
        requireGame(gameId);
        validateKey(systemKey, "systemKey", request(Kind.SYSTEM, systemKey));
        Catalog catalog = load(gameId, systemKey, stored(systemKey));
        assertStoredDefinition(catalog);
        List<BuildGroupResponse> groups = catalog.groups().stream()
            .sorted(Comparator.comparingInt(BuildGroupResponse::sortOrder).thenComparing(BuildGroupResponse::groupKey))
            .toList();
        List<BuildOptionResponse> options = catalog.options().stream()
            .sorted(Comparator.comparing(BuildOptionResponse::name).thenComparing(BuildOptionResponse::optionKey))
            .toList();
        List<BuildOptionSkillRelationResponse> grants = catalog.relations().stream()
            .sorted(Comparator.comparing(BuildOptionSkillRelationResponse::optionName)
                .thenComparing(BuildOptionSkillRelationResponse::optionKey)
                .thenComparing(BuildOptionSkillRelationResponse::sortOrder)
                .thenComparing(BuildOptionSkillRelationResponse::skillKey))
            .toList();
        return new BuildDefinitionResponse(catalog.system(), groups, options, grants);
    }

    private void assertStoredDefinition(Catalog catalog) {
        Check check = stored(catalog.system().systemKey());
        Map<String, BuildOptionResponse> options = indexOptions(catalog.options());
        for (BuildGroupResponse group : catalog.groups()) {
            List<BuildGroupResponse> others = catalog.groups().stream()
                .filter(item -> !item.groupKey().equals(group.groupKey())).toList();
            validateLayout(catalog.system().configurationMode(), group.groupKey(), group.slots(), others, options, check);
        }
        validateRules(catalog.system().configurationMode(), catalog.system().selectionRules(),
            catalog.groups(), catalog.options(), check);
        if (catalog.system().selectionRules().budget() == null) {
            requireZeroCosts(catalog.options(), check, "selectionRules.budget");
        }
        for (BuildOptionSkillRelationResponse relation : catalog.relations()) {
            BuildOptionResponse option = options.get(relation.optionKey());
            if (option == null) {
                throw invalid(check, "skillRelations." + relation.optionKey(), "REFERENCE_NOT_FOUND", "可选项不存在");
            }
            SkillRow skill = skills.findById(catalog.system().gameId(), relation.skillKey());
            if (skill == null || skill.maxLevel() == null) {
                throw invalid(check, "skillRelations." + relation.skillKey(), "REFERENCE_NOT_FOUND", "技能不存在");
            }
            if (relation.activationRank() == null || relation.activationRank() < 1
                || relation.activationRank() > option.maxRank()) {
                throw invalid(check, "skillRelations." + relation.optionKey() + ".activationRank",
                    "RANGE_INVALID", "授予等级超出可选项最高等级");
            }
            if ("SLOT_SELECTION".equals(catalog.system().configurationMode())
                && !"FIXED".equals(relation.skillLevelMode())) {
                throw invalid(check, "skillRelations." + relation.optionKey() + ".skillLevelMode",
                    "ENUM_INVALID", "按位置选择只接受固定技能等级");
            }
            if ("FIXED".equals(relation.skillLevelMode())) {
                if (relation.fixedSkillLevel() == null || relation.fixedSkillLevel() < 1
                    || relation.fixedSkillLevel() > skill.maxLevel()) {
                    throw invalid(check, "skillRelations." + relation.optionKey() + ".fixedSkillLevel",
                        "RANGE_INVALID", "固定技能等级超出技能最高等级");
                }
            } else if ("SAME_AS_OPTION".equals(relation.skillLevelMode())) {
                if (relation.fixedSkillLevel() != null) {
                    throw invalid(check, "skillRelations." + relation.optionKey() + ".fixedSkillLevel",
                        "NULL_REQUIRED", "随投入等级时固定技能等级必须为空");
                }
                if (option.maxRank() > skill.maxLevel()) {
                    throw invalid(check, "skillRelations." + relation.optionKey(),
                        "RANGE_INVALID", "可选项最高等级不能超过技能最高等级");
                }
            } else {
                throw invalid(check, "skillRelations." + relation.optionKey() + ".skillLevelMode",
                    "ENUM_INVALID", "技能等级方式不合法");
            }
        }
    }

    private void requireModeChangeAllowed(Catalog current, String nextMode) {
        SelectionRules rules = current.system().selectionRules();
        boolean rulesPresent = !rules.groupRoles().isEmpty() || rules.budget() != null
            || !rules.prerequisites().isEmpty() || !rules.exclusions().isEmpty();
        if (!current.groups().isEmpty() || rulesPresent) {
            throw new ApiException(HttpStatus.CONFLICT, "409.BUILD_SYSTEM_IN_USE",
                "已有分组或规则，请先清空再修改配置方式", Map.of("systemKey", current.system().systemKey()));
        }
        if ("SLOT_SELECTION".equals(nextMode)) {
            boolean ranked = current.options().stream().anyMatch(option -> option.maxRank() != 1);
            boolean scaled = current.relations().stream().anyMatch(relation -> !"FIXED".equals(relation.skillLevelMode()));
            if (ranked || scaled) {
                throw new ApiException(HttpStatus.CONFLICT, "409.BUILD_SYSTEM_IN_USE",
                    "已有可选项或技能授予与按位置选择冲突，请先清空再修改配置方式",
                    Map.of("systemKey", current.system().systemKey()));
            }
        }
    }

    private void requireOptionRankStillUsable(String systemKey, String optionKey, int maxRank, Catalog current) {
        List<Map<String, Object>> references = new ArrayList<>();
        SelectionRules rules = current.system().selectionRules();
        for (int i = 0; i < rules.prerequisites().size(); i++) {
            Prerequisite rule = rules.prerequisites().get(i);
            boolean exceeds = optionKey.equals(rule.optionKey()) && rule.minimumRank() > maxRank
                || optionKey.equals(rule.requiredOptionKey()) && rule.requiredMinimumRank() > maxRank;
            if (exceeds) {
                references.add(Map.of("systemKey", systemKey, "path", "selectionRules.prerequisites[" + i + "]"));
            }
        }
        for (BuildOptionSkillRelationResponse relation : current.relations()) {
            if (!optionKey.equals(relation.optionKey())) {
                continue;
            }
            if (relation.activationRank() != null && relation.activationRank() > maxRank) {
                references.add(Map.of("systemKey", systemKey, "optionKey", optionKey,
                    "skillKey", relation.skillKey(), "path", "activationRank"));
            }
            if ("SAME_AS_OPTION".equals(relation.skillLevelMode())) {
                SkillRow skill = skills.findById(current.system().gameId(), relation.skillKey());
                if (skill == null || skill.maxLevel() == null || maxRank > skill.maxLevel()) {
                    references.add(Map.of("systemKey", systemKey, "optionKey", optionKey,
                        "skillKey", relation.skillKey(), "path", "skillLevelMode"));
                }
            }
        }
        if (!references.isEmpty()) {
            throw occupied("409.BUILD_OPTION_IN_USE", "可选项等级仍被规则或技能授予使用", "optionKey", optionKey, references);
        }
    }

    private void requireGroupStillSatisfiesRules(
        String systemKey, String groupKey, List<BuildSlot> slots, SelectionRules rules
    ) {
        Map<String, BuildSlot> byKey = new HashMap<>();
        slots.forEach(slot -> byKey.put(slot.slotKey(), slot));
        List<Map<String, Object>> references = new ArrayList<>();
        for (int i = 0; i < rules.groupRoles().size(); i++) {
            GroupRole role = rules.groupRoles().get(i);
            for (int j = 0; j < role.slotRules().size(); j++) {
                SlotRule rule = role.slotRules().get(j);
                if (!groupKey.equals(rule.groupKey())) {
                    continue;
                }
                String path = "selectionRules.groupRoles[" + i + "].slotRules[" + j + "]";
                BuildSlot slot = byKey.get(rule.slotKey());
                if (slot == null || rule.minimumSelections() < slot.minimumSelections()
                    || rule.maximumSelections() > slot.maximumSelections()) {
                    references.add(Map.of("systemKey", systemKey, "groupKey", groupKey, "path", path));
                }
            }
        }
        if (!references.isEmpty()) {
            throw occupied("409.BUILD_GROUP_IN_USE", "分组位置仍被规则引用", "groupKey", groupKey, references);
        }
    }

    private static List<Map<String, Object>> groupReferences(String systemKey, String groupKey, SelectionRules rules) {
        List<Map<String, Object>> references = new ArrayList<>();
        for (int i = 0; i < rules.groupRoles().size(); i++) {
            GroupRole role = rules.groupRoles().get(i);
            for (int j = 0; j < role.groupKeys().size(); j++) {
                if (groupKey.equals(role.groupKeys().get(j))) {
                    references.add(Map.of("systemKey", systemKey, "path",
                        "selectionRules.groupRoles[" + i + "].groupKeys[" + j + "]"));
                }
            }
            for (int j = 0; j < role.slotRules().size(); j++) {
                if (groupKey.equals(role.slotRules().get(j).groupKey())) {
                    references.add(Map.of("systemKey", systemKey, "path",
                        "selectionRules.groupRoles[" + i + "].slotRules[" + j + "]"));
                }
            }
        }
        return references;
    }

    private static List<Map<String, Object>> optionReferences(String systemKey, String optionKey, Catalog current) {
        List<Map<String, Object>> references = new ArrayList<>();
        for (BuildGroupResponse group : current.groups()) {
            for (BuildSlot slot : group.slots()) {
                if (slot.optionKeys().contains(optionKey)) {
                    references.add(Map.of("systemKey", systemKey, "groupKey", group.groupKey(), "slotKey", slot.slotKey()));
                }
            }
        }
        SelectionRules rules = current.system().selectionRules();
        for (int i = 0; i < rules.prerequisites().size(); i++) {
            Prerequisite rule = rules.prerequisites().get(i);
            if (optionKey.equals(rule.optionKey()) || optionKey.equals(rule.requiredOptionKey())) {
                references.add(Map.of("systemKey", systemKey, "path", "selectionRules.prerequisites[" + i + "]"));
            }
        }
        for (int i = 0; i < rules.exclusions().size(); i++) {
            if (rules.exclusions().get(i).optionKeys().contains(optionKey)) {
                references.add(Map.of("systemKey", systemKey, "path", "selectionRules.exclusions[" + i + "]"));
            }
        }
        return references;
    }

    private void validateLayout(
        String mode, String groupKey, List<BuildSlot> slots, List<BuildGroupResponse> others,
        Map<String, BuildOptionResponse> options, Check check
    ) {
        Set<String> placed = new HashSet<>();
        if ("POINT_ALLOCATION".equals(mode)) {
            for (BuildGroupResponse group : others) {
                if (group.groupKey().equals(groupKey)) {
                    continue;
                }
                for (BuildSlot slot : group.slots()) {
                    placed.addAll(slot.optionKeys());
                }
            }
        }
        Set<String> slotKeys = new HashSet<>();
        for (int i = 0; i < slots.size(); i++) {
            BuildSlot slot = slots.get(i);
            if (!slotKeys.add(slot.slotKey())) {
                throw invalid(check, "slots[" + i + "].slotKey", "DUPLICATE_KEY", "同一分组的位置键不能重复");
            }
            Set<String> row = new HashSet<>();
            for (int j = 0; j < slot.optionKeys().size(); j++) {
                String optionKey = slot.optionKeys().get(j);
                String field = "slots[" + i + "].optionKeys[" + j + "]";
                if (!row.add(optionKey)) {
                    throw invalid(check, field, "DUPLICATE_KEY", "同一位置不能重复放入可选项");
                }
                if (!options.containsKey(optionKey)) {
                    throw invalid(check, field, "REFERENCE_NOT_FOUND", "可选项不存在于当前系统");
                }
                if ("POINT_ALLOCATION".equals(mode) && !placed.add(optionKey)) {
                    throw invalid(check, field, "DUPLICATE_KEY", "按点投入时同一可选项在整个布局最多出现一次");
                }
            }
        }
    }

    private void validateRules(
        String mode, SelectionRules rules, List<BuildGroupResponse> groups, List<BuildOptionResponse> options, Check check
    ) {
        Map<String, BuildGroupResponse> groupIndex = new HashMap<>();
        groups.forEach(group -> groupIndex.put(group.groupKey(), group));
        Map<String, BuildOptionResponse> optionIndex = indexOptions(options);
        Set<String> roleKeys = new HashSet<>();
        Map<String, Integer> rolePosition = new HashMap<>();
        for (int i = 0; i < rules.groupRoles().size(); i++) {
            GroupRole role = rules.groupRoles().get(i);
            String prefix = "selectionRules.groupRoles[" + i + "]";
            if (!roleKeys.add(role.roleKey())) {
                throw invalid(check, prefix + ".roleKey", "DUPLICATE_KEY", "分组角色键不能重复");
            }
            rolePosition.put(role.roleKey(), i);
            if (role.minimumGroups() > role.maximumGroups() || role.maximumGroups() > role.groupKeys().size()
                || role.minimumGroups() > role.groupKeys().size()) {
                throw invalid(check, prefix + ".minimumGroups", "RANGE_INVALID", "分组数量超出可选分组");
            }
            if (role.minimumSelectedSlots() > role.maximumSelectedSlots()
                || role.minimumSelectedSlots() > role.slotRules().size()) {
                throw invalid(check, prefix + ".minimumSelectedSlots", "RANGE_INVALID", "已选位置数量超出角色位置规则");
            }
            Set<String> seenGroups = new HashSet<>();
            for (int j = 0; j < role.groupKeys().size(); j++) {
                String groupKey = role.groupKeys().get(j);
                if (!seenGroups.add(groupKey)) {
                    throw invalid(check, prefix + ".groupKeys[" + j + "]", "DUPLICATE_KEY", "分组键不能重复");
                }
                if (!groupIndex.containsKey(groupKey)) {
                    throw invalid(check, prefix + ".groupKeys[" + j + "]", "REFERENCE_NOT_FOUND", "分组不存在于当前系统");
                }
            }
            Set<String> seenDistinct = new HashSet<>();
            for (int j = 0; j < role.distinctFromRoleKeys().size(); j++) {
                String other = role.distinctFromRoleKeys().get(j);
                String field = prefix + ".distinctFromRoleKeys[" + j + "]";
                if (other.equals(role.roleKey())) {
                    throw invalid(check, field, "CYCLE", "分组角色不能与自己互异");
                }
                if (!seenDistinct.add(other)) {
                    throw invalid(check, field, "DUPLICATE_KEY", "互异角色不能重复");
                }
            }
            Set<String> seenSlots = new HashSet<>();
            for (int j = 0; j < role.slotRules().size(); j++) {
                SlotRule slotRule = role.slotRules().get(j);
                String field = prefix + ".slotRules[" + j + "]";
                if (!role.groupKeys().contains(slotRule.groupKey())) {
                    throw invalid(check, field + ".groupKey", "REFERENCE_NOT_FOUND", "位置规则只能引用本角色的分组");
                }
                String identity = slotRule.groupKey() + "\n" + slotRule.slotKey();
                if (!seenSlots.add(identity)) {
                    throw invalid(check, field + ".slotKey", "DUPLICATE_KEY", "同一角色下的位置规则不能重复");
                }
                BuildGroupResponse group = groupIndex.get(slotRule.groupKey());
                BuildSlot slot = group == null ? null : group.slots().stream()
                    .filter(item -> item.slotKey().equals(slotRule.slotKey())).findFirst().orElse(null);
                if (slot == null) {
                    throw invalid(check, field + ".slotKey", "REFERENCE_NOT_FOUND", "位置不存在于当前分组");
                }
                if (slotRule.minimumSelections() < slot.minimumSelections()
                    || slotRule.maximumSelections() > slot.maximumSelections()) {
                    throw invalid(check, field + ".minimumSelections", "RANGE_INVALID", "角色位置数量必须处于分组位置允许范围内");
                }
            }
        }
        Set<String> directed = new HashSet<>();
        for (GroupRole role : rules.groupRoles()) {
            for (String other : role.distinctFromRoleKeys()) {
                if (!rolePosition.containsKey(other)) {
                    int index = rolePosition.get(role.roleKey());
                    int otherIndex = role.distinctFromRoleKeys().indexOf(other);
                    throw invalid(check, "selectionRules.groupRoles[" + index + "].distinctFromRoleKeys[" + otherIndex + "]",
                        "REFERENCE_NOT_FOUND", "互异角色不存在");
                }
                String forward = role.roleKey() + "\n" + other;
                String reverse = other + "\n" + role.roleKey();
                if (directed.contains(reverse)) {
                    int index = rolePosition.get(role.roleKey());
                    int otherIndex = role.distinctFromRoleKeys().indexOf(other);
                    throw invalid(check, "selectionRules.groupRoles[" + index + "].distinctFromRoleKeys[" + otherIndex + "]",
                        "DUPLICATE_KEY", "互异关系不能双向重复声明");
                }
                directed.add(forward);
            }
        }
        if (rules.budget() == null) {
            requireZeroCosts(options, check, "selectionRules.budget");
        }
        Set<String> prerequisitePairs = new HashSet<>();
        for (int i = 0; i < rules.prerequisites().size(); i++) {
            Prerequisite rule = rules.prerequisites().get(i);
            String prefix = "selectionRules.prerequisites[" + i + "]";
            BuildOptionResponse option = optionIndex.get(rule.optionKey());
            BuildOptionResponse required = optionIndex.get(rule.requiredOptionKey());
            if (option == null) {
                throw invalid(check, prefix + ".optionKey", "REFERENCE_NOT_FOUND", "可选项不存在于当前系统");
            }
            if (required == null) {
                throw invalid(check, prefix + ".requiredOptionKey", "REFERENCE_NOT_FOUND", "可选项不存在于当前系统");
            }
            if (rule.minimumRank() > option.maxRank()) {
                throw invalid(check, prefix + ".minimumRank", "RANGE_INVALID", "前置等级超出可选项最高等级");
            }
            if (rule.requiredMinimumRank() > required.maxRank()) {
                throw invalid(check, prefix + ".requiredMinimumRank", "RANGE_INVALID", "前置等级超出可选项最高等级");
            }
            if ("SLOT_SELECTION".equals(mode) && (rule.minimumRank() != 1 || rule.requiredMinimumRank() != 1)) {
                throw invalid(check, prefix + ".minimumRank", "RANGE_INVALID", "按位置选择的投入等级只能为 1");
            }
            if (!prerequisitePairs.add(rule.optionKey() + "\n" + rule.requiredOptionKey())) {
                throw invalid(check, prefix + ".optionKey", "DUPLICATE_KEY", "同一对前置不能重复");
            }
        }
        requireAcyclic(rules.prerequisites(), check);
        for (int i = 0; i < rules.exclusions().size(); i++) {
            Exclusion exclusion = rules.exclusions().get(i);
            String prefix = "selectionRules.exclusions[" + i + "]";
            if (exclusion.optionKeys().isEmpty()) {
                throw invalid(check, prefix + ".optionKeys", "REQUIRED", "互斥可选项不能为空");
            }
            if (exclusion.maximumSelected() > exclusion.optionKeys().size()) {
                throw invalid(check, prefix + ".maximumSelected", "RANGE_INVALID", "互斥数量不能超过可选项数量");
            }
            Set<String> seen = new HashSet<>();
            for (int j = 0; j < exclusion.optionKeys().size(); j++) {
                String optionKey = exclusion.optionKeys().get(j);
                if (!seen.add(optionKey)) {
                    throw invalid(check, prefix + ".optionKeys[" + j + "]", "DUPLICATE_KEY", "互斥可选项不能重复");
                }
                if (!optionIndex.containsKey(optionKey)) {
                    throw invalid(check, prefix + ".optionKeys[" + j + "]", "REFERENCE_NOT_FOUND", "可选项不存在于当前系统");
                }
            }
        }
    }

    private void requireAcyclic(List<Prerequisite> rules, Check check) {
        Map<String, List<Integer>> edges = new HashMap<>();
        for (int i = 0; i < rules.size(); i++) {
            Prerequisite rule = rules.get(i);
            if (rule.optionKey().equals(rule.requiredOptionKey())) {
                throw invalid(check, "selectionRules.prerequisites[" + i + "].optionKey", "CYCLE", "前置不能指向自己");
            }
            edges.computeIfAbsent(rule.requiredOptionKey(), key -> new ArrayList<>()).add(i);
        }
        Map<String, Integer> color = new HashMap<>();
        for (Prerequisite rule : rules) {
            walkPrerequisite(rule.requiredOptionKey(), -1, edges, rules, color, check);
        }
    }

    private void walkPrerequisite(
        String node, int viaRule, Map<String, List<Integer>> edges, List<Prerequisite> rules,
        Map<String, Integer> color, Check check
    ) {
        int state = color.getOrDefault(node, 0);
        if (state == 2) {
            throw invalid(check, "selectionRules.prerequisites[" + viaRule + "].requiredOptionKey",
                "CYCLE", "前置关系形成循环");
        }
        if (state == 1) {
            return;
        }
        color.put(node, 2);
        for (int ruleIndex : edges.getOrDefault(node, List.of())) {
            walkPrerequisite(rules.get(ruleIndex).optionKey(), ruleIndex, edges, rules, color, check);
        }
        color.put(node, 1);
    }

    private void requireZeroCosts(List<BuildOptionResponse> options, Check check, String field) {
        for (BuildOptionResponse option : options) {
            for (int cost : option.rankCosts()) {
                if (cost != 0) {
                    throw invalid(check, field, "RANGE_INVALID", "没有预算时所有可选项成本必须为 0");
                }
            }
        }
    }

    private SystemDraft parseSystem(JsonNode body, boolean create, Check check) {
        requireObject(body, "request", check);
        rejectUnknown(body, create ? SYSTEM_CREATE : SYSTEM_UPDATE, "", check);
        String key = create ? text(body.get("systemKey"), "systemKey", false, 64, check) : null;
        if (create) {
            validateKey(key, "systemKey", check);
        }
        String mode = text(body.get("configurationMode"), "configurationMode", false, 32, check);
        if (!MODES.contains(mode)) {
            throw invalid(check, "configurationMode", "ENUM_INVALID", "配置方式不合法");
        }
        int sortOrder = integer(body.get("sortOrder"), "sortOrder", 0, check);
        SelectionRules rules = parseRules(body.get("selectionRules"), check);
        return new SystemDraft(key, text(body.get("name"), "name", false, 100, check),
            text(body.get("description"), "description", true, 2000, check), mode, sortOrder, rules);
    }

    private GroupDraft parseGroup(JsonNode body, boolean create, Check check) {
        requireObject(body, "request", check);
        rejectUnknown(body, create ? GROUP_CREATE : GROUP_UPDATE, "", check);
        String key = create ? text(body.get("groupKey"), "groupKey", false, 64, check) : null;
        if (create) {
            validateKey(key, "groupKey", check);
        }
        JsonNode rawSlots = body.get("slots");
        if (rawSlots == null || !rawSlots.isArray()) {
            throw invalid(check, "slots", "ARRAY_REQUIRED", "位置必须显式提供数组");
        }
        List<BuildSlot> slots = new ArrayList<>();
        for (int i = 0; i < rawSlots.size(); i++) {
            slots.add(parseSlot(rawSlots.get(i), "slots[" + i + "]", check));
        }
        return new GroupDraft(key, text(body.get("name"), "name", false, 100, check),
            text(body.get("description"), "description", true, 2000, check),
            integer(body.get("sortOrder"), "sortOrder", 0, check), List.copyOf(slots));
    }

    private BuildSlot parseSlot(JsonNode body, String prefix, Check check) {
        requireObject(body, prefix, check);
        rejectUnknown(body, SLOT_FIELDS, prefix + ".", check);
        String slotKey = text(body.get("slotKey"), prefix + ".slotKey", false, 64, check);
        validateKey(slotKey, prefix + ".slotKey", check);
        int minimum = integer(body.get("minimumSelections"), prefix + ".minimumSelections", 0, check);
        int maximum = integer(body.get("maximumSelections"), prefix + ".maximumSelections", 0, check);
        if (minimum > maximum) {
            throw invalid(check, prefix + ".minimumSelections", "RANGE_INVALID", "最少选择数不能大于最多选择数");
        }
        JsonNode rawKeys = body.get("optionKeys");
        if (rawKeys == null || !rawKeys.isArray()) {
            throw invalid(check, prefix + ".optionKeys", "ARRAY_REQUIRED", "候选可选项必须显式提供数组");
        }
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < rawKeys.size(); i++) {
            String field = prefix + ".optionKeys[" + i + "]";
            String optionKey = text(rawKeys.get(i), field, false, 64, check);
            validateKey(optionKey, field, check);
            keys.add(optionKey);
        }
        return new BuildSlot(slotKey, text(body.get("name"), prefix + ".name", false, 100, check),
            minimum, maximum, List.copyOf(keys));
    }

    private OptionDraft parseOption(JsonNode body, boolean create, String mode, Check check) {
        requireObject(body, "request", check);
        rejectUnknown(body, create ? OPTION_CREATE : OPTION_UPDATE, "", check);
        String key = create ? text(body.get("optionKey"), "optionKey", false, 64, check) : null;
        if (create) {
            validateKey(key, "optionKey", check);
        }
        int maxRank = integer(body.get("maxRank"), "maxRank", 1, check);
        if ("SLOT_SELECTION".equals(mode) && maxRank != 1) {
            throw invalid(check, "maxRank", "RANGE_INVALID", "按位置选择的最高投入等级只能为 1");
        }
        JsonNode rawCosts = body.get("rankCosts");
        if (rawCosts == null || !rawCosts.isArray()) {
            throw invalid(check, "rankCosts", "ARRAY_REQUIRED", "等级成本必须显式提供数组");
        }
        if (rawCosts.size() != maxRank) {
            throw invalid(check, "rankCosts", "RANGE_INVALID", "等级成本数量必须等于最高投入等级");
        }
        List<Integer> costs = new ArrayList<>();
        for (int i = 0; i < rawCosts.size(); i++) {
            costs.add(integer(rawCosts.get(i), "rankCosts[" + i + "]", 0, check));
        }
        return new OptionDraft(key, text(body.get("name"), "name", false, 100, check),
            text(body.get("description"), "description", true, 2000, check), maxRank, List.copyOf(costs));
    }

    private SelectionRules parseRules(JsonNode body, Check check) {
        requireObject(body, "selectionRules", check);
        rejectUnknown(body, RULE_FIELDS, "selectionRules.", check);
        JsonNode rawRoles = body.get("groupRoles");
        if (rawRoles == null || !rawRoles.isArray()) {
            throw invalid(check, "selectionRules.groupRoles", "ARRAY_REQUIRED", "分组角色必须显式提供数组");
        }
        List<GroupRole> roles = new ArrayList<>();
        for (int i = 0; i < rawRoles.size(); i++) {
            roles.add(parseRole(rawRoles.get(i), "selectionRules.groupRoles[" + i + "]", check));
        }
        Budget budget = parseBudget(body.get("budget"), check);
        JsonNode rawPrerequisites = body.get("prerequisites");
        if (rawPrerequisites == null || !rawPrerequisites.isArray()) {
            throw invalid(check, "selectionRules.prerequisites", "ARRAY_REQUIRED", "前置规则必须显式提供数组");
        }
        List<Prerequisite> prerequisites = new ArrayList<>();
        for (int i = 0; i < rawPrerequisites.size(); i++) {
            prerequisites.add(parsePrerequisite(rawPrerequisites.get(i), "selectionRules.prerequisites[" + i + "]", check));
        }
        JsonNode rawExclusions = body.get("exclusions");
        if (rawExclusions == null || !rawExclusions.isArray()) {
            throw invalid(check, "selectionRules.exclusions", "ARRAY_REQUIRED", "互斥规则必须显式提供数组");
        }
        List<Exclusion> exclusions = new ArrayList<>();
        for (int i = 0; i < rawExclusions.size(); i++) {
            exclusions.add(parseExclusion(rawExclusions.get(i), "selectionRules.exclusions[" + i + "]", check));
        }
        return new SelectionRules(List.copyOf(roles), budget, List.copyOf(prerequisites), List.copyOf(exclusions));
    }

    private GroupRole parseRole(JsonNode body, String prefix, Check check) {
        requireObject(body, prefix, check);
        rejectUnknown(body, ROLE_FIELDS, prefix + ".", check);
        String roleKey = text(body.get("roleKey"), prefix + ".roleKey", false, 64, check);
        validateKey(roleKey, prefix + ".roleKey", check);
        List<String> groupKeys = keyArray(body.get("groupKeys"), prefix + ".groupKeys", check);
        List<String> distinct = keyArray(body.get("distinctFromRoleKeys"), prefix + ".distinctFromRoleKeys", check);
        JsonNode rawSlots = body.get("slotRules");
        if (rawSlots == null || !rawSlots.isArray()) {
            throw invalid(check, prefix + ".slotRules", "ARRAY_REQUIRED", "角色位置规则必须显式提供数组");
        }
        List<SlotRule> slotRules = new ArrayList<>();
        for (int i = 0; i < rawSlots.size(); i++) {
            slotRules.add(parseSlotRule(rawSlots.get(i), prefix + ".slotRules[" + i + "]", check));
        }
        return new GroupRole(roleKey, text(body.get("name"), prefix + ".name", false, 100, check), groupKeys,
            integer(body.get("minimumGroups"), prefix + ".minimumGroups", 0, check),
            integer(body.get("maximumGroups"), prefix + ".maximumGroups", 0, check),
            integer(body.get("minimumSelectedSlots"), prefix + ".minimumSelectedSlots", 0, check),
            integer(body.get("maximumSelectedSlots"), prefix + ".maximumSelectedSlots", 0, check),
            distinct, List.copyOf(slotRules));
    }

    private SlotRule parseSlotRule(JsonNode body, String prefix, Check check) {
        requireObject(body, prefix, check);
        rejectUnknown(body, SLOT_RULE_FIELDS, prefix + ".", check);
        String groupKey = text(body.get("groupKey"), prefix + ".groupKey", false, 64, check);
        String slotKey = text(body.get("slotKey"), prefix + ".slotKey", false, 64, check);
        validateKey(groupKey, prefix + ".groupKey", check);
        validateKey(slotKey, prefix + ".slotKey", check);
        int minimum = integer(body.get("minimumSelections"), prefix + ".minimumSelections", 0, check);
        int maximum = integer(body.get("maximumSelections"), prefix + ".maximumSelections", 0, check);
        if (minimum > maximum) {
            throw invalid(check, prefix + ".minimumSelections", "RANGE_INVALID", "最少选择数不能大于最多选择数");
        }
        return new SlotRule(groupKey, slotKey, minimum, maximum);
    }

    private Budget parseBudget(JsonNode body, Check check) {
        if (body == null || body.isNull()) {
            return null;
        }
        requireObject(body, "selectionRules.budget", check);
        rejectUnknown(body, BUDGET_FIELDS, "selectionRules.budget.", check);
        String budgetKey = text(body.get("budgetKey"), "selectionRules.budget.budgetKey", false, 64, check);
        validateKey(budgetKey, "selectionRules.budget.budgetKey", check);
        String source = text(body.get("maximumSource"), "selectionRules.budget.maximumSource", false, 32, check);
        if (!BUDGET_SOURCES.contains(source)) {
            throw invalid(check, "selectionRules.budget.maximumSource", "ENUM_INVALID", "预算上限来源不合法");
        }
        JsonNode fixed = body.get("fixedMaximum");
        if ("FIXED".equals(source)) {
            return new Budget(budgetKey, text(body.get("name"), "selectionRules.budget.name", false, 100, check),
                source, integer(fixed, "selectionRules.budget.fixedMaximum", 0, check));
        }
        if (fixed == null || !fixed.isNull()) {
            throw invalid(check, "selectionRules.budget.fixedMaximum", "NULL_REQUIRED", "场景输入时上限必须为空");
        }
        return new Budget(budgetKey, text(body.get("name"), "selectionRules.budget.name", false, 100, check), source, null);
    }

    private Prerequisite parsePrerequisite(JsonNode body, String prefix, Check check) {
        requireObject(body, prefix, check);
        rejectUnknown(body, PREREQUISITE_FIELDS, prefix + ".", check);
        String optionKey = text(body.get("optionKey"), prefix + ".optionKey", false, 64, check);
        String required = text(body.get("requiredOptionKey"), prefix + ".requiredOptionKey", false, 64, check);
        validateKey(optionKey, prefix + ".optionKey", check);
        validateKey(required, prefix + ".requiredOptionKey", check);
        return new Prerequisite(optionKey, integer(body.get("minimumRank"), prefix + ".minimumRank", 1, check),
            required, integer(body.get("requiredMinimumRank"), prefix + ".requiredMinimumRank", 1, check));
    }

    private Exclusion parseExclusion(JsonNode body, String prefix, Check check) {
        requireObject(body, prefix, check);
        rejectUnknown(body, EXCLUSION_FIELDS, prefix + ".", check);
        return new Exclusion(keyArray(body.get("optionKeys"), prefix + ".optionKeys", check),
            integer(body.get("maximumSelected"), prefix + ".maximumSelected", 0, check));
    }

    private List<String> keyArray(JsonNode body, String field, Check check) {
        if (body == null || !body.isArray()) {
            throw invalid(check, field, "ARRAY_REQUIRED", "必须显式提供数组");
        }
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < body.size(); i++) {
            String itemField = field + "[" + i + "]";
            String key = text(body.get(i), itemField, false, 64, check);
            validateKey(key, itemField, check);
            keys.add(key);
        }
        return List.copyOf(keys);
    }

    private Catalog load(String gameId, String systemKey, Check check) {
        BuildSystemResponse system = system(requireSystemRow(gameId, systemKey), check);
        List<BuildGroupResponse> groups = safe(mapper.listGroups(gameId, systemKey, null)).stream()
            .map(row -> group(row, check)).toList();
        List<BuildOptionResponse> options = safe(mapper.listOptions(gameId, systemKey, null)).stream()
            .map(row -> option(row, check)).toList();
        List<BuildOptionSkillRelationResponse> grants = safe(relations.listRelations(gameId, systemKey, null, null));
        Catalog catalog = new Catalog(system, groups, options, grants);
        if ("SLOT_SELECTION".equals(system.configurationMode())) {
            for (BuildOptionResponse option : options) {
                if (option.maxRank() != 1) {
                    throw invalid(check, "maxRank", "RANGE_INVALID", "按位置选择的最高投入等级只能为 1");
                }
            }
        }
        return catalog;
    }

    private BuildSystemResponse system(BuildSystemRow row, Check check) {
        JsonNode tree = readTree(row.selectionRulesJson(), "selectionRules", check);
        SelectionRules rules = parseRules(tree, check);
        if (row.sortOrder() == null || !MODES.contains(row.configurationMode())) {
            throw invalid(check, "configurationMode", "ENUM_INVALID", "已存配置方式不合法");
        }
        return new BuildSystemResponse(row.gameId(), row.systemKey(), row.name(), row.description(),
            row.configurationMode(), row.sortOrder(), rules, row.createdAt(), row.updatedAt());
    }

    private BuildGroupResponse group(BuildGroupRow row, Check check) {
        JsonNode tree = readTree(row.slotsJson(), "slots", check);
        if (tree == null || !tree.isArray()) {
            throw invalid(check, "slots", "ARRAY_REQUIRED", "已存位置不是数组");
        }
        List<BuildSlot> slots = new ArrayList<>();
        for (int i = 0; i < tree.size(); i++) {
            slots.add(parseSlot(tree.get(i), "slots[" + i + "]", check));
        }
        if (row.sortOrder() == null) {
            throw invalid(check, "sortOrder", "RANGE_INVALID", "已存排序不合法");
        }
        return new BuildGroupResponse(row.gameId(), row.systemKey(), row.groupKey(), row.name(), row.description(),
            row.sortOrder(), List.copyOf(slots), row.createdAt(), row.updatedAt());
    }

    private BuildOptionResponse option(BuildOptionRow row, Check check) {
        JsonNode tree = readTree(row.rankCostsJson(), "rankCosts", check);
        if (tree == null || !tree.isArray() || row.maxRank() == null) {
            throw invalid(check, "rankCosts", "ARRAY_REQUIRED", "已存等级成本不是数组");
        }
        if (tree.size() != row.maxRank()) {
            throw invalid(check, "rankCosts", "RANGE_INVALID", "已存等级成本数量与最高等级不一致");
        }
        List<Integer> costs = new ArrayList<>();
        for (int i = 0; i < tree.size(); i++) {
            costs.add(integer(tree.get(i), "rankCosts[" + i + "]", 0, check));
        }
        return new BuildOptionResponse(row.gameId(), row.systemKey(), row.optionKey(), row.name(), row.description(),
            row.maxRank(), List.copyOf(costs), row.createdAt(), row.updatedAt());
    }

    private JsonNode readTree(String raw, String field, Check check) {
        try {
            return json.readTree(raw);
        } catch (RuntimeException | JsonProcessingException ex) {
            throw invalid(check, field, "OBJECT_REQUIRED", "已存内容不合法");
        }
    }

    private String writeJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("无法保存构筑定义", ex);
        }
    }

    private BuildSystemRow requireSystemRow(String gameId, String systemKey) {
        validateKey(systemKey, "systemKey", request(Kind.SYSTEM, systemKey));
        BuildSystemRow row = mapper.findSystem(gameId, systemKey);
        if (row == null) {
            throw notFound(Kind.SYSTEM, systemKey);
        }
        return row;
    }

    private BuildGroupRow requireGroupRow(String gameId, String systemKey, String groupKey) {
        validateKey(groupKey, "groupKey", request(Kind.GROUP, systemKey));
        BuildGroupRow row = mapper.findGroup(gameId, systemKey, groupKey);
        if (row == null) {
            throw notFound(Kind.GROUP, groupKey);
        }
        return row;
    }

    private BuildOptionRow requireOptionRow(String gameId, String systemKey, String optionKey) {
        validateKey(optionKey, "optionKey", request(Kind.OPTION, systemKey));
        BuildOptionRow row = mapper.findOption(gameId, systemKey, optionKey);
        if (row == null) {
            throw notFound(Kind.OPTION, optionKey);
        }
        return row;
    }

    private static void requireGroup(Catalog catalog, String groupKey) {
        if (catalog.groups().stream().noneMatch(group -> group.groupKey().equals(groupKey))) {
            throw notFound(Kind.GROUP, groupKey);
        }
    }

    private static void requireOption(Catalog catalog, String optionKey) {
        if (catalog.options().stream().noneMatch(option -> option.optionKey().equals(optionKey))) {
            throw notFound(Kind.OPTION, optionKey);
        }
    }

    private static Map<String, BuildOptionResponse> indexOptions(List<BuildOptionResponse> options) {
        Map<String, BuildOptionResponse> index = new HashMap<>();
        options.forEach(option -> index.put(option.optionKey(), option));
        return index;
    }

    private void requireGame(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId));
        }
    }

    private void requireObject(JsonNode body, String field, Check check) {
        if (body == null || !body.isObject()) {
            throw invalid(check, field, "OBJECT_REQUIRED", "必须提供完整对象");
        }
    }

    private void rejectUnknown(JsonNode body, Set<String> allowed, String prefix, Check check) {
        List<String> names = new ArrayList<>();
        body.fieldNames().forEachRemaining(names::add);
        names.sort(String::compareTo);
        for (String name : names) {
            if (!allowed.contains(name)) {
                throw invalid(check, prefix + name, "UNKNOWN_FIELD", "请求不支持此字段");
            }
        }
    }

    private String text(JsonNode value, String field, boolean optional, int maximum, Check check) {
        if (optional && (value == null || value.isNull())) {
            return null;
        }
        if (value == null || !value.isTextual()) {
            throw invalid(check, field, "STRING_REQUIRED", "必须提供字符串");
        }
        String result = value.textValue().trim();
        if (result.isEmpty()) {
            if (optional) {
                return null;
            }
            throw invalid(check, field, "REQUIRED", "不能为空");
        }
        if (result.length() > maximum) {
            throw invalid(check, field, "LENGTH_INVALID", "内容不能超过 " + maximum + " 个字符");
        }
        return result;
    }

    private int integer(JsonNode value, String field, int minimum, Check check) {
        if (value == null || value.isNull() || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < minimum) {
            throw invalid(check, field, "RANGE_INVALID", "必须是大于等于 " + minimum + " 的整数");
        }
        return value.intValue();
    }

    private void validateKey(String key, String field, Check check) {
        if (key == null || !KEY.matcher(key).matches()) {
            throw invalid(check, field, "FORMAT_INVALID", "标识格式不合法");
        }
    }

    private String filter(String value, Kind kind) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String result = value.trim();
        if (result.length() > 100) {
            throw invalid(request(kind, null), "keyword", "LENGTH_INVALID", "关键词不能超过100个字符");
        }
        return result;
    }

    private ApiException invalid(Check check, String field, String code, String message) {
        if (check.stored()) {
            return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "500.INVALID_STORED_BUILD_DEFINITION",
                "已存构筑定义不合法", Map.of(
                    "systemKey", check.systemKey() == null ? "" : check.systemKey(),
                    "field", field,
                    "message", message
                ));
        }
        String errorCode = switch (check.kind()) {
            case SYSTEM -> "400.INVALID_BUILD_SYSTEM_REQUEST";
            case GROUP -> "400.INVALID_BUILD_GROUP_REQUEST";
            case OPTION -> "400.INVALID_BUILD_OPTION_REQUEST";
        };
        String title = switch (check.kind()) {
            case SYSTEM -> "构筑系统信息不合法";
            case GROUP -> "构筑分组信息不合法";
            case OPTION -> "构筑可选项信息不合法";
        };
        return new ApiException(HttpStatus.BAD_REQUEST, errorCode, title,
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", code, "message", message))));
    }

    private static ApiException notFound(Kind kind, String key) {
        String code = switch (kind) {
            case SYSTEM -> "404.BUILD_SYSTEM_NOT_FOUND";
            case GROUP -> "404.BUILD_GROUP_NOT_FOUND";
            case OPTION -> "404.BUILD_OPTION_NOT_FOUND";
        };
        String message = switch (kind) {
            case SYSTEM -> "构筑系统不存在";
            case GROUP -> "构筑分组不存在";
            case OPTION -> "构筑可选项不存在";
        };
        String field = switch (kind) {
            case SYSTEM -> "systemKey";
            case GROUP -> "groupKey";
            case OPTION -> "optionKey";
        };
        return new ApiException(HttpStatus.NOT_FOUND, code, message, Map.of(field, key == null ? "" : key));
    }

    private static ApiException conflict(Kind kind, String suffix) {
        String prefix = switch (kind) {
            case SYSTEM -> "BUILD_SYSTEM_";
            case GROUP -> "BUILD_GROUP_";
            case OPTION -> "BUILD_OPTION_";
        };
        String label = switch (kind) {
            case SYSTEM -> "构筑系统";
            case GROUP -> "构筑分组";
            case OPTION -> "构筑可选项";
        };
        return new ApiException(HttpStatus.CONFLICT, "409." + prefix + suffix,
            label + ("KEY_EXISTS".equals(suffix) ? "标识已存在" : "名称已存在"));
    }

    private static ApiException occupied(
        String code, String message, String field, String key, List<Map<String, Object>> references
    ) {
        return new ApiException(HttpStatus.CONFLICT, code, message,
            Map.of(field, key, "references", List.copyOf(references)));
    }

    private static RuntimeException mapConstraint(DataIntegrityViolationException ex, Kind kind) {
        String message = ex.getMostSpecificCause().getMessage();
        String table = switch (kind) {
            case SYSTEM -> "build_systems";
            case GROUP -> "build_groups";
            case OPTION -> "build_options";
        };
        if (message != null && message.contains("pk_" + table)) {
            return conflict(kind, "KEY_EXISTS");
        }
        if (message != null && message.contains("uq_" + table + "_name")) {
            return conflict(kind, "NAME_EXISTS");
        }
        return ex;
    }

    private static Check request(Kind kind, String systemKey) {
        return new Check(false, kind, systemKey);
    }

    private static Check stored(String systemKey) {
        return new Check(true, Kind.SYSTEM, systemKey);
    }

    private static <T> List<T> safe(List<T> values) {
        return values == null ? List.of() : List.copyOf(values);
    }

    private enum Kind { SYSTEM, GROUP, OPTION }

    private record Check(boolean stored, Kind kind, String systemKey) {}

    private record Catalog(
        BuildSystemResponse system,
        List<BuildGroupResponse> groups,
        List<BuildOptionResponse> options,
        List<BuildOptionSkillRelationResponse> relations
    ) {}

    private record SystemDraft(
        String key, String name, String description, String mode, int sortOrder, SelectionRules rules
    ) {}

    private record GroupDraft(String key, String name, String description, int sortOrder, List<BuildSlot> slots) {}

    private record OptionDraft(String key, String name, String description, int maxRank, List<Integer> rankCosts) {
        private BuildOptionResponse asOption(String gameId, String systemKey) {
            return new BuildOptionResponse(gameId, systemKey, key, name, description, maxRank, rankCosts, null, null);
        }
    }
}
