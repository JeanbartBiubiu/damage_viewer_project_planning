package xyz.game.datamanage.mapper.skilltrigger;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerAttributeConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCatalogLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerCombatStatusBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionGroupRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerDamageEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventValueConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerHealthThresholdEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLifecycleEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerLinkEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerParameterRefRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPerTargetCooldownRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerPriorResultBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessActionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessLimitRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerReferenceHit;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerResultModifierRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuleSummaryResponse;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerRuntimeInputBindingRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSkillEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusConditionRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerStatusEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSpellShieldBlockedEventRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerSubjectEventRow;

@Mapper
public interface SkillTriggerRuleMapper {

    List<SkillTriggerRuleSummaryResponse> listSummaries(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    SkillTriggerRuleRow findRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    SkillTriggerRuleRow findRuleForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerRuleRow> listRulesForUpdate(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey
    );

    long countByKey(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    int insertRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("eventType") String eventType,
        @Param("eventSourceJson") String eventSourceJson,
        @Param("conditionGroupsJson") String conditionGroupsJson,
        @Param("actionsJson") String actionsJson,
        @Param("limitsJson") String limitsJson
    );

    int updateRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("eventType") String eventType,
        @Param("eventSourceJson") String eventSourceJson,
        @Param("conditionGroupsJson") String conditionGroupsJson,
        @Param("actionsJson") String actionsJson,
        @Param("limitsJson") String limitsJson
    );

    int deleteRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    int deleteAllForSkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    List<SkillTriggerStatusConditionRow> listStatusConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerCombatStatusBindingRow> listCombatStatusBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerPriorResultBindingRow> listPriorResultBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerResultModifierRow> listModifiers(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerRuleRow> listRules(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerActionRow> listActionsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerEffectActionRow> listEffectActionsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerProcessActionRow> listProcessActionsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerPerTargetCooldownRow> listCooldownsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerProcessLimitRow> listProcessLimitsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerProcessEventRow> listProcessEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerResultEventRow> listResultEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerLifecycleEventRow> listLifecycleEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerStatusEventRow> listStatusEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerHealthThresholdEventRow> listHealthEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerInternalStateEventRow> listInternalStateEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerSubjectEventRow> listSubjectEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerDamageEventRow> listDamageEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerLinkEventRow> listLinkEventsForSkill(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerEffectShapeRow> listEffectShapes(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<String> listEffectInteractionValues(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    List<SkillTriggerProcessShapeRow> listProcessShapes(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<SkillTriggerParameterRefRow> listRuntimeInputParameters(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKeys") Collection<String> formulaKeys
    );

    List<String> listInternalStateValues(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey
    );

    long countRuntimeInputNodes(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("formulaKey") String formulaKey
    );

    List<SkillTriggerCatalogLockRow> lockAttributes(
        @Param("gameId") String gameId, @Param("keys") Collection<String> keys
    );

    List<SkillTriggerCatalogLockRow> lockStatuses(
        @Param("gameId") String gameId, @Param("keys") Collection<String> keys
    );

    List<SkillTriggerCatalogLockRow> lockDamageTypes(
        @Param("gameId") String gameId, @Param("keys") Collection<String> keys
    );

    List<String> lockFormulas(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillTriggerParameterRefRow> lockParameters(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<String> lockEffects(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<String> lockProcesses(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<String> lockSteps(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillTriggerInternalStateLockRow> lockInternalStates(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("keys") Collection<String> keys
    );

    List<String> lockOptions(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("keys") Collection<String> keys
    );

    List<SkillTriggerCatalogLockRow> lockSkills(
        @Param("gameId") String gameId, @Param("keys") Collection<String> keys
    );

    String findStepType(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey
    );

    long countStatusApplyPersistent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey,
        @Param("statusKey") String statusKey
    );

    long countEffectReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("effectKey") String effectKey
    );

    List<SkillTriggerReferenceHit> listResultReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKeys") Collection<String> resultKeys
    );

    long countLifecycleReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("effectKey") String effectKey
    );

    long countSpellShieldBlockedEventReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    long countProcessReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("processKey") String processKey
    );

    long countStepReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("processKey") String processKey,
        @Param("stepKey") String stepKey
    );

    long countInternalStateReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("stateKey") String stateKey
    );

    long countOptionReferences(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("stateKey") String stateKey,
        @Param("optionKeys") Collection<String> optionKeys
    );

    long countFormulaReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("formulaKey") String formulaKey
    );

    long countParameterReferences(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("parameterKey") String parameterKey
    );

    long countStatusReferences(@Param("gameId") String gameId, @Param("statusKey") String statusKey);

    long countSourceSkillReferences(
        @Param("gameId") String gameId, @Param("sourceSkillKey") String sourceSkillKey
    );


}
