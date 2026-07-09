package runtime

import (
	"encoding/json"
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/resource"
)

type gateCheckResult struct {
	skipped    bool
	reason     model.AttemptSkipReason
	readyAtMs  int64
	ability    compilebundle.CompiledAbility
	sourceKey  string
	hasAbility bool
}

func isValidSelector(sel string) bool {
	_, ok := model.ValidCombatantSelectors[sel]
	return ok
}

func (s *genericRunState) checkAttemptGate(entry model.DriverEntry, entryIndex int) gateCheckResult {
	sourceKey, sourceOK := s.resolveCombatantKey(entry.Source, entry.Source, entry.Target)
	targetKey, targetOK := s.resolveCombatantKey(entry.Target, entry.Source, entry.Target)
	if !isValidSelector(entry.Source) || !isValidSelector(entry.Target) || !sourceOK || !targetOK {
		return gateCheckResult{skipped: true, reason: model.AttemptSkipTargetUnavailable}
	}

	resolvedRef := normalizeAbilityRef(entry.AbilityRef, sourceKey, targetKey)
	if _, ok := s.compiled.AbilityRefIndex[resolvedRef]; !ok {
		return gateCheckResult{skipped: true, reason: model.AttemptSkipUnknownAbilityRef}
	}

	ref := s.compiled.AbilityRefIndex[resolvedRef]
	ability := s.compiled.Abilities[ref.AbilityIndex]

	if readyAt, blocked := s.cooldownGate(sourceKey, resolvedRef); blocked {
		return gateCheckResult{
			skipped:    true,
			reason:     model.AttemptSkipCooldownNotReady,
			readyAtMs:  readyAt,
			ability:    ability,
			sourceKey:  sourceKey,
			hasAbility: true,
		}
	}
	if readyAt, blocked := s.resourceGate(sourceKey, targetKey, ability, entry); blocked {
		return gateCheckResult{
			skipped:    true,
			reason:     model.AttemptSkipResourceInsufficient,
			readyAtMs:  readyAt,
			ability:    ability,
			sourceKey:  sourceKey,
			hasAbility: true,
		}
	}
	if blocked := s.conditionGate(entry, entryIndex, sourceKey, targetKey, ability); blocked {
		return gateCheckResult{
			skipped:    true,
			reason:     model.AttemptSkipConditionFalse,
			readyAtMs:  s.nowMs + s.conditionRecheckIntervalMs,
			ability:    ability,
			sourceKey:  sourceKey,
			hasAbility: true,
		}
	}

	_ = targetKey
	return gateCheckResult{
		ability:    ability,
		sourceKey:  sourceKey,
		hasAbility: true,
	}
}

func (s *genericRunState) cooldownGate(sourceKey, abilityRef string) (readyAtMs int64, blocked bool) {
	c, ok := s.combatants[sourceKey]
	if !ok {
		return 0, false
	}
	readyAt, exists := c.cooldowns[abilityRef]
	if !exists || readyAt <= 0 {
		return 0, false
	}
	if s.nowMs < readyAt {
		return readyAt, true
	}
	return 0, false
}

func (s *genericRunState) resourceGate(sourceKey, targetKey string, ability compilebundle.CompiledAbility, entry model.DriverEntry) (readyAtMs int64, blocked bool) {
	if ability.Cost == nil || !ability.Cost.HasAmount {
		return 0, false
	}
	c, ok := s.combatants[sourceKey]
	if !ok {
		return s.nowMs + s.conditionRecheckIntervalMs, true
	}
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		SourceAttrs:     c.attributes,
		TargetAttrs:     target.attributes,
		SourceResources: c.resources,
		TargetResources: target.resources,
		AbilityParams:   ability.Params,
	}
	_ = entry
	amount, err := s.compiled.Formulas.Eval(ability.Cost.AmountProgram, ctx)
	if err != nil {
		amount = math.MaxFloat64
	}
	current := resource.ReadCurrent(c.resources, ability.Cost.ResourceKey)
	if ability.Cost.AllowPartial {
		if current >= 0 {
			return 0, false
		}
	} else if current >= amount {
		return 0, false
	}
	slot := c.resources[ability.Cost.ResourceKey]
	readyAt := resource.EstimateReadyTimeMs(
		s.nowMs,
		current,
		amount,
		resource.RegenPerMs(slot),
		s.conditionRecheckIntervalMs,
	)
	if readyAt <= s.nowMs {
		readyAt = s.nowMs + s.conditionRecheckIntervalMs
	}
	return readyAt, true
}

func (s *genericRunState) conditionGate(entry model.DriverEntry, entryIndex int, sourceKey, targetKey string, ability compilebundle.CompiledAbility) bool {
	if entryIndex < 0 || entryIndex >= len(s.entryConditions) || s.entryConditions[entryIndex] == nil {
		return false
	}
	programID := *s.entryConditions[entryIndex]
	source := s.combatants[sourceKey]
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		SourceAttrs:     source.attributes,
		TargetAttrs:     target.attributes,
		SourceResources: source.resources,
		TargetResources: target.resources,
		AbilityParams:   ability.Params,
	}
	value, err := s.compiled.Formulas.Eval(programID, ctx)
	if err != nil {
		return true
	}
	return value == 0
}

func (s *genericRunState) nextWhileReadyTime(entry model.DriverEntry, result gateCheckResult) int64 {
	var nextAt int64
	switch result.reason {
	case model.AttemptSkipCooldownNotReady:
		nextAt = result.readyAtMs
	case model.AttemptSkipResourceInsufficient:
		nextAt = result.readyAtMs
	case model.AttemptSkipConditionFalse:
		nextAt = s.nowMs + s.conditionRecheckIntervalMs
	default:
		nextAt = s.nowMs + s.conditionRecheckIntervalMs
	}
	if nextAt <= s.nowMs {
		nextAt = s.nowMs + s.conditionRecheckIntervalMs
	}
	return nextAt
}

func materializeCooldowns(raw map[string]interface{}) map[string]int64 {
	if len(raw) == 0 {
		return map[string]int64{}
	}
	out := make(map[string]int64, len(raw))
	for key, value := range raw {
		if readyAt := parseCooldownReadyAtMs(value); readyAt > 0 {
			out[key] = readyAt
		}
	}
	return out
}

func parseCooldownReadyAtMs(value interface{}) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return n
		}
	case map[string]interface{}:
		if raw, ok := v["readyAtMs"]; ok {
			return parseCooldownReadyAtMs(raw)
		}
	}
	return 0
}

func cloneCooldownMap(src map[string]int64) map[string]int64 {
	if len(src) == 0 {
		return map[string]int64{}
	}
	dst := make(map[string]int64, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

// normalizeAbilityRef 将 self/opponent abilityRef 归一为 source/target concrete ref。
func normalizeAbilityRef(abilityRef, sourceKey, targetKey string) string {
	parsed, ok := compilebundle.ParseAbilityRef(abilityRef)
	if !ok {
		return abilityRef
	}
	combatant := parsed.Combatant
	switch combatant {
	case model.SelectorSelf:
		combatant = sourceKey
	case model.SelectorOpponent:
		if sourceKey == model.SelectorSource {
			combatant = model.SelectorTarget
		} else if sourceKey == model.SelectorTarget {
			combatant = model.SelectorSource
		} else {
			combatant = targetKey
		}
	case model.SelectorSource, model.SelectorTarget:
		// already concrete
	default:
		return abilityRef
	}
	if combatant == "" {
		return abilityRef
	}
	return combatant + ".provider[" + parsed.ProviderRef + "].ability[" + parsed.AbilityKey + "]"
}
