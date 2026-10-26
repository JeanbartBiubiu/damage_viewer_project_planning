package execution

import (
	"math"

	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func (s *Engine) isIncomingCappedFlatParent(provider planbundle.CompiledProvider, owner, providerRef string) bool {
	for _, binding := range s.compiled.IncomingCappedFlatSources {
		if binding.Owner == owner && binding.ParentProviderRef == providerRef && s.compiled.Providers[binding.ParentIndex].ProviderKey == provider.ProviderKey {
			return true
		}
	}
	return false
}

func (s *Engine) isIncomingCappedFlatInitializer(listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	for _, binding := range s.compiled.IncomingCappedFlatSources {
		if binding.Owner == listener.OwnerCombatantKey && binding.ParentProviderRef == listener.OwnerProviderRef &&
			int(binding.ParentIndex) == operation.OwnerProviderIndex && operation.ProviderRef == binding.EffectProviderRef &&
			operation.ProviderDefinitionRef == s.compiled.Providers[binding.EffectIndex].ProviderKey && listener.OperationCount == 1 {
			return true
		}
	}
	return false
}

func (s *Engine) initIncomingCappedFlatSources() *model.EngineError {
	if len(s.compiled.IncomingCappedFlatSources) == 0 {
		return nil
	}
	fail := func() *model.EngineError {
		return s.basicAttackErr("capped flat requires fresh actual character initialization with two living opponents", "initialSnapshot")
	}
	if s.loop.StartMs() != 0 || s.loop.DurationMs() < 1 || s.loop.DurationMs() > 600000 || !s.req.StopPolicy.StopOnTargetDeathOrDefault() ||
		len(s.req.DriverPlan.Entries)+len(s.req.SkillUses)+len(s.req.AttackStartFacts)+len(s.req.SkillHitFacts)+len(s.req.ProcessCommandFacts)+len(s.req.InitialSnapshot.ProcessInstances)+len(s.req.InitialSnapshot.UseTriggerLedger) != 0 {
		return fail()
	}
	if err := s.validateBasicAttackInitialSnapshot(); err != nil {
		return err
	}
	for _, actor := range s.req.InitialSnapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return fail()
		}
		hp := s.combatantHp(actor.Key)
		if !s.combatantExists(opponentCombatantKey(actor.Key)) || math.IsNaN(hp) || math.IsInf(hp, 0) || hp <= 0 {
			return fail()
		}
	}
	for _, binding := range s.compiled.IncomingCappedFlatSources {
		if len(s.compiled.Providers[binding.ParentIndex].Processes) != 0 && !s.incomingCappedFlatActivePlanned(binding) {
			return fail()
		}
		matches := 0
		for _, actor := range s.req.InitialSnapshot.Combatants {
			for _, instance := range actor.Providers {
				if instance.DefinitionRef == s.compiled.Providers[binding.EffectIndex].ProviderKey {
					return fail()
				}
				if actor.Key != binding.Owner || instance.ProviderRef != binding.ParentProviderRef {
					continue
				}
				matches++
				if instance.DefinitionRef != s.compiled.Providers[binding.ParentIndex].ProviderKey || instance.Source != binding.Owner || instance.Owner != binding.Owner || instance.Stacks != 1 || instance.ExpireAt != nil || instance.AppliedAtMs != nil || len(instance.State)+len(instance.ModifierSnapshots) != 0 {
					return fail()
				}
			}
		}
		if matches != 1 {
			return fail()
		}
	}
	return nil
}

// Cold admission only: the compiled closure cannot authorize an unused active
// graph, an arbitrary driver entry, or a caller-supplied use/fact.
func (s *Engine) incomingCappedFlatActivePlanned(source planbundle.CompiledIncomingCappedFlatSource) bool {
	parent := s.compiled.Providers[source.ParentIndex]
	matches := func(binding planbundle.CompiledSkillActionBinding) bool {
		return binding.Source == source.Owner && binding.ProviderRef == source.ParentProviderRef && binding.ProviderDefinitionRef == parent.ProviderKey && binding.SkillKey == parent.SkillKey && s.compiled.Abilities[binding.InitialAbilityIndex].ProviderIndex == source.ParentIndex
	}
	for manualIndex := 0; manualIndex < s.actions.ManualCount(); manualIndex++ {
		action := s.actions.ManualAt(manualIndex)
		if action.Plan().Action() == "INITIAL" && action.ControlAbilityIndex() == action.Binding().InitialAbilityIndex && matches(action.Binding()) {
			return true
		}
	}
	if s.actions.HasAutomatic() {
		for automaticIndex := 0; automaticIndex < s.actions.AutomaticCount(); automaticIndex++ {
			rule := s.actions.AutomaticAt(automaticIndex)
			if rule.ControlIndex() == rule.Binding().InitialAbilityIndex && matches(rule.Binding()) {
				return true
			}
		}
	}
	return false
}

// No cap uses the old path. A matching cap evaluates its points once, then
// changes only working branch amounts; raw and crit snapshots remain untouched.
func (f *Frame) incomingCappedFlat(cmd command.Command, ability planbundle.CompiledAbility, crit frozenCritEvidence,
	preOutgoing, raw float64, evidence []map[string]interface{},
) (normal, critical float64, applied bool, records []map[string]interface{}, result *model.EngineError) {
	records = evidence
	if len(f.run.compiled.IncomingCappedFlatSources) == 0 {
		return
	}
	host := f.stageFor(cmd.Target)
	if !host.instances.Damage().HasCommandStage("damage", "incoming_pre_mitigation") {
		return
	}
	mods := host.instances.Damage().CollectForCommandChannelsWithMatches("damage", []string{"all_damage"}, "incoming_pre_mitigation")
	if len(mods) != 1 {
		result = f.run.processErr("damage.incoming_pre_mitigation", "capped flat requires exactly one actual owned modifier", cmd.Target)
		return
	}
	mod := mods[0].Modifier
	if mod.OwnerCombatantKey != cmd.Target || !mod.HasMaximumReductionRatio || !mod.HasCondition || !mod.HasValue {
		result = f.run.processErr("damage.incoming_pre_mitigation", "capped flat lost its actual recipient or compiled shape", mod.ModifierKey)
		return
	}
	ctx := f.evalContext(ability)
	ctx.StrictReads, ctx.HasDamageContext = true, true
	ctx.DamageTypeKey = cmd.DamageType
	condition, err := f.run.formulas.EvalContext(mod.ConditionProg, &ctx)
	if err != nil {
		result = f.formulaError(mod.ConditionProg, err.Error())
		return
	}
	if condition == 0 {
		return
	}
	// Authored source means the permanent modifier's real owner, not attacker.
	ctx.SourceAttrs = host.attributesView()
	if f.damageDefenseContext != nil {
		ctx.SourceAttrs = f.damageDefenseContext.TargetAttrs
	}
	points, err := f.run.formulas.EvalContext(mod.ValueProgram, &ctx)
	if err != nil {
		result = f.formulaError(mod.ValueProgram, err.Error())
		return
	}
	cap := mod.MaximumReductionRatio
	if math.IsNaN(points) || math.IsInf(points, 0) || points < 0 || math.IsNaN(cap) || math.IsInf(cap, 0) || cap < 0 || cap > 1 {
		result = f.run.processErr("damage.incoming_pre_mitigation", "capped flat points and ratio must be finite non-negative values", mod.ModifierKey)
		return
	}
	amounts, weights := [3]float64{raw, 0, 0}, [3]float64{1, 0, 0}
	if crit.present && crit.eligible && preOutgoing > 0 {
		factor := raw / preOutgoing
		amounts = [3]float64{crit.baseRawAmount * factor, crit.baseRawAmount * crit.naturalMultiplier * factor, crit.baseRawAmount * crit.forcedMultiplier * factor}
		weights = [3]float64{1 - crit.chanceEffective, crit.naturalWeight, crit.forcedWeight}
	}
	var reduced [3]float64
	for i, amount := range amounts {
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 || math.IsNaN(weights[i]) || math.IsInf(weights[i], 0) || weights[i] < 0 {
			result = f.run.processErr("damage.incoming_pre_mitigation", "capped flat branch must be finite and non-negative", mod.ModifierKey)
			return
		}
		reduced[i] = amount - math.Min(points, cap*amount)
		if i == 0 {
			normal = reduced[i] * weights[i]
		} else {
			critical += reduced[i] * weights[i]
		}
	}
	if math.IsNaN(normal+critical) || math.IsInf(normal+critical, 0) || normal < 0 || critical < 0 {
		result = f.run.processErr("damage.incoming_pre_mitigation", "capped flat result must be finite and non-negative", mod.ModifierKey)
		return
	}
	applied = true
	if f.run.detailedOutput() {
		records = append(records, map[string]interface{}{"stage": "incoming_pre_mitigation", "command": "damage", "modifierKey": mod.ModifierKey,
			"providerOwner": mod.OwnerCombatantKey, "providerRef": mod.ProviderRef, "collectionHost": cmd.Target, "before": raw, "value": points,
			"maximumReductionRatio": cap, "after": normal + critical, "branchAmounts": amounts, "branchWeights": weights, "branchAfterReduction": reduced})
	}
	return
}
