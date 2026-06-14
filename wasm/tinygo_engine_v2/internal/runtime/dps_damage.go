// 目标/攻击者 HP 变更与抗性减免。
package runtime

import (
	"math"
	"sort"
	"strings"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/crit"
	"tinygo_engine_v2/internal/model"
)

func (state *dpsCurveState) TargetHPTimelineAppend(timeMs int64) {
	state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
		TimeMs: timeMs, CurrentHP: state.targetHP, MaxHP: state.targetMaxHP,
	})
}

func (state *dpsCurveState) applyDamage(timeMs int64, source string, damageType string, rawAmount float64) dpsDamageApplication {
	return state.applyDamageWithContext(timeMs, source, damageType, rawAmount, nil)
}

func (state *dpsCurveState) applyDamageWithContext(
	timeMs int64,
	source string,
	damageType string,
	rawAmount float64,
	ctx *dpsCombatEventContext,
) dpsDamageApplication {
	result := dpsDamageApplication{RawDamage: rawAmount}
	amount := rawAmount
	if ctx != nil {
		preMitigation, finalAmount, ok := state.resolveCombatDamageAmount(ctx, damageType, rawAmount)
		if !ok {
			return result
		}
		result.RawDamage = preMitigation
		amount = finalAmount
	} else {
		resistance := 0.0
		switch damageType {
		case "physical":
			resistance = state.armor
		case "magic":
			resistance = state.magicResist
		case "true":
		default:
			state.block("unsupported damage type " + damageType)
			return result
		}
		resistance = state.effectiveResistance(damageType, resistance)
		mitigatedDamage, code := mitigateDamageByResistance(rawAmount, resistance, damageType)
		if code != model.ErrOK {
			state.block("damage could not be resolved")
			return result
		}
		amount = mitigatedDamage
	}
	if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		state.block("damage could not be resolved")
		return result
	}
	hpBefore := state.targetHP
	hpAfter, finalDamage, code := applyDamageToHP(state.targetHP, amount)
	if code != model.ErrOK {
		state.block("damage could not be applied")
		return result
	}
	state.targetHP = hpAfter
	state.result.TotalDamage += finalDamage
	state.result.DamageByType[damageType] += finalDamage
	state.result.DamageBySource[source] += finalDamage
	state.result.DamageTimeline = append(state.result.DamageTimeline, model.DPSDamageEventV2{
		TimeMs:         timeMs,
		Source:         source,
		DamageType:     damageType,
		RawDamage:      result.RawDamage,
		FinalDamage:    finalDamage,
		TargetHPBefore: hpBefore,
		TargetHPAfter:  state.targetHP,
		CritContext:    dpsCritContextFromCombat(ctx),
	})
	state.TargetHPTimelineAppend(timeMs)
	if state.targetHP <= 0 {
		state.markKilled(timeMs)
	}
	result.Applied = true
	result.FinalDamage = finalDamage
	result.TargetHPBefore = hpBefore
	result.TargetHPAfter = state.targetHP
	return result
}

func (state *dpsCurveState) applyAttackerDamage(timeMs int64, source string, damageType string, rawAmount float64) bool {
	if rawAmount < 0 || math.IsNaN(rawAmount) || math.IsInf(rawAmount, 0) {
		state.block("passive retaliation damage resolved invalid amount")
		return false
	}
	if !supportedDPSDamageType(damageType) {
		state.block("unsupported retaliation damage type " + damageType)
		return false
	}
	finalDamage := rawAmount
	state.result.AttackerDamageTimeline = append(state.result.AttackerDamageTimeline, model.DPSAttackerDamageEventV2{
		TimeMs:      timeMs,
		Source:      source,
		DamageType:  damageType,
		RawDamage:   rawAmount,
		FinalDamage: finalDamage,
	})
	if state.result.AttackerDamageBySource == nil {
		state.result.AttackerDamageBySource = map[string]float64{}
	}
	state.result.AttackerDamageBySource[source] += finalDamage
	return true
}

func (state *dpsCurveState) effectiveResistance(damageType string, resistance float64) float64 {
	switch damageType {
	case "physical":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "armor_pen_percent", "physical_pen_percent"),
			readFirstFiniteAttr(state.attrs, "armor_pen_flat", "physical_pen", "lethality"),
		)
	case "magic":
		return applyPositiveResistancePenetration(
			resistance,
			readFirstFiniteAttr(state.attrs, "magic_pen_percent"),
			readFirstFiniteAttr(state.attrs, "magic_pen_flat", "magic_pen"),
		)
	default:
		return resistance
	}
}

func applyPositiveResistancePenetration(resistance float64, percentPen float64, flatPen float64) float64 {
	if resistance <= 0 {
		return resistance
	}
	effective := resistance * (1 - clampFloat(percentPen, 0, 1))
	if flatPen > 0 {
		effective -= flatPen
	}
	if effective < 0 {
		return 0
	}
	return effective
}

func (state *dpsCurveState) markKilled(timeMs int64) {
	killTimeMs := timeMs
	state.result.KillTimeMs = &killTimeMs
	if killTimeMs > 0 {
		killDPS := state.result.TotalDamage / (float64(killTimeMs) / 1000)
		state.result.KillDps = &killDPS
	}
	if state.rules.DurationMs > timeMs {
		state.result.TargetHPTimeline = append(state.result.TargetHPTimeline, model.DPSTargetHPEventV2{
			TimeMs: state.rules.DurationMs, CurrentHP: 0, MaxHP: state.targetMaxHP,
		})
	}
	state.result.FinalTimeMs = state.rules.DurationMs
	state.result.StopReason = "target_dead"
}

func (state *dpsCurveState) buildDPSCritContext(
	rawAmount float64,
	compiledEffect compilebundle.CompiledEffect,
	critResult critApplication,
) (model.DPSCritContextV2, float64) {
	policy := strings.TrimSpace(compiledEffect.CritPolicy)
	if policy == "" {
		return model.DPSCritContextV2{}, rawAmount
	}
	multiplier := critResult.Multiplier
	if multiplier == 0 {
		multiplier = 1
	}
	ctx := model.DPSCritContextV2{
		HasContext:      true,
		Policy:          policy,
		ChanceRaw:       critResult.ChanceRaw,
		ChanceEffective: critResult.ChanceEffective,
		Multiplier:      multiplier,
		BoundEvidence:   critResult.ChanceBound,
	}
	switch policy {
	case "expected":
		normal, critPart := crit.ExpectedParts(rawAmount, critResult.ChanceEffective, multiplier)
		ctx.ExpectedNormalPart = normal
		ctx.ExpectedCritPart = critPart
		return ctx, normal + critPart
	case "deterministic", "seeded_random":
		ctx.HasActualResult = critResult.HasResult
		ctx.IsCrit = critResult.Result
		if critResult.Result {
			ctx.ExpectedCritPart = rawAmount * multiplier
		} else {
			ctx.ExpectedNormalPart = rawAmount
		}
		return ctx, rawAmount * critResult.Scalar
	default:
		return ctx, rawAmount * critResult.Scalar
	}
}

func (state *dpsCurveState) applyCritContextToCombat(ctx *dpsCombatEventContext, critCtx model.DPSCritContextV2) {
	if ctx == nil || !critCtx.HasContext {
		return
	}
	ctx.HasCritContext = true
	ctx.CritPolicy = critCtx.Policy
	ctx.CritChanceRaw = critCtx.ChanceRaw
	ctx.CritChanceEffective = critCtx.ChanceEffective
	ctx.CritMultiplier = critCtx.Multiplier
	ctx.HasActualCritResult = critCtx.HasActualResult
	ctx.IsCrit = critCtx.IsCrit
	ctx.ExpectedNormalPart = critCtx.ExpectedNormalPart
	ctx.ExpectedCritPart = critCtx.ExpectedCritPart
	ctx.CritBound = critCtx.BoundEvidence
}

func dpsCritContextFromCombat(ctx *dpsCombatEventContext) *model.DPSCritContextV2 {
	if ctx == nil || !ctx.HasCritContext {
		return nil
	}
	return &model.DPSCritContextV2{
		HasContext:         true,
		Policy:             ctx.CritPolicy,
		ChanceRaw:          ctx.CritChanceRaw,
		ChanceEffective:    ctx.CritChanceEffective,
		Multiplier:         ctx.CritMultiplier,
		IsCrit:             ctx.IsCrit,
		HasActualResult:    ctx.HasActualCritResult,
		ExpectedNormalPart: ctx.ExpectedNormalPart,
		ExpectedCritPart:   ctx.ExpectedCritPart,
		BoundEvidence:      ctx.CritBound,
	}
}

func resolveCritContextModifierMultiplier(critCtx *model.DPSCritContextV2, op model.DPSPassiveOperationV2) float64 {
	multiplier := critCtx.Multiplier
	if multiplier == 0 {
		multiplier = 1
	}
	if op.HasCritMultiplierScale {
		multiplier *= op.CritMultiplierScale
	}
	if op.HasCritMultiplierOverride {
		multiplier = op.CritMultiplierOverride
	}
	return multiplier
}

func (state *dpsCurveState) applyCritContextModifiers(
	ctx *dpsCombatEventContext,
	critCtx *model.DPSCritContextV2,
	rawAmount float64,
) *model.DPSCritContextV2 {
	if critCtx == nil || !critCtx.HasContext || ctx == nil {
		return critCtx
	}
	entries := state.collectCritContextModifierEntries(*ctx)
	cooldownGate := ensurePassiveCooldownGate(ctx)
	for _, entry := range entries {
		passive := entry.passive
		op := entry.op
		if !state.checkPassiveCooldownGate(ctx.TimeMs, passive, cooldownGate) {
			continue
		}
		resolvedMultiplier := resolveCritContextModifierMultiplier(critCtx, op)
		if op.ForceCrit {
			critCtx.Multiplier = resolvedMultiplier
			critCtx.ChanceEffective = 1
			critCtx.ExpectedNormalPart = 0
			critCtx.ExpectedCritPart = rawAmount * resolvedMultiplier
			critCtx.IsCrit = false
			critCtx.HasActualResult = false
		} else if op.HasCritMultiplierScale || op.HasCritMultiplierOverride {
			critCtx.Multiplier = resolvedMultiplier
			if critCtx.Policy == "expected" {
				normal, critPart := crit.ExpectedParts(rawAmount, critCtx.ChanceEffective, resolvedMultiplier)
				critCtx.ExpectedNormalPart = normal
				critCtx.ExpectedCritPart = critPart
			}
		}
		runtimeKey := passiveRuntimeKey(passive)
		if !cooldownGate.triggered[runtimeKey] {
			state.recordPassiveTrigger(ctx.TimeMs, passive)
		}
		message := "forceCrit=" + boolToString(op.ForceCrit)
		if op.HasCritMultiplierOverride {
			message += " multiplierOverride=" + floatToString(op.CritMultiplierOverride)
		}
		if op.HasCritMultiplierScale {
			message += " multiplierScale=" + floatToString(op.CritMultiplierScale)
		}
		message += " resolvedMultiplier=" + floatToString(resolvedMultiplier)
		state.result.EffectBreakdown = append(state.result.EffectBreakdown, model.DPSEffectBreakdownV2{
			TimeMs:      ctx.TimeMs,
			Source:      passiveDamageSource(passive, op),
			Kind:        dpsOpCritContextModifier,
			Amount:      critCtx.ExpectedNormalPart + critCtx.ExpectedCritPart,
			Message:     message,
			CritContext: cloneDPSCritContext(critCtx),
		})
		state.markPassiveCooldownTriggeredOnce(ctx.TimeMs, passive, cooldownGate)
	}
	return critCtx
}

func cloneDPSCritContext(src *model.DPSCritContextV2) *model.DPSCritContextV2 {
	if src == nil {
		return nil
	}
	clone := *src
	if src.BoundEvidence != nil {
		evidence := *src.BoundEvidence
		clone.BoundEvidence = &evidence
	}
	return &clone
}

type dpsCritContextModifierEntry struct {
	originalIndex  int
	operationIndex int
	passive        model.DPSPassiveEffectV2
	op             model.DPSPassiveOperationV2
}

func (state *dpsCurveState) collectCritContextModifierEntries(ctx dpsCombatEventContext) []dpsCritContextModifierEntry {
	entries := make([]dpsCritContextModifierEntry, 0)
	for index, passive := range state.passives {
		if !state.critContextModifierPassiveMatches(ctx, passive) {
			continue
		}
		for opIndex, op := range passive.Operations {
			if op.Kind != dpsOpCritContextModifier {
				continue
			}
			entries = append(entries, dpsCritContextModifierEntry{
				originalIndex:  index,
				operationIndex: opIndex,
				passive:        passive,
				op:             op,
			})
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		leftPriority := resolvedDPSPassivePriority(entries[i].passive)
		rightPriority := resolvedDPSPassivePriority(entries[j].passive)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if entries[i].originalIndex != entries[j].originalIndex {
			return entries[i].originalIndex < entries[j].originalIndex
		}
		return entries[i].operationIndex < entries[j].operationIndex
	})
	return entries
}

func (state *dpsCurveState) critContextModifierPassiveMatches(ctx dpsCombatEventContext, passive model.DPSPassiveEffectV2) bool {
	triggerKind := resolvedDPSTriggerKind(passive)
	switch triggerKind {
	case dpsTriggerStatAlwaysOn, dpsTriggerPreEnabledModifier:
		if !state.passiveActiveAt(passive, ctx.TimeMs) {
			return false
		}
		return true
	case dpsTriggerNextBasicAttackAfterState:
		if !ctx.IsBasicAttack {
			return false
		}
		if !state.nextAttackStateReady(passive, ctx.TimeMs) {
			return false
		}
		return true
	default:
		if !state.passiveActiveAt(passive, ctx.TimeMs) {
			return false
		}
		if ctx.IsBasicAttack && (triggerKind == dpsTriggerOnBasicAttackHit || triggerKind == "") {
			return true
		}
		if ctx.IsSpell && strings.TrimSpace(passive.Trigger.Event) == dpsEventOnSpellHit {
			return true
		}
		return false
	}
}

func (state *dpsCurveState) processActiveActionDamageEffect(
	timeMs int64,
	sched *dpsActiveActionSchedule,
	compiledAction compilebundle.CompiledAction,
	_ model.ActionRunResultV2,
	effectIndex int,
	effect model.ActionEffectRunResultV2,
	targetHPBefore float64,
	isBasicAttack bool,
) (dpsCombatEventContext, dpsDamageApplication, bool) {
	damageType := effect.DamageType
	if damageType == "" {
		damageType = "physical"
	}
	rawAmount := effect.RawAmount
	var critCtx model.DPSCritContextV2
	expectedDamage := rawAmount
	if effectIndex < len(compiledAction.Effects) {
		compiledEffect := compiledAction.Effects[effectIndex]
		if compiledEffect.CritPolicy != "" {
			critResult, code := state.runCtx.resolveEffectCrit(compiledEffect, state.attackerIdx)
			if code != model.ErrOK {
				if isBasicAttack {
					state.block("basic_attack_crit_unresolved:" + sched.ref.ActionID)
				} else {
					state.block("skill_crit_unresolved:" + sched.ref.ActionID)
				}
				return dpsCombatEventContext{}, dpsDamageApplication{}, false
			}
			critCtx, expectedDamage = state.buildDPSCritContext(rawAmount, compiledEffect, critResult)
		}
	}
	actionTypes, effectTags := resolveActiveActionClassifier(sched.ref.Classifier, state.bundle, compiledAction)
	sourceType := "spell"
	sourceCategory := "spell"
	procScope := dpsProcScopeActiveSkill
	if isBasicAttack {
		sourceType = "basic_attack"
		sourceCategory = "basic_attack"
		procScope = dpsProcScopeRealBasicAttackOnly
	}
	damageSource := nonEmpty(sched.ref.SkillID, sched.ref.ActionID)
	preDamageCtx := dpsCombatEventContext{
		Event:          dpsEventOnDamageTaken,
		TimeMs:         timeMs,
		SourceRole:     dpsRoleAttacker,
		TargetRole:     dpsRoleTarget,
		ActionID:       sched.ref.ActionID,
		ActionTypes:    actionTypes,
		EffectTypes:    []string{string(model.EffectTypeDealDamage)},
		EffectTags:     effectTags,
		SourceType:     sourceType,
		SourceCategory: sourceCategory,
		SourceID:       damageSource,
		DamageType:     damageType,
		RawDamage:      expectedDamage,
		TargetHPBefore: targetHPBefore,
		IsBasicAttack:  isBasicAttack,
		IsSpell:        !isBasicAttack,
		IsOnHit:        true,
		ProcScope:      procScope,
	}
	preDamageCtx.PassiveCooldownGate = newPassiveCooldownGate()
	if critCtx.HasContext {
		critCtx = *state.applyCritContextModifiers(&preDamageCtx, &critCtx, rawAmount)
		expectedDamage = critCtx.ExpectedNormalPart + critCtx.ExpectedCritPart
		preDamageCtx.RawDamage = expectedDamage
		state.applyCritContextToCombat(&preDamageCtx, critCtx)
	}
	modifiedAmount, ok := state.applyIncomingDamageModifiers(&preDamageCtx, expectedDamage)
	if !ok {
		return dpsCombatEventContext{}, dpsDamageApplication{}, false
	}
	if critCtx.HasContext && preDamageCtx.CritPolicy == "expected" {
		critCtx.ExpectedNormalPart = preDamageCtx.ExpectedNormalPart
		critCtx.ExpectedCritPart = preDamageCtx.ExpectedCritPart
	}
	app := state.applyDamageWithContext(timeMs, damageSource, damageType, modifiedAmount, &preDamageCtx)
	if !app.Applied {
		return dpsCombatEventContext{}, dpsDamageApplication{}, false
	}
	var combatCtx dpsCombatEventContext
	if isBasicAttack {
		combatCtx = state.buildBasicAttackCombatContext(timeMs, *sched, compiledAction, damageType, app)
	} else {
		combatCtx = state.buildSkillCombatContext(timeMs, *sched, compiledAction, damageType, app)
	}
	combatCtx.PassiveCooldownGate = preDamageCtx.PassiveCooldownGate
	state.applyCritContextToCombat(&combatCtx, critCtx)
	return combatCtx, app, true
}
