package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

const preserveTargetPhase = "preserve_on_extend"
const ensureTargetPhase = "ensure_remaining_preserve_phase"

func ordinaryTargetInteger(field plan.CompiledProviderStateField) bool {
	return field.ValueType == model.ProviderStateValueInteger && field.StateKind == "" && field.AmmoRecovery == nil && field.OnExpireCount == 0
}

func compileTargetExpiry(a model.AbilityDefinition, path string, owner uint16, ctx *genericCompileContext) *plan.CompiledTargetExpirySpec {
	x := a.TargetExpirySpec
	fail := func(message string) {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".targetExpirySpec", message, a.AbilityKey)
	}
	if a.Kind != "stateful" || x.AnchorScope != "state_scope/provider_target" || x.AnchorStateKey == "" || len(x.OnExpire) == 0 || len(x.OnExpire) > 12 ||
		len(a.Operations) != 0 || a.TickSpec != nil || a.ListenerSpec != nil || a.ProcessControl != nil || a.Cost != nil || a.Cooldown != nil || a.CastCondition != nil || len(a.StateSchema) != 0 {
		fail("target expiry requires one closed stateful target reservation payload")
	}
	spec := &plan.CompiledTargetExpirySpec{AnchorStateKey: x.AnchorStateKey, OnExpireStart: uint16(len(ctx.session.Operations))}
	ctx.beginOutputUnit()
	damages, tail := 0, false
	for i, op := range x.OnExpire {
		leaf := path + ".targetExpirySpec.onExpire[" + itoa(i) + "]"
		if op.Operation == "damage" {
			damages++
			if tail {
				fail("target expiry damage must precede conditional reapplication")
			}
			if !targetTimingDamageLeaf(op) {
				fail("target expiry requires one complete unconditional noncritical target damage leaf")
			}
		} else if op.Operation == "state_change" {
			copy := op
			copy.ValuePolicy, copy.Condition = "", nil
			if targetMarkExtraFields(copy) || op.TargetMark != nil || op.Target != "self" || op.ValuePolicy != "set" || len(op.Types) != 1 || op.Types[0] != "state_scope/provider_target" || op.Amount == nil || op.DamageType != "" || op.ResourceKey != "" || op.CritEligible || op.VampQualification != "" || len(op.VampOverrides) != 0 {
				fail("target expiry state leaves require only own finite target integer SET")
			}
			if op.Condition != nil {
				tail = true
				if damages != 1 || !targetTimingAliveCondition(*op.Condition, ctx.namedFormulas, 0) {
					fail("target expiry reapplication only permits target HP current greater than zero after its damage")
				}
			} else if tail {
				fail("target expiry conditional reapplication must be a contiguous tail")
			}
		} else {
			fail("target expiry payload contains an unsupported leaf")
		}
		compileOperation(op, leaf, int(owner), ctx)
		ctx.outputUnitIndex++
	}
	ctx.endOutputUnit()
	if damages != 1 {
		fail("target expiry payload requires exactly one damage")
	}
	spec.OnExpireCount = uint16(len(ctx.session.Operations)) - spec.OnExpireStart
	return spec
}

func targetTimingDamageLeaf(op model.OperationDefinition) bool {
	return op.Operation == "damage" && op.Target == "target" && op.Amount != nil && op.DamageType != "" && !targetMarkExtraFields(op) && op.TargetMark == nil && op.ResourceKey == "" && !op.CritEligible && op.VampQualification == model.VampResolved && len(op.Types) == 2 && containsTargetMarkType(op.Types, "damage_trait/delivery_skill") && containsTargetMarkType(op.Types, "damage_trait/origin_direct")
}

func targetTimingAliveCondition(expr model.GenericFormulaExpr, named map[string]model.GenericFormulaExpr, depth int) bool {
	if depth > 64 {
		return false
	}
	if expr.Op == "ref" {
		next, ok := named[expr.Ref]
		return ok && targetTimingAliveCondition(next, named, depth+1)
	}
	return expr.Op == "gt" && len(expr.Args) == 2 && expr.Args[0].Op == "read" && expr.Args[0].Path == "target.attr.hp.current" && targetMarkLiteralNonnegative(&expr.Args[1]) && *expr.Args[1].Value == 0
}

func targetTimingField(field plan.CompiledProviderStateField) bool {
	return finiteIntegerTargetState(field) && validStateInteger(float64(field.DurationMs)) && field.DefaultValue == 0 && field.HasCap && field.MaxValue == 1 && field.RefreshPolicy == model.ProviderStateRefreshOnWrite && field.OnExpireCount == 0
}

func finalizeTargetTiming(req model.CompileRequest, ctx *genericCompileContext) {
	s := ctx.session
	for pi := range s.Providers {
		p := &s.Providers[pi]
		phases, expiry := 0, 0
		for ai := int(p.AbilityStart); ai < int(p.AbilityStart)+int(p.AbilityCount); ai++ {
			a := &s.Abilities[ai]
			key, phased := "", false
			if a.TickSpec != nil && a.TickSpec.PhasePolicy != "" {
				t := a.TickSpec
				key, phased = t.AnchorStateKey, true
				phases++
				if t.PhasePolicy != preserveTargetPhase || !t.IsAnchored() || t.AnchorScope != "state_scope/provider_target" || t.StartDelayMs != 0 || t.IntervalMs <= 0 || !validStateInteger(float64(t.IntervalMs)) || t.OnTickCount != 1 || a.Kind != "tick" || a.OperationCount != 0 {
					ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, "phased target tick requires exactly one closed anchored damage", a.AbilityKey)
				}
				for _, raw := range req.SharedProviders[pi].Abilities {
					if raw.AbilityKey == a.AbilityKey && raw.TickSpec != nil {
						for _, op := range raw.TickSpec.OnTick {
							if !targetTimingDamageLeaf(op) {
								ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, "phased target tick forbids conditional or additional behavior", a.AbilityKey)
							}
						}
					}
				}
				for oi := int(t.OnTickStart); oi < int(t.OnTickStart)+int(t.OnTickCount); oi++ {
					validateTargetTimingDamage(s.Operations[oi], *a, false, ctx)
				}
			}
			if a.TargetExpirySpec != nil {
				key = a.TargetExpirySpec.AnchorStateKey
				expiry++
			}
			if key == "" {
				continue
			}
			field, ok := p.StateFields[key]
			if !ok || !targetTimingField(field) || a.SkillKey != p.SkillKey || a.Cost != nil || a.Cooldown != nil || a.HasCastCondition || a.ProcessControl != nil || a.HasSkillHit || a.IsBasicAttack {
				ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, "target timing requires its same skill finite ordinary zero/one anchor and passive ability", key)
			}
			for _, prior := range p.TargetTimings {
				if prior.StateKey == key {
					ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, "target timing anchors must be unique", key)
				}
			}
			p.TargetTimings = append(p.TargetTimings, plan.CompiledTargetTiming{StateKey: key, AbilityIndex: uint16(ai), Phased: phased})
		}
		if len(p.TargetTimings) == 0 {
			continue
		}
		s.Features |= plan.FeatureTargetTiming
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, message, p.ProviderKey)
		}
		if phases > 3 || expiry > 1 || len(p.TargetTimings) > 4 || (p.Kind != "character" && p.Kind != "build") || p.StableID == "" || p.SkillKey == "" || p.Lifecycle != nil || p.AmmoBinding != nil || len(p.Processes)+len(p.Modifiers)+len(p.StatusContributions) != 0 || p.HasStateOnExpire {
			fail("target timing requires a bounded permanent natural source without mixed roots")
		}
		for key, field := range p.StateFields {
			if !ordinaryTargetInteger(field) || field.DefaultValue != 0 || !field.HasCap || !validStateInteger(field.MaxValue) || field.MaxValue <= 0 || field.DurationMs > 0 && field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
				ctx.collector.addError(model.GenericErrFormulaTypeError, p.ProviderKey, "target timing source only admits complete finite ordinary default-zero capped target integer fields", key)
			}
		}
		mounts := 0
		for _, actor := range req.Combatants {
			for _, mount := range actor.Providers {
				if mount.DefinitionRef == p.ProviderKey {
					mounts++
					if !freshTargetTimingInput(mount.InitialState, p.StateFields) || len(mount.InitialAbilityState) != 0 {
						fail("target timing mount must contain only fresh default state")
					}
				}
			}
		}
		if mounts != 1 {
			fail("target timing requires one actual unique initial owner mount")
		}
		for _, listener := range s.Listeners {
			if listener.OwnerProviderRef == "" {
				continue
			}
			owned := false
			for _, actor := range s.Combatants {
				if actor.Key != listener.OwnerCombatantKey {
					continue
				}
				for _, mount := range actor.ProviderMounts {
					owned = owned || mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == pi
				}
			}
			if !owned {
				continue
			}
			hit, h := s.RuntimeTypes.SkillHit.Lookup()
			damage, d := s.RuntimeTypes.DamageInstance.Lookup()
			owner, o := s.RuntimeTypes.SourceOwner.Lookup()
			isHit := h && listener.EventMatcher.RequiresAllType(hit)
			isDamage := d && listener.EventMatcher.RequiresAllType(damage)
			if !o || !listener.EventMatcher.RequiresAllType(owner) || isHit == isDamage || listener.HasAbilityRef || listener.MaxTriggersPerEvent != 1 || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 {
				fail("target timing source listeners require complete original owner skill-hit or per-damage events")
			}
			for _, op := range s.Operations[int(listener.OperationStart) : int(listener.OperationStart)+int(listener.OperationCount)] {
				if op.OwnerProviderIndex != pi {
					fail("target timing listener has a foreign operation owner")
					continue
				}
				switch op.Operation {
				case "state_change":
					field, ok := p.StateFields[op.Ref]
					value, static := ctx.formulas.FoldStatic(op.AmountProgram)
					if !isHit || op.Target != "self" || op.StateScope != "state_scope/provider_target" || op.ValuePolicy != "set" || !ok || !ordinaryTargetInteger(field) || !field.HasCap || !op.HasAmount || !static || len(ctx.formulas.ReadDependencies(op.AmountProgram)) != 0 || !validStateInteger(value) || value < 0 || value > field.MaxValue {
						fail("target timing hit listeners only admit static own finite target SET operations")
					}
				case model.OperationKindStateDurationChange:
					if !isHit || op.ValuePolicy != ensureTargetPhase {
						fail("target timing listeners cannot use legacy or unrelated duration actions")
					}
				case "resource_change":
					value, static := ctx.formulas.FoldStatic(op.AmountProgram)
					if !static && listener.SourceAbilityIndex >= 0 {
						a := s.Abilities[listener.SourceAbilityIndex]
						static = true
						for _, read := range ctx.formulas.ReadDependencies(op.AmountProgram) {
							v, present := a.Params[read.ReadKey]
							static = static && read.ReadKind == formula.ReadAbilityParam && present && !math.IsNaN(v) && !math.IsInf(v, 0)
						}
						if static {
							var err error
							value, err = ctx.formulas.Eval(op.AmountProgram, formula.GenericEvalContext{StrictReads: true, AbilityParams: model.BorrowNumericView(a.Params)})
							static = err == nil
						}
					}
					if !isDamage || op.Target != "self" || op.ResourceKey == "" || op.ResourceKey == "hp" || !op.HasAmount || !static || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
						fail("target timing damage listeners only admit static own non-HP recovery")
					}
				default:
					fail("target timing source listener contains an unsupported behavior")
				}
			}
		}
		for ai := int(p.AbilityStart); ai < int(p.AbilityStart)+int(p.AbilityCount); ai++ {
			a := s.Abilities[ai]
			if a.Kind == "tick" && a.TickSpec != nil && a.TickSpec.PhasePolicy == preserveTargetPhase || a.Kind == "stateful" && a.TargetExpirySpec != nil {
			} else if a.Kind != "passive_listener" || a.TickSpec != nil || a.TargetExpirySpec != nil || a.Cost != nil || a.Cooldown != nil || a.HasCastCondition || a.ProcessControl != nil || a.HasSkillHit {
				fail("target timing source contains an unsupported natural root")
			}
			if a.TargetExpirySpec != nil {
				x := a.TargetExpirySpec
				for oi := int(x.OnExpireStart); oi < int(x.OnExpireStart)+int(x.OnExpireCount); oi++ {
					op := s.Operations[oi]
					if op.Operation == "damage" {
						validateTargetTimingDamage(op, a, true, ctx)
						continue
					}
					f, ok := p.StateFields[op.Ref]
					value, static := ctx.formulas.FoldStatic(op.AmountProgram)
					if !ok || !ordinaryTargetInteger(f) || !f.HasCap || !op.HasAmount || len(ctx.formulas.ReadDependencies(op.AmountProgram)) != 0 || !static || !validStateInteger(value) || value < 0 || value > f.MaxValue || op.Ref == x.AnchorStateKey && value > 0 {
						fail("target expiry SET requires static own capped ordinary target state and cannot rearm itself")
					}
				}
			}
		}
	}
	for oi, op := range s.Operations {
		if op.Operation != model.OperationKindStateDurationChange || op.ValuePolicy != ensureTargetPhase {
			continue
		}
		fail := func() {
			ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "phase preserving extension requires a real unblocked owner skill-hit listener and own phased anchor with static positive integer milliseconds", op.Ref)
		}
		valid := op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(s.Providers) && op.Target == "self" && op.StateScope == "state_scope/provider_target"
		anchored := false
		if valid {
			for _, timing := range s.Providers[op.OwnerProviderIndex].TargetTimings {
				anchored = anchored || timing.Phased && timing.StateKey == op.Ref
			}
		}
		amount, static := ctx.formulas.FoldStatic(op.AmountProgram)
		listenerValid := false
		for _, listener := range s.Listeners {
			if oi < int(listener.OperationStart) || oi >= int(listener.OperationStart)+int(listener.OperationCount) || !listener.HasCondition || listener.OwnerProviderRef == "" || listener.HasAbilityRef || listener.MaxTriggersPerEvent != 1 {
				continue
			}
			for _, binding := range s.SkillActionBindings {
				for _, hit := range binding.HitBindings {
					ref, exists := s.AbilityRefIndex[hit.HitAbilityRef]
					if exists && binding.Source == listener.OwnerCombatantKey && targetMarkMatcher(listener, s.Abilities[ref.AbilityIndex], model.EventTypeSkillHit, ctx) && targetMarkConditionUnblocked(listener.ConditionProgram, ctx.formulas, 0) {
						listenerValid = true
					}
				}
			}
		}
		if !valid || !anchored || !listenerValid || !op.HasAmount || !static || len(ctx.formulas.ReadDependencies(op.AmountProgram)) != 0 || !validStateInteger(amount) || amount <= 0 {
			fail()
		}
	}
	for _, op := range s.Operations {
		if op.HasAbilityRef {
			rejectTargetExpiryRef(op.AbilityRefStr, op.Path, ctx)
		}
		if op.Operation == "apply_provider" || op.Operation == "refresh_provider" || op.Operation == "provider_duration_change" {
			for _, provider := range s.Providers {
				if len(provider.TargetTimings) > 0 && op.ProviderDefinitionRef == provider.ProviderKey {
					ctx.collector.addError(model.GenericErrUnknownRef, op.Path, "target timing sources can only be installed as their actual initial mount", op.ProviderDefinitionRef)
				}
			}
		}
	}
	for _, listener := range s.Listeners {
		if listener.HasAbilityRef {
			rejectTargetExpiryRef(listener.AbilityRef, "listeners."+listener.ListenerKey, ctx)
		}
	}
}

func rejectTargetExpiryRef(ref, path string, ctx *genericCompileContext) {
	if binding, ok := ctx.session.AbilityRefIndex[ref]; ok && int(binding.AbilityIndex) < len(ctx.session.Abilities) && ctx.session.Abilities[binding.AbilityIndex].TargetExpirySpec != nil {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "target expiry payload cannot be invoked by an ability reference", ref)
	}
}

func validateTargetTimingDamage(op plan.CompiledOperation, a plan.CompiledAbility, expiry bool, ctx *genericCompileContext) {
	for _, read := range ctx.formulas.ReadDependencies(op.AmountProgram) {
		value, present := a.Params[read.ReadKey]
		valid := read.ReadKind == formula.ReadAbilityParam && present && !math.IsNaN(value) && !math.IsInf(value, 0) || read.ReadKind == formula.ReadTargetAttr && read.ReadKey == "hp.max" || expiry && read.ReadKind == formula.ReadSourceAttr && read.ReadKey == "ability_power.resolved"
		if !valid {
			ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "target timing damage amount contains an unauthorized runtime read", read.ReadKey)
		}
	}
}

// The compile mount is deliberately checked before runtime restoration. Runtime
// snapshot validation repeats this gate using the actual mounted definition.
func freshTargetTimingInput(input map[string]interface{}, fields map[string]plan.CompiledProviderStateField) bool {
	for key, value := range input {
		switch key {
		case "state":
			values, ok := value.(map[string]interface{})
			if !ok {
				return false
			}
			for k, v := range values {
				f, ok := fields[k]
				n, number := v.(float64)
				if !number {
					switch x := v.(type) {
					case int:
						n = float64(x)
						number = true
					case int64:
						n = float64(x)
						number = true
					}
				}
				if !ok || !number || n != f.DefaultValue {
					return false
				}
			}
		case "expireAt":
			values, ok := value.(map[string]interface{})
			if !ok {
				return false
			}
			for _, v := range values {
				if !zeroTimingValue(v) {
					return false
				}
			}
		case "targetState":
			values, ok := value.(map[string]interface{})
			if !ok {
				return false
			}
			for k, v := range values {
				if k == "target" {
					if v != "" {
						return false
					}
				} else if k == "values" || k == "expireAt" {
					m, ok := v.(map[string]interface{})
					if !ok {
						return false
					}
					for _, n := range m {
						if !zeroTimingValue(n) {
							return false
						}
					}
				} else {
					return false
				}
			}
		default:
			f, ok := fields[key]
			if !ok || !zeroTimingValue(value) || f.DefaultValue != 0 || strings.TrimSpace(key) == "" {
				return false
			}
		}
	}
	return true
}
func zeroTimingValue(value interface{}) bool {
	switch v := value.(type) {
	case float64:
		return v == 0
	case int:
		return v == 0
	case int64:
		return v == 0
	}
	return false
}
