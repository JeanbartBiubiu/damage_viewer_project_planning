package actionflow

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type automaticCandidateFixture struct {
	evaluated []string
	observed  []string
	reasons   map[string]string
	deadlines map[string]int64
	failureAt string
	failure   *model.EngineError
}

func (fixture *automaticCandidateFixture) EvaluateAutomatic(rule *actionpkg.AutomaticRuleView) (string, []string, int64, *model.EngineError) {
	key := rule.Plan().RuleKey()
	fixture.evaluated = append(fixture.evaluated, key)
	if key == fixture.failureAt {
		return "", nil, 0, fixture.failure
	}
	return fixture.reasons[key], nil, fixture.deadlines[key], nil
}

func (fixture *automaticCandidateFixture) ObserveAutomaticWait(rule *actionpkg.AutomaticRuleView, reason string, related []string, at int64) {
	fixture.observed = append(fixture.observed, rule.Plan().RuleKey())
}

func automaticFixture() (actionpkg.State, []planbundle.CompiledAbility, []planbundle.CompiledProvider, *actionpkg.CooldownLedger) {
	var state actionpkg.State
	state.InitAutomatic()
	abilities := []planbundle.CompiledAbility{{ProviderIndex: 0}, {ProviderIndex: 0}, {ProviderIndex: 0}}
	for index, key := range []string{"ready", "later", "earlier"} {
		ref := "source.provider[" + key + "].ability[initial]"
		state.AddAutomaticRule(actionpkg.AutomaticRuleSeed{InputIndex: index, Plan: model.AutomaticSkillRule{RuleKey: key}, Binding: planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource}}, AbilityRef: ref, ControlIndex: uint16(index)})
	}
	ledger := actionpkg.NewCooldownLedger()
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", state.AutomaticAt(1).AbilityRef()), 500, 0)
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", state.AutomaticAt(2).AbilityRef()), 200, 0)
	return state, abilities, []planbundle.CompiledProvider{{}}, ledger
}

func TestAutomaticChoiceVisitsAndRegistersAllWaitingCandidates(t *testing.T) {
	state, abilities, providers, ledger := automaticFixture()
	executor := NewSkillActionExecutor(&state, abilities, providers, Identity{})
	candidates := &automaticCandidateFixture{reasons: map[string]string{"later": model.AutomaticWaitOwnCooldown, "earlier": model.AutomaticWaitOwnCooldown}, deadlines: map[string]int64{"later": 500, "earlier": 200}}
	choice, err := executor.ChooseAutomatic(0, ledger, candidates)
	wantOrder := []string{"ready", "later", "earlier"}
	if err != nil || choice.Rule != state.AutomaticAt(0) || choice.NextAt != 200 || !reflect.DeepEqual(candidates.evaluated, wantOrder) || !reflect.DeepEqual(candidates.observed, wantOrder) {
		t.Fatal("first usable rule truncated later evaluation or earliest waiting", err, choice, candidates)
	}
	for key, deadline := range candidates.deadlines {
		wait, exists := ledger.Wait(actionpkg.CooldownWaitKey{Kind: "automatic", Owner: model.SelectorSource, Key: key})
		if !exists || wait.ReadyAt != deadline {
			t.Fatal("non-selected rule lost its shared cooldown wait", key, wait)
		}
	}
}

func TestAutomaticChoiceReturnsLateErrorAfterEarlierUsableRule(t *testing.T) {
	state, abilities, providers, ledger := automaticFixture()
	executor := NewSkillActionExecutor(&state, abilities, providers, Identity{})
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "late candidate failure")
	candidates := &automaticCandidateFixture{failureAt: "earlier", failure: &failure}
	choice, err := executor.ChooseAutomatic(0, ledger, candidates)
	if err != &failure || choice.Rule != nil || !reflect.DeepEqual(candidates.evaluated, []string{"ready", "later", "earlier"}) {
		t.Fatal("an earlier usable rule concealed a later formula failure", err, choice, candidates.evaluated)
	}
}
