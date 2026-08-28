package xyz.game.datamanage.model.skillinternalstate;

import java.util.Set;

public sealed interface SkillInternalStateDetail
    permits SkillInternalStateCounterDetail,
        SkillInternalStateAmmoDetail,
        SkillInternalStateModeDetail,
        SkillInternalStateFlagDetail,
        SkillInternalStateCooldownDetail {

    Set<String> foreignFields();

    Set<String> unknownFields();
}
