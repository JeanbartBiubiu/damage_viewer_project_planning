package operation

import (
	"errors"
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/contract"
)

// ShieldProviderIdentity 是原读取时点的有限挂载身份，不包含效果状态或发布能力。
type ShieldProviderIdentity struct {
	DefinitionIndex uint16
	Source, Owner   string
	Stacks          int
	ExpireAt        int64
}

// ReceivedShieldReads 区分伤害绑定期间的暂存身份与事件读取期间的已提交父挂载。
type ReceivedShieldReads interface {
	// ProjectedShieldProvider 在吸收行通过数值校验后，读取当前暂存生命周期身份。
	// 先读取实际实例；未找到时才沿原序读取待应用护盾操作。
	ProjectedShieldProvider(owner, provider string) (ShieldProviderIdentity, bool)
	// ActualShieldProvider 在冻结事件资格通过后读取已提交挂载，不借用暂存投影。
	ActualShieldProvider(owner, provider string) (ShieldProviderIdentity, bool)
}

// ShieldAbsorptionBindingInput 只借用绑定所需的编译定义及原错误身份。
type ShieldAbsorptionBindingInput struct {
	Enabled                          bool
	Providers                        []planbundle.CompiledProvider
	SchemaHash, RulesHash, SessionID string
}

// ReceivedLinkedShieldInput 保留原事件和当前读取者身份，不重新生成或复制吸收快照。
type ReceivedLinkedShieldInput struct {
	Enabled            bool
	Providers          []planbundle.CompiledProvider
	Combatants         []planbundle.CompiledCombatant
	Event              *contract.EventSnapshot
	Owner, ProviderRef string
}

// BindReceivedShieldAbsorptions 在耗尽移除之前逐行校验并绑定生命周期。
// 行与合计的原错误、绑定次序和已完成空快照语义保持不变；不发布快照或效果状态。
func BindReceivedShieldAbsorptions(input ShieldAbsorptionBindingInput, reads ReceivedShieldReads, snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError {
	if snapshot == nil && !input.Enabled {
		return nil
	}
	if snapshot == nil {
		return shieldAbsorptionBindingError(input, target)
	}
	sum := 0.0
	for i := range snapshot.Rows {
		row := &snapshot.Rows[i]
		if !validShieldAbsorption(*row) || row.Owner != target {
			return shieldAbsorptionBindingError(input, target)
		}
		sum += row.Absorbed
		if row.LifecycleProviderRef == "" {
			if row.DefinitionRef != "" {
				return shieldAbsorptionBindingError(input, target)
			}
			continue
		}
		instance, found := reads.ProjectedShieldProvider(row.Owner, row.LifecycleProviderRef)
		index := instance.DefinitionIndex
		if !found || int(index) >= len(input.Providers) || input.Providers[index].ShieldDefinitionRef != row.DefinitionRef || instance.Source != row.Source || instance.Owner != row.Owner || instance.ExpireAt != row.ExpireAt {
			return shieldAbsorptionBindingError(input, target)
		}
		row.LifecycleBound, row.LifecycleIndex = true, index
	}
	if math.IsNaN(sum) || math.IsInf(sum, 0) || sum != total {
		return shieldAbsorptionBindingError(input, target)
	}
	return nil
}

// ReceivedLinkedShieldAbsorbed 只读取原生受伤事件中已绑定的指定自身关联盾吸收额。
// 父挂载资格按读取时的真实已提交实例核对；耗尽盾只读原冻结行，不重新查活盾。
func ReceivedLinkedShieldAbsorbed(input ReceivedLinkedShieldInput, reads ReceivedShieldReads, index uint16) (float64, error) {
	if !input.Enabled || int(index) >= len(input.Providers) || input.Event == nil || input.Event.EventType != model.EventTypeDamageTaken || !input.Event.HasDamageSnapshot || input.Event.ShieldAbsorptions == nil || input.ProviderRef == "" {
		return 0, receivedLinkedShieldError()
	}
	definition := input.Providers[index]
	owner := input.Owner
	if !definition.HasReceivedShieldBinding || input.Event.EventTargetKey != owner {
		return 0, receivedLinkedShieldError()
	}
	matched, expected := 0, ""
	for _, actor := range input.Combatants {
		if actor.Key != owner {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			if mount.DefinitionIndex == definition.ReceivedShieldParentIndex {
				matched, expected = matched+1, mount.ProviderRef
			}
		}
	}
	parent, found := reads.ActualShieldProvider(owner, input.ProviderRef)
	if matched != 1 || expected != input.ProviderRef || !found || parent.DefinitionIndex != definition.ReceivedShieldParentIndex || parent.Source != owner || parent.Owner != owner || parent.Stacks != 1 || parent.ExpireAt != 0 {
		return 0, receivedLinkedShieldError()
	}
	amount := 0.0
	for _, row := range input.Event.ShieldAbsorptions.Rows {
		if !validShieldAbsorption(row) || row.Owner != input.Event.EventTargetKey {
			return 0, receivedLinkedShieldError()
		}
		if row.DefinitionRef != definition.ShieldDefinitionRef {
			continue
		}
		if !row.LifecycleBound || row.LifecycleIndex != index || row.LifecycleProviderRef == "" {
			return 0, receivedLinkedShieldError()
		}
		if row.Source == owner && row.Owner == owner {
			amount += row.Absorbed
		}
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, receivedLinkedShieldError()
	}
	return amount, nil
}

func validShieldAbsorption(row pipeline.ShieldAbsorption) bool {
	for _, value := range []float64{row.RemainingBefore, row.RemainingAfter, row.Absorbed} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	tolerance := 1e-12 * math.Max(1, math.Max(row.RemainingBefore, row.RemainingAfter))
	return row.ShieldRef != "" && row.Source != "" && row.Owner != "" && row.Absorbed > 0 && row.RemainingAfter >= 0 && row.RemainingBefore >= row.RemainingAfter && row.Absorbed <= row.RemainingBefore && math.Abs(row.RemainingBefore-row.RemainingAfter-row.Absorbed) <= tolerance
}

func shieldAbsorptionBindingError(input ShieldAbsorptionBindingInput, target string) *model.EngineError {
	return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "received shield absorption has no valid actual settlement identity", "event.damage.linked_shield", target, input.SchemaHash, input.RulesHash, input.SessionID)
}

func receivedLinkedShieldError() error {
	return errors.New("linked shield absorption requires its frozen native received event and actual unique self parent")
}
