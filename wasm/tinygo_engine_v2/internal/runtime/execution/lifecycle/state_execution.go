package lifecycle

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// StateExecutionInput 只描述当前状态操作的实际身份、时点及有限事件事实。
type StateExecutionInput struct {
	Operation                       plan.CompiledOperation
	Ability                         plan.CompiledAbility
	Owner, Provider, Source, Target string
	Now, Stop                       int64
	Automated, MountedListener      bool
	Event                           *contract.EventSnapshot
}

// StateProviderReads 只借用原目标计时绑定位置的已发布挂载。
type StateProviderReads interface {
	// StateProviders 借用当前已发布挂载，不能用后续帧暂存代替原计时绑定。
	StateProviders(owner string) effectpkg.ProviderList
}

// StateExecutionReads 只在状态操作原读取点借用真实状态和公式上下文。
type StateExecutionReads interface {
	StateProviderReads
	// StateAmount 使用原能力及当前帧读值求值，不提前读取后续操作金额。
	StateAmount(program formula.GenericProgramID, ability plan.CompiledAbility) (float64, *model.EngineError)
	// StateContext 在原属性重算位置准备当前公式上下文，读值失败时返回原错。
	StateContext(ability plan.CompiledAbility) (formula.GenericEvalContext, *model.EngineError)
	// StateBag 借用指定实际拥有者的状态暂存，create 保留原创建语义。
	StateBag(owner, provider string, create bool) effectpkg.BagChange
	// ReadStateBag 在原续时短路位置读取状态，expireTarget 保留原惰性目标到期语义。
	ReadStateBag(owner, provider string, expireTarget bool) effectpkg.BagView
}

// StateAttributeExecution 仅交接状态操作引起的原位属性同步及当前帧错误。
type StateAttributeExecution interface {
	// ResolveOwnerStateAttributes 以已经准备的上下文重算实际状态拥有者。
	ResolveOwnerStateAttributes(owner string, context formula.GenericEvalContext)
	// ResolveTargetStateAttributes 按原目标、拥有者顺序重算双方，不提交暂存。
	ResolveTargetStateAttributes(owner string, ability plan.CompiledAbility, context formula.GenericEvalContext)
	// ResolveAllStateAttributes 执行原位置的跨双方两遍数值同步。
	ResolveAllStateAttributes(ability plan.CompiledAbility)
	// StateFailure 只返回当前帧已记录的失败，保留失败且错误为空时的原短路。
	StateFailure() (bool, *model.EngineError)
	// MarkStateChanged 标记该拥有者的所属暂存，不发布状态。
	MarkStateChanged(owner string)
}

// StateActionExecution 只在状态操作指定位置交接共同弹药和内部冷却，不提供其他行动控制。
type StateActionExecution interface {
	StateWriteActions
	// ChangeStateCooldown 在同一帧处理实际内部冷却写入，保留原行动账和效果投影顺序。
	ChangeStateCooldown(operation plan.CompiledOperation, ability plan.CompiledAbility, amount float64) *model.EngineError
	// SubtractStateCooldown 在同一帧处理实际内部冷却减时，不创建子帧。
	SubtractStateCooldown(operation plan.CompiledOperation, ability plan.CompiledAbility) *model.EngineError
	// StateAmmo 读取当前状态字段实际绑定的共同弹药，不另建库存。
	StateAmmo(owner, provider, key string) *actionpkg.AmmoView
	// RecoverStateAmmo 同步暂存已核定的真实回充，错误沿当前状态操作返回。
	RecoverStateAmmo(ammo *actionpkg.AmmoView, ability plan.CompiledAbility) *model.EngineError
	// SubtractStateAmmo 同步交接共同弹药减时，保持不活动回充的原金额短路。
	SubtractStateAmmo(operation plan.CompiledOperation, ability plan.CompiledAbility) *model.EngineError
}

// AnchoredWriteInput 保存本次目标写入的实际袋、完整期限和运行窗口。
type AnchoredWriteInput struct {
	Owner, Provider, Source, Target, Key string
	Expires, Now, Stop                   int64
	Bag                                  effectpkg.BagChange
}

// ExecuteStateWrite 拥有状态写入、期限和回充资格的完整流程；真实暂存和跨功能同步仍在原帧。
func (e *Executor) ExecuteStateWrite(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, actions StateActionExecution, requests TimingRequests) *model.EngineError {
	op, ability := input.Operation, input.Ability
	if err := e.ValidateStateWrite(op, input.Provider); err != nil {
		return err
	}
	amount, err := reads.StateAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	if !effectpkg.FiniteState(amount) {
		return e.fail(model.GenericErrFormulaTypeError, "", "non-finite state result", "")
	}
	bag := reads.StateBag(input.Owner, input.Provider, true)
	bag.Ensure()
	if field, exists := bag.Fields().Lookup(op.Ref); exists && field.StateKind == model.ProviderStateKindCooldown {
		return actions.ChangeStateCooldown(op, ability, amount)
	}
	result, err := e.WriteState(StateWriteInput{Operation: op, Ability: ability, Owner: input.Owner,
		Provider: input.Provider, Target: input.Target, Amount: amount, Now: input.Now,
		Automated: input.Automated, Bag: bag, Actions: actions})
	if err != nil {
		return err
	}
	if op.StateScope == stateScopeProvider {
		if result.Expiry.Kind != "" {
			requests.StageStateExpiry(result.ExpireAt, result.Expiry)
		}
		context, err := reads.StateContext(ability)
		if err != nil {
			return err
		}
		attributes.ResolveOwnerStateAttributes(input.Owner, context)
		attributes.ResolveAllStateAttributes(ability)
		if result.Ammo {
			if failed, err := attributes.StateFailure(); failed {
				return err
			}
			ammo := actions.StateAmmo(input.Owner, input.Provider, op.Ref)
			if ammo != nil && (result.After == 0 || ammo.Definition().StateFields[op.Ref].AmmoRecovery.OneByOne) {
				if err := actions.RecoverStateAmmo(ammo, ability); err != nil {
					return err
				}
			}
		}
	} else {
		handled, err := e.stageStateTargetTiming(input, result, bag, reads, requests)
		if err != nil {
			return err
		}
		if result.ExpireAt > 0 && !handled {
			StageTargetStateExpiry(input.Owner, input.Provider, input.Target, op.Ref, result.ExpireAt, requests)
			if err := e.StageAnchoredTargetWrite(AnchoredWriteInput{Owner: input.Owner, Provider: input.Provider, Source: input.Source,
				Target: input.Target, Key: op.Ref, Expires: result.ExpireAt, Now: input.Now, Stop: input.Stop, Bag: bag}, reads, requests); err != nil {
				return err
			}
		}
		context, err := reads.StateContext(ability)
		if err != nil {
			return err
		}
		attributes.ResolveTargetStateAttributes(input.Owner, ability, context)
	}
	attributes.MarkStateChanged(input.Owner)
	return nil
}

// ExecuteStateDuration 拥有普通状态减时及两种目标续时的资格、金额短路和暂存流程。
func (e *Executor) ExecuteStateDuration(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, actions StateActionExecution, requests TimingRequests) *model.EngineError {
	op, ability := input.Operation, input.Ability
	if err := e.ValidateDurationChange(op, input.Provider); err != nil {
		return err
	}
	if op.ValuePolicy == "ensure_remaining_preserve_phase" {
		return e.ensurePhasedStateRemaining(input, reads, attributes, requests)
	}
	if op.ValuePolicy == "ensure_remaining" {
		return e.ensureStateRemaining(input, reads, attributes, requests)
	}
	bag := reads.StateBag(input.Owner, input.Provider, true)
	bag.Ensure()
	if op.OwnerProviderIndex >= 0 && op.OwnerProviderIndex < len(e.compiled.Providers) && e.compiled.Providers[op.OwnerProviderIndex].StateFields[op.Ref].StateKind == model.ProviderStateKindAmmo {
		return actions.SubtractStateAmmo(op, ability)
	}
	if field, exists := bag.Fields().Lookup(op.Ref); exists && field.StateKind == model.ProviderStateKindCooldown {
		return actions.SubtractStateCooldown(op, ability)
	}
	active, err := e.StateDurationActive(op, bag, input.Now)
	if err != nil || !active {
		return err
	}
	amount, err := reads.StateAmount(op.AmountProgram, ability)
	if err != nil {
		return err
	}
	result, err := e.SubtractStateDuration(op, bag, amount, input.Now)
	if err != nil || !result.Applied {
		return err
	}
	if op.StateScope == stateScopeProvider {
		if result.Expired {
			context, err := reads.StateContext(ability)
			if err != nil {
				return err
			}
			attributes.ResolveOwnerStateAttributes(input.Owner, context)
		}
	} else {
		context, err := reads.StateContext(ability)
		if err != nil {
			return err
		}
		if result.Expired {
			attributes.ResolveTargetStateAttributes(input.Owner, ability, context)
		} else if result.ExpireAt > 0 {
			StageTargetStateExpiry(input.Owner, input.Provider, bag.TargetKey(), op.Ref, result.ExpireAt, requests)
		}
	}
	attributes.MarkStateChanged(input.Owner)
	return nil
}

// StageTargetStateExpiry 只为真实活动目标状态追加原到期请求，不取得队列控制。
func StageTargetStateExpiry(owner, provider, target, key string, expires int64, requests TimingRequests) {
	if expires <= 0 || owner == "" || provider == "" || key == "" {
		return
	}
	requests.StageStateExpiry(expires, effectpkg.ExpiryPayload{Kind: "provider_target_state", CombatantKey: owner,
		ProviderRef: provider, TargetKey: target, StateKey: key, ExpectedExpireAt: expires})
}

// StageAnchoredTargetWrite 按原目标写入资格核定全部周期；容量失败早于世代变化，成功后仅追加当前帧计时。
func (e *Executor) StageAnchoredTargetWrite(input AnchoredWriteInput, reads StateProviderReads, requests TimingRequests) *model.EngineError {
	if !input.Bag.Present() || input.Expires <= 0 || input.Owner == "" || input.Provider == "" || input.Target == "" || input.Key == "" {
		return nil
	}
	instance, _, exists := reads.StateProviders(input.Owner).Find(input.Provider)
	if !exists {
		return nil
	}
	ability, exists := e.FindAnchoredAbility(instance.DefinitionIndex, input.Key)
	if !exists || ability.TickSpec.IntervalMs <= 0 {
		return nil
	}
	interval, end := ability.TickSpec.IntervalMs, input.Expires
	if end > input.Stop {
		end = input.Stop
	}
	count := int64(0)
	if end > input.Now {
		count = (end - input.Now) / interval
	}
	if count > int64(requests.RemainingTimingSlots()) {
		err := e.invariant("", "anchored tick queue overflow", "")
		err.BudgetCause = model.BudgetCauseMaxQueueEvents
		return err
	}
	generation := input.Bag.BumpAnchoredTickGeneration(input.Key)
	source := input.Source
	if source == "" {
		source = instance.Source
	}
	if source == "" {
		source = input.Owner
	}
	for index := int64(1); index <= count; index++ {
		requests.StageAnchoredTick(input.Now+index*interval, effectpkg.AnchoredPayload{OwnerKey: input.Owner, ProviderRef: input.Provider,
			SourceKey: source, TargetKey: input.Target, AnchorStateKey: input.Key, Generation: generation, ExpectedExpireAt: input.Expires})
	}
	return nil
}

func (e *Executor) stageStateTargetTiming(input StateExecutionInput, result StateWriteResult, bag effectpkg.BagChange, reads StateExecutionReads, requests TimingRequests) (bool, *model.EngineError) {
	if !e.compiled.HasTargetTiming {
		return false, nil
	}
	instance, slot, timing, found := e.TargetTimingBinding(reads.StateProviders(input.Owner), input.Owner, input.Provider, input.Operation.Ref, input.Now)
	if !found {
		return false, nil
	}
	return true, e.StageTargetTiming(instance, slot, timing, input.Target, input.Operation.Ref, result.After, result.ExpireAt, input.Now, input.Stop, bag, requests)
}

func (e *Executor) ensureStateRemaining(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, requests TimingRequests) *model.EngineError {
	op := input.Operation
	if err := e.ValidateTargetRemaining(op); err != nil {
		return err
	}
	bag := reads.ReadStateBag(input.Owner, input.Provider, true)
	if bag.TargetStateRemainingMs(op.Ref, input.Target, input.Now) == 0 {
		return nil
	}
	amount, err := reads.StateAmount(op.AmountProgram, input.Ability)
	if err != nil {
		return err
	}
	next, changed, err := e.TargetRemainingDeadline(op, bag.TargetExpireAt().At(op.Ref), amount, input.Now)
	if err != nil || !changed {
		return err
	}
	change := reads.StateBag(input.Owner, input.Provider, false)
	change.SetTargetExpireAt(op.Ref, next)
	StageTargetStateExpiry(input.Owner, input.Provider, input.Target, op.Ref, next, requests)
	attributes.MarkStateChanged(input.Owner)
	return nil
}

func (e *Executor) ensurePhasedStateRemaining(input StateExecutionInput, reads StateExecutionReads, attributes StateAttributeExecution, requests TimingRequests) *model.EngineError {
	op := input.Operation
	instance, slot, timing, exists := e.TargetTimingBinding(reads.StateProviders(input.Owner), input.Owner, input.Provider, op.Ref, input.Now)
	event := input.Event
	if !exists || !timing.Phased || op.Target != model.SelectorSelf || op.StateScope != stateScopeProviderTarget || int(instance.DefinitionIndex) != op.OwnerProviderIndex ||
		!input.MountedListener || event == nil || event.EventType != model.EventTypeSkillHit || event.EventSourceKey != input.Owner || event.SkillHit == nil || event.SkillHit.Blocked != 0 {
		return e.invariant(op.Path, "phase preserving extension requires its actual unblocked owner skill hit and phased anchor", "")
	}
	bag := reads.ReadStateBag(input.Owner, input.Provider, false)
	if !bag.Present() || !bag.HasTiming() || bag.TargetStateRemainingMs(op.Ref, input.Target, input.Now) == 0 || !bag.Timing(slot).Active {
		return nil
	}
	amount, err := reads.StateAmount(op.AmountProgram, input.Ability)
	if err != nil {
		return err
	}
	if !effectpkg.ValidStateInteger(amount) || amount <= 0 {
		return e.invariant(op.Path, "phase extension requires positive safe integer milliseconds", "")
	}
	delta := int64(amount)
	if input.Now > 0 && delta > math.MaxInt64-input.Now || input.Now < 0 && delta < math.MinInt64-input.Now {
		return e.invariant(op.Path, "phase extension timestamp overflow", "")
	}
	next := input.Now + delta
	if next <= bag.TargetExpireAt().At(op.Ref) {
		return nil
	}
	change := reads.StateBag(input.Owner, input.Provider, false)
	fact := change.Timing(slot)
	prior := fact.Expiry
	fact.Expiry, fact.Protect = next, false
	change.SetTiming(slot, fact)
	change.SetTargetExpireAt(op.Ref, next)
	requests.StageStateExpiry(next, effectpkg.ExpiryPayload{Kind: "target_timing", CombatantKey: input.Owner, ProviderRef: input.Provider,
		TargetKey: input.Target, StateKey: op.Ref, StateGeneration: fact.Generation, ExpectedExpireAt: next, TimingSlot: slot})
	if err := e.StageTargetPhases(instance, slot, timing, change, prior, input.Stop, requests); err != nil {
		return err
	}
	attributes.MarkStateChanged(input.Owner)
	return nil
}
