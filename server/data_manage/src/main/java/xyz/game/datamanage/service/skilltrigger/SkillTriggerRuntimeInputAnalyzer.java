package xyz.game.datamanage.service.skilltrigger;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.mapper.skilltrigger.SkillTriggerRuleMapper;
import xyz.game.datamanage.model.skillinternalstate.SkillInternalStateType;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueMode;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.model.skillprocess.SkillProcessStateOperationKind;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerActionType;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerEffectShapeRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerParameterRefRow;
import xyz.game.datamanage.model.skilltrigger.SkillTriggerProcessShapeRow;

@Component
public class SkillTriggerRuntimeInputAnalyzer {

    private final SkillTriggerRuleMapper mapper;

    public SkillTriggerRuntimeInputAnalyzer(SkillTriggerRuleMapper mapper) {
        this.mapper = mapper;
    }

    public Map<String, SkillParameterValueType> reachableRuntimeParameters(
        String gameId,
        String skillKey,
        SkillTriggerActionType actionType,
        String targetKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey
    ) {
        Set<String> formulaKeys = new LinkedHashSet<>();
        if (actionType == SkillTriggerActionType.EXECUTE_EFFECT) {
            collectEffectFormulas(targetKey, effectsByKey, formulaKeys);
        } else if (actionType == SkillTriggerActionType.START_PROCESS) {
            collectProcessFormulas(gameId, skillKey, targetKey, effectsByKey, processesByKey, formulaKeys, new LinkedHashSet<>());
        }
        if (formulaKeys.isEmpty()) {
            return Map.of();
        }
        Map<String, SkillParameterValueType> reachable = new LinkedHashMap<>();
        for (SkillTriggerParameterRefRow row : nullToEmpty(
            mapper.listRuntimeInputParameters(gameId, skillKey, formulaKeys)
        )) {
            if (row == null || row.parameterKey() == null) {
                continue;
            }
            if (!SkillParameterValueMode.RUNTIME_INPUT.name().equals(row.valueMode())) {
                continue;
            }
            reachable.put(row.parameterKey(), row.valueType());
        }
        return reachable;
    }

    private void collectEffectFormulas(
        String effectKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Set<String> formulaKeys
    ) {
        List<SkillTriggerEffectShapeRow> results = effectsByKey.getOrDefault(effectKey, List.of());
        boolean lifecycleFormulasCollected = false;
        for (SkillTriggerEffectShapeRow row : results) {
            addFormula(formulaKeys, row.valueFormulaKey());
            if (!lifecycleFormulasCollected && row.hasLifecycle()) {
                addFormula(formulaKeys, row.durationFormulaKey());
                addFormula(formulaKeys, row.maxStacksFormulaKey());
                addFormula(formulaKeys, row.applicationStacksFormulaKey());
                addFormula(formulaKeys, row.periodicIntervalFormulaKey());
                lifecycleFormulasCollected = true;
            }
        }
    }

    private void collectProcessFormulas(
        String gameId,
        String skillKey,
        String processKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        Set<String> formulaKeys,
        Set<String> visitedEffects
    ) {
        for (SkillTriggerProcessShapeRow row : processesByKey.getOrDefault(processKey, List.of())) {
            addFormula(formulaKeys, row.cooldownFormulaKey());
            addFormula(formulaKeys, row.delayFormulaKey());
            addFormula(formulaKeys, row.multiCountFormulaKey());
            addFormula(formulaKeys, row.multiIntervalFormulaKey());
            addFormula(formulaKeys, row.periodicCountFormulaKey());
            addFormula(formulaKeys, row.periodicIntervalFormulaKey());
            addFormula(formulaKeys, row.channelDurationFormulaKey());
            addFormula(formulaKeys, row.channelCountFormulaKey());
            addFormula(formulaKeys, row.chargeMinFormulaKey());
            addFormula(formulaKeys, row.chargeMaxFormulaKey());
            addFormula(formulaKeys, row.recastWindowFormulaKey());
            addFormula(formulaKeys, row.recastCountFormulaKey());
            addFormula(formulaKeys, row.empoweredWindowFormulaKey());
            addFormula(formulaKeys, row.counterInitialFormulaKey());
            addFormula(formulaKeys, row.counterMaxFormulaKey());
            addFormula(formulaKeys, row.ammoInitialFormulaKey());
            addFormula(formulaKeys, row.ammoMaxFormulaKey());
            addFormula(formulaKeys, row.ammoRecoveryFormulaKey());
            addFormula(formulaKeys, row.cooldownDurationFormulaKey());
            addFormula(formulaKeys, row.operationValueFormulaKey());
            if (row.bindingEffectKey() != null && visitedEffects.add(row.bindingEffectKey())) {
                collectEffectFormulas(row.bindingEffectKey(), effectsByKey, formulaKeys);
            }
            if (shouldCollectStateDefinitionFormulas(row) && row.operationStateKey() != null) {
                for (String formulaKey : nullToEmpty(
                    mapper.listInternalStateFormulaKeys(gameId, skillKey, row.operationStateKey())
                )) {
                    addFormula(formulaKeys, formulaKey);
                }
            }
        }
    }

    private static boolean shouldCollectStateDefinitionFormulas(SkillTriggerProcessShapeRow row) {
        if (row.operation() == null) {
            return false;
        }
        if (row.operation() == SkillProcessStateOperationKind.RESET) {
            return true;
        }
        return row.operation() == SkillProcessStateOperationKind.START
            && row.stateType() == SkillInternalStateType.INTERNAL_COOLDOWN;
    }

    private static void addFormula(Set<String> formulaKeys, String formulaKey) {
        if (formulaKey != null && !formulaKey.isBlank()) {
            formulaKeys.add(formulaKey);
        }
    }

    private static <T> List<T> nullToEmpty(Collection<T> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        return List.copyOf(values);
    }
}
