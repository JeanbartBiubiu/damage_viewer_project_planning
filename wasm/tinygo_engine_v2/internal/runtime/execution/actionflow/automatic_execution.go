package actionflow

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// AutomaticDispatch 仅交接本次自动行动的真实入口、记录及有限等待请求。
type AutomaticDispatch interface {
	// AutomaticActorsAlive 读取本次实际双方生命，开始前死亡时不进行候选遍历。
	AutomaticActorsAlive() bool
	// PrepareAutomaticLedger 在原位置取得拥有者冷却账可写副本，不借出其他状态。
	PrepareAutomaticLedger() *actionpkg.CooldownLedger
	// RecordAutomaticAttempt 在原位置记录实际控制能力尝试。
	RecordAutomaticAttempt(ref string)
	// ExecuteAutomaticControl 执行已经选中的实际过程控制，真实接受仍由提交决定。
	ExecuteAutomaticControl(entry model.DriverEntry, ability planbundle.CompiledAbility, ref string) *model.EngineError
	// RecordAutomaticResult 记录真实自动拒绝或开始前失败，不改变释放资格。
	RecordAutomaticResult(record model.AutomaticSkillRecord)
	// QueueAutomaticCandidate 请求唯一队列安排下一时刻；onlyMissing保留原已有候选规则。
	QueueAutomaticCandidate(at int64, onlyMissing bool)
}

func (s SkillActionExecutor) RunAutomatic(generation uint64, now int64, dispatch AutomaticDispatch, candidates AutomaticCandidates) *model.EngineError {
	if !s.actions.HasAutomatic() || generation != s.actions.AutomaticGeneration() || !dispatch.AutomaticActorsAlive() {
		return nil
	}
	choice, err := s.ChooseAutomatic(now, dispatch.PrepareAutomaticLedger(), candidates)
	if err != nil {
		return err
	}
	selected, next := choice.Rule, choice.NextAt
	if selected == nil {
		if next > now {
			dispatch.QueueAutomaticCandidate(next, false)
		}
		return nil
	}
	if process := selected.RecastWindow(); process != nil && process.Status() == "active" {
		return s.RunAutomaticRecast(selected, process, now, dispatch)
	}
	action := s.actions.NewAutomaticAction(selected, now)
	s.actions.SetCurrentAction(action)
	key := action.Plan().InstructionKey()
	defer func() { s.actions.SetCurrentAction(nil); s.actions.RemoveProcessFact(key) }()
	dispatch.RecordAutomaticAttempt(action.Plan().AbilityRef())
	entry := model.DriverEntry{EntryKey: key, AbilityRef: action.Plan().AbilityRef(), Source: action.Plan().Source(), Target: action.Plan().Target(), FirstAtMs: now}
	s.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: action.UseRef()})
	err = dispatch.ExecuteAutomaticControl(entry, s.abilities[selected.ControlIndex()], selected.AbilityRef())
	if !action.Accepted() {
		record := model.AutomaticSkillRecord{RuleKey: selected.Plan().RuleKey()}
		s.actions.RecordAutomaticReject(selected, err != nil)
		if err == nil {
			reason := action.Rejection()
			record.Kind, record.Reason = model.AutomaticRecordAttemptRejected, &reason
		} else {
			reason := err.Message
			if err.BudgetCause != "" {
				reason = string(err.BudgetCause)
			}
			record.Kind, record.Reason = model.AutomaticRecordAbortedBeforeStart, &reason
		}
		dispatch.RecordAutomaticResult(record)
		s.actions.ForgetActionUse(action.UseRef())
		if next > now {
			dispatch.QueueAutomaticCandidate(next, true)
		}
	}
	return err
}

func (s SkillActionExecutor) RunAutomaticRecast(rule *actionpkg.AutomaticRuleView, process *actionpkg.ProcessView, now int64, dispatch AutomaticDispatch) *model.EngineError {
	parent := s.actions.ActionForUse(process.UseKey())
	if parent == nil || !parent.Accepted() {
		err := s.error("recast requires its real accepted window", "automaticSkills")
		err.Ref = process.UseKey()
		return err
	}
	index := rule.Binding().ControlAbilityIndices["RECAST"]
	key := parent.Plan().InstructionKey() + ":recast:" + strconv.Itoa(process.StepExecutionIndex()+1)
	ref := process.Owner() + ".provider[" + process.ProviderRef() + "].ability[" + s.abilities[index].AbilityKey + "]"
	parentKey := parent.Plan().InstructionKey()
	action := actionpkg.NewSkillAction(actionpkg.SkillActionSeed{AutomaticRule: rule, Plan: model.SkillActionPlan{InstructionKey: key, BindingKey: rule.Binding().BindingKey, SkillKey: process.SkillKey(), Source: process.Owner(), Target: process.Target(), AbilityRef: ref, Action: "RECAST", FirstAtMs: now, SortOrder: rule.Plan().SortOrder(), ParentInstructionKey: &parentKey, HitBindings: []model.SkillActionHitPreset{}}, Binding: rule.Binding(), ControlAbilityIndex: index, ParentIndex: -1, UseRef: process.UseKey()})
	s.actions.SetCurrentAction(action)
	defer func() { s.actions.SetCurrentAction(nil); s.actions.RemoveProcessFact(key) }()
	dispatch.RecordAutomaticAttempt(ref)
	s.actions.SetProcessFact(key, model.ProcessCommandFact{DriverEntryKey: key, UseRef: process.UseKey()})
	entry := model.DriverEntry{EntryKey: key, AbilityRef: ref, Source: process.Owner(), Target: process.Target(), FirstAtMs: now}
	return dispatch.ExecuteAutomaticControl(entry, s.abilities[index], ref)
}
