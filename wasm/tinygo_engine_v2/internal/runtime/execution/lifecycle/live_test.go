package lifecycle

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type liveEffectFixture struct {
	states            map[string]LiveEffects
	order             []string
	bindFailure       *model.EngineError
	afterRemoval      *effectpkg.Provider
	expirySawDeadline int64
	frames            []ExpiryFrame
}

func liveEffectCase() (Executor, *liveEffectFixture) {
	compiled := &plan.CompiledSession{SchemaHash: "schema", RulesHash: "rules", Providers: []plan.CompiledProvider{{ProviderKey: "status"}}}
	identities := effectpkg.NewIdentityRegistry()
	executor := New(compiled, nil, &identities, "session")
	work := &liveEffectFixture{states: map[string]LiveEffects{"source": {Cooldowns: actionpkg.NewCooldownLedger()}, "target": {Cooldowns: actionpkg.NewCooldownLedger()}}}
	return executor, work
}

func (f *liveEffectFixture) ReadEffects(owner string) (LiveEffects, bool) {
	state, exists := f.states[owner]
	return state, exists
}
func (f *liveEffectFixture) EffectOwnerOrder(buffer []string) []string {
	f.order = append(f.order, "owners")
	return append(buffer, "source", "target")
}
func (f *liveEffectFixture) PublishEffects(owner string, effects LiveEffects) {
	f.order = append(f.order, "publish:"+owner)
	f.states[owner] = effects
}
func (f *liveEffectFixture) ProviderRemovalContext(source, target string) formula.GenericEvalContext {
	f.order = append(f.order, "context:"+source+":"+target)
	return formula.GenericEvalContext{}
}
func (f *liveEffectFixture) MountEffectModifiers(owner string, _ effectpkg.Provider) {
	f.order = append(f.order, "mount:"+owner)
}
func (f *liveEffectFixture) UnmountEffectModifiers(owner, _ string) {
	f.order = append(f.order, "unmount:"+owner)
}
func (f *liveEffectFixture) ResolveAppliedEffects(owner, _ string) {
	f.order = append(f.order, "resolve:"+owner)
}
func (f *liveEffectFixture) ResolveRemovedEffects(owner string, _ formula.GenericEvalContext) {
	f.order = append(f.order, "removed:"+owner)
	if f.afterRemoval != nil {
		state := f.states[owner]
		state.Instances.AppendProvider(*f.afterRemoval)
		f.states[owner] = state
		f.afterRemoval = nil
	}
}
func (f *liveEffectFixture) RemoveEffectDependents(owner, _ string) {
	f.order = append(f.order, "dependents:"+owner)
}
func (f *liveEffectFixture) ScheduleEffectTick(effectpkg.Provider) {
	f.order = append(f.order, "tick")
}
func (f *liveEffectFixture) RecordEffect(kind model.EvidenceKind, _ effectpkg.Provider) {
	f.order = append(f.order, "record:"+string(kind))
}
func (f *liveEffectFixture) BindEffectListeners(effectpkg.Provider) *model.EngineError {
	f.order = append(f.order, "bind")
	return f.bindFailure
}
func (f *liveEffectFixture) BindImmediateEffectUse(_, _, _, _ string) {
	f.order = append(f.order, "immediate_use")
}
func (f *liveEffectFixture) EnqueueExpiry(_ int64, payload effectpkg.ExpiryPayload) {
	if state, exists := f.states[payload.CombatantKey]; exists {
		if instance, _, found := state.Instances.Providers().Find(payload.ProviderRef); found {
			f.expirySawDeadline = instance.ExpireAt
		}
	}
	f.order = append(f.order, "expiry")
}
func (f *liveEffectFixture) RemoveExpiredProvider(owner, reference, source string) {
	f.order = append(f.order, "linked_provider:"+owner)
	state := f.states[owner]
	state.Instances.SetProviders(state.Instances.Providers().RemoveRef(reference))
	state.Instances.SetShields(effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "newly_visible", Remaining: 0}))
	f.states[owner] = state
}
func (f *liveEffectFixture) RemoveExpiredShield(owner, reference string) {
	f.order = append(f.order, "linked_shield:"+owner+":"+reference)
}
func (f *liveEffectFixture) CommitEffectExpiry(frame ExpiryFrame) {
	f.frames = append(f.frames, frame)
}
func (f *liveEffectFixture) ExpireProviderCooldown(effectpkg.ExpiryPayload) {
	f.order = append(f.order, "cooldown")
}
func (f *liveEffectFixture) ExpireTargetTiming(effectpkg.ExpiryPayload) {
	f.order = append(f.order, "timing")
}
func (f *liveEffectFixture) ExpireTargetState(effectpkg.ExpiryPayload) {
	f.order = append(f.order, "target_state")
}
func (f *liveEffectFixture) ExpireSourceState(effectpkg.ExpiryPayload) {
	f.order = append(f.order, "source_state")
}
func (f *liveEffectFixture) SweepEffects() { f.order = append(f.order, "sweep") }

func TestLiveApplicationKeepsPublishedPrefixOnLateBindingFailure(t *testing.T) {
	executor, work := liveEffectCase()
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "binding failed")
	work.bindFailure = &failure
	err := executor.ApplyLive(ProviderApplication{Owner: "target", Source: "source", Definition: "status", Expiry: 200, HasExpiry: true}, 100, work)
	state := work.states["target"]
	if err != &failure || state.Instances.Providers().Len() != 1 || state.Instances.Providers().At(0).ExpireAt != 200 {
		t.Fatal("late failure erased or never published the actual instance", err, state)
	}
	want := []string{"publish:target", "mount:target", "resolve:target", "expiry", "tick", "record:provider_apply", "bind"}
	if !reflect.DeepEqual(work.order, want) || work.expirySawDeadline != 200 {
		t.Fatal("new instance publication moved after scheduling or listener binding", work.order, work.expirySawDeadline)
	}
}

func TestLiveRefreshRequestsExpiryBeforePublishingAndPreservesState(t *testing.T) {
	executor, work := liveEffectCase()
	executor.compiled.Providers[0].NeedsElapsedTime = true
	state := work.states["target"]
	state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "original", DefinitionRef: "status", Owner: "target", Source: "source", Stacks: 2, ExpireAt: 150, State: effectpkg.ObjectState(map[string]interface{}{"saved": 7.0})})
	work.states["target"] = state
	if err := executor.RefreshLive("target", "original", 300, true, effectpkg.ContributionView{}, 120, work); err != nil {
		t.Fatal(err)
	}
	instance := work.states["target"].Instances.Providers().At(0)
	if work.expirySawDeadline != 150 || instance.ExpireAt != 300 || instance.ProviderRef != "original" || instance.State.ToMap()["saved"] != 7.0 || instance.AppliedAtMs != 120 || !instance.HasAppliedAt {
		t.Fatal("refresh lost old deadline visibility or existing identity/state", instance, work.expirySawDeadline)
	}
	if !reflect.DeepEqual(work.order, []string{"expiry", "publish:target", "resolve:target", "record:provider_refresh"}) {
		t.Fatal("refresh changed its original queue-before-state boundary", work.order)
	}
}

func TestLiveReapplicationRereadsAfterExpiredRemoval(t *testing.T) {
	executor, work := liveEffectCase()
	executor.compiled.Providers[0].Lifecycle = &plan.CompiledProviderLifecycle{InstanceScope: model.InstanceScopeSourceTarget}
	state := work.states["target"]
	state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "expired", DefinitionRef: "status", Owner: "target", Source: "source", ExpireAt: 100})
	work.states["target"] = state
	work.afterRemoval = &effectpkg.Provider{ProviderRef: "from_read_preparation", DefinitionRef: "status", Owner: "target", Source: "source", ExpireAt: 200}
	if err := executor.ApplyLive(ProviderApplication{Owner: "target", Source: "source", Definition: "status", Expiry: 300, HasExpiry: true}, 100, work); err != nil {
		t.Fatal(err)
	}
	providers := work.states["target"].Instances.Providers()
	if providers.Len() != 1 || providers.At(0).ProviderRef != "from_read_preparation" || providers.At(0).ExpireAt != 300 {
		t.Fatal("reapplication reused a stale pre-removal view", providers.Snapshot())
	}
	want := []string{"context:source:target", "dependents:target", "publish:target", "unmount:target", "removed:target", "record:provider_expire", "expiry", "publish:target", "resolve:target", "record:provider_refresh"}
	if !reflect.DeepEqual(work.order, want) {
		t.Fatal("expired replacement moved external cleanup or minted a new instance", work.order)
	}
}

func TestLiveRemovalKeepsMissingReverseShieldAndStrictErrorIdentity(t *testing.T) {
	executor, work := liveEffectCase()
	executor.compiled.Features |= plan.FeatureShieldLifecycle
	state := work.states["target"]
	state.Instances.SetShields(effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "orphan", LifecycleProviderRef: "missing", Remaining: 10}))
	state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "present", DefinitionRef: "status", Owner: "target", Source: "source"})
	work.states["target"] = state
	executor.RemoveLive("target", "missing", formula.GenericEvalContext{}, model.EvidenceKindProviderRemove, 100, work)
	if work.states["target"].Instances.Shields().Len() != 1 || len(work.order) != 0 {
		t.Fatal("missing instance published its local reverse-shield deletion", work.states, work.order)
	}
	err := executor.RemoveLiveStrict("target", "present", "foreign", formula.GenericEvalContext{}, 100, work)
	if err == nil || err.Code != model.GenericErrUnknownRef || err.Message != "expire_provider definitionRef mismatch" || err.Path != "present" || err.Ref != "status" || err.SchemaHash != "schema" || err.RulesHash != "rules" || err.SessionID != "session" || len(work.order) != 0 {
		t.Fatal("strict removal changed old error identity or mutated before rejection", err, work.order)
	}
}

func TestLiveSweepKeepsOrdinaryPolicyAndRechecksLinkedShields(t *testing.T) {
	for _, linked := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "linked"}[linked], func(t *testing.T) {
			executor, work := liveEffectCase()
			if linked {
				executor.compiled.Features |= plan.FeatureShieldLifecycle
			}
			state := work.states["source"]
			state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "expired", Owner: "source", Source: "source", ExpireAt: 100})
			state.Instances.SetShields(effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "old_shield", Remaining: 5, ExpireAt: 50}))
			state.Cooldowns.Set(actionpkg.AbilityCooldownIdentity("source", "source.provider[expired].ability[a]"), 300, 0)
			work.states["source"] = state
			executor.SweepLive(100, work, work)
			if linked {
				if !reflect.DeepEqual(work.order, []string{"linked_provider:source", "linked_shield:source:newly_visible"}) {
					t.Fatal("linked sweep reused the pre-removal shield list", work.order)
				}
			} else {
				if !reflect.DeepEqual(work.order, []string{"context:source:target", "owners", "publish:source", "unmount:source", "removed:source", "record:provider_expire", "publish:target"}) || work.states["source"].Instances.Shields().Len() != 1 || work.states["source"].Cooldowns.EntryCount() != 1 {
					t.Fatal("ordinary sweep was changed into full removal or cleared shields in its changed branch", work.order, work.states["source"])
				}
			}
		})
	}
}

func TestEffectExpiryOwnsStaleQualificationAndOriginalFrameCommand(t *testing.T) {
	executor, work := liveEffectCase()
	state := work.states["target"]
	state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "live", DefinitionRef: "status", Source: "source", Owner: "target", ExpireAt: 200})
	work.states["target"] = state
	payload := effectpkg.ExpiryPayload{Kind: "provider", CombatantKey: "target", ProviderRef: "live"}
	executor.HandleExpiry(payload, 100, true, work, work)
	if len(work.order) != 0 || len(work.frames) != 0 {
		t.Fatal("stale provider deadline prepared context or opened a frame", work.order, work.frames)
	}
	executor.HandleExpiry(payload, 200, true, work, work)
	if len(work.frames) != 1 || !reflect.DeepEqual(work.order, []string{"context:source:target"}) {
		t.Fatal("current expiry did not prepare original context and exact frame", work.order, work.frames)
	}
	command := work.frames[0]
	if command.Source != "source" || command.Target != "target" || command.Owner != "target" || command.AbilityRef != "provider_expiry:live" {
		t.Fatal("expiry changed actual frame identity", command)
	}
	var projection Projection
	dirty := false
	mutations := executor.StageExpiryFrame(command, nil, &projection, &dirty)
	if len(mutations) != 1 || mutations[0].Kind != "expire" || mutations[0].ProviderRef != "live" || mutations[0].EvidenceKind != model.EvidenceKindProviderExpire || dirty || projection.dirty {
		t.Fatal("provider expiry incorrectly adopted linked-shield dirty policy", mutations, dirty, projection)
	}
}

func TestProviderExpiryKeepsAutomatedModeIndependentOfFeatures(t *testing.T) {
	for _, tc := range []struct {
		name      string
		features  plan.SessionFeatures
		automated bool
		wantFrame bool
	}{
		{name: "manual_without_features"},
		{name: "manual_with_unrelated_feature", features: plan.FeatureReceivedShieldReads},
		{name: "automated_without_features", automated: true, wantFrame: true},
		{name: "manual_with_action_stun", features: plan.FeatureActionStun, wantFrame: true},
		{name: "manual_with_dynamic_projection", features: plan.FeatureProviderDurationChange, wantFrame: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executor, work := liveEffectCase()
			executor.compiled.Features = tc.features
			state := work.states["target"]
			state.Instances.AppendProvider(effectpkg.Provider{ProviderRef: "expired", DefinitionRef: "status", Source: "source", Owner: "target", ExpireAt: 100})
			work.states["target"] = state

			executor.HandleExpiry(effectpkg.ExpiryPayload{Kind: "provider", CombatantKey: "target", ProviderRef: "expired"}, 100, tc.automated, work, work)

			wantFrames := 0
			if tc.wantFrame {
				wantFrames = 1
			}
			_, _, stillLive := work.states["target"].Instances.Providers().Find("expired")
			if len(work.frames) != wantFrames || stillLive != tc.wantFrame {
				t.Fatalf("独立到期帧数量为 %d，供值器仍存在 %t，预期有 %d 个独立帧", len(work.frames), stillLive, wantFrames)
			}
		})
	}
}

func TestEffectMutationPublicationStopsOnlyAtOriginalExplicitFailure(t *testing.T) {
	executor, work := liveEffectCase()
	executor.compiled.Features |= plan.FeatureImmediatePeriodic
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "bind failure")
	work.bindFailure = &failure
	err := executor.PublishMutations([]Mutation{{Kind: "apply", DefinitionRef: "status", TargetKey: "target", SourceKey: "source"}, {Kind: "apply", DefinitionRef: "status", TargetKey: "source", SourceKey: "source"}}, formula.GenericEvalContext{}, 100, work)
	if err != &failure || work.states["target"].Instances.Providers().Len() != 1 || work.states["source"].Instances.Providers().Len() != 0 {
		t.Fatal("mutation publication lost its prefix or continued after binding failure", err, work.states)
	}
	for _, event := range work.order {
		if event == "immediate_use" {
			t.Fatal("failed ordinary application published an immediate-use binding")
		}
	}
}
