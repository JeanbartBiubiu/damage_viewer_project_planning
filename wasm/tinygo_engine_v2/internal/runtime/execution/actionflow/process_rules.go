package actionflow

import (
	"sort"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessConditions 只借用当前独立条件帧的明确公式和控制能力参数。
type ProcessConditions interface {
	// ReadProcessCondition 从本帧实际能力和准备好的视图求值，不发布状态。
	ReadProcessCondition(program formula.GenericProgramID, ability planbundle.CompiledAbility) (float64, *model.EngineError)
}

// ProcessDeaths 只读取当前真实生命并保护原同步死亡结算重入标记。
type ProcessDeaths interface {
	// HasDeadProcessActor 判断当前是否有显式归零的真实角色，空集合不触发结算。
	HasDeadProcessActor() bool
	// ProcessOwnerDead 查询实际拥有者的显式生命，不用来源冻结值替代。
	ProcessOwnerDead(owner string) bool
	// SettlingProcessDeaths 返回当前是否已在同一同步死亡结算中。
	SettlingProcessDeaths() bool
	// BeginProcessDeaths 在原位置标记同步结算开始，嵌套时沿原重入语义处理。
	BeginProcessDeaths()
	// EndProcessDeaths 在本次同步调用返回时清理原结算标记。
	EndProcessDeaths()
}

func (s ProcessExecutor) Condition(entryIndex int, ability planbundle.CompiledAbility, values ProcessConditions) (bool, *model.EngineError) {
	if program, present := s.actions.DriverCondition(entryIndex); present {
		value, err := values.ReadProcessCondition(program, ability)
		if err != nil || value == 0 {
			return false, err
		}
	}
	if ability.HasCastCondition {
		value, err := values.ReadProcessCondition(ability.CastConditionProgram, ability)
		if err != nil || value == 0 {
			return false, err
		}
	}
	return true, nil
}

func (s ProcessExecutor) IsAttackReset(process *actionpkg.ProcessView, kind string, operation planbundle.CompiledOperation, registry *formula.GenericRegistry, references map[string]planbundle.CompiledAbilityRef, abilities []planbundle.CompiledAbility) bool {
	attack := s.actions.BasicAttack()
	if kind != "PROCESS_START" || attack == nil || process.Owner() != attack.Plan().Source || (operation.Target != model.SelectorSelf && operation.Target != model.SelectorSource) || !operation.HasAmount {
		return false
	}
	ref := NormalizeAbilityRef(operation.AbilityRefStr, process.Owner(), process.Target())
	if ref != attack.Plan().InitialControlAbilityRef {
		return false
	}
	value, constant := registry.FoldStatic(operation.AmountProgram)
	if !constant || value != 0 {
		return false
	}
	bound, found := references[ref]
	if !found || int(bound.AbilityIndex) >= len(abilities) {
		return false
	}
	ability := abilities[bound.AbilityIndex]
	return ability.IsBasicAttack && ability.SkillKey == attack.Plan().SkillKey && ability.ProcessControl != nil && ability.ProcessControl.Action == "INITIAL" && ability.ProcessControl.UseRefFromEvent && ability.ProviderIndex == attack.InitialAbility().ProviderIndex && ability.AbilityKey == attack.InitialAbility().AbilityKey
}

func (s ProcessExecutor) FailDeadProcesses(deaths ProcessDeaths, phases ProcessPhases) *model.EngineError {
	if s.actions.ProcessCount() == 0 || !deaths.HasDeadProcessActor() {
		return nil
	}
	if !deaths.SettlingProcessDeaths() {
		hasPending := false
		for index := 0; index < s.actions.ProcessCount(); index++ {
			process := s.actions.ProcessAt(index)
			if process.Status() == "active" && (s.actions.Dead(process.Owner()) || deaths.ProcessOwnerDead(process.Owner())) {
				hasPending = true
				break
			}
		}
		if !hasPending {
			return nil
		}
	}
	deaths.BeginProcessDeaths()
	defer deaths.EndProcessDeaths()
	ordered := s.actions.ProcessViews()
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].StableKey() < ordered[j].StableKey() })
	for {
		pending := make([]*actionpkg.ProcessView, 0)
		for _, process := range ordered {
			if process.Status() == "active" && (s.actions.Dead(process.Owner()) || deaths.ProcessOwnerDead(process.Owner())) {
				pending = append(pending, process)
			}
		}
		if len(pending) == 0 {
			break
		}
		for _, process := range pending {
			if err := s.Finish(process, "failed", "SOURCE_DIED", "", phases); err != nil {
				return err
			}
		}
	}
	return nil
}
