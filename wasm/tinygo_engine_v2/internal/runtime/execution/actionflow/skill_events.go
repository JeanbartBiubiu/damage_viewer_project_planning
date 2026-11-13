package actionflow

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// SkillActionObserver 只登记已提交行动事实和记录，不执行过程或消费新的资格。
type SkillActionObserver interface {
	// RegisterActionUse 将所属行动创建的真实使用登记到现有命中事实索引。
	RegisterActionUse(use *actionpkg.UseView)
	// ActionUseExists 核对真实使用是否已经登记，不以空字段代替存在标记。
	ActionUseExists(use string) bool
	// ObserveActionUse 记录此刻真实使用阶段，明细关闭不改变行动状态。
	ObserveActionUse(process *actionpkg.ProcessView, kind string, hit, reason *string)
	// ObserveAutomaticStart 沿现有行动状态记录真实自动开始和资格消费。
	ObserveAutomaticStart(action *actionpkg.SkillActionView, process *actionpkg.ProcessView)
	// ObserveAutomaticFinish 沿现有行动状态记录真实自动终结和必要后继资格。
	ObserveAutomaticFinish(action *actionpkg.SkillActionView, process *actionpkg.ProcessView)
}

// SkillUseRecords 只提供有限记录容量和已经登记的真实重施来源。
type SkillUseRecords interface {
	// BeginActionUseRecord 按原明细容量核定是否保留本次真实记录。
	BeginActionUseRecord() bool
	// ActionForKnownUse 按实际使用引用取已登记的行动，不为历史使用创建替代。
	ActionForKnownUse(use string) *actionpkg.SkillActionView
	// AppendActionUseRecord 接受已经构造完整的真实使用记录。
	AppendActionUseRecord(record model.SkillUseRecord)
}

// SkillHitPhases 只交接已核定时点的实际生命读取和真实绑定命中。
type SkillHitPhases interface {
	// SkillHitActorsAlive 读取此刻双方实际生命值，不使用开始时旧快照。
	SkillHitActorsAlive(owner, target string) bool
	// ExecutePlannedHit 执行该真实过程的指定编译绑定命中，不重新接受过程。
	ExecutePlannedHit(process *actionpkg.ProcessView, action *actionpkg.SkillActionView, hit model.SkillActionHitBinding, sequence int) *model.EngineError
}

// CommittedSkillHit 只交接命中原帧提交的有限身份和阻挡数，不从展示记录或尾伤反推。
type CommittedSkillHit struct {
	OccurrenceID uint64
	Sequence     int
	HasSequence  bool
	Blocked      float64
	TimeMs       int64
}

func (s SkillActionExecutor) PublishStart(process *actionpkg.ProcessView, observer SkillActionObserver) {
	action := s.actions.ActionForUse(process.UseKey())
	if action == nil || action.Accepted() || process.UseKey() != action.UseRef() || process.AbilityRef() != action.Plan().AbilityRef() {
		return
	}
	s.actions.Accept(action, "", true)
	if HasSimpleProcessHitFacts(process.Definition(), action.Binding()) {
		s.actions.InitSkillHitStages(process)
	}
	observer.RegisterActionUse(s.actions.NewUse(actionpkg.UseSeed{UseKey: process.UseKey(), Source: process.Owner(), SkillKey: process.SkillKey(), HistoryState: model.SkillHitHistoryComplete, ProcessRef: process.Reference(), ActionRef: action.Reference(), CastID: process.CastID()}))
	observer.ObserveActionUse(process, "STARTED", nil, nil)
	observer.ObserveAutomaticStart(action, process)
}

func (s SkillActionExecutor) PublishFinish(process *actionpkg.ProcessView, observer SkillActionObserver) {
	action := s.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() || action.AutomaticRule() != nil && action.AutomaticFinished() {
		return
	}
	if process.Status() == "complete" {
		s.actions.RecordUse(action, "COMPLETED")
		observer.ObserveActionUse(process, "COMPLETED", nil, nil)
	} else {
		s.actions.RecordUse(action, "FAILED")
		observer.ObserveActionUse(process, "FAILED", nil, process.FailureReason())
	}
	observer.ObserveAutomaticFinish(action, process)
}

func (s SkillActionExecutor) PublishControl(process *actionpkg.ProcessView, abilityRef string, observer SkillActionObserver) {
	action := s.actions.CurrentAction()
	if action != nil && action.Plan().Action() != "INITIAL" && !action.Accepted() && process != nil && process.UseKey() == action.UseRef() && abilityRef == action.Plan().AbilityRef() {
		use := ""
		if action.Plan().Action() == "RECAST" {
			use = process.CastUseKey()
		}
		s.actions.Accept(action, use, false)
	}
	if process != nil && process.CastUseKey() != "" && process.CastUseKey() != process.UseKey() && !observer.ActionUseExists(process.CastUseKey()) {
		observer.RegisterActionUse(s.actions.NewUse(actionpkg.UseSeed{UseKey: process.CastUseKey(), Source: process.Owner(), SkillKey: process.SkillKey(), HistoryState: model.SkillHitHistoryComplete, ProcessRef: process.Reference(), ActionRef: action.Reference(), CastID: process.CastID()}))
	}
}

func (s SkillActionExecutor) PublishMoment(process *actionpkg.ProcessView, kind string, now int64, observer SkillActionObserver) {
	action := s.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() {
		return
	}
	switch kind {
	case "STEP_START":
		s.actions.RecordUse(action, "STEP_ENTERED")
		observer.ObserveActionUse(process, "STEP_ENTERED", nil, nil)
	case "STEP_EXECUTION":
		s.actions.RecordUse(action, "STEP_EXECUTED")
		observer.ObserveActionUse(process, "STEP_EXECUTED", nil, nil)
		if process.Definition().Steps[process.StepIndex()].StepType == "CHARGE" {
			s.actions.SetChargeDuration(action, now-process.StepStartedAtMs())
		}
	case "STEP_COMPLETE":
		s.actions.RecordUse(action, "STEP_COMPLETED")
		observer.ObserveActionUse(process, "STEP_COMPLETED", nil, nil)
	}
	for _, hit := range action.Binding().HitBindings {
		if !actionpkg.MomentMatches(hit.Moment, kind, process.StepKey(), "") {
			continue
		}
		released := action.HasRequiredHitContact(hit)
		if process.HasSkillHitStages() {
			s.actions.AppendSkillHitStage(process, model.ProcessSkillHitStage{HitBindingKey: hit.HitBindingKey, StepKey: process.StepKey(), TimeMs: now, Released: released})
		}
		if released {
			s.actions.RecordUse(action, "RELEASED")
			observer.ObserveActionUse(process, "RELEASED", nil, nil)
		}
	}
	if kind == "PROCESS_COMPLETE" && len(action.Binding().HitBindings) == 0 {
		s.actions.RecordUse(action, "RELEASED")
		observer.ObserveActionUse(process, "RELEASED", nil, nil)
	}
}

func (s SkillActionExecutor) RecordUse(process *actionpkg.ProcessView, kind string, hit, reason *string, now int64, records SkillUseRecords) {
	action := s.actions.ActionForUse(process.UseKey())
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() || action.AutomaticRule() != nil {
		return
	}
	if records.BeginActionUseRecord() {
		use, instruction := process.UseKey(), action.Plan().InstructionKey()
		if (kind == "RELEASED" || kind == "HIT") && process.CastUseKey() != "" {
			use = process.CastUseKey()
			if cast := records.ActionForKnownUse(use); cast != nil {
				instruction = cast.Plan().InstructionKey()
			}
		}
		target := process.Target()
		if process.EmpoweredAttack() != nil {
			target = process.EmpoweredAttack().Target
		}
		records.AppendActionUseRecord(model.SkillUseRecord{EmpoweredAttack: process.EmpoweredAttack(), StepKey: process.StepKey(), StepVersion: process.StepVersion(), ExecutionIndex: process.StepExecutionIndex(), InstructionKey: instruction, TimeMs: now, Kind: kind, Source: process.Owner(), Target: target, SkillKey: process.SkillKey(), ProviderRef: process.ProviderRef(), ProcessKey: process.ProcessKey(), UseRef: use, HitRef: hit, Reason: reason})
	}
}

func (s SkillActionExecutor) ResolveMoment(process *actionpkg.ProcessView, kind string, phases SkillHitPhases) *model.EngineError {
	action := s.actions.ActionForUse(process.UseKey())
	if action != nil && action.Binding().HasEmpoweredAttack {
		return nil
	}
	if action == nil || !action.Accepted() || process.UseKey() != action.UseRef() || process.Status() == "failed" || process.Owner() != action.Plan().Source() || process.ProviderRef() != action.Binding().ProviderRef || process.ProcessKey() != action.Binding().Controls[0].ProcessKey || s.actions.Dead(process.Owner()) || s.actions.Dead(process.Target()) || !phases.SkillHitActorsAlive(process.Owner(), process.Target()) {
		return nil
	}
	for index, hit := range action.Binding().HitBindings {
		if !actionpkg.MomentMatches(hit.Moment, kind, process.StepKey(), "") {
			continue
		}
		if !action.HasRequiredHitContact(hit) {
			s.actions.CompleteSkillHitStage(process, hit.HitBindingKey, false, true)
			continue
		}
		miss := false
		for presetIndex := 0; presetIndex < action.Plan().HitCount(); presetIndex++ {
			preset := action.Plan().HitAt(presetIndex)
			if preset.HitBindingKey == hit.HitBindingKey {
				miss = preset.Preset == "MISS"
			}
		}
		if miss {
			s.actions.CompleteSkillHitStage(process, hit.HitBindingKey, false, true)
			continue
		}
		s.actions.BeginHit(action)
		before := action.Uses().HitCount
		err := phases.ExecutePlannedHit(process, action, hit, action.NextHitSequence())
		contact := action.Uses().HitCount > before
		s.actions.CompleteSkillHitStage(process, hit.HitBindingKey, contact, err == nil)
		if err != nil {
			return err
		}
		if contact {
			s.actions.CommitHitContact(action, index)
		}
	}
	return nil
}

func (s SkillActionExecutor) RecordCommittedHit(key string, actual *actionpkg.UseView, hitFact CommittedSkillHit, observer SkillActionObserver) {
	var process *actionpkg.ProcessView
	if actual != nil {
		process = s.actions.Process(actual.ProcessReference())
	}
	action := s.actions.ActionForUse(key)
	if process != nil {
		action = s.actions.ActionForUse(process.UseKey())
	}
	if action == nil || !action.Accepted() {
		return
	}
	if process != nil && hitFact.HasSequence && hitFact.Sequence > 0 && hitFact.OccurrenceID > 0 {
		s.actions.RecordSkillHitContact(process, hitFact.TimeMs, hitFact.Sequence, hitFact.OccurrenceID, hitFact.Blocked)
	}
	s.actions.RecordUse(action, "HIT")
	for index := 0; index < s.actions.ProcessCount(); index++ {
		process := s.actions.ProcessAt(index)
		if process.UseKey() == action.UseRef() {
			hit := "hit:" + strconv.FormatUint(hitFact.OccurrenceID, 10)
			observer.ObserveActionUse(process, "HIT", &hit, nil)
			return
		}
	}
}
