package lifecycle

import (
	"fmt"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ProviderTickInput struct {
	Owner                          string
	Instance                       effectpkg.Provider
	Now, StopAt, ActivatedAt       int64
	HasBasicAttack                 bool
	BasicAttack                    model.BasicAttackPlan
	AcceptedSource, AcceptedTarget string
	HasAcceptedProcess             bool
}

type ProviderTickRequest struct {
	At, Interval, ExpireAt, ActivatedAt int64
	Owner, Provider                     string
}

type TickInvocation struct {
	Source, Target, Owner, AbilityRef string
	DefinitionRef                     string
	Instance                          effectpkg.Provider
	Ability                           plan.CompiledAbility
	Operations                        []plan.CompiledOperation
	StrictReads, HasNext              bool
	BindActivation                    bool
	ActivatedAt                       int64
	Next                              ProviderTickRequest
}

// TickExecution 只组合当前周期尝试的门禁、真实帧和原位置的计时；不借出队列或总状态。
type TickExecution interface {
	// PeriodicBoundary 在永久周期的原边界核对死亡；首次边界同时重置该事件命令计数。
	PeriodicBoundary(first bool) bool
	// PeriodicParticipantsAlive 查询当前普攻双方生命，供阻挡后续排在原位置复核。
	PeriodicParticipantsAlive() bool
	// PeriodicCooldownBlocked 使用真实冷却账判断本次周期尝试，不缓存重放资格。
	PeriodicCooldownBlocked(owner, ref string) bool
	// PeriodicConditionBlocked 在原时点准备读值并判断施放条件，保留原错误。
	PeriodicConditionBlocked(source, target string, ability plan.CompiledAbility, ref string) (bool, *model.EngineError)
	// RunPeriodicFrame 在原真实帧暂存成本、执行给定操作、预留下一周期并统一提交及同步派发。
	RunPeriodicFrame(invocation TickInvocation) *model.EngineError
	// RecordPeriodicTick 只在真实周期帧及尾部成功后记录已发生事实。
	RecordPeriodicTick(owner string, instance effectpkg.Provider)
	// EnqueuePeriodicTick 在原直接入队位置交给唯一循环，不推进时钟。
	EnqueuePeriodicTick(request ProviderTickRequest)
}

func (e *Executor) RunProviderTick(input ProviderTickInput, execution TickExecution) *model.EngineError {
	instance := input.Instance
	provider := e.compiled.Providers[instance.DefinitionIndex]
	if provider.PermanentCharacterPeriod {
		if !execution.PeriodicBoundary(true) {
			return nil
		}
		if instance.Source != input.Owner || instance.Owner != input.Owner || instance.ExpireAt != 0 ||
			instance.Stacks != 1 || instance.HasAppliedAt || instance.ActivationUseRef != "" {
			return e.invariant("provider.tick", "permanent character tick no longer belongs to its admitted fresh mount", "")
		}
	}
	ability, exists := FindTickAbility(provider, *e.compiled)
	if !exists || ability.TickSpec == nil {
		return nil
	}
	source, target := instance.Source, instance.Owner
	if source == "" {
		source = input.Owner
	}
	if target == "" {
		target = input.Owner
	}
	if input.HasBasicAttack && source == target {
		target = input.BasicAttack.Source
		if source == input.BasicAttack.Source {
			target = input.BasicAttack.Target
		}
	}
	if provider.PermanentCharacterPeriod {
		source, target = input.Owner, OpponentKey(input.Owner)
	}
	if ability.TickSpec.ImmediateFirst {
		if !input.HasAcceptedProcess || input.AcceptedSource != instance.Source || input.AcceptedTarget != OpponentKey(instance.Source) {
			return e.invariant("provider.tick", "immediate period has no actual accepted source and opponent", instance.ProviderRef)
		}
		source, target = input.AcceptedSource, input.AcceptedTarget
	}
	reference := fmt.Sprintf("%s.provider[%s].ability[%s]", input.Owner, instance.ProviderRef, ability.AbilityKey)
	if execution.PeriodicCooldownBlocked(input.Owner, reference) {
		e.continueTick(input, execution)
		return nil
	}
	if ability.HasCastCondition {
		blocked, err := execution.PeriodicConditionBlocked(source, target, *ability, reference)
		if err != nil {
			return err
		}
		if blocked {
			e.continueTick(input, execution)
			return nil
		}
	}
	spec := ability.TickSpec
	start, end := spec.OnTickStart, spec.OnTickStart+spec.OnTickCount
	if int(end) > len(e.compiled.Operations) {
		return e.invariant("", "tick onTick range out of bounds", "")
	}
	invocation := TickInvocation{Source: source, Target: target, Owner: input.Owner, AbilityRef: reference,
		DefinitionRef: provider.ProviderKey,
		Instance:      instance, Ability: *ability, Operations: e.compiled.Operations[start:end],
		StrictReads:    input.HasBasicAttack || provider.PermanentCharacterPeriod,
		BindActivation: provider.Lifecycle != nil && provider.Lifecycle.AllowsSourceTargetReuse(), ActivatedAt: input.ActivatedAt}
	if input.HasBasicAttack && spec.IntervalMs <= input.StopAt-input.Now {
		invocation.HasNext = true
		invocation.Next = ProviderTickRequest{At: input.Now + spec.IntervalMs, Owner: input.Owner,
			Provider: instance.ProviderRef, Interval: spec.IntervalMs, ExpireAt: instance.ExpireAt, ActivatedAt: input.ActivatedAt}
	}
	if err := execution.RunPeriodicFrame(invocation); err != nil {
		return err
	}
	execution.RecordPeriodicTick(input.Owner, instance)
	if provider.PermanentCharacterPeriod && !execution.PeriodicBoundary(false) {
		return nil
	}
	if input.HasBasicAttack {
		return nil
	}
	interval, _, exists := e.TickSchedule(instance.DefinitionIndex)
	if !exists || interval > input.StopAt-input.Now {
		return nil
	}
	execution.EnqueuePeriodicTick(ProviderTickRequest{At: input.Now + interval, Owner: input.Owner,
		Provider: instance.ProviderRef, Interval: interval, ExpireAt: instance.ExpireAt, ActivatedAt: input.ActivatedAt})
	return nil
}

func (e *Executor) continueTick(input ProviderTickInput, execution TickExecution) {
	if input.HasBasicAttack && !execution.PeriodicParticipantsAlive() {
		return
	}
	interval, _, exists := e.TickSchedule(input.Instance.DefinitionIndex)
	if !exists || interval > input.StopAt-input.Now {
		return
	}
	execution.EnqueuePeriodicTick(ProviderTickRequest{At: input.Now + interval, Owner: input.Owner,
		Provider: input.Instance.ProviderRef, Interval: interval, ExpireAt: input.Instance.ExpireAt, ActivatedAt: input.ActivatedAt})
}

func (e *Executor) InitialTickRequest(owner, reference string, index uint16, expiry, now, stop int64, basic, basicAlive bool) (ProviderTickRequest, bool) {
	if basic && !basicAlive || int(index) >= len(e.compiled.Providers) {
		return ProviderTickRequest{}, false
	}
	provider := e.compiled.Providers[index]
	if ability, exists := FindTickAbility(provider, *e.compiled); exists && ability.TickSpec != nil && ability.TickSpec.IsAnchored() {
		return ProviderTickRequest{}, false
	}
	interval, delay, exists := e.TickSchedule(index)
	if !exists || delay > stop-now {
		return ProviderTickRequest{}, false
	}
	first := now + delay
	if !basic && expiry > 0 && first >= expiry {
		return ProviderTickRequest{}, false
	}
	return ProviderTickRequest{At: first, Owner: owner, Provider: reference, Interval: interval, ExpireAt: expiry, ActivatedAt: now}, true
}
