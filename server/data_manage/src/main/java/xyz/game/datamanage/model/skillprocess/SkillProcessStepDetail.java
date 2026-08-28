package xyz.game.datamanage.model.skillprocess;

import java.util.Set;

public sealed interface SkillProcessStepDetail
    permits SkillProcessImmediateStepDetail,
        SkillProcessDelayStepDetail,
        SkillProcessMultiHitStepDetail,
        SkillProcessPeriodicStepDetail,
        SkillProcessChannelStepDetail,
        SkillProcessChargeStepDetail,
        SkillProcessRecastStepDetail,
        SkillProcessEmpoweredAttackStepDetail {

    Set<String> foreignFields();

    Set<String> unknownFields();
}
