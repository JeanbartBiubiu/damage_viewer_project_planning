package xyz.game.datamanage.service.simulation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import xyz.game.datamanage.model.build.BuildConfiguration;
import xyz.game.datamanage.model.build.BuildConfiguration.GroupAssignment;
import xyz.game.datamanage.model.build.BuildConfiguration.OptionSelection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Origin;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;

public final class SnapshotSelectionParser {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> FIELDS = Set.of("sourceCharacterKey", "sourceLevel", "targetCharacterKey",
        "targetLevel", "basicAttackSkillKey", "basicAttackLevel", "sourceEquipmentKeys", "targetEquipmentKeys",
        "sourceBuildConfigurations", "targetBuildConfigurations", "sourceSkillSettings", "targetSkillSettings");

    private SnapshotSelectionParser() { }

    public static Selection parse(JsonNode body) {
        object(body, "selection", FIELDS, FIELDS);
        return new Selection(key(body, "sourceCharacterKey", "selection"), integer(body.get("sourceLevel"), "selection.sourceLevel"),
            key(body, "targetCharacterKey", "selection"), integer(body.get("targetLevel"), "selection.targetLevel"),
            key(body, "basicAttackSkillKey", "selection"), integer(body.get("basicAttackLevel"), "selection.basicAttackLevel"),
            equipment(body.get("sourceEquipmentKeys"), "selection.sourceEquipmentKeys"),
            equipment(body.get("targetEquipmentKeys"), "selection.targetEquipmentKeys"),
            builds(body.get("sourceBuildConfigurations"), "selection.sourceBuildConfigurations"),
            builds(body.get("targetBuildConfigurations"), "selection.targetBuildConfigurations"),
            settings(body.get("sourceSkillSettings"), "selection.sourceSkillSettings"),
            settings(body.get("targetSkillSettings"), "selection.targetSkillSettings"));
    }

    private static List<String> equipment(JsonNode values, String path) {
        array(values, path);
        if (values.size() > 6) throw SnapshotIssues.request(path + "[6]", "SELECTION_LIMIT_EXCEEDED", "每方所选装备不能超过6件");
        List<String> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int index = 0; index < values.size(); index++) {
            String key = key(values.get(index), path + "[" + index + "]");
            unique(seen, key, path + "[" + index + "]");
            result.add(key);
        }
        return List.copyOf(result);
    }

    private static List<BuildConfiguration> builds(JsonNode values, String path) {
        array(values, path);
        List<BuildConfiguration> result = new ArrayList<>();
        Set<String> systems = new HashSet<>();
        for (int index = 0; index < values.size(); index++) {
            JsonNode value = values.get(index);
            String item = path + "[" + index + "]";
            Set<String> fields = Set.of("systemKey", "groupAssignments", "selections", "budgets");
            object(value, item, fields, fields);
            String system = key(value, "systemKey", item);
            unique(systems, system, item + ".systemKey");
            JsonNode assignments = value.get("groupAssignments");
            array(assignments, item + ".groupAssignments");
            List<GroupAssignment> groups = new ArrayList<>();
            Set<GroupAssignment> seenGroups = new HashSet<>();
            for (int groupIndex = 0; groupIndex < assignments.size(); groupIndex++) {
                JsonNode group = assignments.get(groupIndex);
                String groupPath = item + ".groupAssignments[" + groupIndex + "]";
                Set<String> groupFields = Set.of("roleKey", "groupKey");
                object(group, groupPath, groupFields, groupFields);
                GroupAssignment assignment = new GroupAssignment(key(group, "roleKey", groupPath), key(group, "groupKey", groupPath));
                unique(seenGroups, assignment, groupPath);
                groups.add(assignment);
            }
            JsonNode selections = value.get("selections");
            array(selections, item + ".selections");
            List<OptionSelection> options = new ArrayList<>();
            Set<List<String>> seenOptions = new HashSet<>();
            for (int optionIndex = 0; optionIndex < selections.size(); optionIndex++) {
                JsonNode option = selections.get(optionIndex);
                String optionPath = item + ".selections[" + optionIndex + "]";
                Set<String> optionFields = Set.of("roleKey", "groupKey", "slotKey", "optionKey", "rank");
                object(option, optionPath, optionFields, optionFields);
                OptionSelection selection = new OptionSelection(key(option, "roleKey", optionPath), key(option, "groupKey", optionPath),
                    key(option, "slotKey", optionPath), key(option, "optionKey", optionPath), integer(option.get("rank"), optionPath + ".rank"));
                unique(seenOptions, List.of(selection.roleKey(), selection.groupKey(), selection.slotKey(), selection.optionKey()), optionPath);
                options.add(selection);
            }
            JsonNode budgets = value.get("budgets");
            if (!budgets.isObject()) throw SnapshotIssues.request(item + ".budgets", "OBJECT_REQUIRED", "预算必须是对象");
            Map<String, Integer> amounts = new TreeMap<>();
            for (var entry : budgets.properties()) {
                if (!KEY.matcher(entry.getKey()).matches()) throw SnapshotIssues.request(item + ".budgets", "KEY_INVALID", "预算标识不合法");
                amounts.put(entry.getKey(), integer(entry.getValue(), item + ".budgets." + entry.getKey()));
            }
            result.add(new BuildConfiguration(system, List.copyOf(groups), List.copyOf(options), Map.copyOf(amounts)));
        }
        return List.copyOf(result);
    }

    private static List<SkillSetting> settings(JsonNode values, String path) {
        array(values, path);
        List<SkillSetting> result = new ArrayList<>();
        Set<List<Object>> seen = new HashSet<>();
        for (int index = 0; index < values.size(); index++) {
            JsonNode value = values.get(index);
            String item = path + "[" + index + "]";
            object(value, item, Set.of("origin", "skillKey", "enabled", "skillLevel"), Set.of("origin", "skillKey", "enabled"));
            JsonNode origin = value.get("origin");
            if (!origin.isObject() || !origin.path("kind").isTextual()) {
                throw SnapshotIssues.request(item + ".origin.kind", "REQUIRED", "必须提供来源类型");
            }
            Origin identity;
            switch (origin.path("kind").textValue()) {
                case "CHARACTER" -> {
                    Set<String> fields = Set.of("kind", "characterKey");
                    object(origin, item + ".origin", fields, fields);
                    identity = Origin.character(key(origin, "characterKey", item + ".origin"));
                }
                case "EQUIPMENT" -> {
                    Set<String> fields = Set.of("kind", "equipmentKey");
                    object(origin, item + ".origin", fields, fields);
                    identity = Origin.equipment(key(origin, "equipmentKey", item + ".origin"));
                }
                case "BUILD_OPTION" -> {
                    Set<String> fields = Set.of("kind", "systemKey", "roleKey", "groupKey", "slotKey", "optionKey");
                    object(origin, item + ".origin", fields, fields);
                    identity = Origin.build(key(origin, "systemKey", item + ".origin"), new OptionSelection(
                        key(origin, "roleKey", item + ".origin"), key(origin, "groupKey", item + ".origin"),
                        key(origin, "slotKey", item + ".origin"), key(origin, "optionKey", item + ".origin"), 0));
                }
                default -> throw SnapshotIssues.request(item + ".origin.kind", "ENUM_INVALID", "来源类型不合法");
            }
            String skillKey = key(value, "skillKey", item);
            unique(seen, List.of(identity, skillKey), item);
            if (!value.get("enabled").isBoolean()) throw SnapshotIssues.request(item + ".enabled", "BOOLEAN_REQUIRED", "本场开关必须是布尔值");
            Integer level = value.has("skillLevel") ? integer(value.get("skillLevel"), item + ".skillLevel") : null;
            result.add(new SkillSetting(identity, skillKey, value.get("enabled").booleanValue(), level));
        }
        return List.copyOf(result);
    }

    private static void object(JsonNode value, String path, Set<String> allowed, Set<String> required) {
        if (value == null || !value.isObject()) throw SnapshotIssues.request(path, "OBJECT_REQUIRED", "必须提供对象");
        for (String field : value.properties().stream().map(Map.Entry::getKey).sorted().toList()) {
            if (!allowed.contains(field)) throw SnapshotIssues.request(path + "." + field, "UNKNOWN_FIELD", "不接受此请求字段");
        }
        for (String field : required.stream().sorted().toList()) {
            if (!value.hasNonNull(field)) throw SnapshotIssues.request(path + "." + field, "REQUIRED", "必须明确提供此字段");
        }
    }

    private static void array(JsonNode value, String path) {
        if (value == null || !value.isArray()) throw SnapshotIssues.request(path, "ARRAY_REQUIRED", "必须明确提供数组");
    }

    private static String key(JsonNode value, String field, String path) {
        return key(value.get(field), path + "." + field);
    }

    private static String key(JsonNode value, String path) {
        if (value == null || !value.isTextual() || !KEY.matcher(value.textValue()).matches()) {
            throw SnapshotIssues.request(path, "KEY_INVALID", "标识必须是格式合法的非空字符串");
        }
        return value.textValue();
    }

    private static int integer(JsonNode value, String path) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt()) {
            throw SnapshotIssues.request(path, "INTEGER_REQUIRED", "必须明确提供范围内的整数");
        }
        if (value.intValue() < 0) throw SnapshotIssues.request(path, "RANGE_INVALID", "整数不能为负数");
        return value.intValue();
    }

    private static <T> void unique(Set<T> seen, T identity, String path) {
        if (!seen.add(identity)) throw SnapshotIssues.request(path, "DUPLICATE_KEY", "请求项不能重复");
    }
}
