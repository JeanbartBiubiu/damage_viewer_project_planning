package runtime

import (
	"math"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/counter"
	"tinygo_engine_v2/internal/crit"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func (ctx *RunContext) applyEffect(effect compilebundle.CompiledEffect, source uint8, target uint8, chainDepth uint8, input float64, actionResult *model.ActionRunResultV2, effectIndex int) model.ErrCode {
	actualSource := roleActor(effect.SourceRole, source, target)
	actualTarget := roleActor(effect.TargetRole, source, target)
	switch effect.Type {
	case compilebundle.EffectDealDamage:
		amount, formulaID, breakdown, code := ctx.effectAmountTrace(effect, actualSource, actualTarget, input)
		if code != model.ErrOK {
			return code
		}
		critResult, code := ctx.resolveEffectCrit(effect, actualSource)
		if code != model.ErrOK {
			return code
		}
		modeResult := ctx.resolveEffectMode(effect)
		effectiveAmount := amount * critResult.Scalar * modeResult.Scalar
		hpBefore := ctx.Actors[actualTarget].HP
		damage, code := ctx.dealDamageResult(actualSource, actualTarget, effectiveAmount, effect.DamageType, chainDepth)
		if actionResult != nil {
			effectResult := model.ActionEffectRunResultV2{
				EffectIndex:       effectIndex,
				Kind:              string(model.EffectTypeDealDamage),
				FormulaID:         formulaID,
				FormulaBreakdown:  breakdown,
				RawAmount:         amount,
				HasRawAmount:      true,
				DamageType:        effect.DamageType,
				FinalDamage:       damage.FinalDamage,
				HasFinalDamage:    true,
				ShieldBefore:      damage.ShieldBefore,
				HasShieldBefore:   true,
				ShieldAfter:       damage.ShieldAfter,
				HasShieldAfter:    true,
				ShieldAbsorbed:    damage.ShieldAbsorbed,
				HasShieldAbsorbed: true,
				CritPolicy:        effect.CritPolicy,
				CritRoll:          critResult.Roll,
				HasCritRoll:       critResult.HasRoll,
				CritResult:        critResult.Result,
				HasCritResult:     critResult.HasResult,
				CritMultiplier:    critResult.Multiplier,
				HasCritMultiplier: critResult.HasMultiplier,
				ModeAugmentID:     modeResult.ModeID,
				ModeActive:        modeResult.Active,
				ModeMultiplier:    modeResult.Multiplier,
				HasModeState:      modeResult.HasModeState,
				TargetHPBefore:    hpBefore,
				TargetHPAfter:     ctx.Actors[actualTarget].HP,
				SourceActorID:     ctx.Actors[actualSource].ActorID,
				TargetActorID:     ctx.Actors[actualTarget].ActorID,
			}
			fillActionEffectCritChance(&effectResult, critResult)
			actionResult.Effects = append(actionResult.Effects, effectResult)
		}
		return code
	case compilebundle.EffectDamageFromRecent:
		amount := ctx.Actors[actualSource].DamageTaken.Sum(ctx.NowMs, effect.HistoryWindowMs)
		if effect.Amount != 0 {
			amount *= effect.Amount
		}
		critResult, code := ctx.resolveEffectCrit(effect, actualSource)
		if code != model.ErrOK {
			return code
		}
		modeResult := ctx.resolveEffectMode(effect)
		effectiveAmount := amount * critResult.Scalar * modeResult.Scalar
		hpBefore := ctx.Actors[actualTarget].HP
		damage, code := ctx.dealDamageResult(actualSource, actualTarget, effectiveAmount, effect.DamageType, chainDepth)
		if actionResult != nil {
			effectResult := model.ActionEffectRunResultV2{
				EffectIndex:       effectIndex,
				Kind:              string(model.EffectTypeDamageFromRecent),
				RawAmount:         amount,
				HasRawAmount:      true,
				DamageType:        effect.DamageType,
				FinalDamage:       damage.FinalDamage,
				HasFinalDamage:    true,
				ShieldBefore:      damage.ShieldBefore,
				HasShieldBefore:   true,
				ShieldAfter:       damage.ShieldAfter,
				HasShieldAfter:    true,
				ShieldAbsorbed:    damage.ShieldAbsorbed,
				HasShieldAbsorbed: true,
				CritPolicy:        effect.CritPolicy,
				CritRoll:          critResult.Roll,
				HasCritRoll:       critResult.HasRoll,
				CritResult:        critResult.Result,
				HasCritResult:     critResult.HasResult,
				CritMultiplier:    critResult.Multiplier,
				HasCritMultiplier: critResult.HasMultiplier,
				ModeAugmentID:     modeResult.ModeID,
				ModeActive:        modeResult.Active,
				ModeMultiplier:    modeResult.Multiplier,
				HasModeState:      modeResult.HasModeState,
				HistoryWindowMs:   effect.HistoryWindowMs,
				HasHistoryWindow:  true,
				TargetHPBefore:    hpBefore,
				TargetHPAfter:     ctx.Actors[actualTarget].HP,
				SourceActorID:     ctx.Actors[actualSource].ActorID,
				TargetActorID:     ctx.Actors[actualTarget].ActorID,
			}
			fillActionEffectCritChance(&effectResult, critResult)
			actionResult.Effects = append(actionResult.Effects, effectResult)
		}
		return code
	case compilebundle.EffectHeal:
		amount, formulaID, breakdown, code := ctx.effectAmountTrace(effect, actualSource, actualTarget, input)
		if code != model.ErrOK {
			return code
		}
		critResult, code := ctx.resolveEffectCrit(effect, actualSource)
		if code != model.ErrOK {
			return code
		}
		heal, code := ctx.applyHeal(actualSource, actualTarget, amount*critResult.Scalar)
		if actionResult != nil {
			effectResult := model.ActionEffectRunResultV2{
				EffectIndex:       effectIndex,
				Kind:              string(model.EffectTypeHeal),
				FormulaID:         formulaID,
				FormulaBreakdown:  breakdown,
				RawAmount:         amount,
				HasRawAmount:      true,
				CritPolicy:        effect.CritPolicy,
				HealApplied:       heal.Applied,
				HasHealApplied:    true,
				OverhealAmount:    heal.Overheal,
				HasOverheal:       true,
				CritRoll:          critResult.Roll,
				HasCritRoll:       critResult.HasRoll,
				CritResult:        critResult.Result,
				HasCritResult:     critResult.HasResult,
				CritMultiplier:    critResult.Multiplier,
				HasCritMultiplier: critResult.HasMultiplier,
				TargetHPBefore:    heal.HPBefore,
				TargetHPAfter:     heal.HPAfter,
				SourceActorID:     ctx.Actors[actualSource].ActorID,
				TargetActorID:     ctx.Actors[actualTarget].ActorID,
			}
			fillActionEffectCritChance(&effectResult, critResult)
			actionResult.Effects = append(actionResult.Effects, effectResult)
		}
		return code
	case compilebundle.EffectApplyStatus:
		code := ctx.applyStatusFrom(actualSource, actualTarget, effect.Status)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:   effectIndex,
				Kind:          string(model.EffectTypeApplyStatus),
				StatusID:      ctx.statusID(effect.Status),
				SourceActorID: ctx.Actors[actualSource].ActorID,
				TargetActorID: ctx.Actors[actualTarget].ActorID,
			})
		}
		return code
	case compilebundle.EffectGrantShield:
		amount, formulaID, breakdown, code := ctx.effectAmountTrace(effect, actualSource, actualTarget, input)
		if code != model.ErrOK {
			return code
		}
		shieldBefore := ctx.shieldTotal(actualTarget)
		code = ctx.grantShieldFrom(actualSource, actualTarget, effect.Status, amount)
		shieldAfter := ctx.shieldTotal(actualTarget)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:      effectIndex,
				Kind:             string(model.EffectTypeGrantShield),
				FormulaID:        formulaID,
				FormulaBreakdown: breakdown,
				RawAmount:        amount,
				HasRawAmount:     true,
				StatusID:         ctx.statusID(effect.Status),
				ShieldBefore:     shieldBefore,
				HasShieldBefore:  true,
				ShieldAfter:      shieldAfter,
				HasShieldAfter:   true,
				ShieldGranted:    shieldAfter - shieldBefore,
				HasShieldGranted: true,
				SourceActorID:    ctx.Actors[actualSource].ActorID,
				TargetActorID:    ctx.Actors[actualTarget].ActorID,
			})
		}
		return code
	case compilebundle.EffectApplyMark:
		ctx.Pair.AddMark(effect.MarkID)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:   effectIndex,
				Kind:          string(model.EffectTypeApplyMark),
				MarkID:        effect.MarkID,
				MarkActive:    ctx.Pair.HasMark(effect.MarkID),
				HasMarkState:  true,
				MarkCount:     ctx.Pair.MarkCount,
				SourceActorID: ctx.Actors[actualSource].ActorID,
				TargetActorID: ctx.Actors[actualTarget].ActorID,
			})
		}
		ctx.log("mark_apply", actualSource, actualTarget, 0, 0, 0, effect.MarkID)
	case compilebundle.EffectConsumeMark:
		ctx.Pair.ConsumeMark(effect.MarkID)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:   effectIndex,
				Kind:          string(model.EffectTypeConsumeMark),
				MarkID:        effect.MarkID,
				MarkActive:    ctx.Pair.HasMark(effect.MarkID),
				HasMarkState:  true,
				MarkCount:     ctx.Pair.MarkCount,
				SourceActorID: ctx.Actors[actualSource].ActorID,
				TargetActorID: ctx.Actors[actualTarget].ActorID,
			})
		}
		ctx.log("mark_consume", actualSource, actualTarget, 0, 0, 0, effect.MarkID)
	case compilebundle.EffectInterrupt:
		interruptedActionID := ctx.interruptExecutions(actualTarget)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:         effectIndex,
				Kind:                string(model.EffectTypeInterrupt),
				InterruptedActionID: interruptedActionID,
				HasInterrupt:        interruptedActionID != "",
				SourceActorID:       ctx.Actors[actualSource].ActorID,
				TargetActorID:       ctx.Actors[actualTarget].ActorID,
			})
		}
		ctx.log("interrupt", actualSource, actualTarget, 0, 0, 0, interruptedActionID)
	case compilebundle.EffectIncrementCounter:
		key := counter.Key{Scope: counter.ScopeGlobal, Name: effect.CounterKey}
		before := ctx.Counters.Get(key)
		delta := effect.Amount
		if delta == 0 {
			delta = 1
		}
		after := ctx.Counters.Add(key, delta)
		if actionResult != nil {
			actionResult.Effects = append(actionResult.Effects, model.ActionEffectRunResultV2{
				EffectIndex:     effectIndex,
				Kind:            string(model.EffectTypeIncrementCounter),
				CounterKey:      effect.CounterKey,
				CounterBefore:   before,
				CounterAfter:    after,
				HasCounterState: true,
				SourceActorID:   ctx.Actors[actualSource].ActorID,
				TargetActorID:   ctx.Actors[actualTarget].ActorID,
			})
		}
		ctx.log("counter_increment", actualSource, actualTarget, 0, 0, after, effect.CounterKey)
	default:
		return model.ErrUnsupported
	}
	return model.ErrOK
}

func (ctx *RunContext) effectAmount(effect compilebundle.CompiledEffect, source uint8, target uint8, input float64) (float64, model.ErrCode) {
	if effect.HasFormula {
		ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
		ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
		value, err := ctx.Bundle.Formulas.Eval(effect.Formula, formula.EvalContext{
			SourceAttrs: &ctx.Actors[source].Attrs,
			TargetAttrs: &ctx.Actors[target].Attrs,
			Resources:   &ctx.Actors[source].Resources,
			Counters:    ctx,
			Input:       input,
		})
		if err != nil {
			return 0, model.ErrNumeric
		}
		return value, model.ErrOK
	}
	return effect.Amount, model.ErrOK
}

func (ctx *RunContext) effectAmountTrace(effect compilebundle.CompiledEffect, source uint8, target uint8, input float64) (float64, string, []model.ActionValueBreakdownStepV2, model.ErrCode) {
	if effect.HasFormula {
		ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
		ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
		value, steps, err := ctx.Bundle.Formulas.EvalTrace(effect.Formula, formula.EvalContext{
			SourceAttrs: &ctx.Actors[source].Attrs,
			TargetAttrs: &ctx.Actors[target].Attrs,
			Resources:   &ctx.Actors[source].Resources,
			Counters:    ctx,
			Input:       input,
		})
		if err != nil {
			return 0, "", nil, model.ErrNumeric
		}
		formulaID := ""
		if int(effect.Formula) < len(ctx.Bundle.Formulas.Programs) {
			formulaID = ctx.Bundle.Formulas.Programs[effect.Formula].ID
		}
		return value, formulaID, steps, model.ErrOK
	}
	return effect.Amount, "", nil, model.ErrOK
}

func (ctx *RunContext) statusTickAmountTrace(status compilebundle.CompiledStatus, source uint8, target uint8, input float64) (float64, string, []model.ActionValueBreakdownStepV2, model.ErrCode) {
	if status.HasTickFormula {
		ctx.Actors[source].Attrs.ResolveAll(ctx.NowMs)
		ctx.Actors[target].Attrs.ResolveAll(ctx.NowMs)
		value, steps, err := ctx.Bundle.Formulas.EvalTrace(status.TickFormula, formula.EvalContext{
			SourceAttrs: &ctx.Actors[source].Attrs,
			TargetAttrs: &ctx.Actors[target].Attrs,
			Resources:   &ctx.Actors[source].Resources,
			Counters:    ctx,
			Input:       input,
		})
		if err != nil {
			return 0, "", nil, model.ErrNumeric
		}
		formulaID := ""
		if int(status.TickFormula) < len(ctx.Bundle.Formulas.Programs) {
			formulaID = ctx.Bundle.Formulas.Programs[status.TickFormula].ID
		}
		return value, formulaID, steps, model.ErrOK
	}
	return status.TickAmount, "", nil, model.ErrOK
}

func (ctx *RunContext) resolveEffectCrit(effect compilebundle.CompiledEffect, source uint8) (critApplication, model.ErrCode) {
	return ctx.resolveCritApplication(
		effect.CritPolicy,
		effect.CritChanceSource,
		effect.CritChance,
		effect.CritMultiplierSource,
		effect.CritMultiplier,
		source,
	)
}

func (ctx *RunContext) resolveStatusTickCrit(status compilebundle.CompiledStatus, source uint8) (critApplication, model.ErrCode) {
	return ctx.resolveCritApplication(
		status.TickCritPolicy,
		status.TickCritChanceSource,
		status.TickCritChance,
		"",
		status.TickCritMultiplier,
		source,
	)
}

func (ctx *RunContext) resolveCritApplication(
	policy string,
	chanceSource string,
	fixedChance float64,
	multiplierSource string,
	fixedMultiplier float64,
	source uint8,
) (critApplication, model.ErrCode) {
	if policy == "" {
		return critApplication{Scalar: 1}, model.ErrOK
	}
	chance, code := ctx.resolveCritChance(chanceSource, fixedChance, source)
	if code != model.ErrOK {
		return critApplication{}, code
	}
	multiplier, code := ctx.resolveCritMultiplier(multiplierSource, fixedMultiplier, source)
	if code != model.ErrOK {
		return critApplication{}, code
	}
	if multiplier == 0 {
		multiplier = 1
	}
	if multiplier < 0 || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return critApplication{}, model.ErrNumeric
	}
	chanceApp := critApplication{
		ChanceRaw:       chance.Raw,
		ChanceEffective: chance.Effective,
		HasChance:       true,
		ChanceBound:     chance.Bound,
		Multiplier:      multiplier,
		HasMultiplier:   true,
	}
	switch policy {
	case "seeded_random":
		roll := ctx.RNG.Float("crit")
		result := roll < chance.Effective
		scalar := 1.0
		if result {
			scalar = multiplier
		}
		chanceApp.Scalar = scalar
		chanceApp.Roll = roll
		chanceApp.HasRoll = true
		chanceApp.Result = result
		chanceApp.HasResult = true
		return chanceApp, model.ErrOK
	case "deterministic":
		result := crit.Resolve(crit.Spec{Policy: crit.PolicyDeterministic, Chance: chance.Effective, Multiplier: multiplier})
		chanceApp.Scalar = result.Scalar
		chanceApp.Result = result.Crit
		chanceApp.HasResult = true
		return chanceApp, model.ErrOK
	case "expected":
		result := crit.Resolve(crit.Spec{Policy: crit.PolicyExpected, Chance: chance.Effective, Multiplier: multiplier})
		chanceApp.Scalar = result.Scalar
		chanceApp.Result = false
		chanceApp.HasResult = true
		return chanceApp, model.ErrOK
	case "never":
		chanceApp.Scalar = 1
		chanceApp.Result = false
		chanceApp.HasResult = true
		return chanceApp, model.ErrOK
	default:
		return critApplication{}, model.ErrUnsupported
	}
}

type critChanceResolution struct {
	Raw       float64
	Effective float64
	Bound     *model.NumericBoundEvidenceV2
}

func (ctx *RunContext) resolveCritChance(chanceSource string, fixedChance float64, source uint8) (critChanceResolution, model.ErrCode) {
	switch chanceSource {
	case "", "fixed":
		if math.IsNaN(fixedChance) || math.IsInf(fixedChance, 0) {
			return critChanceResolution{}, model.ErrNumeric
		}
		effective, evidence := crit.ClampValue("crit_chance", "crit_field", fixedChance, crit.ProbabilityBounds())
		return critChanceResolution{Raw: fixedChance, Effective: effective, Bound: evidence}, model.ErrOK
	case "none":
		return critChanceResolution{Raw: 0, Effective: 0}, model.ErrOK
	case "attacker_crit_chance":
		raw, effective, ok := ctx.actorCritChanceValues(source)
		if !ok {
			return critChanceResolution{}, model.ErrUnknownAttr
		}
		if raw != effective {
			bounds, hasBounds := ctx.actorCritChanceBounds()
			evidence := &model.NumericBoundEvidenceV2{
				Key: "crit_chance", Source: "attribute_definition", Mode: "clamp",
				RawValue: raw, BoundedValue: effective, WasClamped: true,
			}
			if hasBounds {
				evidence.Min = bounds.Min
				evidence.HasMin = bounds.HasMin
				evidence.Max = bounds.Max
				evidence.HasMax = bounds.HasMax
			}
			return critChanceResolution{Raw: raw, Effective: effective, Bound: evidence}, model.ErrOK
		}
		return critChanceResolution{Raw: raw, Effective: effective}, model.ErrOK
	default:
		return critChanceResolution{}, model.ErrUnsupported
	}
}

func (ctx *RunContext) actorCritChanceValues(actor uint8) (raw float64, effective float64, ok bool) {
	if int(actor) >= len(ctx.Actors) {
		return 0, 0, false
	}
	for _, attrID := range []string{"crit_chance", "critChance"} {
		index, found := ctx.Bundle.AttrIndex[attrID]
		if !found {
			continue
		}
		ctx.Actors[actor].Attrs.ResolveAll(ctx.NowMs)
		return ctx.Actors[actor].Attrs.ReadResolvedClampEvidence(index)
	}
	return 0, 0, false
}

func (ctx *RunContext) actorCritChance(actor uint8) (float64, bool) {
	return ctx.actorCritAttribute(actor, "crit_chance", "critChance")
}

func (ctx *RunContext) actorCritChanceBounds() (crit.Bounds, bool) {
	for _, attrID := range []string{"crit_chance", "critChance"} {
		index, ok := ctx.Bundle.AttrIndex[attrID]
		if !ok || int(index) >= len(ctx.Bundle.Attrs) {
			continue
		}
		def := ctx.Bundle.Attrs[index]
		if !def.HasClampMin && !def.HasClampMax {
			return crit.Bounds{}, false
		}
		return crit.Bounds{
			Min: def.ClampMin, HasMin: def.HasClampMin,
			Max: def.ClampMax, HasMax: def.HasClampMax,
		}, true
	}
	return crit.Bounds{}, false
}

func (ctx *RunContext) actorCritDamage(actor uint8) (float64, bool) {
	return ctx.actorCritAttribute(actor, "crit_damage", "critDamage")
}

func (ctx *RunContext) actorCritAttribute(actor uint8, attrIDs ...string) (float64, bool) {
	if int(actor) >= len(ctx.Actors) {
		return 0, false
	}
	for _, attrID := range attrIDs {
		index, ok := ctx.Bundle.AttrIndex[attrID]
		if !ok {
			continue
		}
		ctx.Actors[actor].Attrs.ResolveAll(ctx.NowMs)
		value, ok := ctx.Actors[actor].Attrs.ReadAttr(index, model.AttrReadResolved)
		if ok {
			return value, true
		}
	}
	return 0, false
}

func (ctx *RunContext) resolveCritMultiplier(multiplierSource string, fixedMultiplier float64, source uint8) (float64, model.ErrCode) {
	switch multiplierSource {
	case "", "fixed":
		return fixedMultiplier, model.ErrOK
	case "attacker_crit_damage":
		value, ok := ctx.actorCritDamage(source)
		if !ok {
			return 0, model.ErrUnknownAttr
		}
		return value, model.ErrOK
	default:
		return 0, model.ErrUnsupported
	}
}

func (ctx *RunContext) resolveEffectMode(effect compilebundle.CompiledEffect) modeApplication {
	if effect.ModeAugmentID == "" {
		return modeApplication{Scalar: 1}
	}
	multiplier := effect.ModeMultiplier
	if multiplier == 0 {
		multiplier = 1
	}
	active := ctx.ModeAugments[effect.ModeAugmentID]
	scalar := 1.0
	if active {
		scalar = multiplier
	}
	return modeApplication{
		Scalar:       scalar,
		ModeID:       effect.ModeAugmentID,
		Active:       active,
		HasModeState: true,
		Multiplier:   multiplier,
	}
}

func fillActionEffectCritChance(dst *model.ActionEffectRunResultV2, critResult critApplication) {
	if !critResult.HasChance {
		return
	}
	dst.HasCritChance = true
	dst.CritChanceRaw = critResult.ChanceRaw
	dst.CritChanceEffective = critResult.ChanceEffective
	dst.CritChanceBound = critResult.ChanceBound
}

func fillStatusTickCritChance(dst *model.StatusTickRunResultV2, critResult critApplication) {
	if !critResult.HasChance {
		return
	}
	dst.HasCritChance = true
	dst.CritChanceRaw = critResult.ChanceRaw
	dst.CritChanceEffective = critResult.ChanceEffective
	dst.CritChanceBound = critResult.ChanceBound
}

func effectKindString(kind compilebundle.EffectType) string {
	switch kind {
	case compilebundle.EffectDealDamage:
		return string(model.EffectTypeDealDamage)
	case compilebundle.EffectHeal:
		return string(model.EffectTypeHeal)
	case compilebundle.EffectApplyStatus:
		return string(model.EffectTypeApplyStatus)
	case compilebundle.EffectGrantShield:
		return string(model.EffectTypeGrantShield)
	case compilebundle.EffectApplyMark:
		return string(model.EffectTypeApplyMark)
	case compilebundle.EffectConsumeMark:
		return string(model.EffectTypeConsumeMark)
	case compilebundle.EffectDamageFromRecent:
		return string(model.EffectTypeDamageFromRecent)
	case compilebundle.EffectInterrupt:
		return string(model.EffectTypeInterrupt)
	case compilebundle.EffectIncrementCounter:
		return string(model.EffectTypeIncrementCounter)
	default:
		return "unknown"
	}
}
