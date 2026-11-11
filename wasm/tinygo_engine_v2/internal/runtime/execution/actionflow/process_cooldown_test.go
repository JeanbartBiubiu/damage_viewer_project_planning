package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type processCooldownFixture struct {
	ledger            *actionpkg.CooldownLedger
	now               int64
	order             []string
	failure           *model.EngineError
	previewSawTotal   bool
	preview           AttackWaitPreview
	previewOwner, ref string
}

func (f *processCooldownFixture) StageActionCooldown(owner, ref string, ready int64) *model.EngineError {
	f.order = append(f.order, "stage")
	if f.failure != nil {
		return f.failure
	}
	f.ledger.Set(actionpkg.AbilityCooldownIdentity(owner, ref), ready, f.now)
	return nil
}
func (f *processCooldownFixture) WritableProcessCooldown(string) *actionpkg.CooldownLedger {
	f.order = append(f.order, "ledger")
	return f.ledger
}
func (f *processCooldownFixture) InitialAttackWaitPreview() AttackWaitPreview {
	f.order = append(f.order, "preview")
	entry, found := f.ledger.Entry(actionpkg.AbilityCooldownIdentity(f.previewOwner, f.ref))
	f.previewSawTotal = found && entry.HasOrdinaryTotal && entry.OrdinaryTotalMs == 250
	return f.preview
}

func TestProcessCooldownKeepsOrdinaryTotalBeforeActualAttackWait(t *testing.T) {
	var state actionpkg.State
	state.InitBasicAttack(actionpkg.BasicAttackSeed{Plan: model.BasicAttackPlan{PlanKey: "attack", Source: "source", Target: "target", InitialControlAbilityRef: "initial", AttackSpeedAttributeKey: "attack_speed"}})
	use, _, _ := state.BeginAttack(100, 1)
	state.SetAttackActive(true)
	executor := NewProcessExecutor(&state, Identity{})
	process := executor.InitialProcess(ProcessStartInput{Owner: "source", Target: "target", AbilityRef: "initial", Use: use, Now: 100, Definition: &planbundle.CompiledProcess{}})
	work := &processCooldownFixture{ledger: actionpkg.NewCooldownLedger(), now: 100, previewOwner: "source", ref: "initial",
		preview: AttackWaitPreview{Source: attribute.FromMap(map[string]model.AttributeSlotDef{"attack_speed": {Resolved: 1}})}}
	wait, err := executor.StageCooldown(process, 350, 100, work)
	entry, found := work.ledger.Entry(actionpkg.AbilityCooldownIdentity("source", "initial"))
	if err != nil || !found || !entry.HasOrdinaryTotal || entry.OrdinaryTotalMs != 250 || !work.previewSawTotal || wait == nil || wait.ProgressDeadline() != 350 || wait.Speed() != 1 || state.BasicAttack().Wait() != nil {
		t.Fatal("process cooldown lost the ordinary total or published an unstaged attack wait", err, entry, wait, work)
	}
	if !reflect.DeepEqual(work.order, []string{"stage", "ledger", "preview"}) {
		t.Fatal("process cooldown changed the numeric/total/wait order", work.order)
	}
}

func TestProcessCooldownFailureStopsBeforeTotalAndUnrelatedUseDoesNotReadWait(t *testing.T) {
	var state actionpkg.State
	state.InitBasicAttack(actionpkg.BasicAttackSeed{Plan: model.BasicAttackPlan{PlanKey: "attack", Source: "source", Target: "target", InitialControlAbilityRef: "initial"}})
	state.BeginAttack(100, 1)
	state.SetAttackActive(true)
	executor := NewProcessExecutor(&state, Identity{})
	process := executor.InitialProcess(ProcessStartInput{Owner: "source", AbilityRef: "initial", Use: "other-use", Definition: &planbundle.CompiledProcess{}})
	work := &processCooldownFixture{ledger: actionpkg.NewCooldownLedger(), now: 100}
	wait, err := executor.StageCooldown(process, 350, 100, work)
	if err != nil || wait != nil || !reflect.DeepEqual(work.order, []string{"stage", "ledger"}) {
		t.Fatal("another use read the selected attack's formula view", err, wait, work.order)
	}
	entry, found := work.ledger.Entry(actionpkg.AbilityCooldownIdentity("source", "initial"))
	if !found || !entry.HasOrdinaryTotal || entry.OrdinaryTotalMs != 250 {
		t.Fatal("unrelated use lost its ordinary cooldown source", entry)
	}
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "cooldown operation failed")
	failed := &processCooldownFixture{ledger: actionpkg.NewCooldownLedger(), now: 100, failure: &failure}
	wait, err = executor.StageCooldown(process, 350, 100, failed)
	if err != &failure || wait != nil || failed.ledger.EntryCount() != 0 || !reflect.DeepEqual(failed.order, []string{"stage"}) {
		t.Fatal("failed numeric cooldown continued into ordinary total or waiting", err, wait, failed)
	}
}
