package actionflow

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessEmpoweredBinding 是根层已核对的有限编译绑定，不带命中或完整会话状态。
type ProcessEmpoweredBinding struct {
	AbilityIndex    uint16
	ReplacesPrimary bool
	Slot            uint16
}

// ProcessStartInput 给出本次真实新过程的身份、定义及已准备时刻，不决定默认状态。
type ProcessStartInput struct {
	Owner, Target, ProviderRef, AbilityRef, Use string
	Ability                                     planbundle.CompiledAbility
	Definition                                  *planbundle.CompiledProcess
	Now                                         int64
	Empowered                                   *ProcessEmpoweredBinding
}

func (s ProcessExecutor) InitialProcess(input ProcessStartInput) *actionpkg.ProcessView {
	seed := actionpkg.ProcessSeed{
		Snapshot: model.ProcessInstanceSnapshot{
			Owner: input.Owner, Target: input.Target, ProviderRef: input.ProviderRef,
			ProcessKey: input.Definition.ProcessKey, SkillKey: input.Definition.SkillKey, UseKey: input.Use,
			StartedAtMs: input.Now, StepStartedAtMs: input.Now, AdvanceAtMs: input.Now,
			ActualCosts: map[string]float64{}, ActionOccupancies: []model.ProcessActionOccupancy{}, Status: "active",
		},
		Definition: input.Definition, Ability: input.Ability, AbilityRef: input.AbilityRef, StepIndex: -1, CastUseKey: input.Use,
	}
	if binding := input.Empowered; binding != nil {
		seed.HasEmpoweredAbility = true
		seed.EmpoweredAbilityIndex = binding.AbilityIndex
		seed.ReplacesPrimary = binding.ReplacesPrimary
		seed.PrimaryReplacementBinding = binding.Slot
	}
	return actionpkg.NewProcess(seed)
}
