package admission

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// FoldOwnedRecoveryAmount 只折叠已选监听能力的静态参数，不能提供运行期缓存金额。
func FoldOwnedRecoveryAmount(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) (float64, bool) {
	if value, static := input.Formulas.Metadata.FoldStatic(operation.AmountProgram); static {
		return value, true
	}
	if listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return 0, false
	}
	ability := input.Compiled.Abilities[listener.SourceAbilityIndex]
	provider := input.Compiled.Providers[operation.OwnerProviderIndex]
	if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != operation.OwnerProviderIndex || listener.SourceAbilityIndex < int(provider.AbilityStart) || listener.SourceAbilityIndex >= int(provider.AbilityStart)+int(provider.AbilityCount) {
		return 0, false
	}
	reads := input.Formulas.Metadata.ReadDependencies(operation.AmountProgram)
	if len(reads) == 0 {
		return 0, false
	}
	for _, read := range reads {
		value, present := ability.Params[read.ReadKey]
		if read.ReadKind != formula.ReadAbilityParam || read.ReadKey == "" || !present || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
	}
	value, err := input.Formulas.Evaluation.Eval(operation.AmountProgram, formula.GenericEvalContext{StrictReads: true, AbilityParams: model.BorrowNumericView(ability.Params)})
	return value, err == nil
}

// Admission checks the actual owner's current inputs without freezing the
// amount. The mounted-listener executor still evaluates it for every event.

// EvaluateOwnedDynamicHealAmount 校验实际拥有者当前输入及所有可达依赖；结果仅用于准入，不冻结事件金额。
func EvaluateOwnedDynamicHealAmount(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) (float64, bool) {
	if listener.SourceAbilityIndex < 0 || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
		return 0, false
	}
	ability := input.Compiled.Abilities[listener.SourceAbilityIndex]
	provider := input.Compiled.Providers[operation.OwnerProviderIndex]
	owner, exists := actorView(input, listener.OwnerCombatantKey)
	if !exists || ability.Kind != "passive_listener" || int(ability.ProviderIndex) != operation.OwnerProviderIndex || listener.SourceAbilityIndex < int(provider.AbilityStart) || listener.SourceAbilityIndex >= int(provider.AbilityStart)+int(provider.AbilityCount) {
		return 0, false
	}
	context := formula.GenericEvalContext{StrictReads: true, SourceAttrs: owner.Attributes, AbilityParams: model.BorrowNumericView(ability.Params)}
	hasOwnedAttribute := false
	for _, read := range input.Formulas.Metadata.ReadDependencies(operation.AmountProgram) {
		if read.ReadKey == "" {
			return 0, false
		}
		switch read.ReadKind {
		case formula.ReadSourceAttr:
			attributeKey, field := read.ReadKey, "resolved"
			if dot := strings.LastIndex(read.ReadKey, "."); dot > 0 {
				attributeKey, field = read.ReadKey[:dot], read.ReadKey[dot+1:]
			}
			slot, present := owner.Attributes.Lookup(attributeKey)
			if !present {
				return 0, false
			}
			switch field {
			case "base":
				present = slot.HasBase()
			case "current":
				present = slot.HasCurrent()
			case "max":
				present = slot.HasMax()
			case "resolved":
				present = slot.HasResolved()
			default:
				return 0, false
			}
			if !present {
				return 0, false
			}
			hasOwnedAttribute = true
		case formula.ReadAbilityParam:
			value, present := ability.Params[read.ReadKey]
			if !present || math.IsNaN(value) || math.IsInf(value, 0) {
				return 0, false
			}
		default:
			return 0, false
		}
		// Check both conditional branches as well as the selected output.
		value, err := formula.EvaluateRead(read, context)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
	}
	if !hasOwnedAttribute {
		return 0, false
	}
	value, err := input.Formulas.Evaluation.Eval(operation.AmountProgram, context)
	return value, err == nil
}

// OwnedSettledSelfRecovery 校验真实挂载、自身数值和金额依赖；事件金额的结构资格由完整监听准入链在需要时继续核定。
func OwnedSettledSelfRecovery(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) (qualified, requiresEventAmount bool) {
	if (operation.Target != model.SelectorSelf && operation.Target != model.SelectorSource) || !operation.HasAmount || int(operation.AmountProgram) >= input.Formulas.Metadata.Count() || operation.OwnerProviderIndex < 0 || operation.OwnerProviderIndex >= len(input.Compiled.Providers) {
		return false, false
	}
	settled := false
	for _, pair := range []struct{ kind, relation planbundle.DeclaredType }{
		{input.Compiled.RuntimeTypes.DamageInstance, input.Compiled.RuntimeTypes.SourceOwner},
		{input.Compiled.RuntimeTypes.DamageTaken, input.Compiled.RuntimeTypes.TargetOwner},
	} {
		kind, declared := pair.kind.Lookup()
		relation, relationDeclared := pair.relation.Lookup()
		settled = settled || declared && relationDeclared && listener.EventMatcher.RequiresAllType(kind) && listener.EventMatcher.RequiresAllType(relation)
	}
	if !settled {
		return false, false
	}
	owned := false
	for _, actor := range input.Compiled.Combatants {
		if actor.Key != listener.OwnerCombatantKey {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			owned = owned || mount.ProviderRef == listener.OwnerProviderRef && int(mount.DefinitionIndex) == operation.OwnerProviderIndex
		}
	}
	owner, exists := actorView(input, listener.OwnerCombatantKey)
	if !owned || !exists {
		return false, false
	}
	amount, supported := FoldOwnedRecoveryAmount(input, listener, operation)
	if !supported && operation.Operation == "heal" {
		amount, supported = EvaluateOwnedDynamicHealAmount(input, listener, operation)
	}
	if !supported {
		if operation.Operation != "heal" {
			return false, false
		}
		requiresEventAmount = true
	} else if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return false, false
	}
	health, hasHealth := owner.Attributes.Lookup("hp")
	if !hasHealth || !health.HasCurrent() || !health.HasMax() || math.IsNaN(health.Current) || math.IsInf(health.Current, 0) || math.IsNaN(health.Max) || math.IsInf(health.Max, 0) || health.Max <= 0 || health.Current < 0 || health.Current > health.Max {
		return false, false
	}
	if operation.Operation == "heal" {
		return true, requiresEventAmount
	}
	if operation.ResourceKey == "" || operation.ResourceKey == "hp" {
		return false, false
	}
	slot, present := owner.Resources.Lookup(operation.ResourceKey)
	return present && !math.IsNaN(slot.Current) && !math.IsInf(slot.Current, 0) && !math.IsNaN(slot.Max) && !math.IsInf(slot.Max, 0) && slot.Max > 0 && slot.Current >= 0 && slot.Current <= slot.Max, requiresEventAmount
}
