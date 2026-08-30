package xyz.game.datamanage.model.skilltrigger;

import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;

public record SkillTriggerInternalStateLockRow(
    String stateKey,
    SkillInternalStateType stateType,
    String scope
) {
}
