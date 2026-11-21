package actionflow

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type FrameAPI interface {
	// StageProcess 暂存主过程的原实例及独占变更，仅供本帧最终发布。
	StageProcess(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet)
	// Process 借用本帧将发布的主过程视图，调用者只读。
	Process() *actionpkg.ProcessView
	// ProcessOriginal 借用主过程原实例，供等待准备及原位发布后的读取。
	ProcessOriginal() *actionpkg.ProcessView
	// MarkProcessStart 标记主过程发布时还需登记新实例。
	MarkProcessStart()
	// StartsProcess 报告主槽是否登记为新过程。
	StartsProcess() bool
	// PublishProcess 将主槽变更发布到原实例，再按需要登记新实例。
	PublishProcess(actions *actionpkg.State)
	// PrepareOccupancy 根据主过程变更暂存本帧的行动等待调整。
	PrepareOccupancy(executor ProcessExecutor, now int64) *model.EngineError
	// StageProcessTimer 仅接受主过程自己的计时决定，内层借用不得覆盖。
	StageProcessTimer(changes *actionpkg.ProcessChangeSet, pending bool)
	// ProcessTimer 借用主过程计时请求，供容量预检及原位入队。
	ProcessTimer() *actionpkg.ProcessView
	// MarkRecastExecution 记录主过程已按重施执行本步骤。
	MarkRecastExecution()
	// RecastExecuted 仅对主过程返回本帧已执行重施步骤的标记。
	RecastExecuted(changes *actionpkg.ProcessChangeSet) bool
	// StagePassiveProcess 按操作顺序暂存已核定的新被动过程。
	StagePassiveProcess(process *actionpkg.ProcessView)
	// PassiveProcessCount 返回待发布的新被动过程数。
	PassiveProcessCount() int
	// PassiveProcessAt 按暂存顺序借用被动过程，供发布和排程。
	PassiveProcessAt(index int) *actionpkg.ProcessView
	// SetActionWait 更新本帧行动等待的调整请求。
	SetActionWait(pending bool)
	// StageAttackWait 暂存普攻等待预检的结果。
	StageAttackWait(wait *actionpkg.AttackWaitView)
	// AttackWait 借用暂存的普攻等待视图，调用者只读。
	AttackWait() *actionpkg.AttackWaitView
	// HasAttackWaitChange 报告本帧是否已经通过行动、普攻或弹药调整等待。
	HasAttackWaitChange(ammo *actionpkg.AmmoView) bool
	// AttackWaitInput 组合本帧暂存和当前队列、存活事实用于等待准备。
	AttackWaitInput(ammo *actionpkg.AmmoView, queued, alive bool) AttackWaitInput
	// StageCooldownWake 保存已经核定的冷却唤醒请求。
	StageCooldownWake(plan CooldownWakePlan)
	// CooldownWakeFlags 返回已暂存的自动技能与普攻唤醒标记。
	CooldownWakeFlags() (automatic, attack bool)
	// CooldownAttemptCount 返回待改期驱动数。
	CooldownAttemptCount() int
	// CooldownAttemptAt 按原顺序返回改期请求值。
	CooldownAttemptAt(index int) CooldownAttempt
	// AmmoWait 读取本帧对该实例最新暂存的等待，否则读取当前已发布等待。
	AmmoWait(ammo *actionpkg.AmmoView) actionpkg.AmmoWait
	// StageAmmoWait 保留该实例首次登记位置并更新等待事实。
	StageAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait)
	// AmmoWaitCount 返回有待发布等待的弹药实例数。
	AmmoWaitCount() int
	// AmmoWaitAt 按首次登记顺序借用弹药实例并返回等待值，供预检和发布。
	AmmoWaitAt(index int) (*actionpkg.AmmoView, actionpkg.AmmoWait)
	// StageAmmoCapture 暂存已核定的使用前弹药捕获。
	StageAmmoCapture(capture *AmmoCapture)
	// AmmoCapture 借用本次仍待发布的只读弹药捕获。
	AmmoCapture() *AmmoCapture
}

// Frame 持有同一真实帧共享的行动暂存，发布顺序和队列仍由根层协调。
type Frame struct {
	commitProcessOriginal    *actionpkg.ProcessView
	commitProcessChanges     *actionpkg.ProcessChangeSet
	commitProcessView        *actionpkg.ProcessView
	processIsNew             bool
	processTimer             bool
	recastExecutionCommitted bool
	passiveProcesses         []*actionpkg.ProcessView
	actionWait               bool
	attackWait               *actionpkg.AttackWaitView
	cooldownWake             CooldownWakePlan
	ammoWaits                []pendingAmmoWait
	ammoCapture              *AmmoCapture
}

// 等待按实际挂载实例分槽，保留首次登记顺序。
type pendingAmmoWait struct {
	ammo *actionpkg.AmmoView
	wait actionpkg.AmmoWait
}

var _ FrameAPI = (*Frame)(nil)

func (f *Frame) StageProcess(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet) {
	f.commitProcessOriginal, f.commitProcessChanges, f.commitProcessView = original, changes, changes.View()
}

func (f *Frame) Process() *actionpkg.ProcessView { return f.commitProcessView }

func (f *Frame) ProcessOriginal() *actionpkg.ProcessView { return f.commitProcessOriginal }

func (f *Frame) MarkProcessStart() { f.processIsNew = true }

func (f *Frame) StartsProcess() bool { return f.processIsNew }

func (f *Frame) PublishProcess(actions *actionpkg.State) {
	if f.commitProcessView == nil {
		return
	}
	f.commitProcessChanges.Publish(f.commitProcessOriginal)
	if f.processIsNew {
		actions.AddProcess(f.commitProcessOriginal)
	}
}

func (f *Frame) PrepareOccupancy(executor ProcessExecutor, now int64) *model.EngineError {
	if f.commitProcessView == nil {
		return nil
	}
	changed, err := executor.PrepareOccupancy(f.commitProcessChanges, f.commitProcessOriginal, now)
	f.actionWait = changed
	return err
}

func (f *Frame) StageProcessTimer(changes *actionpkg.ProcessChangeSet, pending bool) {
	if changes == f.commitProcessChanges {
		f.processTimer = pending
	}
}

func (f *Frame) ProcessTimer() *actionpkg.ProcessView {
	if f.processTimer {
		return f.commitProcessOriginal
	}
	return nil
}

func (f *Frame) MarkRecastExecution() { f.recastExecutionCommitted = true }

func (f *Frame) RecastExecuted(changes *actionpkg.ProcessChangeSet) bool {
	return changes == f.commitProcessChanges && f.recastExecutionCommitted
}

func (f *Frame) StagePassiveProcess(process *actionpkg.ProcessView) {
	f.passiveProcesses = append(f.passiveProcesses, process)
}

func (f *Frame) PassiveProcessCount() int { return len(f.passiveProcesses) }

func (f *Frame) PassiveProcessAt(index int) *actionpkg.ProcessView { return f.passiveProcesses[index] }

func (f *Frame) SetActionWait(pending bool) { f.actionWait = pending }

func (f *Frame) StageAttackWait(wait *actionpkg.AttackWaitView) { f.attackWait = wait }

func (f *Frame) AttackWait() *actionpkg.AttackWaitView { return f.attackWait }

func (f *Frame) HasAttackWaitChange(ammo *actionpkg.AmmoView) bool {
	return f.attackWait != nil || f.hasAmmoWait(ammo) || f.actionWait
}

func (f *Frame) AttackWaitInput(ammo *actionpkg.AmmoView, queued, alive bool) AttackWaitInput {
	return AttackWaitInput{PendingWait: f.attackWait, PendingAmmo: f.hasAmmoWait(ammo), PendingAction: f.actionWait,
		HasQueuedAttack: queued, CombatantsAlive: alive}
}

func (f *Frame) StageCooldownWake(plan CooldownWakePlan) { f.cooldownWake = plan }

func (f *Frame) CooldownWakeFlags() (automatic, attack bool) {
	return f.cooldownWake.Automatic, f.cooldownWake.BasicAttack
}

func (f *Frame) CooldownAttemptCount() int { return len(f.cooldownWake.Attempts) }

func (f *Frame) CooldownAttemptAt(index int) CooldownAttempt { return f.cooldownWake.Attempts[index] }

func (f *Frame) AmmoWait(ammo *actionpkg.AmmoView) actionpkg.AmmoWait {
	for _, pending := range f.ammoWaits {
		if pending.ammo == ammo {
			return pending.wait
		}
	}
	return ammo.Wait()
}

func (f *Frame) StageAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait) {
	for i := range f.ammoWaits {
		if f.ammoWaits[i].ammo == ammo {
			f.ammoWaits[i].wait = wait
			return
		}
	}
	f.ammoWaits = append(f.ammoWaits, pendingAmmoWait{ammo: ammo, wait: wait})
}

func (f *Frame) hasAmmoWait(ammo *actionpkg.AmmoView) bool {
	if ammo == nil {
		return false
	}
	for _, pending := range f.ammoWaits {
		if pending.ammo == ammo {
			return true
		}
	}
	return false
}

func (f *Frame) AmmoWaitCount() int { return len(f.ammoWaits) }

func (f *Frame) AmmoWaitAt(index int) (*actionpkg.AmmoView, actionpkg.AmmoWait) {
	pending := f.ammoWaits[index]
	return pending.ammo, pending.wait
}

func (f *Frame) StageAmmoCapture(capture *AmmoCapture) { f.ammoCapture = capture }

func (f *Frame) AmmoCapture() *AmmoCapture { return f.ammoCapture }
