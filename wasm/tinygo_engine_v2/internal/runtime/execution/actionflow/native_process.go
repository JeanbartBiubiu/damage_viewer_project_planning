package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// NativeProcessStart 是一次真实普攻开始监听提供的有限事实，不含执行器或复制收集器。
type NativeProcessStart struct {
	Source, Target, AbilityRef, DriverKey string
	Depth                                 int
	Now                                   int64
	Event                                 *contract.EventSnapshot
}

// PreparedNativeProcess 是真实开始事实的有限过程决定；定义仅借用到根层同步启动完成。
type PreparedNativeProcess struct {
	Entry         model.DriverEntry
	Provider, Use string
	Rejection     string
	Definition    *planbundle.CompiledProcess
}

// NativeProcessReads 只读取真实开始事实的使用、挂载、生命和冷却，不接收同步启动上下文。
type NativeProcessReads interface {
	// NativeProcessUse 返回当前已登记的原普攻使用，缺失返回nil。
	NativeProcessUse(use string) *actionpkg.UseView
	// NativeProcessMounted 核对实际普攻来源的有效挂载。
	NativeProcessMounted(owner, provider string, definition uint16) bool
	// NativeProcessDead 查询拥有者是否存在明确且归零的当前生命。
	NativeProcessDead(owner string) bool
	// NativeProcessCooldown 查询实际首次控制的唯一普通冷却。
	NativeProcessCooldown(owner, ref string) bool
}

func (s ProcessExecutor) PrepareNativeProcess(input NativeProcessStart, ability planbundle.CompiledAbility, providers []planbundle.CompiledProvider, reads NativeProcessReads) (PreparedNativeProcess, *model.EngineError) {
	event := input.Event
	if input.DriverKey != "" || input.Depth < 1 || event == nil || event.EventType != model.EventTypeBasicAttackStart || !event.HasUse || ability.ProcessControl.Action != "INITIAL" || !ability.IsBasicAttack {
		return PreparedNativeProcess{}, s.error("abilityRef", "event-bound INITIAL requires a real basic_attack_start listener context", input.AbilityRef)
	}
	parsed, valid := planbundle.ParseAbilityRef(input.AbilityRef)
	use := reads.NativeProcessUse(event.UseKey)
	if !valid || use == nil || parsed.Combatant != input.Source || event.EventSourceKey != input.Source || event.EventTargetKey != input.Target || event.UseSource != input.Source || event.UseSkillKey != ability.SkillKey || use.Source() != input.Source || use.SkillKey() != ability.SkillKey {
		return PreparedNativeProcess{}, s.error("processControl.useRefFromEvent", "native attack and process must share the real source, target, skill and use", input.AbilityRef)
	}
	definition := &providers[ability.ProviderIndex].Processes[ability.ProcessControl.ProcessIndex]
	if !reads.NativeProcessMounted(input.Source, parsed.ProviderRef, ability.ProviderIndex) {
		return PreparedNativeProcess{}, s.error("processControl.processKey", "event-bound process requires its live mounted provider", input.AbilityRef)
	}
	entry := model.DriverEntry{EntryKey: model.EventTypeBasicAttackStart + "/" + event.UseKey, AbilityRef: input.AbilityRef, Source: input.Source, Target: input.Target, FirstAtMs: input.Now}
	prepared := PreparedNativeProcess{Entry: entry, Provider: parsed.ProviderRef, Use: event.UseKey, Definition: definition}
	var mountKey string
	for index := 0; index < s.actions.ProcessCount(); index++ {
		current := s.actions.ProcessAt(index)
		if current.UseKey() == event.UseKey {
			return PreparedNativeProcess{}, s.error("processControl.useRefFromEvent", "one native attack use cannot start another process instance", event.UseKey)
		}
		if current.Status() != "active" {
			continue
		}
		if mountKey == "" {
			mountKey = actionpkg.ProcessMountKey(input.Source, parsed.ProviderRef, definition.ProcessKey)
		}
		if current.MountKey() == mountKey {
			prepared.Rejection = "process_already_active"
			return prepared, nil
		}
	}
	if reads.NativeProcessDead(input.Source) {
		prepared.Rejection = "source_dead"
		return prepared, nil
	}
	if reads.NativeProcessCooldown(input.Source, input.AbilityRef) {
		prepared.Rejection = "cooldown_not_ready"
		return prepared, nil
	}
	return prepared, nil
}

func (s ProcessExecutor) RequireAttackProcess(ability planbundle.CompiledAbility, skill, use, ref, source, target, driver string, now int64, providers []planbundle.CompiledProvider, abilities []planbundle.CompiledAbility) *model.EngineError {
	parsed, _ := planbundle.ParseAbilityRef(ref)
	for _, definition := range providers[ability.ProviderIndex].Processes {
		if definition.SkillKey != skill || definition.InitialAbilityIndex < 0 || !abilities[definition.InitialAbilityIndex].ProcessControl.UseRefFromEvent {
			continue
		}
		for index := 0; index < s.actions.ProcessCount(); index++ {
			process := s.actions.ProcessAt(index)
			if process.UseKey() == use && process.Owner() == source && process.Target() == target && process.ProviderRef() == parsed.ProviderRef && process.ProcessKey() == definition.ProcessKey && process.SkillKey() == skill && process.StartedAtMs() <= now && process.Status() != "failed" {
				return nil
			}
		}
		return s.error("skillHitFacts["+driver+"].useRef", "basic attack hit requires its successful native-start-bound process with the same source, target, skill and use", use)
	}
	return nil
}
