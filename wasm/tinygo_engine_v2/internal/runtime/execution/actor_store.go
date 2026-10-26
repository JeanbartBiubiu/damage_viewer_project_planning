package execution

import (
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

func (c combatantRuntime) attributesView() attribute.Table  { return c.numbers.Attributes() }
func (c combatantRuntime) resourceView() model.ResourceView { return c.numbers.Resources() }
func (c combatantRuntime) hpMaxAnchorValue() float64        { return c.numbers.HPMaxAnchor() }
func (c *combatantRuntime) setAttributes(value attribute.Table) {
	c.numbers = c.numbers.WithAttributes(value)
}
func (c *combatantRuntime) setHPMaxAnchor(value float64) {
	c.numbers = c.numbers.WithHPMaxAnchor(value)
}

func (c *stagedCombatant) attributesView() attribute.Table       { return c.numbers.Attributes() }
func (c *stagedCombatant) resourceView() model.ResourceView      { return c.numbers.Resources() }
func (c *stagedCombatant) setAttributes(value attribute.Table)   { c.numbers.SetAttributes(value) }
func (c *stagedCombatant) readonlyResources() model.ResourceView { return c.numbers.FreezeResources() }
