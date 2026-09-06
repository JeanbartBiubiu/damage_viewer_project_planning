package xyz.game.datamanage.service.skilltrigger;

import xyz.game.datamanage.model.value.SkillNumericValue;

import java.util.Collection;
import xyz.game.datamanage.support.authoring.AggregateJson;
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
        return reachableRuntimeParameters(
            gameId,
            skillKey,
            actionType,
            targetKey,
            effectsByKey,
            processesByKey,
            Map.of()
        );
    }

    public Map<String, SkillParameterValueType> reachableRuntimeParameters(
        String gameId,
        String skillKey,
        SkillTriggerActionType actionType,
        String targetKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        Map<String, ? extends Collection<SkillNumericValue>> interactionValueOverrides
    ) {
        return reachableRuntimeParameters(
            gameId,
            skillKey,
            actionType,
            targetKey,
            effectsByKey,
            processesByKey,
            interactionValueOverrides,
            Map.of()
        );
    }

    public Map<String, SkillParameterValueType> reachableRuntimeParameters(
        String gameId,
        String skillKey,
        SkillTriggerActionType actionType,
        String targetKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        Map<String, ? extends Collection<SkillNumericValue>> interactionValueOverrides,
        Map<String, ? extends Collection<SkillNumericValue>> resultValueOverrides
    ) {
        Set<SkillNumericValue> values = new LinkedHashSet<>();
        if (actionType == SkillTriggerActionType.EXECUTE_EFFECT) {
            collectEffectValues(
                gameId,
                skillKey,
                targetKey,
                effectsByKey,
                interactionValueOverrides,
                resultValueOverrides,
                values
            );
        } else if (actionType == SkillTriggerActionType.START_PROCESS) {
            collectProcessValues(
                gameId,
                skillKey,
                targetKey,
                effectsByKey,
                processesByKey,
                interactionValueOverrides,
                resultValueOverrides,
                values,
                new LinkedHashSet<>()
            );
        }
        if (values.isEmpty()) {
            return Map.of();
        }
        Set<String> formulaKeys = new LinkedHashSet<>();
        Set<String> parameterKeys = new LinkedHashSet<>();
        for (SkillNumericValue value : values) {
            if (value.formulaKey() != null) formulaKeys.add(value.formulaKey());
            if (value.parameterKey() != null) parameterKeys.add(value.parameterKey());
        }
        Map<String, SkillParameterValueType> reachable = new LinkedHashMap<>();
        if (!parameterKeys.isEmpty()) {
            for (SkillTriggerParameterRefRow row : nullToEmpty(mapper.lockParameters(gameId, skillKey, parameterKeys))) {
                if (SkillParameterValueMode.RUNTIME_INPUT.name().equals(row.valueMode())) reachable.put(row.parameterKey(), row.valueType());
            }
        }
        for (SkillTriggerParameterRefRow row : nullToEmpty(
            formulaKeys.isEmpty() ? List.of() : mapper.listRuntimeInputParameters(gameId, skillKey, formulaKeys)
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

    private void collectEffectValues(
        String gameId,
        String skillKey,
        String effectKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, ? extends Collection<SkillNumericValue>> interactionValueOverrides,
        Map<String, ? extends Collection<SkillNumericValue>> resultValueOverrides,
        Set<SkillNumericValue> values
    ) {
        List<SkillTriggerEffectShapeRow> results = effectsByKey.getOrDefault(effectKey, List.of());
        boolean lifecycleFormulasCollected = false;
        for (SkillTriggerEffectShapeRow row : results) {
            if (!resultValueOverrides.containsKey(effectKey)) {
                addValue(values, row.value());
            }
            if (!lifecycleFormulasCollected && row.hasLifecycle()) {
                addValue(values, row.durationValue());
                addValue(values, row.maxStacksValue());
                addValue(values, row.applicationStacksValue());
                addValue(values, row.periodicIntervalValue());
                lifecycleFormulasCollected = true;
            }
        }
        if (resultValueOverrides.containsKey(effectKey)) {
            for (SkillNumericValue formulaKey : nullToEmpty(resultValueOverrides.get(effectKey))) {
                addValue(values, formulaKey);
            }
        }
        Collection<SkillNumericValue> interactionValues = interactionValueOverrides.containsKey(effectKey)
            ? interactionValueOverrides.get(effectKey)
            : nullToEmpty(mapper.listEffectInteractionValues(gameId, skillKey, effectKey)).stream().map(json -> AggregateJson.read(json, SkillNumericValue.class)).toList();
        for (SkillNumericValue formulaKey : nullToEmpty(interactionValues)) {
            addValue(values, formulaKey);
        }
    }

    private void collectProcessValues(
        String gameId,
        String skillKey,
        String processKey,
        Map<String, List<SkillTriggerEffectShapeRow>> effectsByKey,
        Map<String, List<SkillTriggerProcessShapeRow>> processesByKey,
        Map<String, ? extends Collection<SkillNumericValue>> interactionValueOverrides,
        Map<String, ? extends Collection<SkillNumericValue>> resultValueOverrides,
        Set<SkillNumericValue> values,
        Set<String> visitedEffects
    ) {
        for (SkillTriggerProcessShapeRow row : processesByKey.getOrDefault(processKey, List.of())) {
            addValue(values, row.cooldownValue());
            addValue(values, row.delayValue());
            addValue(values, row.multiCountValue());
            addValue(values, row.multiIntervalValue());
            addValue(values, row.periodicCountValue());
            addValue(values, row.periodicIntervalValue());
            addValue(values, row.channelDurationValue());
            addValue(values, row.channelCountValue());
            addValue(values, row.chargeMinValue());
            addValue(values, row.chargeMaxValue());
            addValue(values, row.recastWindowValue());
            addValue(values, row.recastCountValue());
            addValue(values, row.empoweredWindowValue());
            addValue(values, row.counterInitialValue());
            addValue(values, row.counterMaxValue());
            addValue(values, row.ammoInitialValue());
            addValue(values, row.ammoMaxValue());
            addValue(values, row.ammoRecoveryValue());
            addValue(values, row.cooldownDurationValue());
            addValue(values, row.operationValue());
            if (row.bindingEffectKey() != null && visitedEffects.add(row.bindingEffectKey())) {
                collectEffectValues(
                    gameId,
                    skillKey,
                    row.bindingEffectKey(),
                    effectsByKey,
                    interactionValueOverrides,
                    resultValueOverrides,
                    values
                );
            }
            if (shouldCollectStateDefinitionValues(row) && row.operationStateKey() != null) {
                for (String formulaKey : nullToEmpty(
                    mapper.listInternalStateValues(gameId, skillKey, row.operationStateKey())
                )) {
                    addValue(values, AggregateJson.read(formulaKey, SkillNumericValue.class));
                }
            }
        }
    }

    private static boolean shouldCollectStateDefinitionValues(SkillTriggerProcessShapeRow row) {
        if (row.operation() == null) {
            return false;
        }
        if (row.operation() == SkillProcessStateOperationKind.RESET) {
            return true;
        }
        if (row.stateType() == SkillInternalStateType.COUNTER || row.stateType() == SkillInternalStateType.AMMO) return true;
        return row.operation() == SkillProcessStateOperationKind.START
            && row.stateType() == SkillInternalStateType.INTERNAL_COOLDOWN;
    }

    private static void addValue(Set<SkillNumericValue> values, SkillNumericValue value) {
        if (value != null) values.add(value);
    }

    private static <T> List<T> nullToEmpty(Collection<T> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        return List.copyOf(values);
    }
}
