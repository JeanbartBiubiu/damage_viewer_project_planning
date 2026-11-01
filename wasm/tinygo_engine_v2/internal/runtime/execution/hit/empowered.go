package hit

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// AttachedPayload 描述当前真实强化暂存所需的有限身份和只读编译绑定。
type AttachedPayload struct {
	OccurrenceID           uint64
	ParentRoot             bool
	RootDamage             bool
	UseKey                 string
	SkillKey               string
	Owner                  string
	Target                 string
	PriorQualifiedContacts int
	Ability                planbundle.CompiledAbility
	Plan                   *planbundle.CompiledSkillHit
	AbilityRef             string
	ReplacesPrimary        bool
	Identity               Identity
}

// AttachedPayloadHost 交接当前共享帧的求值、暂存操作与阻挡后的跨监听阶段。
type AttachedPayloadHost interface {
	SelectionHost
	AttachedFrameHost
	// AttachedSpellShields 读取当前共享暂存内仍可消费且未被此前负载认领的盾。
	AttachedSpellShields(target string) (effectpkg.ProviderList, *model.EngineError)
	// BindAttachedHit 将本负载有限事实与真实使用绑定当前同步求值范围，不发布事件。
	BindAttachedHit(context *Context)
	// FinishAttachedHit 清除当前候选阻挡写入标记，不恢复或发布其他状态。
	FinishAttachedHit()
	// AttachedBlocked 在同一帧认领原盾，并由根层同步交接原盾自己的消费监听。
	AttachedBlocked(context *Context, replacesPrimary bool) *model.EngineError
}

// ActivationHistory 是当前已登记真实使用的有限历史事实。
type ActivationHistory struct {
	Present                 bool
	Source, SkillKey, State string
	Contacts                int
}

// EmpoweredGroupInput 保存原普攻命中和当前时点，不携带可写行动或数值状态。
type EmpoweredGroupInput struct {
	Source, Target, UseRef string
	OccurrenceID           uint64
	NowMs                  int64
	Abilities              []planbundle.CompiledAbility
}

// ProcessMomentHost 只交接当前共享帧中的原过程时点与有限求值绑定。
type ProcessMomentHost[Binding any] interface {
	// BeginEmpoweredProcess 进入本过程的有限同步求值范围，返回只属于此调用的恢复凭据。
	BeginEmpoweredProcess(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack) Binding
	// EndEmpoweredProcess 记录本范围的实际输出并用原凭据恢复调用者绑定，不撤销共享暂存。
	EndEmpoweredProcess(binding Binding)
	// EmpoweredProcessMoment 在共享暂存中同步执行指定原过程时点。
	EmpoweredProcessMoment(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack, kind string) *model.EngineError
}

// EmpoweredFailureHost 只交接当前共享帧的失败时点及其有限求值范围。
type EmpoweredFailureHost[Binding any] interface {
	// BeginEmpoweredProcess 绑定本次独占暂存，返回当前调用的恢复凭据。
	BeginEmpoweredProcess(changes *actionpkg.ProcessChangeSet, target string, association *model.ProcessEmpoweredAttack) Binding
	// EndEmpoweredProcess 恢复原绑定并登记本范围实际产生的输出，不撤销共享暂存。
	EndEmpoweredProcess(binding Binding)
	// EmpoweredFailureMoment 在原位置执行已经确定的失败时点和原因。
	EmpoweredFailureMoment(changes *actionpkg.ProcessChangeSet, reason string) *model.EngineError
}

// EmpoweredGroupHost 只交接强化时点、当前帧操作与原有提交，遍历和完成规则归命中。
type EmpoweredGroupHost[Event, Binding any] interface {
	ProcessMomentHost[Binding]
	// EmpoweredOwnerLive 查询拥有者存活与实际挂载，不缓存子调用之前的资格。
	EmpoweredOwnerLive(owner, provider string, definition uint16) bool
	// EmpoweredActivationHistory 返回原激活使用的真实登记身份和已发生接触数。
	EmpoweredActivationHistory(use string) ActivationHistory
	// EmpoweredPayload 在同一帧的实际命中目标执行负载，完成后恢复外层求值绑定。
	EmpoweredPayload(event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility) *model.EngineError
	// StageEmpoweredResult 追加本次已完成过程的提交事实，不立即发布。
	StageEmpoweredResult(original *actionpkg.ProcessView, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack)
	// CommitEmpoweredGroup 统一发布共享强化帧及其尾部；未暂存过程时不提交空帧。
	CommitEmpoweredGroup() *model.EngineError
	// EmpoweredFinishedCount 返回当前组已暂存完成的过程数。
	EmpoweredFinishedCount() int
	// EmpoweredFinishedAt 借用本组指定完成过程，只用于当前同步尾部。
	EmpoweredFinishedAt(index int) *actionpkg.ProcessView
	// ResolveEmpoweredProcess 发布该过程真实目标的解决事实，并保留过程失败。
	ResolveEmpoweredProcess(process *actionpkg.ProcessView) *model.EngineError
	// EmpoweredGroupFailure 在原有全部解决事实发布之后返回本场已经保留的过程错误。
	EmpoweredGroupFailure() *model.EngineError
	// EmpoweredExecutionError 返回原过程错误，不修改状态。
	EmpoweredExecutionError(path, message, use string) *model.EngineError
}

// WaitCurrent 核对原命中入口捕获的实例、版本及期限；实际拥有者资格由调用方实时提供。
func WaitCurrent(wait EmpoweredWait, owner string, nowMs int64, ownerLive bool) bool {
	p := wait.Instance
	return p != nil && p.Owner() == owner && p.UseKey() == wait.UseKey && p.StepVersion() == wait.Version &&
		p.Status() == "active" && p.StepExecutionIndex() == 0 && p.HasExpiry() && p.Expiry() == wait.Expires && nowMs < wait.Expires && ownerLive
}

// StageEmpoweredFailure 暂存事件中断失败并执行原失败时点，成功后才登记本组失败事实。
func StageEmpoweredFailure[Binding any](frame *Frame, original *actionpkg.ProcessView, nowMs int64, host EmpoweredFailureHost[Binding]) *model.EngineError {
	changes := actionpkg.StageProcess(original)
	p := changes.View()
	reason := "EVENT_ABORTED"
	changes.Finish("failed", reason, nowMs)
	binding := host.BeginEmpoweredProcess(changes, p.Target(), nil)
	err := host.EmpoweredFailureMoment(changes, reason)
	host.EndEmpoweredProcess(binding)
	if err != nil {
		return err
	}
	frame.StageMutation(original, changes)
	frame.StageFinished(p)
	return nil
}

// CompleteEmpoweredProcess 执行原三个过程时点与实际负载，完成标记仍在最后时点之前暂存。
func CompleteEmpoweredProcess[Event, Binding any](event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility, nowMs int64, host EmpoweredGroupHost[Event, Binding]) *model.EngineError {
	binding := host.BeginEmpoweredProcess(changes, association.Target, association)
	defer host.EndEmpoweredProcess(binding)
	if err := host.EmpoweredProcessMoment(changes, association.Target, association, "STEP_EXECUTION"); err != nil {
		return err
	}
	if err := host.EmpoweredPayload(event, changes, association, payload); err != nil {
		return err
	}
	if err := host.EmpoweredProcessMoment(changes, association.Target, association, "STEP_COMPLETE"); err != nil {
		return err
	}
	changes.Finish("complete", "", nowMs)
	return host.EmpoweredProcessMoment(changes, association.Target, association, "PROCESS_COMPLETE")
}

// ExecuteEmpoweredGroup 按命中入口冻结顺序复查每个等待，在同一真实帧完成全部合法附加结果。
func ExecuteEmpoweredGroup[Event, Binding any](input EmpoweredGroupInput, waits []EmpoweredWait, event Event, host EmpoweredGroupHost[Event, Binding]) *model.EngineError {
	for _, wait := range waits {
		p := wait.Instance
		if p == nil || p.ReplacesPrimary() || !WaitCurrent(wait, input.Source, input.NowMs, host.EmpoweredOwnerLive(p.Owner(), p.ProviderRef(), p.Ability().ProviderIndex)) {
			continue
		}
		history := host.EmpoweredActivationHistory(p.UseKey())
		if !history.Present || history.Source != p.Owner() || history.SkillKey != p.SkillKey() || history.State != model.SkillHitHistoryComplete || history.Contacts >= MaxHistoryContacts {
			return host.EmpoweredExecutionError("skillUses", "empowered activation requires its real complete contact history", p.UseKey())
		}
		changes := actionpkg.StageProcess(p)
		association := &model.ProcessEmpoweredAttack{UseRef: input.UseRef, HitRef: "hit:" + strconv.FormatUint(input.OccurrenceID, 10), Target: input.Target}
		changes.SetEmpoweredAttack(association)
		payload := input.Abilities[changes.View().EmpoweredAbilityIndex()]
		if err := CompleteEmpoweredProcess(event, changes, association, payload, input.NowMs, host); err != nil {
			return err
		}
		host.StageEmpoweredResult(p, changes, association)
	}
	if host.EmpoweredFinishedCount() == 0 {
		return nil
	}
	if err := host.CommitEmpoweredGroup(); err != nil {
		return err
	}
	for index := 0; index < host.EmpoweredFinishedCount(); index++ {
		p := host.EmpoweredFinishedAt(index)
		if err := host.ResolveEmpoweredProcess(p.WithTarget(p.EmpoweredAttack().Target)); err != nil {
			return err
		}
	}
	return host.EmpoweredGroupFailure()
}

// ExecuteAttachedPayload 在当前共享帧完成强化候选选择、判盾与实际负载执行。
func ExecuteAttachedPayload(input AttachedPayload, host AttachedPayloadHost) *model.EngineError {
	first := float64(1)
	if input.PriorQualifiedContacts > 0 {
		first = 0
	}
	selected, err := SelectCandidates(input.Plan, input.Ability, input.Owner, true, first, host)
	if err != nil {
		return err
	}
	unit, hasUnit, err := FormBlockUnit(input.Plan, selected, input.OccurrenceID, input.UseKey, input.Identity)
	if err != nil {
		return err
	}
	facts := Facts{OccurrenceID: input.OccurrenceID, UseRef: input.UseKey, SkillKey: input.SkillKey, SourceKey: input.Owner,
		TargetKey: input.Target, HasFirstContact: true, FirstContact: first}
	if hasUnit {
		facts.UnitScope, facts.EffectOccurrenceKey, facts.ResultKey, facts.CandidateKey = unit.Scope, unit.EffectOccurrenceKey, unit.ResultKey, unit.CandidateKey
		shields, err := host.AttachedSpellShields(input.Target)
		if err != nil {
			return err
		}
		if shields.Len() > 1 {
			return host.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "multiple active spell shields have no nominated priority", "providers", input.Target)
		}
		if shields.Len() == 1 {
			shield := shields.At(0)
			facts.Blocked = 1
			facts.ShieldOwner, facts.ShieldProviderRef, facts.ShieldDefinitionRef, facts.ShieldSource = shield.Owner, shield.ProviderRef, shield.DefinitionRef, shield.Source
		}
	}
	context := NewContext(ContextSeed{Facts: facts, Ability: input.Ability, Plan: input.Plan, AbilityRef: input.AbilityRef})
	if err := context.FreezeAttachedCandidates(selected, host); err != nil {
		return err
	}
	host.BindAttachedHit(context)
	rootDamage := input.RootDamage
	if input.ReplacesPrimary {
		rootDamage = input.ParentRoot
	}
	if err := ExecuteAttachedCandidates(context, rootDamage, host); err != nil {
		return err
	}
	host.FinishAttachedHit()
	if facts.Blocked == 1 {
		return host.AttachedBlocked(context, input.ReplacesPrimary)
	}
	return nil
}
