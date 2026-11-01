package lifecycle

import "tinygo_engine_v2/internal/model"

// InitializationAPI 列出原生来源初始化的单场事实，不推进循环或管理角色集合。
type InitializationAPI interface {
	// Reset 仅在初始事件入队前保存应完成的实际来源数量。
	Reset(count int)
	// Begin 核对实际来源存在、零时刻和未完成数量，再进入当前初始化事件。
	Begin(now int64, actualOwner bool) bool
	// End 结束当前初始化事件的预算上下文，失败也必须结束。
	End()
	// Complete 只在真实初始化派发及尾部成功后消费一个来源资格。
	Complete()
	// Pending 返回尚未完成的真实来源数量，供普攻启动保持原等待。
	Pending() int
	// Active 返回是否正在原生初始化事件中，供现有事件预算及冷初始化操作消费。
	Active() bool
}

type Initialization struct {
	pending int
	active  bool
}

var _ InitializationAPI = (*Initialization)(nil)

func (i *Initialization) Reset(count int) { i.pending = count }

func (i *Initialization) Begin(now int64, actualOwner bool) bool {
	if i.pending <= 0 || !actualOwner || now != 0 {
		return false
	}
	i.active = true
	return true
}

func (i *Initialization) End() { i.active = false }

func (i *Initialization) Complete() { i.pending-- }

func (i *Initialization) Pending() int { return i.pending }

func (i *Initialization) Active() bool { return i.active }

func (e *Executor) SourceInitializationStart(now int64, snapshot model.Snapshot) (bool, *model.EngineError) {
	if _, declared := e.compiled.RuntimeTypes.SourceInitialized.Lookup(); !declared {
		return false, nil
	}
	if now != 0 {
		return false, e.invariant("initialSnapshot.timeMs", "source initialization requires a fresh time-zero snapshot", "")
	}
	if len(snapshot.ProcessInstances)+len(snapshot.UseTriggerLedger) != 0 {
		return false, e.invariant("initialSnapshot", "source initialization requires unused process and trigger state", "")
	}
	return true, nil
}

func (e *Executor) SourceInitializationState(snapshot model.Snapshot) *model.EngineError {
	for _, owner := range snapshot.Combatants {
		if len(owner.Cooldowns)+len(owner.Shields)+len(owner.ProviderState)+len(owner.AbilityState)+len(owner.EffectiveStatuses)+len(owner.Vars) != 0 {
			return e.invariant("initialSnapshot.combatants", "source initialization cannot restore previous runtime state", "")
		}
	}
	return nil
}
