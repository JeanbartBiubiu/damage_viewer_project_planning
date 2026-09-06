package xyz.game.datamanage.model.imagerelation;

public record ImageUsageRow(
    String sourceType,
    String sourceParentKey,
    String sourceKey,
    String sourceName,
    String sourceStatus,
    String parentName
) {}
