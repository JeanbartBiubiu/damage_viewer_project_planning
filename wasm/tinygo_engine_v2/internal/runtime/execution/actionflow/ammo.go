package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AmmoWork 只借用当前库存阶段的状态、金额和数值刷新，不包含提交或队列。
type AmmoWork interface {
	// ReadAmmoInventory 读取原库存槽的实际数值，不补缺失值。
	ReadAmmoInventory(ammo *actionpkg.AmmoView) (float64, *model.EngineError)
	// ReadAmmoWait 取得本阶段暂存优先的唯一回充等待。
	ReadAmmoWait(ammo *actionpkg.AmmoView) actionpkg.AmmoWait
	// WriteAmmoWait 在当前阶段暂存唯一回充等待，不发布或另建时钟。
	WriteAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait)
	// AmmoAmount 从所属能力和当前暂存读取金额；strict只在原回充位置开启严格读取，
	// false保留当前帧原有设置，不关闭已经开启的严格读取。
	AmmoAmount(program formula.GenericProgramID, ability planbundle.CompiledAbility, strict bool) (float64, *model.EngineError)
	// WriteAmmoInventory 在原库存槽暂存已核定值并标记数值已变。
	WriteAmmoInventory(ammo *actionpkg.AmmoView, value float64)
	// RecordAmmo 暂存真实机制记录，不改变可靠数值或回充期限。
	RecordAmmo(ammo *actionpkg.AmmoView, kind string, before, after float64, operation string, use *string, ready *int64)
	// ConsumeAmmoCommand 在原位置消费本事件命令预算，失败不继续操作。
	ConsumeAmmoCommand() *model.EngineError
	// ResolveAmmoAttributes 沿原两遍顺序刷新库存变化产生的属性，错误保持当前暂存。
	ResolveAmmoAttributes(ability planbundle.CompiledAbility) *model.EngineError
	// AmmoActorsAlive 查询当前暂存双方生命和已冻结死亡，供真正回充前复核。
	AmmoActorsAlive(ammo *actionpkg.AmmoView) bool
}

// AmmoRecoveryEvent 是唯一队列交付的完整来源、状态、世代和时刻。
type AmmoRecoveryEvent struct {
	Owner, ProviderRef, StateKey string
	Generation                   uint64
	TimeMs                       int64
}

// AmmoPhases 只提供真实挂载核对和当前独立库存帧的执行交接。
type AmmoPhases interface {
	// AmmoMounted 核对当前真实来源的有效挂载，旧计时不得恢复已卸载供值器。
	AmmoMounted(ammo *actionpkg.AmmoView) bool
	// InitializeAmmoFrame 在一个独立帧内核对并启动初始回充，不移动提交边界。
	InitializeAmmoFrame(ammo *actionpkg.AmmoView) *model.EngineError
	// RecoverAmmoFrame 在原回充时刻建立独立帧执行库存恢复并提交。
	RecoverAmmoFrame(ammo *actionpkg.AmmoView) *model.EngineError
	// InitialAttackAmmo 沿既有整匣普攻准入边界启动第一次等待。
	InitialAttackAmmo() *model.EngineError
}

func (s SkillActionExecutor) BindBasicAmmo(ammo *actionpkg.AmmoView) {
	if attack := s.actions.BasicAttack(); attack != nil && ammo == attack.Ammo() {
		s.actions.BindAmmo(ammo, attack.Plan().Target, attack.Plan().InitialControlAbilityRef, attack.InitialAbility())
	}
}

func (s SkillActionExecutor) FindAmmo(owner, provider, key string) *actionpkg.AmmoView {
	for index := 0; index < s.actions.AmmoCount(); index++ {
		ammo := s.actions.AmmoAt(index)
		if ammo.Owner() == owner && ammo.ProviderRef() == provider && ammo.Binding().StateKey == key {
			return ammo
		}
	}
	if attack := s.actions.BasicAttack(); attack != nil && attack.Ammo() != nil {
		ammo := attack.Ammo()
		if ammo.Owner() == owner && ammo.ProviderRef() == provider && ammo.Binding().StateKey == key {
			s.BindBasicAmmo(ammo)
			return ammo
		}
	}
	return nil
}

func (s SkillActionExecutor) InitializePlannedAmmo() {
	for _, action := range s.PlannedSources() {
		ability := s.abilities[action.Binding().InitialAbilityIndex]
		provider := s.providers[ability.ProviderIndex]
		if provider.AmmoBinding == nil || s.FindAmmo(action.Binding().Source, action.Binding().ProviderRef, provider.AmmoBinding.StateKey) != nil {
			continue
		}
		ref := action.Binding().Source + ".provider[" + action.Binding().ProviderRef + "].ability[" + ability.AbilityKey + "]"
		s.actions.AddAmmo(actionpkg.NewAmmo(actionpkg.AmmoSeed{Owner: action.Binding().Source, ProviderRef: action.Binding().ProviderRef, Definition: provider, Binding: *provider.AmmoBinding, Target: action.Plan().Target(), AbilityRef: ref, Ability: ability}))
	}
	if attack := s.actions.BasicAttack(); attack != nil && attack.Ammo() != nil {
		ammo := attack.Ammo()
		s.BindBasicAmmo(ammo)
		if ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery.OneByOne || s.actions.ManualCount() > 0 || s.actions.HasAutomatic() {
			s.actions.AddAmmo(ammo)
		}
	}
}

func (s SkillActionExecutor) InitializeDrivenAmmo(phases AmmoPhases) *model.EngineError {
	for index := 0; index < s.actions.AmmoCount(); index++ {
		ammo := s.actions.AmmoAt(index)
		if !phases.AmmoMounted(ammo) {
			continue
		}
		if err := phases.InitializeAmmoFrame(ammo); err != nil {
			return err
		}
	}
	if s.actions.AmmoCount() == 0 {
		return phases.InitialAttackAmmo()
	}
	return nil
}

func (s SkillActionExecutor) RecoverAmmo(event AmmoRecoveryEvent, now int64, phases AmmoPhases) *model.EngineError {
	stateKey := event.StateKey
	if attack := s.actions.BasicAttack(); stateKey == "" && attack != nil && attack.Ammo() != nil {
		ammo := attack.Ammo()
		if event.Owner == ammo.Owner() && event.ProviderRef == ammo.ProviderRef() {
			stateKey = ammo.Binding().StateKey
		}
	}
	ammo := s.FindAmmo(event.Owner, event.ProviderRef, stateKey)
	if ammo == nil || !ammo.Wait().Active || event.Generation != ammo.Wait().Generation || event.TimeMs != ammo.Wait().ReadyAt || event.TimeMs != now || !phases.AmmoMounted(ammo) {
		return nil
	}
	return phases.RecoverAmmoFrame(ammo)
}

func (s SkillActionExecutor) PrepareInitialAmmo(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, *model.EngineError) {
	value, err := work.ReadAmmoInventory(ammo)
	if err != nil {
		return false, err
	}
	field := ammo.Definition().StateFields[ammo.Binding().StateKey]
	if value == field.MaxValue || ammo.Wait().Active || !field.AmmoRecovery.OneByOne && value > 0 {
		return false, nil
	}
	if err := work.ConsumeAmmoCommand(); err != nil {
		return false, err
	}
	remaining := int64(-1)
	if field.AmmoRecovery.OneByOne {
		if !field.AmmoRecovery.HasInitialRemaining {
			return false, s.error("incomplete ammo inventory requires explicit initial remaining time", field.AmmoRecovery.Path+".initialRemainingMs")
		}
		remaining = field.AmmoRecovery.InitialRemainingMs
	}
	return true, s.PrepareAmmoRecovery(ammo, ammo.Ability(), remaining, now, work)
}

func (s SkillActionExecutor) PublishAmmoWait(ammo *actionpkg.AmmoView, wait actionpkg.AmmoWait, alive bool) bool {
	s.actions.PublishAmmoWait(ammo, wait)
	if !ammo.Wait().Active {
		return false
	}
	if attack := s.actions.BasicAttack(); attack != nil && ammo == attack.Ammo() {
		ready := ammo.Wait().ReadyAt
		if attack.Current() != nil {
			s.actions.SetAttackMechanicReady(ready)
		} else if attack.StartedCount() == 0 && alive {
			s.actions.SetInitialMechanicReady(&ready)
		}
	}
	return alive
}

func (s SkillActionExecutor) PrepareAmmoRecovery(ammo *actionpkg.AmmoView, ability planbundle.CompiledAbility, initialRemaining, now int64, work AmmoWork) *model.EngineError {
	wait := work.ReadAmmoWait(ammo)
	if wait.Active {
		return nil
	}
	recovery := ammo.Definition().StateFields[ammo.Binding().StateKey].AmmoRecovery
	interval, err := work.AmmoAmount(recovery.IntervalProgram, ability, true)
	if err != nil {
		return err
	}
	if !formula.ValidPositiveInt64DurationMs(interval) || interval > float64(maxJSONSafeInteger-now) {
		return s.error("ammo recovery requires a positive safe integer interval and timestamp", recovery.Path+".intervalMs")
	}
	delay := int64(interval)
	if initialRemaining >= 0 {
		if initialRemaining > delay || initialRemaining > maxJSONSafeInteger-now {
			return s.error("initial remaining time exceeds the complete recovery interval or timestamp", recovery.Path+".initialRemainingMs")
		}
		delay = initialRemaining
	}
	if wait.Generation == ^uint64(0) {
		return s.error("ammo generation overflow", recovery.Path)
	}
	readyAt := now + delay
	value, err := work.ReadAmmoInventory(ammo)
	if err != nil {
		return err
	}
	work.WriteAmmoWait(ammo, actionpkg.AmmoWait{Active: true, ReadyAt: readyAt, Generation: wait.Generation + 1})
	work.RecordAmmo(ammo, model.MechanicWaitStarted, value, value, recovery.Path, nil, &readyAt)
	return nil
}

func (s SkillActionExecutor) PrepareRecoveredAmmo(ammo *actionpkg.AmmoView, now int64, work AmmoWork) (bool, *model.EngineError) {
	if !work.AmmoActorsAlive(ammo) {
		return false, nil
	}
	if err := work.ConsumeAmmoCommand(); err != nil {
		return false, err
	}
	before, err := work.ReadAmmoInventory(ammo)
	if err != nil {
		return false, err
	}
	field := ammo.Definition().StateFields[ammo.Binding().StateKey]
	if before >= field.MaxValue || !field.AmmoRecovery.OneByOne && before != 0 {
		return false, s.error("ammo recovery requires an incomplete original inventory", ammo.Binding().StateKey)
	}
	after := field.MaxValue
	if field.AmmoRecovery.OneByOne {
		after = before + 1
	}
	work.WriteAmmoInventory(ammo, after)
	wait := ammo.Wait()
	wait.Active = false
	work.WriteAmmoWait(ammo, wait)
	readyAt := wait.ReadyAt
	work.RecordAmmo(ammo, model.MechanicStateChanged, before, after, field.AmmoRecovery.Path, nil, &readyAt)
	work.RecordAmmo(ammo, model.MechanicWaitEnded, before, after, field.AmmoRecovery.Path, nil, &readyAt)
	if err := work.ResolveAmmoAttributes(ammo.Ability()); err != nil {
		return false, err
	}
	if after < field.MaxValue {
		if err := s.PrepareAmmoRecovery(ammo, ammo.Ability(), -1, now, work); err != nil {
			return false, err
		}
	}
	return true, nil
}

// ValidateAmmoInventory 保持实际库存的整数、非负和完整上限校验，不补默认值。
func ValidateAmmoInventory(value, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value && value >= 0 && value <= maximum
}
