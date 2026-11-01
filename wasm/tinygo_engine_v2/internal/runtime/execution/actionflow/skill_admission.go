package actionflow

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// SkillAdmission 是首次行动准入需要的有限输入，不提供运行时状态或执行能力。
type SkillAdmission struct {
	Manual          []model.SkillActionPlan
	Automatic       *model.AutomaticSkillPlan
	BasicAttack     *model.BasicAttackPlan
	Entries         []model.DriverEntry
	ExternalFacts   int
	Snapshot        model.Snapshot
	RecordBudget    *model.RecordBudget
	Start, Duration int64
}

// SkillAdmissionChecks 只提供报告容量初始化和当前来源准入，不执行战斗。
type SkillAdmissionChecks interface {
	// InitSkillRecords 初始化技能与治疗记录的展示容量，失败不接受行动。
	InitSkillRecords(budget *model.RecordBudget) bool
	// InitAutomaticRecords 初始化自动行动展示容量，不改变计算预算。
	InitAutomaticRecords(budget *model.RecordBudget) bool
	// ValidateInitialSkillSnapshot 核对原始与物化快照的真实来源约束。
	ValidateInitialSkillSnapshot() *model.EngineError
	// ValidateSkillSource 核对当前实际选择的完整静态行动来源。
	ValidateSkillSource(owner, provider string, definition uint16) *model.EngineError
}

// ValidSkillActionControl 保留当前明确支持的手动控制集合。
func ValidSkillActionControl(action string) bool {
	return action == "INITIAL" || action == "CHARGE_RELEASE" || action == "RECAST" || action == "CANCEL"
}

func (s SkillActionExecutor) InitializeManual(input SkillAdmission, bindings []planbundle.CompiledSkillActionBinding, checks SkillAdmissionChecks) *model.EngineError {
	if !checks.InitSkillRecords(input.RecordBudget) {
		return s.error("invalid skill or healing record budget", "recordBudget")
	}
	if len(input.Manual) == 0 {
		return nil
	}
	if len(input.Manual) > 64 || input.Entries == nil || len(input.Entries)+input.ExternalFacts != 0 {
		return s.error("planned casts require 1 to 64 instructions and no external facts", "driverPlan")
	}
	if input.Start != 0 || input.Duration < 1 || input.Duration > 600000 {
		return s.error("single cast requires time zero and duration in [1,600000]", "stopPolicy")
	}
	if len(input.Snapshot.ProcessInstances)+len(input.Snapshot.UseTriggerLedger) != 0 {
		return s.error("single cast requires a fresh initial snapshot", "initialSnapshot")
	}
	for _, actor := range input.Snapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return s.error("single cast requires empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if err := checks.ValidateInitialSkillSnapshot(); err != nil {
		return err
	}
	seen := map[string]bool{}
	for index, plan := range input.Manual {
		path := "driverPlan.skillActions[" + strconv.Itoa(index) + "]"
		if strings.TrimSpace(plan.InstructionKey) == "" || seen[plan.InstructionKey] || plan.Source != model.SelectorSource || (plan.Target != model.SelectorSource && plan.Target != model.SelectorTarget) || !ValidSkillActionControl(plan.Action) || (plan.Action == "INITIAL" && plan.ParentInstructionKey != nil) || (plan.Action != "INITIAL" && (plan.ParentInstructionKey == nil || strings.TrimSpace(*plan.ParentInstructionKey) == "")) || plan.FirstAtMs < 0 || plan.FirstAtMs > input.Duration || plan.SortOrder < 0 || plan.HitBindings == nil {
			return s.error("invalid unique instruction, parent, timing or target", path)
		}
		seen[plan.InstructionKey] = true
		found := false
		for _, binding := range bindings {
			if binding.BindingKey != plan.BindingKey {
				continue
			}
			controlIndex, hasControl := binding.ControlAbilityIndices[plan.Action]
			expectedHits := len(binding.HitBindings)
			if binding.HasEmpoweredAttack {
				expectedHits = 0
			}
			if binding.SkillKey != plan.SkillKey || binding.Source != plan.Source || !hasControl || plan.AbilityRef != binding.Source+".provider["+binding.ProviderRef+"].ability["+s.abilities[controlIndex].AbilityKey+"]" || (plan.Action == "INITIAL" && len(plan.HitBindings) != expectedHits) || (plan.Action != "INITIAL" && len(plan.HitBindings) != 0) || binding.HasEmpoweredAttack && (plan.Target != plan.Source || input.BasicAttack == nil || input.BasicAttack.Source != plan.Source) {
				return s.error("instruction does not match its immutable compiled skill binding", path)
			}
			presetKeys := map[string]bool{}
			for _, preset := range plan.HitBindings {
				bound := false
				for _, hit := range binding.HitBindings {
					bound = bound || hit.HitBindingKey == preset.HitBindingKey
				}
				if !bound || presetKeys[preset.HitBindingKey] || (preset.Preset != "TARGET_HIT" && preset.Preset != "MISS") || plan.Target != model.SelectorTarget {
					return s.error("invalid release binding, hit preset or unique target", path+".hitBindings")
				}
				presetKeys[preset.HitBindingKey] = true
			}
			s.addManualPlan(plan, binding, controlIndex)
			found = true
			break
		}
		if !found {
			return s.error("unknown compiled skill binding", path+".bindingKey")
		}
	}
	if message := s.actions.BindManualParents(); message != "" {
		return s.error(message, "driverPlan.skillActions.parentInstructionKey")
	}
	for index := 0; index < s.actions.ManualCount(); index++ {
		action := s.actions.ManualAt(index)
		provider := s.abilities[action.Binding().InitialAbilityIndex].ProviderIndex
		if err := checks.ValidateSkillSource(action.Plan().Source(), action.Binding().ProviderRef, provider); err != nil {
			return err
		}
	}
	return nil
}

func (s SkillActionExecutor) InitializeAutomatic(input SkillAdmission, bindings []planbundle.CompiledSkillActionBinding, checks SkillAdmissionChecks) *model.EngineError {
	if input.Automatic == nil {
		return nil
	}
	if err := input.Automatic.Validate(); err != nil {
		return s.error(err.Error(), strings.Fields(err.Error())[0])
	}
	if len(input.Manual)+len(input.Entries)+input.ExternalFacts != 0 {
		return s.error("automatic skills require empty manual instructions and external fact arrays", "driverPlan")
	}
	if input.Start != 0 || input.Duration < 1 || input.Duration > 600000 || len(input.Snapshot.ProcessInstances)+len(input.Snapshot.UseTriggerLedger) != 0 {
		return s.error("automatic skills require a fresh time-zero run and duration in [1,600000]", "initialSnapshot")
	}
	for _, actor := range input.Snapshot.Combatants {
		if len(actor.Cooldowns)+len(actor.Shields)+len(actor.ProviderState)+len(actor.AbilityState)+len(actor.EffectiveStatuses)+len(actor.Vars) != 0 {
			return s.error("automatic skills require empty initial runtime state", "initialSnapshot.combatants")
		}
	}
	if err := checks.ValidateInitialSkillSnapshot(); err != nil {
		return err
	}
	s.actions.InitAutomatic()
	if !checks.InitAutomaticRecords(input.RecordBudget) {
		return s.error("invalid automatic record budget", "recordBudget.maxAutomaticSkillRecords")
	}
	for index, rule := range input.Automatic.Rules {
		path := "driverPlan.automaticSkills.rules[" + strconv.Itoa(index) + "]"
		var binding *planbundle.CompiledSkillActionBinding
		for index := range bindings {
			if bindings[index].BindingKey == rule.BindingKey {
				binding = &bindings[index]
				break
			}
		}
		if binding == nil {
			return s.error("unknown compiled skill binding", path+".bindingKey")
		}
		if !binding.AutomaticEligible {
			return s.error(binding.AutomaticIneligibleReason, binding.AutomaticIneligiblePath)
		}
		control, exists := binding.ControlAbilityIndices["INITIAL"]
		expectedHits := len(binding.HitBindings)
		if binding.HasEmpoweredAttack {
			expectedHits = 0
		}
		if !exists || binding.Source != model.SelectorSource || len(rule.HitBindings) != expectedHits || binding.HasEmpoweredAttack && (rule.Target != binding.Source || input.BasicAttack == nil || input.BasicAttack.Source != binding.Source) {
			return s.error("automatic rule must match its actual initial binding and complete hit presets", path)
		}
		for _, preset := range rule.HitBindings {
			found := false
			for _, hit := range binding.HitBindings {
				if hit.HitBindingKey == preset.HitBindingKey {
					found = true
					break
				}
			}
			if !found || rule.Target != model.SelectorTarget {
				return s.error("hit preset must name a compiled hit binding on the actual target", path+".hitBindings")
			}
		}
		ref := binding.Source + ".provider[" + binding.ProviderRef + "].ability[" + s.abilities[control].AbilityKey + "]"
		s.addAutomaticPlan(index, rule, *binding, ref, control)
	}
	if path, message := s.actions.LinkAutomaticRules(); message != "" {
		return s.error(message, path)
	}
	for index := 0; index < s.actions.AutomaticCount(); index++ {
		rule := s.actions.AutomaticAt(index)
		if err := checks.ValidateSkillSource(rule.Binding().Source, rule.Binding().ProviderRef, s.abilities[rule.Binding().InitialAbilityIndex].ProviderIndex); err != nil {
			return err
		}
	}
	return nil
}

func (s SkillActionExecutor) addManualPlan(plan model.SkillActionPlan, binding planbundle.CompiledSkillActionBinding, control uint16) {
	s.actions.AddManualAction(actionpkg.NewSkillAction(actionpkg.SkillActionSeed{Plan: plan, Binding: binding, ControlAbilityIndex: control, ParentIndex: -1, UseRef: "skill:" + plan.InstructionKey, Summary: model.SkillActionSummary{PlannedCount: 1}}))
}

func (s SkillActionExecutor) addAutomaticPlan(index int, rule model.AutomaticSkillRule, binding planbundle.CompiledSkillActionBinding, ref string, control uint16) {
	s.actions.AddAutomaticRule(actionpkg.AutomaticRuleSeed{InputIndex: index, Plan: rule, Binding: binding, AbilityRef: ref, ControlIndex: control})
}
