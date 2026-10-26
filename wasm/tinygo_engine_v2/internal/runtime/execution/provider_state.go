package execution

import (
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

const (
	stateScopeProvider       = effectpkg.StateScopeProvider
	stateScopeProviderTarget = effectpkg.StateScopeProviderTarget
)

func (s *Engine) restoreProviderStateTimers(snapshot model.Snapshot) *model.EngineError {
	combatantKeys := map[string]bool{}
	for _, c := range snapshot.Combatants {
		combatantKeys[c.Key] = true
	}
	for i, snap := range snapshot.Combatants {
		rt, ok := s.combatants[snap.Key]
		if !ok {
			continue
		}
		base := "initialSnapshot.combatants[" + itoa(uint32(i)) + "].providerState"
		if err := s.validateRawProviderState(snap.ProviderState, rt, base); err != nil {
			return err
		}
		for _, providerRef := range rt.providerState.Keys() {
			bag := rt.providerState.Edit(providerRef, false)
			if !bag.Present() {
				continue
			}
			defs := s.resolveProviderStateFieldDefs(snap.Key, providerRef, rt.instances.Providers())
			if defs == nil {
				continue
			}
			bag.BindFieldDefs(defs)
			path := base + "[" + providerRef + "]"
			if err := bag.RestoreTimers(snapshot.TimeMs, combatantKeys, path, s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID); err != nil {
				return err
			}
			if rt.cooldowns == nil {
				rt.cooldowns = actionpkg.NewCooldownLedger()
			}
			migrateInternalCooldownTimers(bag, rt.cooldowns, snap.Key, providerRef, snapshot.TimeMs)
		}
		s.combatants[snap.Key] = rt
	}
	return nil
}
