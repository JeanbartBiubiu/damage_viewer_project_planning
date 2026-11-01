package admission

import (
	"math"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// IncomingCappedFlatScene 借用本次原始快照及冷准入所需的有限运行限制，不保存或修改它们。
type IncomingCappedFlatScene struct {
	Snapshot        model.Snapshot
	Start, Duration int64
	StopOnDeath     bool
	ExternalFacts   int
}

// IncomingCappedFlatParent 按完整拥有者、挂载及定义判断原生父来源，不只匹配技能键。
func IncomingCappedFlatParent(sources []planbundle.CompiledIncomingCappedFlatSource, providers []planbundle.CompiledProvider, definition, owner, reference string) bool {
	for _, binding := range sources {
		if binding.Owner == owner && binding.ParentProviderRef == reference && providers[binding.ParentIndex].ProviderKey == definition {
			return true
		}
	}
	return false
}

// IncomingCappedFlatInitializer 仅接受当前父挂载唯一的真实初始化应用。
func IncomingCappedFlatInitializer(sources []planbundle.CompiledIncomingCappedFlatSource, providers []planbundle.CompiledProvider, listener planbundle.CompiledListener, operation planbundle.CompiledOperation) bool {
	for _, binding := range sources {
		if binding.Owner == listener.OwnerCombatantKey && binding.ParentProviderRef == listener.OwnerProviderRef &&
			int(binding.ParentIndex) == operation.OwnerProviderIndex && operation.ProviderRef == binding.EffectProviderRef &&
			operation.ProviderDefinitionRef == providers[binding.EffectIndex].ProviderKey && listener.OperationCount == 1 {
			return true
		}
	}
	return false
}

// ValidateIncomingCappedFlatScene 按原场景限制、初始选择、双方状态顺序完成冷准入，不预先检查后续来源。
func ValidateIncomingCappedFlatScene(input Input, scene IncomingCappedFlatScene) *model.EngineError {
	if scene.Start != 0 || scene.Duration < 1 || scene.Duration > 600000 || !scene.StopOnDeath || scene.ExternalFacts != 0 {
		return incomingCappedFlatError(input)
	}
	if err := ValidateInitialSelection(input, scene.Snapshot.Combatants, true); err != nil {
		return err
	}
	for _, actor := range scene.Snapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return incomingCappedFlatError(input)
		}
		current, _ := actorView(input, actor.Key)
		hp := current.Attributes.At("hp").Current
		_, hasOpponent := actorView(input, opponent(actor.Key))
		if !hasOpponent || math.IsNaN(hp) || math.IsInf(hp, 0) || hp <= 0 {
			return incomingCappedFlatError(input)
		}
	}
	return nil
}

// IncomingCappedFlatRequiresPlan 返回本来源是否需要实际首次行动证明；根层只在此要求下交接行动读取。
func IncomingCappedFlatRequiresPlan(providers []planbundle.CompiledProvider, source planbundle.CompiledIncomingCappedFlatSource) bool {
	return len(providers[source.ParentIndex].Processes) != 0
}

// ValidateIncomingCappedFlatSource 在该项行动证明已经读取后核对原始快照来源，失败时不读取下一项行动。
func ValidateIncomingCappedFlatSource(input Input, initial []model.CombatantSnapshot, source planbundle.CompiledIncomingCappedFlatSource, planAllowed bool) *model.EngineError {
	if !planAllowed {
		return incomingCappedFlatError(input)
	}
	matches := 0
	for _, actor := range initial {
		for _, instance := range actor.Providers {
			if instance.DefinitionRef == input.Compiled.Providers[source.EffectIndex].ProviderKey {
				return incomingCappedFlatError(input)
			}
			if actor.Key != source.Owner || instance.ProviderRef != source.ParentProviderRef {
				continue
			}
			matches++
			if instance.DefinitionRef != input.Compiled.Providers[source.ParentIndex].ProviderKey || instance.Source != source.Owner || instance.Owner != source.Owner ||
				instance.Stacks != 1 || instance.ExpireAt != nil || instance.AppliedAtMs != nil || len(instance.State)+len(instance.ModifierSnapshots) != 0 {
				return incomingCappedFlatError(input)
			}
		}
	}
	if matches != 1 {
		return incomingCappedFlatError(input)
	}
	return nil
}

func incomingCappedFlatError(input Input) *model.EngineError {
	return fail(input, "capped flat requires fresh actual character initialization with two living opponents", "initialSnapshot")
}
