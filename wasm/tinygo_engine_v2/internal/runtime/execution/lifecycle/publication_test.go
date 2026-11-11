package lifecycle

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type effectPublicationEvent struct {
	Kind string
	Ref  string
	At   int64
}

type effectPublicationFixture struct {
	views  map[string]effectpkg.ShieldList
	events []effectPublicationEvent
}

func (f *effectPublicationFixture) ShieldExpiryState(owner string) (effectpkg.ShieldList, bool) {
	shields, exists := f.views[owner]
	return shields, exists
}

func (f *effectPublicationFixture) EnqueueExpiry(at int64, payload effectpkg.ExpiryPayload) {
	reference := payload.ProviderRef
	if payload.Kind == "shield" {
		reference = payload.ShieldRef
	}
	f.events = append(f.events, effectPublicationEvent{Kind: payload.Kind, Ref: payload.CombatantKey + "/" + reference, At: at})
}

func (f *effectPublicationFixture) RecordEffect(kind model.EvidenceKind, instance effectpkg.Provider) {
	f.events = append(f.events, effectPublicationEvent{Kind: string(kind), Ref: instance.Owner + "/" + instance.ProviderRef, At: instance.ExpireAt})
}

func TestProjectedMutationValidationKeepsGlobalProjectionRuleAndErrorIdentity(t *testing.T) {
	compiled := plan.CompiledSession{SchemaHash: "schema", RulesHash: "rules"}
	executor := New(&compiled, nil, nil, "session")
	mutations := []Mutation{{Projected: true, ProviderRef: "prepared"}, {ProviderRef: "foreign"}}
	projection := Projection{}
	if err := executor.ValidateProjectedMutations(&projection, mutations); err != nil {
		t.Fatal("an ordinary frame gained a projection-only rejection", err)
	}
	projection.changes = []ProjectedChange{{Instance: effectpkg.Provider{Owner: "target", ProviderRef: "other-owner"}}}
	err := executor.ValidateProjectedMutations(&projection, mutations)
	if err == nil || err.Code != model.GenericErrRuntimeInvariantFailed || err.Phase != model.GenericPhaseRun || err.Path != "providers" || err.Ref != "foreign" || err.SchemaHash != "schema" || err.RulesHash != "rules" || err.SessionID != "session" {
		t.Fatal("mixed batch lost its original error location or run identity", err)
	}
	if mutations[1].Projected || len(projection.changes) != 1 {
		t.Fatal("validation published or rewrote the unsupported mutation")
	}
	mutations[1].Projected = true
	if err := executor.ValidateProjectedMutations(&projection, mutations); err != nil {
		t.Fatal("fully prepared batch was rejected", err)
	}
}

func TestOwnerPreflightUsesOriginalBaseAndReplaysProjectedOperations(t *testing.T) {
	compiled := plan.CompiledSession{Providers: []plan.CompiledProvider{{ProviderKey: "p"}}}
	executor := New(&compiled, nil, nil, "")
	base := effectpkg.ProviderList{}.Append(effectpkg.Provider{ProviderRef: "live", DefinitionRef: "p", Source: "source", Owner: "target", ExpireAt: 100})
	state := effectpkg.NewInstances(base, effectpkg.ShieldList{}, effectpkg.AttributeResolver{}, effectpkg.DamageResolver{}, effectpkg.ResourceContributions{})
	staged := effectpkg.StageInstances(state, 10)
	staged.ProjectProviders()
	staged.RemoveProvider(0)
	removal := Mutation{Kind: "expire", ProviderRef: "live", Strict: true, Projected: true}
	count, err := executor.PreflightOwner(staged, []Mutation{removal}, MutationPreflight{Now: 10})
	if err != nil || count != 0 || staged.Providers().Len() != 0 || staged.BaseProviders().Len() != 1 || state.Providers().Len() != 1 {
		t.Fatal("preflight used the future list or published its preview", count, err)
	}
	_, err = executor.PreflightOwner(staged, []Mutation{removal, removal}, MutationPreflight{Now: 10})
	if err == nil || err.Message != "expire_provider instance is missing" || err.Ref != "live" {
		t.Fatal("projected removals were skipped instead of replayed in original order", err)
	}
	ordinary := effectpkg.StageInstances(state, 10)
	count, err = executor.PreflightOwner(ordinary, []Mutation{{Kind: "refresh", ProviderRef: "live", HasExpireAt: true, ExpireAt: 200}}, MutationPreflight{Now: 10})
	if err != nil || count != 1 || ordinary.Providers().At(0).ExpireAt != 100 || state.Providers().At(0).ExpireAt != 100 {
		t.Fatal("ordinary preflight did not use current unmodified providers", count, err)
	}
}

func TestProjectionPublicationKeepsExpiryBeforeEachFactAndOriginalOrder(t *testing.T) {
	projection := Projection{changes: []ProjectedChange{
		{Instance: effectpkg.Provider{Owner: "source", ProviderRef: "fresh", ExpireAt: 75}, Kind: model.EvidenceKindProviderApply, EnqueueExpiry: true},
		{Instance: effectpkg.Provider{Owner: "target", ProviderRef: "removed", ExpireAt: 20}, Kind: model.EvidenceKindProviderRemove},
		{Instance: effectpkg.Provider{Owner: "source", ProviderRef: "permanent"}, Kind: model.EvidenceKindProviderRefresh, EnqueueExpiry: true},
	}}
	publication := &effectPublicationFixture{}
	projection.Publish(publication)
	want := []effectPublicationEvent{
		{Kind: "provider", Ref: "source/fresh", At: 75},
		{Kind: string(model.EvidenceKindProviderApply), Ref: "source/fresh", At: 75},
		{Kind: string(model.EvidenceKindProviderRemove), Ref: "target/removed", At: 20},
		{Kind: string(model.EvidenceKindProviderRefresh), Ref: "source/permanent", At: 0},
	}
	if !reflect.DeepEqual(publication.events, want) || len(projection.changes) != 3 {
		t.Fatal("projection changed expiry/observation order or consumed its source", publication.events, projection.changes)
	}
}

func TestShieldExpiryMatchesFirstReferenceAndKeepsDuplicateOriginalDeadlines(t *testing.T) {
	shields := effectpkg.ShieldList{}.
		Append(effectpkg.Shield{ShieldRef: "active", ExpireAt: 900}).
		Append(effectpkg.Shield{ShieldRef: "first-inactive", ExpireAt: 0}).
		Append(effectpkg.Shield{ShieldRef: "first-inactive", ExpireAt: 800}).
		Append(effectpkg.Shield{ShieldRef: "still-physical", ExpireAt: 1})
	reads := &effectPublicationFixture{views: map[string]effectpkg.ShieldList{"source": shields}}
	pending := []ShieldExpiry{
		{CombatantKey: "source", ShieldRef: "active", ExpireAt: 100},
		{CombatantKey: "source", ShieldRef: "active", ExpireAt: 100},
		{CombatantKey: "source", ShieldRef: "first-inactive", ExpireAt: 100},
		{CombatantKey: "source", ShieldRef: "still-physical", ExpireAt: 200},
		{CombatantKey: "source", ShieldRef: "gone", ExpireAt: 100},
		{CombatantKey: "missing", ShieldRef: "active", ExpireAt: 100},
		{CombatantKey: "source", ShieldRef: "active", ExpireAt: 0},
		{CombatantKey: "source", ExpireAt: 100},
	}
	if count := CountShieldExpiries(pending, reads); count != 3 {
		t.Fatal("shield demand used request length, later duplicate shield, or an equality deadline rule", count)
	}
	PublishShieldExpiries(pending, reads, reads)
	want := []effectPublicationEvent{{Kind: "shield", Ref: "source/active", At: 100}, {Kind: "shield", Ref: "source/active", At: 100}, {Kind: "shield", Ref: "source/still-physical", At: 200}}
	if !reflect.DeepEqual(reads.events, want) {
		t.Fatal("shield publication deduplicated requests or replaced their original times", reads.events)
	}
}

func TestShieldExpiryPublicationRechecksActualPublishedState(t *testing.T) {
	pending := []ShieldExpiry{{CombatantKey: "source", ShieldRef: "shield", ExpireAt: 30}}
	staged := &effectPublicationFixture{views: map[string]effectpkg.ShieldList{"source": effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "shield", ExpireAt: 30})}}
	if count := CountShieldExpiries(pending, staged); count != 1 {
		t.Fatal("valid staged shield did not reserve one queue request", count)
	}
	live := &effectPublicationFixture{views: map[string]effectpkg.ShieldList{"source": {}}}
	PublishShieldExpiries(pending, live, live)
	if len(live.events) != 0 {
		t.Fatal("formal publication reused stale preflight qualification", live.events)
	}
	live.views["source"] = effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "shield", ExpireAt: 90})
	PublishShieldExpiries(pending, live, live)
	if !reflect.DeepEqual(live.events, []effectPublicationEvent{{Kind: "shield", Ref: "source/shield", At: 30}}) {
		t.Fatal("live matching could not publish a still-valid original request", live.events)
	}
}
