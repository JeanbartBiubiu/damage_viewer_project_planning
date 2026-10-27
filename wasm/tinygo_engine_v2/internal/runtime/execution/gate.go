package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"encoding/json"
	"math"
	"sort"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

type gateCheckResult struct {
	err        *model.EngineError
	skipped    bool
	reason     model.AttemptSkipReason
	readyAtMs  int64
	ability    planbundle.CompiledAbility
	sourceKey  string
	hasAbility bool
}

func isValidSelector(sel string) bool {
	_, ok := model.ValidCombatantSelectors[sel]
	return ok
}

func (s *Engine) checkAttemptGate(entry model.DriverEntry, entryIndex int) gateCheckResult {
	sourceKey, sourceOK := s.resolveDriverCombatantKey(entry.Source, model.SelectorSource)
	targetKey, targetOK := s.resolveDriverCombatantKey(entry.Target, sourceKey)
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
	readyAt, blocked, resourceErr := s.resourceGate(sourceKey, targetKey, ability, resolvedRef, entry)
	if resourceErr != nil {
		return gateCheckResult{err: resourceErr}
	}
	if blocked {
		return gateCheckResult{
			skipped:    true,
			reason:     model.AttemptSkipResourceInsufficient,
			readyAtMs:  readyAt,
			ability:    ability,
			sourceKey:  sourceKey,
			hasAbility: true,
		}
	}
	blocked, conditionErr := s.conditionGate(entry, entryIndex, sourceKey, targetKey, ability, resolvedRef)
	if conditionErr != nil {
		return gateCheckResult{err: conditionErr}
	}
	if blocked {
		return gateCheckResult{
			skipped:    true,
			reason:     model.AttemptSkipConditionFalse,
			readyAtMs:  s.loop.TimeMs() + s.conditionRecheckIntervalMs,
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

func (s *Engine) cooldownGate(sourceKey, abilityRef string) (readyAtMs int64, blocked bool) {
	sourceKey = actionpkg.AbilityCooldownOwner(sourceKey, abilityRef)
	c, ok := s.combatants[sourceKey]
	if !ok {
		return 0, false
	}
	id := actionpkg.AbilityCooldownIdentity(sourceKey, abilityRef)
	if c.cooldowns.Remaining(id, s.loop.TimeMs()) > 0 {
		return c.cooldowns.ReadyAt(id), true
	}
	return 0, false
}

func (s *Engine) resourceGate(sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string, entry model.DriverEntry) (readyAtMs int64, blocked bool, formulaErr *model.EngineError) {
	if ability.Cost == nil || !ability.Cost.HasAmount {
		return 0, false, nil
	}
	c, ok := s.combatants[sourceKey]
	if !ok {
		return s.loop.TimeMs() + s.conditionRecheckIntervalMs, true, nil
	}
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		RuntimeSkillKey: ability.SkillKey,
		SourceAttrs:     c.attributesView(),
		TargetAttrs:     target.attributesView(),
		SourceResources: c.resourceView(),
		TargetResources: target.resourceView(),
		AbilityParams:   ability.Params,
	}
	// Provider-aware cost preflight: only a valid parsed provider ability ref binds
	// HasProviderContext + lazy-expired provider state (mirrors lifecycle charging).
	// Unparseable refs stay fail-closed (no context → provider.state eval error → MaxFloat64).
	if parsed, ok := planbundle.ParseAbilityRef(abilityRef); ok {
		ownerKey := sourceKey
		providerRef := parsed.ProviderRef
		switch parsed.Combatant {
		case model.SelectorSource, model.SelectorSelf, "":
			ownerKey = sourceKey
		case model.SelectorTarget:
			ownerKey = targetKey
		case model.SelectorOpponent:
			if sourceKey == model.SelectorSource {
				ownerKey = model.SelectorTarget
			} else if sourceKey == model.SelectorTarget {
				ownerKey = model.SelectorSource
			} else {
				ownerKey = targetKey
			}
		default:
			ownerKey = parsed.Combatant
		}
		ctx.HasProviderContext = true
		ctx.ProviderState = model.NumericView{}
		ctx.ProviderTargetState = model.NumericView{}
		if owner, ok := s.combatants[ownerKey]; ok && providerRef != "" {
			if bag := owner.providerState.PrepareRead(providerRef, false,
				s.resolveProviderStateFieldDefs(ownerKey, providerRef, owner.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: owner.cooldowns.View(), OwnerKey: ownerKey, TargetView: true, TargetKey: targetKey}); bag.Present() {
				ctx.ProviderState = bag.State()
				if bag.TargetKey() == targetKey {
					ctx.ProviderTargetState = bag.TargetStateForFormula()
				}
				s.combatants[ownerKey] = owner
			}
		}
	}
	_ = entry
	amount, err := s.formulas.EvalContext(ability.Cost.AmountProgram, &ctx)
	if err != nil {
		return 0, false, s.evalFormulaError(ability.Cost.AmountProgram, err, abilityRef)
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return 0, false, s.gateFormulaError(ability.Cost.AmountProgram, "resource cost must be finite and nonnegative", abilityRef)
	}
	current := c.resourceView().At(ability.Cost.ResourceKey).Current
	if ability.Cost.AllowPartial {
		if current >= 0 {
			return 0, false, nil
		}
	} else if current >= amount {
		return 0, false, nil
	}
	readyAt := resourceReadyTimeMs(
		s.loop.TimeMs(),
		current,
		amount,
		s.conditionRecheckIntervalMs,
	)
	if readyAt <= s.loop.TimeMs() {
		readyAt = s.loop.TimeMs() + s.conditionRecheckIntervalMs
	}
	return readyAt, true, nil
}

func (s *Engine) conditionGate(entry model.DriverEntry, entryIndex int, sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string) (bool, *model.EngineError) {
	if programID, present := s.actions.DriverCondition(entryIndex); present {
		source := s.combatants[sourceKey]
		target := s.combatants[targetKey]
		ctx := formula.GenericEvalContext{
			StrictReads:     s.automatedRun(),
			SourceAttrs:     source.attributesView(),
			TargetAttrs:     target.attributesView(),
			SourceResources: source.resourceView(),
			TargetResources: target.resourceView(),
			AbilityParams:   ability.Params,
		}
		value, err := s.formulas.EvalContext(programID, &ctx)
		if err != nil {
			return false, s.evalFormulaError(programID, err, abilityRef)
		}
		if value == 0 {
			return true, nil
		}
	}
	if ability.HasCastCondition {
		return s.castConditionBlocked(sourceKey, targetKey, ability, abilityRef)
	}
	_ = entry
	return false, nil
}

func (s *Engine) castConditionBlocked(sourceKey, targetKey string, ability planbundle.CompiledAbility, abilityRef string) (bool, *model.EngineError) {
	ownerKey := sourceKey
	providerRef := ""
	if parsed, ok := planbundle.ParseAbilityRef(abilityRef); ok {
		providerRef = parsed.ProviderRef
		switch parsed.Combatant {
		case model.SelectorSource, model.SelectorSelf, "":
			ownerKey = sourceKey
		case model.SelectorTarget:
			ownerKey = targetKey
		case model.SelectorOpponent:
			if sourceKey == model.SelectorSource {
				ownerKey = model.SelectorTarget
			} else if sourceKey == model.SelectorTarget {
				ownerKey = model.SelectorSource
			} else {
				ownerKey = targetKey
			}
		default:
			ownerKey = parsed.Combatant
		}
	}
	source := s.combatants[sourceKey]
	target := s.combatants[targetKey]
	ctx := formula.GenericEvalContext{
		StrictReads:        s.automatedRun(),
		SourceAttrs:        source.attributesView(),
		TargetAttrs:        target.attributesView(),
		SourceResources:    source.resourceView(),
		TargetResources:    target.resourceView(),
		AbilityParams:      ability.Params,
		HasProviderContext: true,
		ProviderState:      model.NumericView{},
	}
	if owner, ok := s.combatants[ownerKey]; ok && providerRef != "" {

		bag := owner.providerState.PrepareRead(providerRef, true,
			s.resolveProviderStateFieldDefs(ownerKey, providerRef, owner.instances.Providers()), s.loop.TimeMs(), effectpkg.ReadOptions{Cooldowns: owner.cooldowns.View(), OwnerKey: ownerKey, TargetView: true, TargetKey: targetKey})
		s.combatants[ownerKey] = owner
		ctx.ProviderState = bag.State()
		if bag.TargetKey() == targetKey {
			ctx.ProviderTargetState = bag.TargetStateForFormula()
		}
	}
	value, err := s.formulas.EvalContext(ability.CastConditionProgram, &ctx)
	if err != nil {
		return false, s.evalFormulaError(ability.CastConditionProgram, err, abilityRef)
	}
	return value == 0, nil
}

func (s *Engine) gateFormulaError(program formula.GenericProgramID, message, ref string) *model.EngineError {
	path := ref + ".condition"
	if int(program) < len(s.formulas.Programs) {
		path = s.formulas.Programs[program].Key
	}
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrFormulaTypeError, message, path, ref, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
}

func (s *Engine) nextWhileReadyTime(entry model.DriverEntry, result gateCheckResult) int64 {
	var nextAt int64
	switch result.reason {
	case model.AttemptSkipCooldownNotReady:
		nextAt = result.readyAtMs
	case model.AttemptSkipResourceInsufficient:
		nextAt = result.readyAtMs
	case model.AttemptSkipConditionFalse:
		nextAt = s.loop.TimeMs() + s.conditionRecheckIntervalMs
	default:
		nextAt = s.loop.TimeMs() + s.conditionRecheckIntervalMs
	}
	if nextAt <= s.loop.TimeMs() {
		nextAt = s.loop.TimeMs() + s.conditionRecheckIntervalMs
	}
	return nextAt
}

func materializeCooldowns(raw map[string]interface{}, owner string) *actionpkg.CooldownLedger {
	out := actionpkg.NewCooldownLedger()
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := raw[key]
		if readyAt := parseCooldownReadyAtMs(value); readyAt > 0 {
			out.Set(actionpkg.AbilityCooldownIdentity(owner, key), readyAt, 0)
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

// normalizeAbilityRef 将 self/opponent abilityRef 归一为 source/target concrete ref。
func normalizeAbilityRef(abilityRef, sourceKey, targetKey string) string {
	parsed, ok := planbundle.ParseAbilityRef(abilityRef)
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
