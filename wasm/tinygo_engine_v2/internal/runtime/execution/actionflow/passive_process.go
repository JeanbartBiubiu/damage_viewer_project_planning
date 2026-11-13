package actionflow

import (
	"strconv"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
)

// PassiveProcessStart只交接当前原生命中和实际挂载，不保存事件大快照。
type PassiveProcessStart struct {
	Owner, Target, Provider, AbilityRef string
	Now                                 int64
	Ordinal                             int
	MountedListener                     bool
	Event                               *contract.EventSnapshot
	OriginAbility                       planbundle.CompiledAbility
}

type PassiveProcessStartsAPI interface {
	// Append接收已核定的新过程，借用至当前帧统一发布；失败帧丢弃全部未发布项。
	Append(process *actionpkg.ProcessView)
	// Len返回当前帧预约数，供同一实例和队列预算预检。
	Len() int
	// At按原操作顺序借用已核定过程，仅供统一发布和入队。
	At(index int) *actionpkg.ProcessView
}

// PassiveProcessStarts由原操作帧独占；仅保存未发布过程，不持有队列。
type PassiveProcessStarts struct{ processes []*actionpkg.ProcessView }

var _ PassiveProcessStartsAPI = (*PassiveProcessStarts)(nil)

func (p *PassiveProcessStarts) Append(process *actionpkg.ProcessView) {
	p.processes = append(p.processes, process)
}
func (p *PassiveProcessStarts) Len() int                            { return len(p.processes) }
func (p *PassiveProcessStarts) At(index int) *actionpkg.ProcessView { return p.processes[index] }

func (s ProcessExecutor) PreparePassiveProcess(input PassiveProcessStart, ability planbundle.CompiledAbility, operation planbundle.CompiledOperation, providers []planbundle.CompiledProvider, reads NativeProcessReads) (*actionpkg.ProcessView, *model.EngineError) {
	bad := func(message string) (*actionpkg.ProcessView, *model.EngineError) {
		return nil, s.error(operation.Path, message, input.AbilityRef)
	}
	event := input.Event
	if !input.MountedListener || event == nil || event.EventType != model.EventTypeSkillHit || !event.HasUse || !event.HasSkillHit || event.SkillHit == nil || ability.Kind != "passive_listener" || ability.ProcessControl != nil || operation.OwnerProviderIndex != int(ability.ProviderIndex) {
		return bad("passive process requires its real owned native skill-hit listener frame")
	}
	hit := event.SkillHit
	parsed, good := planbundle.ParseAbilityRef(input.AbilityRef)
	hitRef, hitGood := planbundle.ParseAbilityRef(hit.AbilityRef)
	use := reads.NativeProcessUse(event.UseKey)
	if !good || !hitGood || !hit.HasPlan || hit.IsBasicAttack || hit.OccurrenceID == 0 || hit.HitSequence == nil || *hit.HitSequence < 1 ||
		use == nil || event.EventSourceKey != input.Owner || event.EventTargetKey != input.Target || event.UseSource != input.Owner ||
		parsed.Combatant != input.Owner || parsed.ProviderRef != input.Provider || hitRef.Combatant != input.Owner ||
		hit.SourceKey != input.Owner || hit.TargetKey != input.Target || hit.UseRef != event.UseKey || hit.SkillKey != event.UseSkillKey ||
		use.Source() != input.Owner || use.SkillKey() != event.UseSkillKey || !input.OriginAbility.HasSkillHit || input.OriginAbility.IsBasicAttack || input.OriginAbility.SkillKey != event.UseSkillKey ||
		!reads.NativeProcessMounted(input.Owner, hitRef.ProviderRef, input.OriginAbility.ProviderIndex) || !reads.NativeProcessMounted(input.Owner, input.Provider, ability.ProviderIndex) {
		return bad("passive process requires complete live source, target, provider, original use and actual hit identity")
	}
	if hit.Blocked != 0 {
		return nil, nil
	}
	if int(ability.ProviderIndex) >= len(providers) || operation.PassiveProcessIndex < 0 || operation.PassiveProcessIndex >= len(providers[ability.ProviderIndex].Processes) {
		return bad("passive process compiled reference is out of range")
	}
	definition := &providers[ability.ProviderIndex].Processes[operation.PassiveProcessIndex]
	if definition.EntryKind != model.ProcessEntrySkillHitPassive || definition.SkillKey != ability.SkillKey || definition.InitialAbilityIndex >= 0 {
		return bad("passive process reference must retain its own compiled entry and skill")
	}
	if reads.NativeProcessDead(input.Owner) || reads.NativeProcessDead(input.Target) {
		return nil, nil
	}
	useKey := "passive:" + strconv.Itoa(input.Ordinal) + ":" + input.Owner + ":" + input.Provider + ":" + definition.ProcessKey
	for i := 0; i < s.actions.ProcessCount(); i++ {
		if s.actions.ProcessAt(i).UseKey() == useKey {
			return bad("passive process instance identity conflicts with a prior instance")
		}
	}
	origin := &model.PassiveProcessOrigin{UseSource: event.UseSource, UseKey: event.UseKey, UseSkillKey: event.UseSkillKey,
		HitAbilityRef: hit.AbilityRef, HitSequence: *hit.HitSequence, HitOccurrenceID: hit.OccurrenceID}
	return actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: input.Owner, Target: input.Target,
		ProviderRef: input.Provider, ProcessKey: definition.ProcessKey, SkillKey: definition.SkillKey, UseKey: useKey, PassiveOrigin: origin,
		StartedAtMs: input.Now, StepStartedAtMs: input.Now, AdvanceAtMs: input.Now, Status: "active", ActualCosts: map[string]float64{}, ActionOccupancies: []model.ProcessActionOccupancy{}},
		Definition: definition, Ability: ability, AbilityRef: input.AbilityRef, StepIndex: -1, CastID: use.CastID(), CastUseKey: event.UseKey}), nil
}
