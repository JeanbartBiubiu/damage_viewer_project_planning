package hit

import (
	"math"
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// NativePrimaryInput 只借用原生主体的编译计划和已解析的真实来源，不读取其他行动状态。
type NativePrimaryInput struct {
	Plan                     *planbundle.CompiledSkillHit
	Bindings                 []planbundle.CompiledSkillActionBinding
	Owner, Provider          string
	Definition               string
	StartAbilityRef          string
	InitialControlAbilityRef string
	HitAbilityRef            string
}

// NativePrimary 是经命中规则核对后的原生主体绑定，发布仍由行动所有者完成。
type NativePrimary struct {
	Plan      *planbundle.CompiledSkillHit
	Candidate int
	Identity  model.BasicAttackPrimaryIdentity
}

// NativePrimaryHost 仅查询替换绑定的来源是否属于当前真实技能计划。
type NativePrimaryHost interface {
	// PlannedPrimaryProvider 查询给定挂载的计划身份，不执行或改变行动。
	PlannedPrimaryProvider(owner, provider string) bool
}

// PrimaryBinding 是原生普攻主体实际绑定的有限只读投影。
type PrimaryBinding struct {
	Present, Mounted                     bool
	Plan                                 *planbundle.CompiledSkillHit
	Candidate                            int
	HitAbilityRef, Source, Target, Skill string
	Identity                             *model.BasicAttackPrimaryIdentity
}

// PrimarySelectionHost 只读取当前存活挂载及原激活使用，不执行普攻或过程。
type PrimarySelectionHost interface {
	// EmpoweredOwnerLive 查询当前拥有者存活和实际挂载。
	EmpoweredOwnerLive(owner, provider string, definition uint16) bool
}

// PrimaryReplacementHost 按原顺序读取已选等待所需的真实主体和激活历史。
type PrimaryReplacementHost interface {
	PrimarySelectionHost
	// PrimaryNativeBinding 只在已有替换等待时读取原生主体及其实际挂载，返回本次同步独占的身份值。
	PrimaryNativeBinding(source string, definition uint16) PrimaryBinding
	// PrimaryActivationHistory 返回选中过程实际激活使用的有限历史。
	PrimaryActivationHistory(use string) ActivationHistory
}

// PrimaryReplacementInput 描述原命中主体位置的替换请求，不提前创建真实帧。
type PrimaryReplacementInput struct {
	Context                   *Context
	Candidate                 int
	EventType, Source, Target string
	NowMs                     int64
}

// PrimaryReplacement 保存已核对资格的原过程暂存及其真实双使用关联。
type PrimaryReplacement struct {
	Original    *actionpkg.ProcessView
	Changes     *actionpkg.ProcessChangeSet
	Association *model.ProcessEmpoweredAttack
}

// PrimaryPayloadHost 交接主体替换共享帧中原负载伤害统计的准确范围。
type PrimaryPayloadHost[Event, Binding any] interface {
	ProcessMomentHost[Binding]
	// EmpoweredPayload 在同一共享帧执行本次实际替换负载。
	EmpoweredPayload(event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility) *model.EngineError
	// PrimaryDamageStart 返回执行负载前已有伤害事实数，不从数值汇总反推。
	PrimaryDamageStart() int
	// StagePrimaryPayload 只依据该次负载实际产生的事实暂存主体替换统计。
	StagePrimaryPayload(process *actionpkg.ProcessView, payload planbundle.CompiledAbility, association *model.ProcessEmpoweredAttack, start int) *model.EngineError
}

// PrimaryExecutionHost 仅追加真实替换负载的伤害事件，不提交或立即派发。
type PrimaryExecutionHost[Event, Binding any] interface {
	PrimaryPayloadHost[Event, Binding]
	// QueuePrimaryDamage 在原帧重新绑定真实负载并追加已确定资格的伤害事实，返回前恢复外层求值范围。
	QueuePrimaryDamage(event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload, parent planbundle.CompiledAbility, rootDamage bool)
}

// PrepareNativePrimary 校验显式主体要求及候选角色，然后构造完整主体身份，不发布绑定。
func PrepareNativePrimary(input NativePrimaryInput, host NativePrimaryHost, identity Identity) (NativePrimary, bool, *model.EngineError) {
	if input.Plan == nil {
		return NativePrimary{}, false, hitError(identity, model.GenericErrRuntimeInvariantFailed, "native hit requires its complete hit plan", "driverPlan.basicAttack", "")
	}
	if input.Plan.PrimaryCandidate < 0 {
		for _, binding := range input.Bindings {
			if binding.ReplacesPrimary && host.PlannedPrimaryProvider(binding.Source, binding.ProviderRef) {
				return NativePrimary{}, false, hitError(identity, model.GenericErrRuntimeInvariantFailed, "primary replacement requires one explicitly marked native primary", "driverPlan.basicAttack.hitAbilityRef", "")
			}
		}
		return NativePrimary{}, false, nil
	}
	index := input.Plan.PrimaryCandidate
	if index >= len(input.Plan.Candidates) || input.Plan.Candidates[index].AttackDamageRole != planbundle.AttackDamageRolePrimary {
		return NativePrimary{}, false, hitError(identity, model.GenericErrRuntimeInvariantFailed, "invalid compiled primary binding", "driverPlan.basicAttack.hitAbilityRef", "")
	}
	candidate := input.Plan.Candidates[index]
	return NativePrimary{Plan: input.Plan, Candidate: index, Identity: model.BasicAttackPrimaryIdentity{
		Owner: input.Owner, ProviderRef: input.Provider, DefinitionRef: input.Definition, StartAbilityRef: input.StartAbilityRef,
		InitialControlAbilityRef: input.InitialControlAbilityRef, HitAbilityRef: input.HitAbilityRef,
		CandidateKey: candidate.CandidateKey, EffectOccurrenceKey: candidate.EffectOccurrenceKey, EffectKey: candidate.EffectKey, ResultKey: candidate.ResultKey,
	}}, true, nil
}

// PreparePrimaryReplacement 依次核对冻结等待、真实主体及激活历史，成功后才暂存过程和替换关联。
func PreparePrimaryReplacement(input PrimaryReplacementInput, host PrimaryReplacementHost, identity Identity) (PrimaryReplacement, *model.EngineError) {
	chosen, found, multiple := SelectPrimaryWait(input.Context.empoweredWaits, input.Source, input.NowMs, host)
	if multiple {
		return PrimaryReplacement{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "multiple live primary replacements have no nominated priority", "skillActions", "")
	}
	if !found {
		return PrimaryReplacement{}, nil
	}
	binding := host.PrimaryNativeBinding(input.Source, input.Context.ability.ProviderIndex)
	if !NativePrimaryMatches(input.Context, input.Candidate, input.EventType, input.Source, input.Target, binding) {
		return PrimaryReplacement{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "primary replacement requires the actual complete native attack binding", "driverPlan.basicAttack", "")
	}
	original := chosen.Instance
	if !CompleteActivationHistory(original, host.PrimaryActivationHistory(original.UseKey())) {
		return PrimaryReplacement{}, hitError(identity, model.GenericErrRuntimeInvariantFailed, "primary replacement requires its real complete activation history", "skillUses", original.UseKey())
	}
	changes := actionpkg.StageProcess(original)
	facts := &input.Context.facts
	association := &model.ProcessEmpoweredAttack{UseRef: facts.UseRef, HitRef: "hit:" + strconv.FormatUint(facts.OccurrenceID, 10), Target: input.Target, ReplacedPrimary: binding.Identity}
	changes.SetEmpoweredAttack(association)
	return PrimaryReplacement{Original: original, Changes: changes, Association: association}, nil
}

// ExecutePrimaryReplacement 执行真实替换后暂存过程和接触事实，最后仅为实际负载追加原命中伤害事件资格。
func ExecutePrimaryReplacement[Event, Binding any](frame *Frame, event Event, context *Context, prepared PrimaryReplacement, payload planbundle.CompiledAbility, nowMs int64, host PrimaryExecutionHost[Event, Binding]) *model.EngineError {
	if err := ExecutePrimaryPayload(event, prepared.Changes, prepared.Association, payload, nowMs, host); err != nil {
		return err
	}
	p := prepared.Changes.View()
	frame.StageMutation(prepared.Original, prepared.Changes)
	frame.StageContact(p, *prepared.Association)
	frame.StageFinished(p)
	host.QueuePrimaryDamage(event, prepared.Changes, prepared.Association, payload, context.ability, context.facts.RootDamageEvent)
	return nil
}

// ExecutePrimaryPayload 在原生主体位置执行完整替换时点与负载，不提交或安排另一刀。
func ExecutePrimaryPayload[Event, Binding any](event Event, changes *actionpkg.ProcessChangeSet, association *model.ProcessEmpoweredAttack, payload planbundle.CompiledAbility, nowMs int64, host PrimaryPayloadHost[Event, Binding]) *model.EngineError {
	binding := host.BeginEmpoweredProcess(changes, association.Target, association)
	defer host.EndEmpoweredProcess(binding)
	if err := host.EmpoweredProcessMoment(changes, association.Target, association, "STEP_EXECUTION"); err != nil {
		return err
	}
	start := host.PrimaryDamageStart()
	if err := host.EmpoweredPayload(event, changes, association, payload); err != nil {
		return err
	}
	if err := host.StagePrimaryPayload(changes.View(), payload, association, start); err != nil {
		return err
	}
	if err := host.EmpoweredProcessMoment(changes, association.Target, association, "STEP_COMPLETE"); err != nil {
		return err
	}
	changes.Finish("complete", "", nowMs)
	return host.EmpoweredProcessMoment(changes, association.Target, association, "PROCESS_COMPLETE")
}

// SelectPrimaryWait 在真实主体尝试时重新核对全部冻结等待，不指定新的优先级。
func SelectPrimaryWait(waits []EmpoweredWait, owner string, nowMs int64, host PrimarySelectionHost) (EmpoweredWait, bool, bool) {
	var selected EmpoweredWait
	found := false
	for _, wait := range waits {
		p := wait.Instance
		if p == nil || !p.ReplacesPrimary() || !WaitCurrent(wait, owner, nowMs, host.EmpoweredOwnerLive(p.Owner(), p.ProviderRef(), p.Ability().ProviderIndex)) {
			continue
		}
		if found {
			return EmpoweredWait{}, false, true
		}
		selected, found = wait, true
	}
	return selected, found, false
}

// NativePrimaryMatches 核对替换来自当前选定原生普攻的同一个命中主体。
func NativePrimaryMatches(context *Context, candidate int, eventType, source, target string, binding PrimaryBinding) bool {
	facts := context.facts
	return binding.Present && binding.Mounted && binding.Plan == context.plan && binding.Candidate == candidate &&
		eventType == model.EventTypeBasicAttackHit && context.ability.IsBasicAttack && context.abilityRef == binding.HitAbilityRef &&
		facts.SourceKey == binding.Source && facts.TargetKey == binding.Target && source == binding.Source && target == binding.Target &&
		facts.SkillKey == binding.Skill && facts.UseRef != ""
}

// CompleteActivationHistory 核对强化实际激活的完整历史，不替代普攻使用或另登记身份。
func CompleteActivationHistory(process *actionpkg.ProcessView, history ActivationHistory) bool {
	return history.Present && history.Source == process.Owner() && history.SkillKey == process.SkillKey() &&
		history.State == model.SkillHitHistoryComplete && history.Contacts < MaxHistoryContacts
}

// PrimaryReplacementRow 从本次实际负载伤害生成主体替换事实；不从报告明细反推。
func PrimaryReplacementRow(process *actionpkg.ProcessView, payload planbundle.CompiledAbility, definitionRef string, association *model.ProcessEmpoweredAttack, blocked bool, damages []contract.DamageFact) *model.BasicAttackPrimaryReplacement {
	row := &model.BasicAttackPrimaryReplacement{Primary: *association.ReplacedPrimary,
		Replacement: model.BasicAttackReplacementIdentity{Owner: process.Owner(), ProviderRef: process.ProviderRef(),
			DefinitionRef: definitionRef, SkillKey: process.SkillKey(), ProcessKey: process.ProcessKey(),
			HitAbilityRef: process.Owner() + ".provider[" + process.ProviderRef() + "].ability[" + payload.AbilityKey + "]"},
		Target: association.Target, Count: 1}
	if blocked {
		row.BlockedCount = 1
	}
	for _, damage := range damages {
		if damage.EmpoweredAttack != association || damage.AbilityRef != row.Replacement.HitAbilityRef || damage.Outcome == nil {
			continue
		}
		row.PostDefenseDamage += damage.Outcome.MitigatedAmount
		row.ShieldAbsorbed += damage.Outcome.ShieldAbsorbed
		row.ActualHpLoss += damage.Outcome.HPDamage
	}
	return row
}

// PrimaryReplacementFinite 保留实际累计发布前的有限数校验，不修改已有累计。
func PrimaryReplacementFinite(previous, next model.BasicAttackPrimaryReplacement) bool {
	for _, value := range []float64{previous.PostDefenseDamage + next.PostDefenseDamage, previous.ShieldAbsorbed + next.ShieldAbsorbed, previous.ActualHpLoss + next.ActualHpLoss} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

// StagePrimaryReplacement 根据本次负载实际伤害核对原累计并暂存记录，不发布或读取报告明细。
func StagePrimaryReplacement(frame *Frame, process *actionpkg.ProcessView, payload planbundle.CompiledAbility, definitionRef string, association *model.ProcessEmpoweredAttack, damages []contract.DamageFact, previous model.BasicAttackPrimaryReplacement, exists bool, identity Identity) *model.EngineError {
	row := PrimaryReplacementRow(process, payload, definitionRef, association, frame.PrimaryBlocked(), damages)
	if exists && !PrimaryReplacementFinite(previous, *row) {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "primary replacement aggregate must remain finite", "basicAttack.primaryReplacements", "")
	}
	frame.StagePrimary(row, process.PrimaryReplacementBinding())
	return nil
}
