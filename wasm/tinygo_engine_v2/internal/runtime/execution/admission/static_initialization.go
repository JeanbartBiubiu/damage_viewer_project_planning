package admission

import (
	"math"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
)

// InitialProvider 是初始化准入所需的实际单个挂载事实，不携带可写状态。
type InitialProvider struct {
	Present                      bool
	DefinitionIndex              uint16
	DefinitionRef, Source, Owner string
	Stacks                       int
	ExpireAt                     int64
	StateCount                   int
}

// validateStaticInitializerDefinition 校验永久初始化来源的完整形状，不派发监听。
func validateStaticInitializerDefinition(input Input, provider planbundle.CompiledProvider, cappedParent bool) *model.EngineError {
	if (provider.Kind != "item" && provider.Kind != "character" && provider.Kind != "build") || provider.StableID == "" || (provider.AbilityCount != 0 || len(provider.Processes) != 0) && !cappedParent || provider.Lifecycle != nil || len(provider.Listeners) == 0 || len(provider.StateFields)+len(provider.StatusContributions)+len(provider.Modifiers) != 0 {
		return fail(input, "initializer must be a complete static owned source", "initialSnapshot.combatants.providers")
	}
	return nil
}

// validateStaticInitializationOperation 校验一项永久初始化操作及其完整效果定义，不安装效果。
func validateStaticInitializationOperation(input Input, listener planbundle.CompiledListener, operation planbundle.CompiledOperation, cappedInitializer bool) *model.EngineError {
	if operation.Operation != "apply_provider" || operation.Target != "self" || operation.ProviderRef == "" || operation.HasCondition || operation.HasAmount || operation.ProviderRefFromEvent {
		return fail(input, "initialization may only mount a complete permanent modifier on its own source", operation.Path)
	}
	index, exists := definitionIndex(input, operation.ProviderDefinitionRef)
	if !exists {
		return fail(input, "missing initialized effect definition", operation.Path)
	}
	effect := input.Compiled.Providers[index]
	if effect.Kind != "status" || effect.AbilityCount != 0 || effect.Lifecycle != nil || len(effect.Listeners)+len(effect.Processes)+len(effect.StateFields)+len(effect.StatusContributions) != 0 || len(effect.Modifiers) != 1 {
		return fail(input, "initialized effect must contain one permanent static modifier", operation.Path)
	}
	modifier := effect.Modifiers[0]
	if modifier.HasMaximumReductionRatio && cappedInitializer {
		return nil
	}
	if GroupedDamageSourceModifier(*input.Formulas, modifier) {
		return nil
	}
	if !modifier.HasValue || modifier.HasCondition || int(modifier.ValueProgram) >= input.Formulas.Metadata.Count() {
		return fail(input, "initialization modifier requires a finite constant", operation.Path)
	}
	value, static := input.Formulas.Metadata.FoldStatic(modifier.ValueProgram)
	if modifier.OwnedHealthReads && modifier.Kind == "attribute" && modifier.ValuePolicy == "add" && modifier.Stage == "" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorSelf {
		attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		owner, exists := actorView(input, listener.OwnerCombatantKey)
		if !exists || attributeKey == "hp" || attributeKey == "" {
			return fail(input, "health-derived addition requires an owned non-HP attribute", operation.Path)
		}
		if _, declared := owner.Attributes.Lookup(attributeKey); !declared {
			return fail(input, "health-derived addition output slot is missing", operation.Path)
		}
		if _, declared := owner.Attributes.Lookup("hp"); !declared {
			return fail(input, "health-derived addition owner HP slot is missing", operation.Path)
		}
		return nil
	}
	if !static || math.IsNaN(value) || math.IsInf(value, 0) {
		return fail(input, "initialization modifier requires an application snapshot constant", operation.Path)
	}
	if effect.PermanentResourceMax && modifier.Kind == "resource_max" && modifier.CurrentValuePolicy == "preserve_initial_current" {
		return nil
	}
	if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorOpponent {
		attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		opponentActor, exists := actorView(input, opponent(listener.OwnerCombatantKey))
		if !exists || attributeKey == "" || attributeKey == "hp" {
			return fail(input, "permanent aura requires a declared non-HP opponent attribute", operation.Path)
		}
		if _, declared := opponentActor.Attributes.Lookup(attributeKey); !declared {
			return fail(input, "permanent aura opponent attribute slot is missing", operation.Path)
		}
		if modifier.ValuePolicy != "multiply" || modifier.Stage != "total" || value < 0 {
			return fail(input, "permanent aura requires an explicit nonnegative total multiplier", operation.Path)
		}
		return nil
	}
	if modifier.Kind == "attribute" && pipeline.ModifierTargetCombatantSelector(modifier.Target) == model.SelectorSelf {
		attributeKey := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
		owner, ownerExists := actorView(input, listener.OwnerCombatantKey)
		if !ownerExists || attributeKey == "hp" || attributeKey == "" {
			return fail(input, "permanent skill attribute requires a supported owned non-HP slot", operation.Path)
		}
		if _, exists := owner.Attributes.Lookup(attributeKey); !exists {
			return fail(input, "permanent skill attribute slot is missing", operation.Path)
		}
		if !OwnedAttributePolicy(modifier) {
			return fail(input, "permanent skill attribute requires an explicit supported calculation", operation.Path)
		}
		if modifier.ValuePolicy == "complement_multiply" && (value < 0 || value > 1) {
			return fail(input, "permanent complement ratio must be in [0,1]", operation.Path)
		}
		return nil
	}
	if modifier.Kind == "pipeline" && modifier.Command == "heal" && modifier.HealDirection == model.HealReceived && modifier.HealCategory == model.HealAny && modifier.HealGroupCalculationMode == model.HealGroupRatioAdd && modifier.ValuePolicy == "add_percent" {
		return nil
	}
	if modifier.Kind == "pipeline" && modifier.Command == "shield" && modifier.Channel == "normal_shield" && modifier.Stage == "received" && modifier.ValuePolicy == "add_percent" {
		return nil
	}
	return fail(input, "unsupported permanent source modifier", operation.Path)
}

// pureOwnedLinkedShieldInitialization 检查真实父挂载、关联盾及所有创建操作的单一归属。
func pureOwnedLinkedShieldInitialization(input Input, listener planbundle.CompiledListener, instance InitialProvider) bool {
	op := input.Compiled.Operations[listener.OperationStart]
	if op.OwnerProviderIndex < 0 || op.OwnerProviderIndex >= len(input.Compiled.Providers) || op.Target != model.SelectorSelf || !op.HasAmount || op.HasCondition || op.HasShieldDuration || !op.HasShieldLifecycleProvider || op.ShieldRef == "" || int(op.ShieldLifecycleProviderIndex) >= len(input.Compiled.Providers) {
		return false
	}
	parent := input.Compiled.Providers[op.OwnerProviderIndex]
	if (parent.Kind != "character" && parent.Kind != "build") || parent.StableID == "" || parent.SkillKey == "" || parent.Lifecycle != nil || parent.AmmoBinding != nil || parent.ShieldDefinitionRef != "" || len(parent.Processes)+len(parent.StateFields)+len(parent.Modifiers)+len(parent.StatusContributions) != 0 || len(parent.Listeners) != 1 {
		return false
	}
	actualListener := parent.Listeners[0]
	if actualListener.ListenerKey != listener.ListenerKey || actualListener.OperationStart != listener.OperationStart || actualListener.OperationCount != listener.OperationCount || actualListener.SourceAbilityIndex != listener.SourceAbilityIndex {
		return false
	}
	if parent.AbilityCount == 0 {
		if listener.SourceAbilityIndex >= 0 {
			return false
		}
	} else {
		if parent.AbilityCount != 1 || listener.SourceAbilityIndex != int(parent.AbilityStart) || listener.SourceAbilityIndex >= len(input.Compiled.Abilities) {
			return false
		}
		ability := input.Compiled.Abilities[listener.SourceAbilityIndex]
		if ability.Kind != "passive_listener" || int(ability.ProviderIndex) != op.OwnerProviderIndex || ability.SkillKey != parent.SkillKey || ability.ProcessControl != nil || ability.TickSpec != nil || ability.Cost != nil || ability.Cooldown != nil || ability.HasCastCondition || ability.HasSkillHit || ability.IsBasicAttack || ability.OperationCount != 0 && (ability.OperationStart != listener.OperationStart || ability.OperationCount != listener.OperationCount) {
			return false
		}
	}
	matched, mounts := false, 0
	for _, actor := range input.Compiled.Combatants {
		if actor.Key != listener.OwnerCombatantKey {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			if int(mount.DefinitionIndex) == op.OwnerProviderIndex {
				mounts++
				matched = matched || mount.ProviderRef == listener.OwnerProviderRef
			}
		}
	}
	if mounts != 1 || !matched || !instance.Present || int(instance.DefinitionIndex) != op.OwnerProviderIndex || instance.DefinitionRef != parent.ProviderKey || instance.Source != listener.OwnerCombatantKey || instance.Owner != listener.OwnerCombatantKey || instance.Stacks != 1 || instance.ExpireAt != 0 || instance.StateCount != 0 {
		return false
	}
	amount, static := input.Formulas.Metadata.FoldStatic(op.AmountProgram)
	if !static || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
		return false
	}
	shield := input.Compiled.Providers[op.ShieldLifecycleProviderIndex]
	if shield.Kind != "status" || shield.SkillKey != parent.SkillKey || shield.ShieldDefinitionRef != op.ShieldRef || shield.AbilityCount != 0 || shield.AmmoBinding != nil || shield.NeedsElapsedTime || len(shield.Listeners)+len(shield.Processes)+len(shield.StateFields)+len(shield.StatusContributions) != 0 || !shield.TypeSet.Empty() || shield.Lifecycle != nil && (shield.Lifecycle.MaxStacks != 1 || shield.Lifecycle.RefreshPolicy != model.RefreshPolicyReplace || shield.Lifecycle.HasDuration || shield.Lifecycle.TickIntervalMs != 0 || shield.Lifecycle.InstanceScope != "") {
		return false
	}
	if len(shield.Modifiers) > 0 {
		// 编译层已有完整静态非HP关联修正证明，此处补真实接收者槽位。
		if !shield.AtomicLinkedShield {
			return false
		}
		actual, _ := actorView(input, listener.OwnerCombatantKey)
		for _, modifier := range shield.Modifiers {
			key := pipeline.AttributeKeyFromModifierTarget(modifier.Target)
			if _, exists := actual.Attributes.Lookup(key); !exists {
				return false
			}
		}
	}
	for _, creator := range input.Compiled.Operations {
		if creator.ShieldRef != op.ShieldRef && !(creator.HasShieldLifecycleProvider && creator.ShieldLifecycleProviderIndex == op.ShieldLifecycleProviderIndex) {
			continue
		}
		if creator.Operation != "shield" || creator.OwnerProviderIndex != op.OwnerProviderIndex || creator.Target != model.SelectorSelf || !creator.HasShieldLifecycleProvider || creator.ShieldLifecycleProviderIndex != op.ShieldLifecycleProviderIndex {
			return false
		}
	}
	return true
}
