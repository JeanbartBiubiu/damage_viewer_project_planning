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
        @Param("eventType") String eventType
    );

    int updateRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("name") String name,
        @Param("description") String description,
        @Param("sortOrder") Integer sortOrder,
        @Param("eventType") String eventType
    );

    int deleteRule(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    int deleteAllForSkill(@Param("gameId") String gameId, @Param("skillKey") String skillKey);

    int deleteChildren(@Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey);

    SkillTriggerProcessEventRow findProcessEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerSkillEventRow findSkillEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerResultEventRow findResultEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerLifecycleEventRow findLifecycleEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerStatusEventRow findStatusEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerHealthThresholdEventRow findHealthEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerInternalStateEventRow findInternalStateEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerSubjectEventRow findSubjectEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerDamageEventRow findDamageEvent(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerSpellShieldBlockedEventRow findSpellShieldBlockedEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey
    );

    int insertProcessEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("processKey") String processKey,
        @Param("momentType") String momentType,
        @Param("stepKey") String stepKey
    );

    int insertSkillEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("sourceSkillKey") String sourceSkillKey,
        @Param("useKind") String useKind
    );

    int insertResultEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey
    );

    int insertLifecycleEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("effectKey") String effectKey,
        @Param("lifecycleMoment") String lifecycleMoment
    );

    int insertStatusEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("subject") String subject,
        @Param("statusKey") String statusKey,
        @Param("changeKind") String changeKind
    );

    int insertHealthEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("subject") String subject,
        @Param("attributeKey") String attributeKey,
        @Param("thresholdFormulaKey") String thresholdFormulaKey,
        @Param("direction") String direction
    );

    int insertInternalStateEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("stateKey") String stateKey,
        @Param("changeKind") String changeKind
    );

    int insertSubjectEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("subject") String subject
    );

    int insertDamageEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("damageTypeKey") String damageTypeKey,
        @Param("deliveryKind") String deliveryKind,
        @Param("originKind") String originKind
    );

    int insertSpellShieldBlockedEvent(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("shieldEffectKey") String shieldEffectKey
    );

    List<SkillTriggerConditionGroupRow> listConditionGroups(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerConditionRow> listConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerAttributeConditionRow> listAttributeConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerStatusConditionRow> listStatusConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerInternalStateConditionRow> listInternalStateConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerEventValueConditionRow> listEventValueConditions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    int insertConditionGroup(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("groupKey") String groupKey,
        @Param("name") String name,
        @Param("sortOrder") Integer sortOrder
    );

    int insertCondition(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("groupKey") String groupKey,
        @Param("conditionKey") String conditionKey,
        @Param("conditionType") String conditionType,
        @Param("sortOrder") Integer sortOrder
    );

    int insertAttributeCondition(SkillTriggerAttributeConditionRow row);

    int insertStatusCondition(SkillTriggerStatusConditionRow row);

    int insertInternalStateCondition(SkillTriggerInternalStateConditionRow row);

    int insertEventValueCondition(SkillTriggerEventValueConditionRow row);

    List<SkillTriggerActionRow> listActions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerEffectActionRow> listEffectActions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerProcessActionRow> listProcessActions(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    int insertAction(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("actionKey") String actionKey,
        @Param("name") String name,
        @Param("actionType") String actionType,
        @Param("sortOrder") Integer sortOrder,
        @Param("targetContext") String targetContext
    );

    int insertEffectAction(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("actionKey") String actionKey,
        @Param("effectKey") String effectKey
    );

    int insertProcessAction(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("actionKey") String actionKey,
        @Param("processKey") String processKey,
        @Param("failureReason") String failureReason
    );

    List<SkillTriggerRuntimeInputBindingRow> listBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerInternalStateBindingRow> listInternalStateBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerCombatStatusBindingRow> listCombatStatusBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerEventValueBindingRow> listEventValueBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    List<SkillTriggerPriorResultBindingRow> listPriorResultBindings(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    int insertBinding(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("actionKey") String actionKey,
        @Param("bindingKey") String bindingKey,
        @Param("parameterKey") String parameterKey,
        @Param("sourceType") String sourceType
    );

    int insertInternalStateBinding(SkillTriggerInternalStateBindingRow row);

    int insertCombatStatusBinding(SkillTriggerCombatStatusBindingRow row);

    int insertEventValueBinding(SkillTriggerEventValueBindingRow row);

    int insertPriorResultBinding(SkillTriggerPriorResultBindingRow row);

    List<SkillTriggerResultModifierRow> listModifiers(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    int insertModifier(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("actionKey") String actionKey,
        @Param("resultKey") String resultKey,
        @Param("effectKey") String effectKey,
        @Param("fixedMultiplier") BigDecimal fixedMultiplier,
        @Param("fixedMinValue") BigDecimal fixedMinValue,
        @Param("fixedMaxValue") BigDecimal fixedMaxValue
    );

    SkillTriggerPerTargetCooldownRow findCooldown(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    SkillTriggerProcessLimitRow findProcessLimit(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey, @Param("ruleKey") String ruleKey
    );

    int insertCooldown(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("durationFormulaKey") String durationFormulaKey,
        @Param("targetContext") String targetContext
    );

    int insertProcessLimit(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("ruleKey") String ruleKey,
        @Param("processKey") String processKey,
        @Param("limitFormulaKey") String limitFormulaKey
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

    List<SkillTriggerEffectShapeRow> listEffectShapes(
        @Param("gameId") String gameId, @Param("skillKey") String skillKey
    );

    List<String> listEffectInteractionFormulaKeys(
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

    List<String> listInternalStateFormulaKeys(
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

    List<String> lockResults(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
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

    boolean effectHasLifecycle(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey
    );

    SkillTriggerEffectShapeRow findEffectShape(
        @Param("gameId") String gameId,
        @Param("skillKey") String skillKey,
        @Param("effectKey") String effectKey,
        @Param("resultKey") String resultKey
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

    void forceDeferredConstraintsImmediate();
}
