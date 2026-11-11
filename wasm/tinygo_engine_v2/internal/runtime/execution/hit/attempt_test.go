package hit

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type attemptFixture struct {
	log                     []string
	history                 History
	known, unknown          bool
	occurrence              uint64
	selectionContacts       int
	attackErr, selectionErr *model.EngineError
}

func (f *attemptFixture) SetHitAttemptOccurrence(id uint64) {
	f.log = append(f.log, "occurrence")
	f.occurrence = id
}
func (f *attemptFixture) RequireHitAttackProcess(_ planbundle.CompiledAbility, _, _ string) *model.EngineError {
	f.log = append(f.log, "attack")
	return f.attackErr
}
func (f *attemptFixture) MarkHitAttack(string) { f.log = append(f.log, "mark") }
func (f *attemptFixture) HitAttemptUse(string) AttemptUse {
	f.log = append(f.log, "use")
	history := model.SkillHitHistoryComplete
	if f.unknown {
		history = model.SkillHitHistoryUnknown
	}
	return AttemptUse{Present: f.known, HistoryState: history, History: &f.history}
}
func (f *attemptFixture) HitAttemptBudgetError() *model.EngineError {
	f.log = append(f.log, "budget")
	return f.HitExecutionError(model.GenericErrRuntimeInvariantFailed, "budget", "", "")
}
func (f *attemptFixture) HitExecutionError(code model.GenericErrCode, message, path, ref string) *model.EngineError {
	return hitError(Identity{}, code, message, path, ref)
}
func (f *attemptFixture) HitParticipation(formula.GenericProgramID, planbundle.CompiledAbility, string, uint16) (float64, bool, *model.EngineError) {
	f.log = append(f.log, "selection")
	f.selectionContacts = f.history.ContactCount()
	return 1, true, f.selectionErr
}
func (f *attemptFixture) HitConditionValue(planbundle.CompiledSkillHitValueCond, string) (float64, *model.EngineError) {
	return 1, nil
}
func (f *attemptFixture) HitSpellShields(string) effectpkg.ProviderList {
	return effectpkg.ProviderList{}
}
func (f *attemptFixture) FreezeHitEmpoweredWaits(string) []EmpoweredWait { return nil }

func attemptState() (State, AttemptInput) {
	use := "use"
	return State{facts: map[string]model.SkillHitFact{"entry": {UseRef: &use}}}, AttemptInput{
		EntryKey: "entry", AbilityRef: "ability", SourceKey: "source", TargetKey: "target", Plan: &planbundle.CompiledSkillHit{SkillKey: "q"},
	}
}

func TestAttemptKeepsOccurrenceBeforeAttackFailureAndNoLaterFacts(t *testing.T) {
	state, input := attemptState()
	input.Ability.IsBasicAttack = true
	issue := hitError(Identity{}, model.GenericErrUnknownRef, "attack failed", "attack", "")
	work := &attemptFixture{known: true, attackErr: issue}
	if _, err := PrepareAttempt(&state, input, work); err != issue || state.OccurrenceCount() != 1 || work.occurrence != 1 || work.history.ContactCount() != 0 || !reflect.DeepEqual(work.log, []string{"occurrence", "attack"}) {
		t.Fatal("attempt identity or failure prefix changed", err, state.OccurrenceCount(), work)
	}
}

func TestAttemptRegistersHistoryBeforeSelectionFailureAndUnknownHistoryStaysUnknown(t *testing.T) {
	state, input := attemptState()
	input.Plan.Candidates = []planbundle.CompiledSkillHitCandidate{{CandidateKey: "c", HasParticipation: true, RuleGroupIndex: -1}}
	issue := hitError(Identity{}, model.GenericErrFormulaTypeError, "selection failed", "condition", "")
	work := &attemptFixture{known: true, selectionErr: issue}
	if _, err := PrepareAttempt(&state, input, work); err != issue || work.history.ContactCount() != 1 || work.selectionContacts != 1 || !reflect.DeepEqual(work.log, []string{"occurrence", "mark", "use", "selection"}) {
		t.Fatal("selection failure lost earlier contact", err, work)
	}
	state, input = attemptState()
	work = &attemptFixture{known: true, unknown: true}
	context, err := PrepareAttempt(&state, input, work)
	if err != nil || context.View().HasFirstContact || work.history.ContactCount() != 1 {
		t.Fatal("unknown history manufactured first contact", context, err, work)
	}
}

func TestAttemptGuardAndExhaustedBudgetDoNotAllocateOccurrence(t *testing.T) {
	state, input := attemptState()
	state.occurrences = 256
	work := &attemptFixture{}
	input.Plan = nil
	if _, err := PrepareAttempt(&state, input, work); err == nil || err.Message != "resolve_skill_hit missing compiled plan" || len(work.log) != 0 {
		t.Fatal(err, work)
	}
	input.Plan = &planbundle.CompiledSkillHit{}
	if _, err := PrepareAttempt(&state, input, work); err == nil || state.OccurrenceCount() != 256 || work.occurrence != 0 || !reflect.DeepEqual(work.log, []string{"budget"}) {
		t.Fatal(err, work, state.OccurrenceCount())
	}
}
