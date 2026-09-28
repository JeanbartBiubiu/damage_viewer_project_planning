package xyz.game.datamanage.model.build;

import java.util.List;

public record BuildSlot(
    String slotKey,
    String name,
    int minimumSelections,
    int maximumSelections,
    List<String> optionKeys
) {}
