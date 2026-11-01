package lifecycle

import (
	"fmt"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type AnchoredInvocation struct {
	Instance   effectpkg.Provider
	Ability    plan.CompiledAbility
	Operations []plan.CompiledOperation
	Payload    effectpkg.AnchoredPayload
	AbilityRef string
	Source     string
	Terminal   bool
	Blocked    bool
	Phased     bool
}

// AnchoredExecution 只运行一个锚定或相位时点的真实帧及尾部，不借出其他执行控制。
type AnchoredExecution interface {
	// AnchoredCooldownBlocked 使用实际冷却账判断当次锚定周期，不登记补放资格。
	AnchoredCooldownBlocked(owner, abilityRef string) bool
	// AnchoredConditionBlocked 在原位置准备实际双方读值并计算本次施放条件。
	AnchoredConditionBlocked(source, target string, ability plan.CompiledAbility, ref string) (bool, *model.EngineError)
	// RunAnchoredFrame 运行当前真实帧并按原位置结算末拍状态；返回帧是否已发布，区分发布后尾部错误。
	RunAnchoredFrame(invocation AnchoredInvocation) (bool, *model.EngineError)
	// ReleaseAnchoredHold 重新取得当前已提交状态袋，只释放同目标同世代且已发布的末拍保护。
	ReleaseAnchoredHold(payload effectpkg.AnchoredPayload, settled bool)
	// RecordAnchoredTick 在本次真实帧及尾部成功后追加原周期事实。
	RecordAnchoredTick(invocation AnchoredInvocation)
}

func (e *Executor) FindAnchoredAbility(index uint16, key string) (*plan.CompiledAbility, bool) {
	if int(index) >= len(e.compiled.Providers) {
		return nil, false
	}
	provider := e.compiled.Providers[index]
	for slot := int(provider.AbilityStart); slot < int(provider.AbilityStart)+int(provider.AbilityCount); slot++ {
		ability := &e.compiled.Abilities[slot]
		if ability.TickSpec != nil && ability.TickSpec.PhasePolicy == "preserve_on_extend" && TickAnchoredTo(ability.TickSpec, key) {
			return ability, true
		}
	}
	ability, found := FindTickAbility(provider, *e.compiled)
	if !found || !TickAnchoredTo(ability.TickSpec, key) {
		return nil, false
	}
	return ability, true
}

// TickAnchoredTo 只判断当前编译周期是否绑定此状态字段。
func TickAnchoredTo(spec *plan.CompiledTickSpec, key string) bool {
	return spec != nil && spec.IsAnchored() && spec.AnchorStateKey == key
}

// AnchoredStateCurrent 复核实际目标、世代和完整期限；来源身份由调用者持有的真实实例另行核对。
func AnchoredStateCurrent(payload effectpkg.AnchoredPayload, bag effectpkg.BagView) bool {
	return bag.Present() && bag.TargetKey() != "" && bag.TargetKey() == payload.TargetKey &&
		bag.CurrentAnchoredTickGeneration(payload.AnchorStateKey) == payload.Generation &&
		bag.TargetExpireAt().At(payload.AnchorStateKey) == payload.ExpectedExpireAt && payload.ExpectedExpireAt > 0
}

func (e *Executor) RunAnchoredTick(instance effectpkg.Provider, ability plan.CompiledAbility, payload effectpkg.AnchoredPayload, bag effectpkg.BagChange, now int64, execution AnchoredExecution) *model.EngineError {
	if !AnchoredStateCurrent(payload, bag.View()) {
		return nil
	}
	source := instance.Source
	if source == "" {
		source = payload.OwnerKey
	}
	if payload.SourceKey != "" && source != payload.SourceKey {
		return nil
	}
	terminal, settled := now == payload.ExpectedExpireAt, false
	if terminal {
		bag.SetInclusiveAtExpiryHold(payload.TargetKey, payload.AnchorStateKey)
		defer func() { execution.ReleaseAnchoredHold(payload, settled) }()
	}
	spec := ability.TickSpec
	start, end := spec.OnTickStart, spec.OnTickStart+spec.OnTickCount
	if int(end) > len(e.compiled.Operations) {
		return e.invariant("", "anchored tick onTick range out of bounds", "")
	}
	reference := fmt.Sprintf("%s.provider[%s].ability[%s]", payload.OwnerKey, instance.ProviderRef, ability.AbilityKey)
	blocked := execution.AnchoredCooldownBlocked(payload.OwnerKey, reference)
	if !blocked && ability.HasCastCondition {
		var err *model.EngineError
		blocked, err = execution.AnchoredConditionBlocked(source, payload.TargetKey, ability, reference)
		if err != nil {
			return err
		}
	}
	if blocked && !terminal {
		return nil
	}
	invocation := AnchoredInvocation{Instance: instance, Ability: ability, Operations: e.compiled.Operations[start:end],
		Payload: payload, AbilityRef: reference, Source: source, Terminal: terminal, Blocked: blocked}
	var err *model.EngineError
	settled, err = execution.RunAnchoredFrame(invocation)
	if err != nil || blocked {
		return err
	}
	execution.RecordAnchoredTick(invocation)
	return nil
}

// ReleaseAnchoredHold 清理当前已提交袋的同世代末拍保护，不清理刷新后的新值。
func ReleaseAnchoredHold(payload effectpkg.AnchoredPayload, bag effectpkg.BagChange, settled bool) {
	if bag.Present() && settled && bag.TargetKey() == payload.TargetKey && bag.CurrentAnchoredTickGeneration(payload.AnchorStateKey) == payload.Generation {
		bag.ClearInclusiveAtExpiryHold()
	}
}

// ClearAnchoredTerminal 在实际帧命令已接纳后清除当前末拍状态，不运行公式、操作或发布。
func ClearAnchoredTerminal(payload effectpkg.AnchoredPayload, bag effectpkg.BagChange) {
	bag.ClearInclusiveAtExpiryHold()
	bag.SetTargetValue(payload.AnchorStateKey, bag.Fields().At(payload.AnchorStateKey).DefaultValue)
	bag.SetTargetExpireAt(payload.AnchorStateKey, 0)
}

func (e *Executor) RunPhasedTick(instance effectpkg.Provider, timing plan.CompiledTargetTiming, fact effectpkg.TimingFact, payload effectpkg.AnchoredPayload, at int64, execution AnchoredExecution) *model.EngineError {
	if at > fact.Expiry {
		return nil
	}
	ability := e.compiled.Abilities[timing.AbilityIndex]
	interval := ability.TickSpec.IntervalMs
	if interval <= 0 || at <= fact.Origin || (at-fact.Origin)%interval != 0 {
		return nil
	}
	spec := ability.TickSpec
	invocation := AnchoredInvocation{Instance: instance, Ability: ability, Operations: e.compiled.Operations[int(spec.OnTickStart) : int(spec.OnTickStart)+int(spec.OnTickCount)],
		Payload: payload, AbilityRef: fmt.Sprintf("%s.provider[%s].ability[%s]", instance.Owner, instance.ProviderRef, ability.AbilityKey),
		Source: instance.Source, Terminal: at == fact.Expiry, Phased: true}
	// 保相位续时保留原世代，末拍清理必须消费当前真实期限。
	invocation.Payload.ExpectedExpireAt = fact.Expiry
	if _, err := execution.RunAnchoredFrame(invocation); err != nil {
		return err
	}
	execution.RecordAnchoredTick(invocation)
	return nil
}
