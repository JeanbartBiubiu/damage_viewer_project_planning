package compile

import (
	"tinygo_engine_v2/internal/model"
)

// Replacement roles must be consumed by the complete real INITIAL binding.
// Several separately mounted replacement definitions are allowed at compile time.
func finalizeAttackDamageRoles(ctx *genericCompileContext) {
	for index, ability := range ctx.session.Abilities {
		if !ability.HasSkillHit || ability.OperationCount != 1 {
			continue
		}
		hit := ctx.session.Operations[ability.OperationStart].SkillHit
		if hit == nil || !hit.ReplacesPrimary {
			continue
		}
		bound := false
		for _, binding := range ctx.session.SkillActionBindings {
			for _, hitBinding := range binding.HitBindings {
				ref, found := ctx.session.AbilityRefIndex[hitBinding.HitAbilityRef]
				if found && int(ref.AbilityIndex) == index && !binding.HasEmpoweredAttack {
					ctx.collector.addError(model.GenericErrUnknownRef, hit.Candidates[0].Path+".attackDamageRole", "REPLACE_PRIMARY cannot be consumed by a non-empowered process", ability.AbilityKey)
				}
			}
			if binding.HasEmpoweredAttack && binding.ReplacesPrimary && int(binding.EmpoweredAbilityIndex) == index {
				initial := ctx.session.Abilities[binding.InitialAbilityIndex]
				if initial.ProcessControl != nil && initial.ProcessControl.RequireExplicitSelfTarget != nil && *initial.ProcessControl.RequireExplicitSelfTarget {
					bound = true
				}
			}
		}
		if !bound {
			ctx.collector.addError(model.GenericErrUnknownRef, hit.Candidates[0].Path+".attackDamageRole", "REPLACE_PRIMARY requires its own complete self-targeted INITIAL empowered binding", ability.AbilityKey)
		}
	}
}
