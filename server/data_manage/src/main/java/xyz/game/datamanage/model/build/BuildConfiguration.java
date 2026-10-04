package xyz.game.datamanage.model.build;

import java.util.List;
import java.util.Map;

public record BuildConfiguration(String systemKey, List<GroupAssignment> groupAssignments,
                                 List<OptionSelection> selections, Map<String, Integer> budgets) {
    public record GroupAssignment(String roleKey, String groupKey) { }

    public record OptionSelection(String roleKey, String groupKey, String slotKey, String optionKey, int rank) { }
}
