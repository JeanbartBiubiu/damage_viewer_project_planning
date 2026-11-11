package hit

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/usage"
)

type groupAdmissionFixture struct {
	t                       *testing.T
	origin                  RuleOrigin
	ledger                  *usage.Ledger
	commit                  bool
	originCalls, frameCalls int
	issue                   *model.EngineError
}

func (f *groupAdmissionFixture) RuleGroupOrigin(int, *Context) RuleOrigin {
	f.originCalls++
	return f.origin
}
func (f *groupAdmissionFixture) RuleGroupReservationFailure(*model.EngineError) {}
func (f *groupAdmissionFixture) RunRuleGroupFrame(_ int, _ *Context, _ planbundle.CompiledSkillHitRuleGroup, grant RuleGrant, token usage.Reservation, _ int) *model.EngineError {
	f.frameCalls++
	if _, skip, err := f.ledger.Reserve(grant.Key, grant.UseSkillKey); err != nil || !skip || f.ledger.Pending() != 1 {
		f.t.Fatal("group did not own the actual shared reservation", skip, err)
	}
	if f.commit {
		f.ledger.Commit(token)
	}
	return f.issue
}

func TestAdmittedGroupOwnsSharedReservationAndOnlyReleasesUncommittedPrefix(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(map[bool]string{false: "before_commit", true: "after_commit"}[committed], func(t *testing.T) {
			group := planbundle.CompiledSkillHitRuleGroup{RuleKey: "rule", CandidateCount: 1, OncePerUseGroup: "g", OncePerUseScope: model.OncePerUseScopeProviderTarget}
			plan := &planbundle.CompiledSkillHit{SkillKey: "q", OwnerProviderIndex: 0, Candidates: []planbundle.CompiledSkillHitCandidate{{}}}
			ability := planbundle.CompiledAbility{AbilityKey: "a", HasSkillHit: true, OperationCount: 1}
			context := NewContext(ContextSeed{Facts: Facts{SourceKey: "source", TargetKey: "target", UseRef: "u", SkillKey: "q"}, Plan: plan, Ability: ability, AbilityRef: "source.provider[p].ability[a]"})
			origin := RuleOrigin{HasReference: true, EventType: model.EventTypeSkillHit, HasUse: true, UseKey: "u", UseSource: "source", UseSkillKey: "q", KnownUse: true, RegisteredUseSource: "source", RegisteredSkillKey: "q", TargetKey: "target",
				Combatants: []planbundle.CompiledCombatant{{Key: "source", ProviderMounts: []planbundle.CompiledProviderMount{{ProviderRef: "p"}}}}, Abilities: []planbundle.CompiledAbility{ability}, Providers: []planbundle.CompiledProvider{{ProviderKey: "definition"}}, Operations: []planbundle.CompiledOperation{{SkillHit: plan}},
				LiveProviders: effectpkg.Providers([]effectpkg.Provider{{ProviderRef: "p", DefinitionRef: "definition", Owner: "source", Source: "source"}})}
			ledger := usage.New(usage.Identity{})
			issue := hitError(Identity{}, model.GenericErrFormulaTypeError, "tail failed", "tail", "")
			work := &groupAdmissionFixture{t: t, origin: origin, ledger: &ledger, commit: committed, issue: issue}
			if err := ExecuteAdmittedGroup(context, group, 1, 0, Identity{}, &ledger, work); err != issue || work.frameCalls != 1 || ledger.Pending() != 0 {
				t.Fatal(err, work, ledger.Pending())
			}
			want := 0
			if committed {
				want = 1
			}
			if ledger.Len() != want || len(ledger.Snapshot()) != want {
				t.Fatal("failure erased or retained wrong prefix", ledger.Len(), ledger.Snapshot())
			}
		})
	}
}

func TestAdmittedGroupRejectsRangeBeforeReadingActualOrigin(t *testing.T) {
	context := NewContext(ContextSeed{Plan: &planbundle.CompiledSkillHit{}})
	ledger := usage.New(usage.Identity{})
	work := &groupAdmissionFixture{t: t, ledger: &ledger}
	if err := ExecuteAdmittedGroup(context, planbundle.CompiledSkillHitRuleGroup{RuleKey: "invalid"}, 1, 0, Identity{}, &ledger, work); err == nil || err.Code != model.GenericErrRuntimeInvariantFailed || work.originCalls != 0 || ledger.Len() != 0 {
		t.Fatal(err, work, ledger.Len())
	}
}
