package admission

import (
	"math"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

// TargetMarkInitialState 保存一个编译操作在原初始袋中的事实；按编译操作顺序传入。
// 袋不存在与存在且值为0分别表达，不进行到期投影、默认填充或目标重映射。
type TargetMarkInitialState struct {
	OperationIndex int
	BagPresent     bool
	Value          float64
	ExpireAt       int64
}

// TargetMarkSources 借用运行起点、真实选中来源及各操作对应的初始状态。
type TargetMarkSources struct {
	StartMs   int64
	Selection SourceSelection
	Initial   []TargetMarkInitialState
}

// ValidateTargetMarkSources 按原操作顺序检查零时刻新场景及真实父来源、触发入口和恢复资源。
// 所有数值及状态只读借用，首个失败保留原完整错误身份，不安装状态或创建使用身份。
func ValidateTargetMarkSources(input Input, sources TargetMarkSources) *model.EngineError {
	if !input.Compiled.HasTargetMarkConsumption {
		return nil
	}
	for _, initial := range sources.Initial {
		op := input.Compiled.Operations[initial.OperationIndex]
		mark := op.TargetMark
		if sources.StartMs != 0 || mark.OwnerCombatantKey != model.SelectorSource || !plannedProvider(sources.Selection, model.SelectorSource, mark.OwnerProviderRef) {
			return fail(input, "target mark requires a fresh zero-time scene and its actual planned parent", op.Path)
		}
		if mark.TriggerKind == model.EventTypeBasicAttackHit {
			attack := sources.Selection.BasicAttack
			if attack == nil || attack.HitAbilityRef != mark.TriggerAbilityRef || attack.Source != mark.OwnerCombatantKey {
				return fail(input, "target mark attack trigger is not the actual selected native hit", op.Path)
			}
		} else {
			parsed, valid := planbundle.ParseAbilityRef(mark.TriggerAbilityRef)
			if !valid || !plannedProvider(sources.Selection, model.SelectorSource, parsed.ProviderRef) {
				return fail(input, "target mark skill trigger is not driven by its real INITIAL source", op.Path)
			}
		}
		owner, exists := actorView(input, mark.OwnerCombatantKey)
		if !exists {
			return fail(input, "target mark owner is missing", op.Path)
		}
		if initial.BagPresent && (initial.Value != 0 || initial.ExpireAt != 0) {
			return fail(input, "target mark cannot restore an external active target field", op.Path)
		}
		if mark.Restore != nil {
			slot, exists := owner.Resources.Lookup(mark.Restore.ResourceKey)
			if !exists || math.IsNaN(slot.Current) || math.IsInf(slot.Current, 0) || math.IsNaN(slot.Max) || math.IsInf(slot.Max, 0) || slot.Max <= 0 || slot.Current < 0 || slot.Current > slot.Max {
				return fail(input, "target mark restore requires an explicit finite current and positive resource capacity", op.Path)
			}
		}
	}
	return nil
}

func targetMarkListenerOwned(input Input, listener planbundle.CompiledListener, op planbundle.CompiledOperation) bool {
	mark := op.TargetMark
	return input.Compiled.HasTargetMarkConsumption && mark != nil && listener.OperationCount == 1 && listener.SourceAbilityIndex >= 0 &&
		listener.OwnerCombatantKey == mark.OwnerCombatantKey && listener.OwnerProviderRef == mark.OwnerProviderRef && !listener.HasAbilityRef && !listener.HasOncePerUse && listener.PerCastThrottleMs == 0
}
