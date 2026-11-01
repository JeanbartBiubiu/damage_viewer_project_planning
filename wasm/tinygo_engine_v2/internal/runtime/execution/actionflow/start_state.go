package actionflow

import (
	"math"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// StartStateReads 只在原捕获位置准备指定来源状态包，不执行操作或提交。
type StartStateReads interface {
	// StartStateBag 按原捕获的创建标记准备同一帧状态包，不把缺失包解释为有效零。
	StartStateBag(owner, provider string, create bool) effectpkg.BagView
}

// AttackCaptureAPI 列出原普攻使用独占捕获的只读能力。
type AttackCaptureAPI interface {
	// Len 返回本次实际捕获的来源数；nil捕获保持0且不分配。
	Len() int
	// Values 只借用指定完整来源的冻结值，借用不超过当前公式准备；缺失返回nil。
	Values(provider string) []formula.ProviderStateBeforeValue
}

// AttackCapture 独占本次原普攻的来源捕获条目，不接受外部可写集合。
type AttackCapture struct{ providers []attackProviderCapture }

type attackProviderCapture struct {
	provider string
	values   []formula.ProviderStateBeforeValue
}

var _ AttackCaptureAPI = (*AttackCapture)(nil)

func (capture *AttackCapture) Len() int {
	if capture == nil {
		return 0
	}
	return len(capture.providers)
}

func (capture *AttackCapture) Values(provider string) []formula.ProviderStateBeforeValue {
	if capture != nil {
		for _, row := range capture.providers {
			if row.provider == provider {
				return row.values
			}
		}
	}
	return nil
}

func (s ProcessExecutor) CaptureStartState(process *actionpkg.ProcessView, owner, provider string, reads StartStateReads) ([]formula.ProcessStartStateValue, *model.EngineError) {
	if process == nil || len(process.Definition().StartStateKeys) == 0 {
		return nil, nil
	}
	if !process.HasEmpoweredAbility() || provider != process.ProviderRef() || owner != process.Owner() {
		return nil, s.error(process.Definition().Path, "process start capture requires its actual empowered use", process.UseKey())
	}
	bag := reads.StartStateBag(process.Owner(), process.ProviderRef(), true)
	if !bag.Present() {
		return nil, s.error(process.Definition().Path, "process start capture state is missing", process.UseKey())
	}
	values := make([]formula.ProcessStartStateValue, len(process.Definition().StartStateKeys))
	for index, key := range process.Definition().StartStateKeys {
		value, present := bag.State().Lookup(key)
		field, declared := bag.Fields().Lookup(key)
		if !present || !declared || field.ValueType != model.ProviderStateValueInteger || field.StateKind != "" || value < 0 || math.Trunc(value) != value || value > float64(maxJSONSafeInteger) || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, s.error(process.Definition().Path+".startState."+key, "process start capture requires its actual explicit safe integer SET value", key)
		}
		values[index] = formula.ProcessStartStateValue{StateKey: key, Value: value}
	}
	return values, nil
}

func (s BasicAttackExecutor) CaptureStartState(enabled bool, source string, use *actionpkg.UseView, captured bool, combatants []planbundle.CompiledCombatant, providers []planbundle.CompiledProvider, reads StartStateReads) (AttackCapture, *model.EngineError) {
	if !enabled {
		return AttackCapture{}, nil
	}
	if use == nil || use.Source() != source || captured {
		return AttackCapture{}, s.captureError("attack-start counter capture requires its fresh original use", "")
	}
	var capture AttackCapture
	for _, actor := range combatants {
		if actor.Key != use.Source() {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			provider := providers[mount.DefinitionIndex]
			if len(provider.AttackStartStateKeys) == 0 {
				continue
			}
			bag := reads.StartStateBag(use.Source(), mount.ProviderRef, false)
			values := make([]formula.ProviderStateBeforeValue, 0, len(provider.AttackStartStateKeys))
			for _, key := range provider.AttackStartStateKeys {
				field := provider.StateFields[key]
				value := field.DefaultValue
				if bag.Present() {
					if current, exists := bag.State().Lookup(key); exists {
						value = current
					}
				}
				if !effectpkg.ValidStateInteger(value) || value < 0 || field.HasCap && value > field.MaxValue {
					return AttackCapture{}, s.captureError("attack-start counter value must be a finite owned integer", key)
				}
				values = append(values, formula.ProviderStateBeforeValue{StateKey: key, Value: value})
			}
			capture.providers = append(capture.providers, attackProviderCapture{provider: mount.ProviderRef, values: values})
		}
	}
	return capture, nil
}

func (s BasicAttackExecutor) StartStateContext(enabled bool, event *contract.EventSnapshot, owner, provider string, use *actionpkg.UseView, captured *AttackCapture) []formula.ProviderStateBeforeValue {
	if !enabled || event == nil || !event.HasUse || event.EventType != model.EventTypeBasicAttackStart && event.EventType != model.EventTypeBasicAttackHit {
		return nil
	}
	if use == nil || owner != use.Source() || owner != event.EventSourceKey || owner != event.UseSource || provider == "" {
		return nil
	}
	return captured.Values(provider)
}

func (s BasicAttackExecutor) captureError(message, ref string) *model.EngineError {
	err := s.error(message, "attackStartFacts")
	err.Ref = ref
	return err
}
