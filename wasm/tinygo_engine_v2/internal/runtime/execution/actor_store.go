package execution

import (
	"strings"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type combatantRuntime struct {
	instances effectpkg.InstanceState
	numbers   actor.State

	cooldowns *actionpkg.CooldownLedger

	providerState effectpkg.BagState
}

func (s *Engine) combatantHp(key string) float64 {
	c, ok := s.combatants[key]
	if !ok {
		return 0
	}
	if slot, ok := c.attributesView().LookupIndex(c.attributesView().Layout().HPIndex()); ok {
		return slot.Current
	}
	return 0
}

func (s *Engine) combatantHasHp(key string) bool {
	c, ok := s.combatants[key]
	if !ok {
		return false
	}
	_, ok = c.attributesView().LookupIndex(c.attributesView().Layout().HPIndex())
	return ok
}

func combatantPrefixFromAbilityRef(abilityRef string) string {
	if idx := strings.Index(abilityRef, "."); idx > 0 {
		return abilityRef[:idx]
	}
	return abilityRef
}

func (s *Engine) resolveOperationTarget(selector, entrySource, entryTarget string) (string, bool) {
	key, ok := s.resolveCombatantKey(selector, entrySource, entryTarget)
	return key, ok
}

func (s *Engine) resolveCombatantKey(selector, entrySource, entryTarget string) (string, bool) {
	switch selector {
	case model.SelectorSource:
		return entrySource, s.combatantExists(entrySource)
	case model.SelectorTarget:
		return entryTarget, s.combatantExists(entryTarget)
	case model.SelectorSelf:
		return entrySource, s.combatantExists(entrySource)
	case model.SelectorOpponent:
		if entrySource == model.SelectorSource {
			return model.SelectorTarget, s.combatantExists(model.SelectorTarget)
		}
		if entrySource == model.SelectorTarget {
			return model.SelectorSource, s.combatantExists(model.SelectorSource)
		}
		return entryTarget, s.combatantExists(entryTarget)
	default:
		if s.combatantExists(selector) {
			return selector, true
		}
		return "", false
	}
}

func (s *Engine) combatantExists(key string) bool {
	_, ok := s.combatants[key]
	return ok
}

func (c combatantRuntime) attributesView() attribute.Table { return c.numbers.Attributes() }

func (c combatantRuntime) resourceView() model.ResourceView { return c.numbers.Resources() }

func (c combatantRuntime) hpMaxAnchorValue() float64 { return c.numbers.HPMaxAnchor() }

func (c *combatantRuntime) setAttributes(value attribute.Table) {
	c.numbers = c.numbers.WithAttributes(value)
}

func (c *combatantRuntime) setHPMaxAnchor(value float64) {
	c.numbers = c.numbers.WithHPMaxAnchor(value)
}

func (c *stagedCombatant) attributesView() attribute.Table { return c.numbers.Attributes() }

func (c *stagedCombatant) resourceView() model.ResourceView { return c.numbers.Resources() }

func (c *stagedCombatant) setAttributes(value attribute.Table) { c.numbers.SetAttributes(value) }

func (c *stagedCombatant) readonlyResources() model.ResourceView { return c.numbers.FreezeResources() }
