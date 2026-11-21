package lifecycle

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type ownExpiryReads struct {
	instances effectpkg.ProviderList
	prepared  bool
}

func (r *ownExpiryReads) PrepareDurationRead() *model.EngineError { r.prepared = true; return nil }
func (r *ownExpiryReads) DurationProviders(string) effectpkg.ProviderList {
	if !r.prepared {
		panic("test read before projection preparation")
	}
	return r.instances
}

func TestOwnDefinitionExpiryUsesActualFrameIdentityAndUniqueLiveInstance(t *testing.T) {
	compiled := plan.CompiledSession{Features: plan.FeatureProviderDurationChange,
		Providers:  []plan.CompiledProvider{{ProviderKey: "parent"}, {ProviderKey: "slow", AtomicDynamic: true}},
		Combatants: []plan.CompiledCombatant{{Key: "source", ProviderMounts: []plan.CompiledProviderMount{{ProviderRef: "real_parent", DefinitionIndex: 0}}}}}
	e := New(&compiled, nil, nil, "session")
	op := plan.CompiledOperation{Operation: "expire_provider", Target: "self", OwnerProviderIndex: 0, ProviderDefinitionRef: "slow"}
	instance := effectpkg.Provider{ProviderRef: "slow#5", DefinitionRef: "slow", DefinitionIndex: 1, Source: "source", Owner: "source", ExpireAt: 500}
	for _, kind := range []string{"valid", "missing", "exact_expiry", "foreign_event", "wrong_target", "wrong_mount", "foreign_instance", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			owner, source, parent, target, now := "source", "source", "real_parent", "source", int64(100)
			reads := &ownExpiryReads{instances: effectpkg.ProviderList{}.Append(instance)}
			reject := false
			switch kind {
			case "missing":
				reads.instances = effectpkg.ProviderList{}
			case "exact_expiry":
				now = 500
			case "foreign_event":
				source, reject = "target", true
			case "wrong_target":
				target, reject = "target", true
			case "wrong_mount":
				parent, reject = "another_parent", true
			case "foreign_instance":
				foreign := instance
				foreign.Source = "target"
				reads.instances, reject = effectpkg.ProviderList{}.Append(foreign), true
			case "duplicate":
				duplicate := instance
				duplicate.ProviderRef = "slow#6"
				reads.instances, reject = reads.instances.Append(duplicate), true
			}
			mutation, changed, err := e.PrepareOwnDefinitionExpiry(op, owner, source, parent, target, now, reads)
			if (err != nil) != reject {
				t.Fatalf("changed=%v error=%+v reject=%v", changed, err, reject)
			}
			if !reject {
				wantChanged := kind == "valid"
				if changed != wantChanged || changed && (mutation.ProviderRef != "slow#5" || mutation.SourceKey != "source" || mutation.TargetKey != "source" || !mutation.Strict) {
					t.Fatal("wrong actual instance removal", mutation, changed)
				}
			}
		})
	}
}
