package xyz.game.datamanage.service.skilltrigger.reference;

import static xyz.game.datamanage.service.skilltrigger.validation.SkillTriggerValidationSupport.nullToEmpty;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleMoment;
import xyz.game.datamanage.model.skilleffect.SkillEffectLifecycleRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultRequest;
import xyz.game.datamanage.model.skilleffect.SkillEffectResultType;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventSource;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEventType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateChangeKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateConditionDetail;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateLockRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerInternalStateValueKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;
import xyz.game.datamanage.support.authoring.SkillAttackStartValueSemantics;

/** 目录校验与反向引用保护共用的形状判定。 */
final class SkillTriggerReferenceSupport {

    private SkillTriggerReferenceSupport() {}

    static boolean isEligibleSpellShieldEffect(
        SkillEffectLifecycleRequest lifecycle,
        List<SkillEffectResultRequest> results
    ) {
        if (lifecycle == null || results == null) {
            return false;
        }
        return results.stream().anyMatch(result -> result != null
            && result.resultType() == SkillEffectResultType.SPELL_SHIELD
            && result.lifecycleBehavior() != null
            && result.lifecycleBehavior().moment() == SkillEffectLifecycleMoment.PERSISTENT);
    }

    static boolean isEligibleSpellShieldEffect(List<SkillTriggerEffectShapeRow> results) {
        return results.stream().anyMatch(result -> result.hasLifecycle()
            && result.resultType() == SkillEffectResultType.SPELL_SHIELD
            && result.resultMoment() == SkillEffectLifecycleMoment.PERSISTENT);
    }

    static Map<String, List<SkillTriggerEffectShapeRow>> indexEffects(List<SkillTriggerEffectShapeRow> rows) {
        Map<String, List<SkillTriggerEffectShapeRow>> indexed = new LinkedHashMap<>();
        for (SkillTriggerEffectShapeRow row : nullToEmpty(rows)) {
            indexed.computeIfAbsent(row.effectKey(), ignored -> new ArrayList<>()).add(row);
        }
        return indexed;
    }

    static Map<String, List<SkillTriggerProcessShapeRow>> indexProcesses(
        List<SkillTriggerProcessShapeRow> rows
    ) {
        Map<String, List<SkillTriggerProcessShapeRow>> indexed = new LinkedHashMap<>();
        for (SkillTriggerProcessShapeRow row : nullToEmpty(rows)) {
            indexed.computeIfAbsent(row.processKey(), ignored -> new ArrayList<>()).add(row);
        }
        return indexed;
    }

    static SkillTriggerEffectShapeRow findResult(
        Map<String, List<SkillTriggerEffectShapeRow>> effectShapes,
        String effectKey,
        String resultKey
    ) {
        if (resultKey == null) {
            return null;
        }
        for (SkillTriggerEffectShapeRow row : effectShapes.getOrDefault(effectKey, List.of())) {
            if (row.resultKey() != null && row.resultKey().equals(resultKey)) {
                return row;
            }
        }
        return null;
    }

    static boolean internalStateChangeMatches(
        SkillInternalStateType stateType,
        SkillTriggerInternalStateChangeKind changeKind
    ) {
        return switch (changeKind) {
            case VALUE_CHANGED -> stateType == SkillInternalStateType.COUNTER || stateType == SkillInternalStateType.AMMO;
            case OPTION_SELECTED -> stateType == SkillInternalStateType.MODE;
            case FLAG_CHANGED -> stateType == SkillInternalStateType.FLAG;
            case COOLDOWN_READY -> stateType == SkillInternalStateType.INTERNAL_COOLDOWN;
        };
    }

    static boolean internalStateValueMatches(
        SkillInternalStateType stateType,
        SkillTriggerInternalStateValueKind valueKind
    ) {
        return switch (valueKind) {
            case VALUE -> stateType == SkillInternalStateType.COUNTER || stateType == SkillInternalStateType.AMMO;
            case ATTACK_START_VALUE -> stateType == SkillInternalStateType.AMMO;
            case DAMAGE_BEFORE_VALUE -> false;
            case OPTION_SELECTED -> stateType == SkillInternalStateType.MODE;
            case ENABLED -> stateType == SkillInternalStateType.FLAG;
            case REMAINING_MS -> stateType == SkillInternalStateType.INTERNAL_COOLDOWN;
        };
    }

    static boolean conditionStateValueMatches(String skillKey, SkillTriggerEventSource event,
        SkillTriggerInternalStateConditionDetail detail, SkillTriggerInternalStateLockRow state) {
        if (state == null) return false;
        if (detail.valueKind() == SkillTriggerInternalStateValueKind.ATTACK_START_VALUE)
            return SkillAttackStartValueSemantics.readAllowed(skillKey, event, detail.stateSkillKey(), state);
        if (detail.valueKind() == SkillTriggerInternalStateValueKind.DAMAGE_BEFORE_VALUE)
            return skillKey.equals(detail.stateSkillKey()) && "TARGET".equals(state.scope())
                && state.stateType() == SkillInternalStateType.COUNTER && !state.targetTiming()
                && event != null && event.eventType() == SkillTriggerEventType.DAMAGE_DEALT;
        if (detail.valueKind() == SkillTriggerInternalStateValueKind.REMAINING_MS && state.stateType() == SkillInternalStateType.COUNTER)
            return skillKey.equals(detail.stateSkillKey()) && "TARGET".equals(state.scope());
        return internalStateValueMatches(state.stateType(), detail.valueKind());
    }
}
