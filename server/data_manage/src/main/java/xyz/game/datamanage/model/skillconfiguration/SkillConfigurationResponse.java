package xyz.game.datamanage.model.skillconfiguration;

import java.util.List;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.model.skillparameter.SkillParameterResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skilleffect.SkillEffectDetailResponse;
import xyz.game.datamanage.model.skillprocess.SkillProcessDetailResponse;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateDetailResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleDetailResponse;

public record SkillConfigurationResponse(
    SkillResponse skill,
    List<SkillParameterResponse> parameters,
    List<SkillFormulaDetailResponse> formulas,
    List<SkillEffectDetailResponse> effects,
    List<SkillProcessDetailResponse> processes,
    List<SkillInternalStateDetailResponse> internalStates,
    List<SkillTriggerRuleDetailResponse> triggerRules,
    String baseDigest
) {
}
