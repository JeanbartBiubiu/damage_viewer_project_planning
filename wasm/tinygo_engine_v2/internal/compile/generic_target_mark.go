package compile

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func targetMarkExtraFields(op model.OperationDefinition) bool {
	return op.ValuePolicy != "" || op.AttributeKey != "" || op.AbilityRef != "" || op.ShieldRef != "" || op.ShieldLifecycleProviderDefinitionRef != "" ||
		op.ProviderDefinitionRef != "" || op.ProviderRef != "" || op.EventType != "" || op.Payload != nil || len(op.Tags) != 0 || op.Condition != nil ||
		op.CopyableOnHit || op.CritChance != nil || op.CritMultiplier != nil || op.CritMultiplierMin != nil || op.RepeatScope != "" || op.RepeatCount != 0 ||
		op.RepeatTag != "" || op.RepeatDelayMs != 0 || op.TriggerStateKey != "" || op.Threshold != 0 || op.SkillHit != nil || op.ProviderRefFromEvent || op.OutputRef != "" || op.ShieldDurationMs != nil
}

func compileTargetMarkOperation(op model.OperationDefinition, path string, owner int, ctx *genericCompileContext) {
	fail := func(message string) { ctx.collector.addError(model.GenericErrUnknownRef, path, message, op.Ref) }
	if op.Target != "target" || op.Ref == "" || op.TargetMark == nil || targetMarkExtraFields(op) || op.Amount != nil || op.DamageType != "" || op.ResourceKey != "" || len(op.Types) != 0 || op.CritEligible || op.VampQualification != "" || len(op.VampOverrides) != 0 {
		fail("consume_target_mark requires only operation/target/ref/targetMark")
		return
	}
	m := op.TargetMark
	if m.StateKey == "" || m.StateScope != "provider_target" || m.TriggerAbilityRef == "" || (m.TriggerKind != model.EventTypeSkillHit && m.TriggerKind != model.EventTypeBasicAttackHit) || m.DamageBlockScope != model.SpellShieldScopeDamageInstance || m.Damage == nil {
		fail("targetMark requires its own target field, real hit binding and DAMAGE_INSTANCE payload")
		return
	}
	damage := *m.Damage
	if damage.Operation != "damage" || damage.Target != "target" || damage.Ref == "" || damage.Amount == nil || damage.DamageType == "" || damage.ResourceKey != "" || damage.TargetMark != nil || targetMarkExtraFields(damage) || damage.CritEligible || damage.VampQualification != model.VampResolved ||
		len(damage.Types) != 2 || !containsTargetMarkType(damage.Types, "damage_trait/delivery_skill") || !containsTargetMarkType(damage.Types, "damage_trait/origin_direct") {
		fail("targetMark damage requires one noncritical SKILL/DIRECT resolved target damage leaf")
		return
	}
	compiled := plan.CompiledOperation{Operation: op.Operation, Target: op.Target, Ref: op.Ref, Path: path, OwnerProviderIndex: owner,
		TargetMark: &plan.CompiledTargetMark{StateKey: m.StateKey, TriggerKind: m.TriggerKind, TriggerAbilityRef: m.TriggerAbilityRef}}
	compiled.TargetMark.Damage = compileTargetMarkLeaf(damage, path+".targetMark.damage", owner, ctx)
	zero := model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(0)}
	compiled.TargetMark.Clear = compileTargetMarkLeaf(model.OperationDefinition{Operation: "state_change", Target: "self", Ref: m.StateKey, ValuePolicy: "set", Types: []string{"state_scope/provider_target"}, Amount: &zero}, path+".targetMark.stateKey", owner, ctx)
	if m.Restore != nil {
		r := *m.Restore
		if m.TriggerKind != model.EventTypeSkillHit || r.Operation != "resource_change" || r.Target != "self" || r.Ref == "" || r.ResourceKey == "" || r.ResourceKey == "hp" || !targetMarkLiteralNonnegative(r.Amount) ||
			r.TargetMark != nil || targetMarkExtraFields(r) || r.DamageType != "" || len(r.Types) != 0 || r.CritEligible || r.VampQualification != "" || len(r.VampOverrides) != 0 {
			fail("targetMark restore requires an optional static nonnegative self non-HP resource leaf on a skill hit")
			return
		}
		compiled.TargetMark.Restore = compileTargetMarkLeaf(r, path+".targetMark.restore", owner, ctx)
	}
	ctx.session.Operations = append(ctx.session.Operations, compiled)
}

func compileTargetMarkLeaf(op model.OperationDefinition, path string, owner int, ctx *genericCompileContext) *plan.CompiledOperation {
	start := len(ctx.session.Operations)
	compileOperation(op, path, owner, ctx)
	if len(ctx.session.Operations) != start+1 {
		ctx.collector.addError(model.GenericErrUnknownRef, path, "target mark requires exactly one compiled leaf", op.Ref)
		ctx.session.Operations = ctx.session.Operations[:start]
		return nil
	}
	leaf := ctx.session.Operations[start]
	ctx.session.Operations = ctx.session.Operations[:start]
	return &leaf
}

func containsTargetMarkType(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func finalizeTargetMarkConsumption(req model.CompileRequest, ctx *genericCompileContext) {
	for index := range ctx.session.Operations {
		op := &ctx.session.Operations[index]
		if op.Operation != model.OperationKindConsumeTargetMark {
			continue
		}
		fail := func(message string) { ctx.collector.addError(model.GenericErrUnknownRef, op.Path, message, op.Ref) }
		m, owner := op.TargetMark, op.OwnerProviderIndex
		if m == nil || m.Damage == nil || owner < 0 || owner >= len(ctx.session.Providers) {
			fail("target mark requires its complete compiled payload and parent")
			continue
		}
		parent := ctx.session.Providers[owner]
		field, exists := parent.StateFields[m.StateKey]
		if parent.Kind != "character" || parent.StableID == "" || parent.SkillKey == "" || parent.Lifecycle != nil || !exists || !finiteIntegerTargetState(field) || field.DefaultValue != 0 || !field.HasCap || field.MaxValue != 1 || field.RefreshPolicy != model.ProviderStateRefreshOnWrite || field.OnExpireCount != 0 {
			fail("target mark requires a permanent character parent and own finite ordinary 0/1 field")
			continue
		}
		var listener *plan.CompiledListener
		matches := 0
		for i := range ctx.session.Listeners {
			candidate := &ctx.session.Listeners[i]
			if int(candidate.OperationStart) == index && candidate.OperationCount == 1 {
				listener, matches = candidate, matches+1
			}
		}
		if matches != 1 || listener == nil || !targetMarkListenerShape(*listener, owner, ctx) || !strings.Contains(op.Path, ".listenerSpec.operations[") {
			fail("consume_target_mark is only available in one actual single-operation passive listener")
			continue
		}
		mounts := 0
		for _, actor := range ctx.session.Combatants {
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == owner {
					mounts++
					if actor.Key != model.SelectorSource || mount.ProviderRef != listener.OwnerProviderRef {
						fail("target mark parent cannot use a foreign or duplicate mount")
					}
				}
			}
		}
		if mounts != 1 || listener.OwnerCombatantKey != model.SelectorSource {
			fail("target mark requires one real source mount")
			continue
		}
		m.OwnerCombatantKey, m.OwnerProviderRef = listener.OwnerCombatantKey, listener.OwnerProviderRef
		own := targetMarkInitialHit(ctx, m.OwnerProviderRef, parent.SkillKey, "")
		if own == "" {
			fail("target mark parent requires its unique real INITIAL hit binding")
			continue
		}
		m.MarkAbilityRef = own
		ref, found := ctx.session.AbilityRefIndex[m.TriggerAbilityRef]
		parsed, valid := plan.ParseAbilityRef(m.TriggerAbilityRef)
		if !found || !valid || parsed.Combatant != model.SelectorSource || int(ref.AbilityIndex) >= len(ctx.session.Abilities) {
			fail("target mark trigger must address a real source hit ability")
			continue
		}
		ability := ctx.session.Abilities[ref.AbilityIndex]
		if !ability.HasSkillHit || ability.Kind != "active" || ability.OperationCount != 1 || !targetMarkMatcher(*listener, ability, m.TriggerKind, ctx) {
			fail("target mark listener must match its actual native hit and source owner")
			continue
		}
		if m.TriggerKind == model.EventTypeBasicAttackHit {
			if !ability.IsBasicAttack || m.Restore != nil {
				fail("attack mark consumption requires a native basic hit and no restore")
			}
		} else if ability.IsBasicAttack || ability.SkillKey == parent.SkillKey || targetMarkInitialHit(ctx, parsed.ProviderRef, ability.SkillKey, m.TriggerAbilityRef) == "" {
			fail("skill mark consumption requires a different skill's unique actual INITIAL hit")
		}
		m.TriggerAbilityIndex = ref.AbilityIndex
		for _, candidate := range ctx.session.Abilities[int(parent.AbilityStart) : int(parent.AbilityStart)+int(parent.AbilityCount)] {
			if candidate.TickSpec != nil && candidate.TickSpec.AnchorStateKey == m.StateKey && candidate.TickSpec.AnchorScope == "state_scope/provider_target" {
				fail("target mark field cannot anchor a periodic callback")
			}
		}
		validateTargetMarkPrograms(m.Damage, ctx.session.Abilities[listener.SourceAbilityIndex], req.Formulas, ctx)
		if m.Restore != nil {
			validateTargetMarkPrograms(m.Restore, ctx.session.Abilities[listener.SourceAbilityIndex], req.Formulas, ctx)
		}
		writers := 0
		for wi := range ctx.session.Operations {
			writer := &ctx.session.Operations[wi]
			if writer.OwnerProviderIndex != owner || writer.Ref != m.StateKey || (writer.Operation != "state_change" && writer.Operation != model.OperationKindStateDurationChange) {
				continue
			}
			if !targetMarkSetter(wi, *writer, own, owner, ctx) {
				fail("target mark field has an unauthorized writer")
				continue
			}
			writer.TargetMarkWriterRef = own
			writers++
		}
		if writers != 1 {
			fail("target mark requires exactly one unblocked own INITIAL SET1 listener")
		}
		ctx.session.Features |= plan.FeatureTargetMarkConsumption
	}
}

func targetMarkListenerShape(listener plan.CompiledListener, owner int, ctx *genericCompileContext) bool {
	index := listener.SourceAbilityIndex
	if index < 0 || index >= len(ctx.session.Abilities) || listener.HasAbilityRef || listener.HasOncePerUse || listener.PerCastThrottleMs != 0 || listener.MaxTriggersPerEvent != 1 {
		return false
	}
	a := ctx.session.Abilities[index]
	return int(a.ProviderIndex) == owner && a.Kind == "passive_listener" && a.Cost == nil && a.Cooldown == nil && !a.HasCastCondition && a.TickSpec == nil && a.ProcessControl == nil && a.OperationCount == 0
}

func targetMarkMatcher(listener plan.CompiledListener, ability plan.CompiledAbility, kind string, ctx *genericCompileContext) bool {
	event, found := ctx.catalog.Registry.LookupDomain("event", kind)
	owner, hasOwner := ctx.catalog.Registry.LookupDomain("event", "event/source_owner")
	if !found || !hasOwner || !listener.EventMatcher.RequiresAllType(event) || !listener.EventMatcher.RequiresAllType(owner) {
		return false
	}
	var set typeset.TypeSet
	if kind == model.EventTypeSkillHit {
		set = ability.TypeSet
	}
	set.Add(event)
	set.Add(owner)
	return listener.EventMatcher.Match(set)
}

func targetMarkInitialHit(ctx *genericCompileContext, providerRef, skill, expected string) string {
	result, matches := "", 0
	for _, binding := range ctx.session.SkillActionBindings {
		if binding.Source != model.SelectorSource || binding.ProviderRef != providerRef || binding.SkillKey != skill || len(binding.Controls) != 1 || binding.Controls[0].Action != "INITIAL" {
			continue
		}
		for _, hit := range binding.HitBindings {
			if expected == "" || hit.HitAbilityRef == expected {
				result, matches = hit.HitAbilityRef, matches+1
			}
		}
	}
	if matches != 1 {
		return ""
	}
	return result
}

func targetMarkSetter(index int, op plan.CompiledOperation, own string, owner int, ctx *genericCompileContext) bool {
	if op.Operation != "state_change" || op.StateScope != "state_scope/provider_target" || op.Target != model.SelectorSelf || op.ValuePolicy != "set" || !op.HasAmount || len(ctx.formulas.ReadDependencies(op.AmountProgram)) != 0 {
		return false
	}
	amount, static := ctx.formulas.FoldStatic(op.AmountProgram)
	if !static || amount != 1 {
		return false
	}
	ref := ctx.session.AbilityRefIndex[own]
	for _, listener := range ctx.session.Listeners {
		if int(listener.OperationStart) == index && listener.OperationCount == 1 && targetMarkListenerShape(listener, owner, ctx) && listener.OwnerCombatantKey == model.SelectorSource &&
			targetMarkMatcher(listener, ctx.session.Abilities[ref.AbilityIndex], model.EventTypeSkillHit, ctx) && listener.HasCondition && targetMarkConditionUnblocked(listener.ConditionProgram, ctx.formulas, 0) {
			return true
		}
	}
	return false
}

func targetMarkLiteralNonnegative(expr *model.GenericFormulaExpr) bool {
	return expr != nil && expr.Op == "const" && expr.Value != nil && !math.IsNaN(*expr.Value) && !math.IsInf(*expr.Value, 0) && *expr.Value >= 0 && expr.LinkedProgram == nil && expr.Path == "" && expr.Ref == "" && len(expr.Args) == 0 && expr.Expr == nil && expr.Min == nil && expr.Max == nil && expr.Decimals == nil
}

func targetMarkProgramBindings(id formula.GenericProgramID, skill string, definitions []model.NamedFormula, registry formula.Builder, depth int) bool {
	if depth > 64 || int(id) >= registry.Count() {
		return false
	}
	program := registry.Info(formula.GenericProgramID(id))
	if program.HasNamedBinding {
		if program.Scope == "skill" && program.SkillKey != skill {
			return false
		}
		for _, definition := range definitions {
			if definition.Key == program.Key {
				for _, parameter := range definition.Parameters {
					if parameter.ValueMode == "RUNTIME_INPUT" {
						return false
					}
				}
			}
		}
	}
	for _, instruction := range registry.Instructions(id) {
		if instruction.Op == formula.GenericOpRef && !targetMarkProgramBindings(formula.GenericProgramID(instruction.RefIndex), skill, definitions, registry, depth+1) {
			return false
		}
	}
	return true
}

func validateTargetMarkPrograms(op *plan.CompiledOperation, ability plan.CompiledAbility, definitions []model.NamedFormula, ctx *genericCompileContext) {
	if op == nil || !op.HasAmount {
		return
	}
	programs := []formula.GenericProgramID{op.AmountProgram}
	for _, override := range op.VampOverrides {
		if override.Mode == model.VampOverride {
			programs = append(programs, override.EfficiencyProgram)
		}
	}
	for _, program := range programs {
		if !targetMarkProgramBindings(program, ability.SkillKey, definitions, ctx.formulas, 0) {
			ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "target mark forbids runtime input and foreign skill formula bindings", op.Ref)
		}
		for _, read := range ctx.formulas.ReadDependencies(program) {
			allowed := op.Operation == "damage" && (read.ReadKind == formula.ReadSourceAttr || read.ReadKind == formula.ReadTargetAttr)
			if op.Operation == "damage" && read.ReadKind == formula.ReadAbilityParam {
				value, exists := ability.Params[read.ReadKey]
				allowed = exists && !math.IsNaN(value) && !math.IsInf(value, 0)
			}
			if !allowed {
				ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path, "target mark payload only reads its own frozen parameters and current attributes", read.ReadKey)
			}
		}
	}
}
