package xyz.game.datamanage.service.simulation;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import xyz.game.datamanage.model.build.BuildConfiguration;
import xyz.game.datamanage.model.build.BuildConfiguration.GroupAssignment;
import xyz.game.datamanage.model.build.BuildConfiguration.OptionSelection;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
import xyz.game.datamanage.model.build.BuildGroupResponse;
import xyz.game.datamanage.model.build.BuildOptionResponse;
import xyz.game.datamanage.model.build.BuildSlot;
import xyz.game.datamanage.model.build.BuildSystemResponse.GroupRole;
import xyz.game.datamanage.model.build.BuildSystemResponse.SlotRule;

final class SnapshotBuildValidator {
    private SnapshotBuildValidator() { }

    static BuildConfiguration normalize(BuildConfiguration configuration) {
        return new BuildConfiguration(configuration.systemKey(), configuration.groupAssignments().stream()
            .sorted(Comparator.comparing(GroupAssignment::roleKey).thenComparing(GroupAssignment::groupKey)).toList(),
            configuration.selections().stream().sorted(Comparator.comparing(OptionSelection::roleKey)
                .thenComparing(OptionSelection::groupKey).thenComparing(OptionSelection::slotKey)
                .thenComparing(OptionSelection::optionKey)).toList(), new TreeMap<>(configuration.budgets()));
    }

    static void validate(String gameId, BuildDefinitionResponse definition, BuildConfiguration configuration, String path) {
        if (!gameId.equals(definition.system().gameId()) || !configuration.systemKey().equals(definition.system().systemKey())) {
            throw SnapshotIssues.invalid(path + ".systemKey", "REFERENCE_OUT_OF_SCOPE", "构筑定义不属于本次游戏与系统");
        }
        Map<String, GroupRole> roles = new HashMap<>();
        definition.system().selectionRules().groupRoles().forEach(role -> roles.put(role.roleKey(), role));
        Map<String, BuildGroupResponse> groups = new HashMap<>();
        definition.groups().forEach(group -> groups.put(group.groupKey(), group));
        Map<String, BuildOptionResponse> options = new HashMap<>();
        definition.options().forEach(option -> options.put(option.optionKey(), option));
        Set<GroupAssignment> assignments = new HashSet<>(configuration.groupAssignments());
        for (int index = 0; index < configuration.groupAssignments().size(); index++) {
            GroupAssignment assignment = configuration.groupAssignments().get(index);
            GroupRole role = roles.get(assignment.roleKey());
            String item = path + ".groupAssignments[" + index + "]";
            if (role == null || !role.groupKeys().contains(assignment.groupKey()) || !groups.containsKey(assignment.groupKey())) {
                throw SnapshotIssues.invalid(item, "REFERENCE_OUT_OF_SCOPE", "分组角色或候选分组不属于此构筑定义");
            }
            for (String other : role.distinctFromRoleKeys()) {
                if (assignments.contains(new GroupAssignment(other, assignment.groupKey()))) {
                    throw SnapshotIssues.invalid(item, "GROUPS_NOT_DISTINCT", "互异角色不能选择相同分组");
                }
            }
        }
        for (GroupRole role : roles.values()) {
            long count = assignments.stream().filter(assignment -> assignment.roleKey().equals(role.roleKey())).count();
            range(count, role.minimumGroups(), role.maximumGroups(), path + ".groupAssignments", "分组角色的分组数量不符合定义");
        }
        Map<List<String>, Integer> slotCounts = new HashMap<>();
        Map<String, Integer> ranks = new HashMap<>();
        long cost = 0;
        for (int index = 0; index < configuration.selections().size(); index++) {
            OptionSelection selection = configuration.selections().get(index);
            String item = path + ".selections[" + index + "]";
            if (!assignments.contains(new GroupAssignment(selection.roleKey(), selection.groupKey()))) {
                throw SnapshotIssues.invalid(item, "REFERENCE_OUT_OF_SCOPE", "选择不属于已分配角色与分组");
            }
            GroupRole role = roles.get(selection.roleKey());
            BuildGroupResponse group = groups.get(selection.groupKey());
            SlotRule rule = role.slotRules().stream().filter(candidate -> candidate.groupKey().equals(selection.groupKey())
                && candidate.slotKey().equals(selection.slotKey())).findFirst().orElse(null);
            BuildSlot slot = group.slots().stream().filter(candidate -> candidate.slotKey().equals(selection.slotKey())).findFirst().orElse(null);
            BuildOptionResponse option = options.get(selection.optionKey());
            if (rule == null || slot == null || option == null || !slot.optionKeys().contains(selection.optionKey())) {
                throw SnapshotIssues.invalid(item, "REFERENCE_OUT_OF_SCOPE", "位置或可选项不属于该角色允许的实际位置");
            }
            if (selection.rank() < 1 || selection.rank() > option.maxRank()) {
                throw SnapshotIssues.invalid(item + ".rank", "LEVEL_OUT_OF_RANGE", "投入等级必须为正整数且不超过可选项最高等级");
            }
            if ("POINT_ALLOCATION".equals(definition.system().configurationMode()) && ranks.containsKey(selection.optionKey())) {
                throw SnapshotIssues.invalid(item + ".optionKey", "DUPLICATE_OPTION", "按点投入时每个可选项只能选择一次");
            }
            slotCounts.merge(List.of(selection.roleKey(), selection.groupKey(), selection.slotKey()), 1, Integer::sum);
            ranks.merge(selection.optionKey(), selection.rank(), Math::max);
            if (option.rankCosts() == null || option.rankCosts().size() != option.maxRank()) {
                throw SnapshotIssues.invalid(item + ".rank", "CONFIGURATION_INCOMPLETE", "可选项的逐级成本不完整");
            }
            for (int rank = 0; rank < selection.rank(); rank++) {
                Integer amount = option.rankCosts().get(rank);
                if (amount == null || amount < 0) throw SnapshotIssues.invalid(item + ".rank", "CONFIGURATION_INCOMPLETE", "逐级成本必须是非负整数");
                cost += amount;
            }
        }
        for (GroupAssignment assignment : assignments) {
            GroupRole role = roles.get(assignment.roleKey());
            for (SlotRule rule : role.slotRules()) {
                if (!rule.groupKey().equals(assignment.groupKey())) continue;
                int count = slotCounts.getOrDefault(List.of(role.roleKey(), rule.groupKey(), rule.slotKey()), 0);
                range(count, rule.minimumSelections(), rule.maximumSelections(), path + ".selections", "角色位置选择数量不符合定义");
                BuildSlot slot = groups.get(rule.groupKey()).slots().stream()
                    .filter(candidate -> candidate.slotKey().equals(rule.slotKey())).findFirst().orElseThrow();
                range(count, slot.minimumSelections(), slot.maximumSelections(), path + ".selections", "分组位置选择数量不符合定义");
            }
        }
        for (GroupRole role : roles.values()) {
            long count = slotCounts.keySet().stream().filter(slot -> slot.getFirst().equals(role.roleKey())).count();
            range(count, role.minimumSelectedSlots(), role.maximumSelectedSlots(), path + ".selections", "角色已选位置总数不符合定义");
        }
        for (var prerequisite : definition.system().selectionRules().prerequisites()) {
            if (ranks.getOrDefault(prerequisite.optionKey(), 0) >= prerequisite.minimumRank()
                && ranks.getOrDefault(prerequisite.requiredOptionKey(), 0) < prerequisite.requiredMinimumRank()) {
                throw SnapshotIssues.invalid(path + ".selections", "PREREQUISITE_UNMET", "选择未满足已定义的前置投入等级");
            }
        }
        for (var exclusion : definition.system().selectionRules().exclusions()) {
            long count = exclusion.optionKeys().stream().filter(ranks::containsKey).count();
            if (count > exclusion.maximumSelected()) {
                throw SnapshotIssues.invalid(path + ".selections", "EXCLUSION_VIOLATED", "选择超过已定义的互斥数量");
            }
        }
        var budget = definition.system().selectionRules().budget();
        if (budget == null || "FIXED".equals(budget.maximumSource())) {
            if (!configuration.budgets().isEmpty()) {
                throw SnapshotIssues.invalid(path + ".budgets", "REFERENCE_OUT_OF_SCOPE", "固定预算或无预算时不得提交场景预算");
            }
            long maximum = budget == null ? 0 : budget.fixedMaximum();
            if (cost > maximum) throw SnapshotIssues.invalid(path + ".budgets", "BUDGET_EXCEEDED", "累计逐级成本超过构筑预算");
        } else {
            if (!configuration.budgets().keySet().equals(Set.of(budget.budgetKey()))) {
                throw SnapshotIssues.invalid(path + ".budgets." + budget.budgetKey(), "BUDGET_REQUIRED", "必须明确提供且只提供定义要求的场景预算");
            }
            Integer maximum = configuration.budgets().get(budget.budgetKey());
            if (maximum == null || maximum < 0) throw SnapshotIssues.invalid(path + ".budgets." + budget.budgetKey(), "RANGE_INVALID", "场景预算必须为非负整数");
            if (cost > maximum) throw SnapshotIssues.invalid(path + ".budgets." + budget.budgetKey(), "BUDGET_EXCEEDED", "累计逐级成本超过构筑预算");
        }
    }

    private static void range(long count, int minimum, int maximum, String path, String message) {
        if (count < minimum || count > maximum) throw SnapshotIssues.invalid(path, "SELECTION_COUNT_INVALID", message);
    }
}
