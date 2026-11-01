package actionflow

import (
	"strconv"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessInitialInput 保留原过程行、驱动和控制事实的有限初始化输入。
type ProcessInitialInput struct {
	Rows         []model.ProcessInstanceSnapshot
	Entries      []model.DriverEntry
	Commands     []model.ProcessCommandFact
	Start, Now   int64
	MaxInstances int
}

// ProcessInitialChecks 只交接原初始能力、实际双方和已核定恢复计时请求。
type ProcessInitialChecks interface {
	// InitialProcessAbility 按原驱动规则读取实际过程控制和完整能力引用。
	InitialProcessAbility(entry model.DriverEntry) (planbundle.CompiledAbility, string, bool)
	// InitialProcessActor 解析并核对原驱动的真实拥有者及目标。
	InitialProcessActor(selector, source string) (string, bool)
	// QueueRestoredProcess 在原初始化成功位置向唯一队列写入已核定的实际计时。
	QueueRestoredProcess(process *actionpkg.ProcessView) *model.EngineError
}

func (s ProcessExecutor) Initialize(input ProcessInitialInput, plan ProcessRestorePlan, restore ProcessRestoreFacts, checks ProcessInitialChecks) *model.EngineError {
	s.actions.InitProcessFacts()
	hasProcess := len(input.Rows) > 0 || len(input.Commands) > 0
	if !hasProcess {
		for _, ability := range plan.Abilities {
			if ability.ProcessControl != nil && ability.ProcessControl.UseRefFromEvent {
				hasProcess = true
				break
			}
		}
	}
	if !hasProcess {
		for _, entry := range input.Entries {
			ability, _, ok := checks.InitialProcessAbility(entry)
			if ok && ability.ProcessControl != nil {
				hasProcess = true
				break
			}
		}
	}
	if hasProcess {
		for _, entry := range input.Entries {
			if entry.FirstAtMs < input.Start {
				return s.error("driverPlan.entries["+entry.EntryKey+"].firstAtMs", "driver in a process run cannot precede the initial snapshot", entry.AbilityRef)
			}
		}
	}
	if len(input.Rows) > input.MaxInstances {
		return s.error("initialSnapshot.processInstances", "process instance budget exceeded", "")
	}
	seenUses := map[string]bool{}
	active := map[string]bool{}
	for i, row := range input.Rows {
		path := "initialSnapshot.processInstances[" + strconv.Itoa(i) + "]"
		p, err := s.Restore(row, path, input.Now, plan, restore)
		if err != nil {
			return err
		}
		if seenUses[row.UseKey] {
			return s.error(path+".useKey", "duplicate successful process use", row.UseKey)
		}
		seenUses[row.UseKey] = true
		if row.Status == "active" {
			key := p.MountKey()
			if active[key] {
				return s.error(path, "multiple active instances on one mounted process", row.ProcessKey)
			}
			active[key] = true
		}
		s.actions.AddProcess(p)
	}
	entries := map[string]int{}
	controls := map[string]int{}
	for i, entry := range input.Entries {
		if _, exists := entries[entry.EntryKey]; exists && (len(input.Commands) > 0 || s.actions.ProcessCount() > 0) {
			return s.error("driverPlan.entries", "duplicate driver entryKey", entry.EntryKey)
		}
		entries[entry.EntryKey] = i
		ability, ref, ok := checks.InitialProcessAbility(entry)
		if !ok || ability.ProcessControl == nil {
			continue
		}
		path := "driverPlan.entries[" + entry.EntryKey + "]"
		if ability.ProcessControl.UseRefFromEvent {
			return s.error(path+".abilityRef", "event-bound INITIAL control cannot be borrowed by a driver", ref)
		}
		if strings.TrimSpace(entry.EntryKey) == "" || entry.Repeat != nil || entry.WhileReady != nil {
			return s.error(path, "process control requires a named single-shot driver", ref)
		}
		if entry.FirstAtMs < input.Start {
			return s.error(path+".firstAtMs", "process driver cannot precede the initial snapshot", ref)
		}
		source, sourceOK := checks.InitialProcessActor(entry.Source, model.SelectorSource)
		target, targetOK := checks.InitialProcessActor(entry.Target, source)
		parsed, parsedOK := planbundle.ParseAbilityRef(ref)
		if !sourceOK || !targetOK || entry.Source == "" || entry.Target == "" || !parsedOK || parsed.Combatant != source || !restore.ProcessActorExists(target) {
			return s.error(path, "process driver must identify its real owner and target", ref)
		}
		controls[entry.EntryKey] = i
	}
	for i, fact := range input.Commands {
		path := "processCommandFacts[" + strconv.Itoa(i) + "]"
		if exists := s.actions.HasProcessFact(fact.DriverEntryKey); exists {
			return s.error(path+".driverEntryKey", "duplicate process command fact", fact.DriverEntryKey)
		}
		idx, ok := controls[fact.DriverEntryKey]
		if !ok {
			return s.error(path+".driverEntryKey", "fact must reference a process control driver", fact.DriverEntryKey)
		}
		entry := input.Entries[idx]
		ability, _, _ := checks.InitialProcessAbility(entry)
		use, ok := restore.ProcessKnownUse(fact.UseRef)
		if !ok || fact.UseRef == "" {
			return s.error(path+".useRef", "process command requires an existing skill use", fact.UseRef)
		}
		source, _ := checks.InitialProcessActor(entry.Source, model.SelectorSource)
		if use.Source != source || use.SkillKey != ability.SkillKey {
			return s.error(path+".useRef", "process use source and skill must match the control ability", fact.UseRef)
		}
		s.actions.SetProcessFact(fact.DriverEntryKey, fact)
	}
	for _, entry := range input.Entries {
		if _, ok := controls[entry.EntryKey]; ok {
			if ok := s.actions.HasProcessFact(entry.EntryKey); !ok {
				return s.error("processCommandFacts", "process driver requires an explicit command fact", entry.EntryKey)
			}
		}
	}
	for processSlot := 0; processSlot < s.actions.ProcessCount(); processSlot++ {
		p := s.actions.ProcessAt(processSlot)
		if p.Status() == "active" {
			if err := checks.QueueRestoredProcess(p); err != nil {
				return err
			}
		}
	}
	return nil
}
