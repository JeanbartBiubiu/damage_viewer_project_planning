package execution

import (
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func killedBasicAttackRecoveryInput(kind string, targetHP, damage float64) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, targetHP, damage, 0, 0, 1)
	addKilledRecovery(&c, &r, 0, eventTypeDamageInstance)
	c.SharedProviders[1].Kind = kind
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	// Selected authoring values remain independent named programs; admission
	// must establish that their actual dependencies are static.
	c.Formulas = append(c.Formulas,
		formuladefinition.FromExpr("recovery/hp_static", "recovery_skill", authoringBinary("add", authoringConst(18), authoringBinary("mul", authoringConst(2), authoringConst(11))), nil),
		formuladefinition.FromExpr("recovery/mana_static", "recovery_skill", authoringBinary("add", authoringConst(4), authoringConst(8)), nil))
	operations := c.SharedProviders[1].Abilities[0].ListenerSpec.Operations
	operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "recovery/hp_static"})
	operations[1].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "recovery/mana_static"})
	return c, r
}
