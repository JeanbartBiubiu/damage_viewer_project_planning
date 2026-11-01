package actionflow

import "tinygo_engine_v2/internal/model"

// NativeAttackStart 只交接已准入一刀的真实使用登记、开始帧及强化预留。
type NativeAttackStart interface {
	// StartActorsAlive 读取此刻真实双方生命，不保存旧的可用判断。
	StartActorsAlive(source, target string) bool
	// RegisterNativeStart 登记本刀已分配的真实使用、开始及命中事实，并保存原报告位置。
	RegisterNativeStart(use, start, hit string)
	// ExecuteNativeStart 记录原开始能力尝试并执行开始帧，返回真实过程错误。
	ExecuteNativeStart(entry model.DriverEntry) *model.EngineError
	// NativeCooldownReady 读取已提交的唯一能力冷却期限。
	NativeCooldownReady(owner, ref string) int64
	// ReserveNativeEmpowered 在真实开始完成且双方仍存活时预留原强化等待。
	ReserveNativeEmpowered(use, target string) *model.EngineError
}

func (s BasicAttackExecutor) Begin(now int64, speed float64, initializationPending int, phases NativeAttackStart) (string, string, *model.EngineError) {
	b := s.actions.BasicAttack()
	if b == nil || initializationPending != 0 || !phases.StartActorsAlive(b.Plan().Source, b.Plan().Target) || s.actions.Occupied(b.Plan().Source) {
		return "", "", s.error("native attack start is unavailable", "driverPlan.basicAttack")
	}
	useRef, startKey, hitKey := s.actions.BeginAttack(now, speed)
	phases.RegisterNativeStart(useRef, startKey, hitKey)
	startEntry := model.DriverEntry{EntryKey: startKey, AbilityRef: b.Plan().StartAbilityRef, Source: b.Plan().Source, Target: b.Plan().Target, FirstAtMs: now}
	if err := phases.ExecuteNativeStart(startEntry); err != nil {
		return "", "", err
	}
	found := false
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		p := s.actions.ProcessAt(processSlot)
		if p.UseKey() == useRef && p.AbilityRef() == b.Plan().InitialControlAbilityRef && p.Owner() == b.Plan().Source && p.Target() == b.Plan().Target && p.SkillKey() == b.Plan().SkillKey && p.Status() == "complete" {
			found = true
			break
		}
	}
	if !found {
		return "", "", s.error("native start did not complete its actual attack process", b.Plan().InitialControlAbilityRef)
	}
	ready := phases.NativeCooldownReady(b.Plan().Source, b.Plan().InitialControlAbilityRef)
	if ready <= now || ready > maxJSONSafeInteger || b.Wait() == nil || phases.NativeCooldownReady(b.Plan().Source, b.Plan().InitialControlAbilityRef) != ready || b.Current().ReadyAtMs() == nil {
		return "", "", s.error("attack process did not commit its unique valid cooldown waiting node", b.Plan().InitialControlAbilityRef)
	}
	if !phases.StartActorsAlive(b.Plan().Source, b.Plan().Target) {
		return "", "", s.error("combatant died before native hit", "driverPlan.basicAttack")
	}
	if err := phases.ReserveNativeEmpowered(useRef, b.Plan().Target); err != nil {
		return "", "", err
	}
	return useRef, hitKey, nil
}
