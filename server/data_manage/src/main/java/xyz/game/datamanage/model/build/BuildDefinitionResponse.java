package xyz.game.datamanage.model.build;

import java.util.List;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;

public record BuildDefinitionResponse(
    BuildSystemResponse system,
    List<BuildGroupResponse> groups,
    List<BuildOptionResponse> options,
    List<BuildOptionSkillRelationResponse> skillRelations
) {}
