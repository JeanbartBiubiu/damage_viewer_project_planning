package xyz.game.datamanage.model.build;

import java.time.OffsetDateTime;
import java.util.List;

public record BuildSystemResponse(
    String gameId,
    String systemKey,
    String name,
    String description,
    String configurationMode,
    int sortOrder,
    SelectionRules selectionRules,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public record SelectionRules(
        List<GroupRole> groupRoles,
        Budget budget,
        List<Prerequisite> prerequisites,
        List<Exclusion> exclusions
    ) {}

    public record GroupRole(
        String roleKey,
        String name,
        List<String> groupKeys,
        int minimumGroups,
        int maximumGroups,
        int minimumSelectedSlots,
        int maximumSelectedSlots,
        List<String> distinctFromRoleKeys,
        List<SlotRule> slotRules
    ) {}

    public record SlotRule(
        String groupKey,
        String slotKey,
        int minimumSelections,
        int maximumSelections
    ) {}

    public record Budget(
        String budgetKey,
        String name,
        String maximumSource,
        Integer fixedMaximum
    ) {}

    public record Prerequisite(
        String optionKey,
        int minimumRank,
        String requiredOptionKey,
        int requiredMinimumRank
    ) {}

    public record Exclusion(List<String> optionKeys, int maximumSelected) {}
}
