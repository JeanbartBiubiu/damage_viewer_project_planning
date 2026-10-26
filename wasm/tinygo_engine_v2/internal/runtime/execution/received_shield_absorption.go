package execution

import (
	"errors"
	"math"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	"tinygo_engine_v2/internal/plan"
)

func validateReceivedShieldInitialSnapshot(compiled plan.CompiledSession, req model.RunRequest) *model.EngineError {
	if !compiled.HasReceivedShieldReads {
		return nil
	}
	bad := func(message, ref string) *model.EngineError {
		return engineErrorPtrAt(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, message, "initialSnapshot.combatants.providers", ref, compiled.SchemaHash, compiled.RulesHash, req.SessionID)
	}
	if req.InitialSnapshot.TimeMs != 0 {
		return bad("received shield absorption requires a fresh initialized scene", "")
	}
	for _, shield := range compiled.Providers {
		if !shield.HasReceivedShieldBinding {
			continue
		}
		parent := int(shield.ReceivedShieldParentIndex)
		if parent >= len(compiled.Providers) {
			return bad("received shield parent binding is invalid", shield.ProviderKey)
		}
		for _, actor := range compiled.Combatants {
			mountRef, count := "", 0
			for _, mount := range actor.ProviderMounts {
				if int(mount.DefinitionIndex) == parent {
					mountRef, count = mount.ProviderRef, count+1
				}
			}
			if count == 0 {
				continue
			}
			if count != 1 {
				return bad("received shield parent mount is ambiguous", mountRef)
			}
			actors, parents := 0, 0
			for _, snapshot := range req.InitialSnapshot.Combatants {
				if snapshot.Key != actor.Key {
					continue
				}
				actors++
				for _, instance := range snapshot.Providers {
					if instance.DefinitionRef == shield.ProviderKey {
						return bad("received shield instance must be created by its real initializer", instance.ProviderRef)
					}
					if instance.DefinitionRef != compiled.Providers[parent].ProviderKey && instance.ProviderRef != mountRef {
						continue
					}
					parents++
					if instance.DefinitionRef != compiled.Providers[parent].ProviderKey || instance.ProviderRef != mountRef || instance.Source != actor.Key || instance.Owner != actor.Key || instance.Stacks != 1 || instance.ExpireAt != nil || len(instance.State) != 0 {
						return bad("received shield requires its explicit unchanged actual self parent", instance.ProviderRef)
					}
				}
				for _, instance := range snapshot.Shields {
					if instance.DefinitionRef == shield.ShieldDefinitionRef {
						return bad("received shield restoration is not authorized", instance.ShieldRef)
					}
					if instance.ShieldRef == "" || instance.Source == "" || instance.Owner != actor.Key {
						return bad("received shield facts require explicit initial shield identities", instance.ShieldRef)
					}
				}
			}
			if actors != 1 || parents != 1 {
				return bad("received shield parent is missing or duplicated in the initial snapshot", mountRef)
			}
		}
	}
	return nil
}

func validShieldAbsorption(row pipeline.ShieldAbsorption) bool {
	for _, value := range []float64{row.RemainingBefore, row.RemainingAfter, row.Absorbed} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	tolerance := 1e-12 * math.Max(1, math.Max(row.RemainingBefore, row.RemainingAfter))
	return row.ShieldRef != "" && row.Source != "" && row.Owner != "" && row.Absorbed > 0 && row.RemainingAfter >= 0 && row.RemainingBefore >= row.RemainingAfter && row.Absorbed <= row.RemainingBefore && math.Abs(row.RemainingBefore-row.RemainingAfter-row.Absorbed) <= tolerance
}

// Bind before depletion removes providers. The resulting rows are immutable and
// shared by the original received event and all of its listener conditions.
func (f *Frame) bindReceivedShieldAbsorptions(snapshot *pipeline.ShieldAbsorptionSnapshot, target string, total float64) *model.EngineError {
	if snapshot == nil && !f.run.compiled.HasReceivedShieldReads {
		return nil
	}
	bad := func() *model.EngineError {
		return f.run.processErr("event.damage.linked_shield", "received shield absorption has no valid actual settlement identity", target)
	}
	if snapshot == nil {
		return bad()
	}
	sum := 0.0
	for i := range snapshot.Rows {
		row := &snapshot.Rows[i]
		if !validShieldAbsorption(*row) || row.Owner != target {
			return bad()
		}
		sum += row.Absorbed
		if row.LifecycleProviderRef == "" {
			if row.DefinitionRef != "" {
				return bad()
			}
			continue
		}
		sc := f.stageFor(row.Owner)
		instance, _, found := sc.instances.Providers().Find(row.LifecycleProviderRef)
		index, source, owner, expires := instance.DefinitionIndex, instance.Source, instance.Owner, instance.ExpireAt
		if !found {
			for _, mutation := range sc.providerOps {
				if mutation.kind == "shield_apply" && mutation.providerRef == row.LifecycleProviderRef {
					index, source, owner, expires, found = mutation.definitionIndex, mutation.sourceKey, mutation.targetKey, mutation.expireAt, true
				}
			}
		}
		if !found || int(index) >= len(f.run.compiled.Providers) || f.run.compiled.Providers[index].ShieldDefinitionRef != row.DefinitionRef || source != row.Source || owner != row.Owner || expires != row.ExpireAt {
			return bad()
		}
		row.LifecycleBound, row.LifecycleIndex = true, index
	}
	if math.IsNaN(sum) || math.IsInf(sum, 0) || sum != total {
		return bad()
	}
	return nil
}

func (f *Frame) ReceivedLinkedShieldAbsorbed(index uint16) (float64, error) {
	bad := func() (float64, error) {
		return 0, errors.New("linked shield absorption requires its frozen native received event and actual unique self parent")
	}
	if !f.run.compiled.HasReceivedShieldReads || int(index) >= len(f.run.compiled.Providers) || f.eventCtx == nil || f.eventCtx.eventType != model.EventTypeDamageTaken || !f.eventCtx.hasDamageSnapshot || f.eventCtx.shieldAbsorptions == nil || f.ownerProviderRef == "" {
		return bad()
	}
	definition := f.run.compiled.Providers[index]
	owner := f.providerOwnerKey()
	if !definition.HasReceivedShieldBinding || f.eventCtx.eventTargetKey != owner {
		return bad()
	}
	matched, expected := 0, ""
	for _, actor := range f.run.compiled.Combatants {
		if actor.Key != owner {
			continue
		}
		for _, mount := range actor.ProviderMounts {
			if mount.DefinitionIndex == definition.ReceivedShieldParentIndex {
				matched, expected = matched+1, mount.ProviderRef
			}
		}
	}
	parent, _, found := f.run.combatants[owner].instances.Providers().Find(f.ownerProviderRef)
	if matched != 1 || expected != f.ownerProviderRef || !found || parent.DefinitionIndex != definition.ReceivedShieldParentIndex || parent.Source != owner || parent.Owner != owner || parent.Stacks != 1 || parent.ExpireAt != 0 {
		return bad()
	}
	amount := 0.0
	for _, row := range f.eventCtx.shieldAbsorptions.Rows {
		if !validShieldAbsorption(row) || row.Owner != f.eventCtx.eventTargetKey {
			return bad()
		}
		if row.DefinitionRef != definition.ShieldDefinitionRef {
			continue
		}
		if !row.LifecycleBound || row.LifecycleIndex != index || row.LifecycleProviderRef == "" {
			return bad()
		}
		if row.Source == owner && row.Owner == owner {
			amount += row.Absorbed
		}
	}
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return bad()
	}
	return amount, nil
}
