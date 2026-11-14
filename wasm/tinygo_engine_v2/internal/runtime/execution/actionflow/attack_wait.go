package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// AttackWaitInput 是当前帧的有限等待变化与队列存在事实，不借出队列或帧。
type AttackWaitInput struct {
	PendingWait                      *actionpkg.AttackWaitView
	PendingAmmo, PendingAction       bool
	HasQueuedAttack, CombatantsAlive bool
}

// AttackWaitPreview 只借用当前等待预检中的明确双方属性与公式输入。
type AttackWaitPreview struct {
	Source, Target attribute.Table
	Context        formula.GenericEvalContext
}

// InitialAttackWaitReads 只在真实当前普攻首次冷却已经核定后准备原公式视图。
type InitialAttackWaitReads interface {
	// InitialAttackWaitPreview 借用当前帧双方属性和原能力上下文，不建立新的帧。
	InitialAttackWaitPreview() AttackWaitPreview
}

// AttackWaitWork 只在当前帧准备期间借用等待相关属性、冷却与金额。
type AttackWaitWork interface {
	// AttackStunUntil 读取同帧投影后的实际有限眩晕期限；失败不发布等待。
	AttackStunUntil(owner string) (int64, *model.EngineError)
	// PreviewAttackWait 沿原位置准备必要动态投影及两遍派生，失败不使用半成品。
	PreviewAttackWait() (float64, *model.EngineError)
	// ReadAttackWaitPreview 仅在已有未就绪等待时借用预检双方和完整公式上下文。
	ReadAttackWaitPreview() AttackWaitPreview
	// AttackCooldowns 借用当前所属暂存的唯一冷却账，写入不发布状态。
	AttackCooldowns() *actionpkg.CooldownLedger
	// WritableAttackCooldowns 在原首次写入位置取得所属冷却暂存，不复制只读查询。
	WritableAttackCooldowns() *actionpkg.CooldownLedger
	// ConsumeAttackWaitCommand 在原调整位置消费一个真实事件命令预算。
	ConsumeAttackWaitCommand() *model.EngineError
	// AttackPeriod 在原命令消费之后读取已准备预检视图的真实普通攻击周期。
	AttackPeriod() (float64, *model.EngineError)
	// AttackAmmo 返回该帧实际库存与暂存优先的回充等待。
	AttackAmmo(ammo *actionpkg.AmmoView) (float64, actionpkg.AmmoWait, *model.EngineError)
}

// AttackWaitResult 是当前阶段待交回原帧的等待变化与必要队列预留数量。
type AttackWaitResult struct {
	Wait       *actionpkg.AttackWaitView
	ExtraQueue int
}

func (s BasicAttackExecutor) InitialWait(process *actionpkg.ProcessView, ready, now int64, reads InitialAttackWaitReads) (*actionpkg.AttackWaitView, *model.EngineError) {
	attack := s.actions.BasicAttack()
	if attack == nil || !s.actions.AttackActive() || process.AbilityRef() != attack.Plan().InitialControlAbilityRef || process.UseKey() != attack.Current().UseRef() {
		return nil, nil
	}
	if ready <= now || ready > maxJSONSafeInteger {
		return nil, s.error("initial attack cooldown must produce a positive safe waiting timestamp", attack.Plan().InitialControlAbilityRef)
	}
	preview := reads.InitialAttackWaitPreview()
	return actionpkg.NewAttackWait(actionpkg.AttackWaitSeed{InitialReady: ready, Anchor: now, Period: ready - now, Remaining: 1,
		Speed: preview.Source.At(attack.Plan().AttackSpeedAttributeKey).Resolved, SourceAttributes: preview.Source, TargetAttributes: preview.Target,
		ProviderState: model.BorrowNumericView(AttackStateSnapshot(preview.Context.ProviderState, preview.Context.ProviderStateDefaults)), TargetState: model.BorrowNumericView(AttackStateSnapshot(preview.Context.ProviderTargetState, preview.Context.ProviderStateDefaults))}), nil
}

func (s BasicAttackExecutor) PrepareWait(now int64, input AttackWaitInput, original, pending *actionpkg.ProcessView, work AttackWaitWork) (AttackWaitResult, *model.EngineError) {
	result, err := s.PrepareWaitProgress(now, input, work)
	if err != nil || s.actions.BasicAttack() == nil {
		return result, err
	}
	attack := s.actions.BasicAttack()
	controlled, controlErr := work.AttackStunUntil(attack.Plan().Source)
	if controlErr != nil {
		return AttackWaitResult{}, controlErr
	}
	if result.Wait == nil && !input.PendingAmmo && !input.PendingAction {
		return result, nil
	}
	notBefore := now
	if controlled > notBefore {
		notBefore = controlled
	}
	for index := 0; index < s.actions.ProcessCount(); index++ {
		process := s.actions.ProcessAt(index)
		if process != original && process.OccupiesAction(attack.Plan().Source) && process.ActionDeadline() > notBefore {
			notBefore = process.ActionDeadline()
		}
	}
	if pending.OccupiesAction(attack.Plan().Source) && pending.ActionDeadline() > notBefore {
		notBefore = pending.ActionDeadline()
	}
	if ammo := attack.Ammo(); ammo != nil {
		value, wait, err := work.AttackAmmo(ammo)
		if err != nil {
			return AttackWaitResult{}, err
		}
		if value == 0 && wait.Active && wait.ReadyAt > notBefore {
			notBefore = wait.ReadyAt
		}
	}
	work.WritableAttackCooldowns().RegisterWait(AttackCooldownWaitKey(attack), []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)}, notBefore, now)
	return result, nil
}

func (s BasicAttackExecutor) PrepareWaitProgress(now int64, input AttackWaitInput, work AttackWaitWork) (AttackWaitResult, *model.EngineError) {
	result := AttackWaitResult{Wait: input.PendingWait}
	attack := s.actions.BasicAttack()
	if attack == nil {
		return result, nil
	}
	speed, err := work.PreviewAttackWait()
	if err != nil {
		return result, err
	}
	if !validAttackSpeed(speed, attack.Plan().AttackSpeedInputMax) {
		return result, s.error("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	previous := attack.Wait()
	if result.Wait != nil {
		previous = result.Wait
	}
	if previous == nil {
		result.ExtraQueue = attackWaitExtraQueue(input, result.Wait)
		return result, nil
	}
	ledger := work.AttackCooldowns()
	previousReady := previous.ProgressDeadline()
	actualReady := ledger.AbilityReadyAt(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)
	if result.Wait == nil && actualReady != previousReady && (actualReady > now || previousReady > now) {
		ready := ledger.AbilityReadyAt(attack.Plan().Source, attack.Plan().InitialControlAbilityRef)
		if ready > maxJSONSafeInteger {
			return result, s.error("changed attack cooldown requires a safe actual remaining deadline", attack.Plan().InitialControlAbilityRef)
		}
		if ready < now {
			ready = now
		}
		if err := work.ConsumeAttackWaitCommand(); err != nil {
			return result, err
		}
		result.Wait = previous.Reanchor(now, ready)
		previous, previousReady = result.Wait, ready
	}
	if previousReady <= now {
		result.ExtraQueue = attackWaitExtraQueue(input, result.Wait)
		return result, nil
	}
	preview := work.ReadAttackWaitPreview()
	speed = preview.Source.At(attack.Plan().AttackSpeedAttributeKey).Resolved
	if !validAttackSpeed(speed, attack.Plan().AttackSpeedInputMax) {
		return result, s.error("modified attack speed violates its explicit input bound", "driverPlan.basicAttack.attackSpeedInputMax")
	}
	if speed == previous.Speed() && !attack.WaitDependenciesChanged(previous, preview.Source, preview.Target, preview.Context) {
		result.ExtraQueue = attackWaitExtraQueue(input, result.Wait)
		return result, nil
	}
	if err := work.ConsumeAttackWaitCommand(); err != nil {
		return result, err
	}
	periodValue, err := work.AttackPeriod()
	if err != nil {
		return result, err
	}
	if math.IsNaN(periodValue) || math.IsInf(periodValue, 0) || periodValue <= 0 || periodValue > float64(maxJSONSafeInteger) {
		return result, s.error("adjusted attack period must be finite, positive and safe", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	period := int64(math.Max(1, math.Round(periodValue)))
	delay := actionpkg.BasicAttackRemainingDelay(previous.RemainingAt(now), period)
	if delay > float64(maxJSONSafeInteger-now) {
		return result, s.error("adjusted attack time exceeds safe integer range", "driverPlan.basicAttack.initialControlAbilityRef")
	}
	result.Wait = previous.Recalculate(now, period, speed, preview.Source, preview.Target, model.BorrowNumericView(AttackStateSnapshot(preview.Context.ProviderState, preview.Context.ProviderStateDefaults)), model.BorrowNumericView(AttackStateSnapshot(preview.Context.ProviderTargetState, preview.Context.ProviderStateDefaults)))
	work.WritableAttackCooldowns().Set(actionpkg.AbilityCooldownIdentity(attack.Plan().Source, attack.Plan().InitialControlAbilityRef), now+int64(delay), now)
	if !input.HasQueuedAttack && input.CombatantsAlive {
		result.ExtraQueue = 1
	}
	return result, nil
}

func attackWaitExtraQueue(input AttackWaitInput, wait *actionpkg.AttackWaitView) int {
	if (wait != nil || input.PendingAmmo || input.PendingAction) && !input.HasQueuedAttack && input.CombatantsAlive {
		return 1
	}
	return 0
}

// AttackCooldownWaitKey 返回该实际普通攻击在共用冷却账中的唯一等待身份。
func AttackCooldownWaitKey(attack *actionpkg.BasicAttackView) actionpkg.CooldownWaitKey {
	return actionpkg.CooldownWaitKey{Kind: "basic_attack", Owner: attack.Plan().Source, Key: attack.Plan().PlanKey}
}

// AttackStateSnapshot 合并当前有限状态值与声明默认，当前显式有效0优先。
func AttackStateSnapshot(values, defaults model.NumericView) map[string]float64 {
	if values.Len()+defaults.Len() == 0 {
		return nil
	}
	snapshot := make(map[string]float64, values.Len()+defaults.Len())
	defaults.Range(func(key string, value float64) bool { snapshot[key] = value; return true })
	values.Range(func(key string, value float64) bool { snapshot[key] = value; return true })
	return snapshot
}

func validAttackSpeed(speed, maximum float64) bool {
	return !math.IsNaN(speed) && !math.IsInf(speed, 0) && speed > 0 && speed <= maximum
}
