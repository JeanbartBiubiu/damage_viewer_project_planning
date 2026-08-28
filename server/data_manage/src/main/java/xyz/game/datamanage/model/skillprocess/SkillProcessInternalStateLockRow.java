package xyz.game.datamanage.model.skillprocess;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;

public record SkillProcessInternalStateLockRow(
    String stateKey,
    SkillInternalStateType stateType
) {
}
