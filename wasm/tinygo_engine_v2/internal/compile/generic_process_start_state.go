package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// Only actual empowered result amount operations can receive this per-use
// capability. A named formula declaration alone does not grant a read context.
func finalizeProcessStartStateReads(ctx *genericCompileContext) {
	allowed := make([]bool, len(ctx.session.Operations))
	for _, binding := range ctx.session.SkillActionBindings {
		if !binding.HasEmpoweredAttack {
			continue
		}
		initial := ctx.session.Abilities[binding.InitialAbilityIndex]
		provider := &ctx.session.Providers[initial.ProviderIndex]
		if initial.ProcessControl == nil || initial.ProcessControl.ProcessIndex < 0 {
			continue
		}
		process := &provider.Processes[initial.ProcessControl.ProcessIndex]
		payload := ctx.session.Abilities[binding.EmpoweredAbilityIndex]
		for _, root := range ctx.session.Operations[payload.OperationStart : payload.OperationStart+payload.OperationCount] {
			if root.SkillHit == nil {
				continue
			}
			for _, candidate := range root.SkillHit.Candidates {
				for index := candidate.OperationStart; index < candidate.OperationStart+candidate.OperationCount; index++ {
					op := ctx.session.Operations[index]
					if !op.HasAmount || op.Operation != "damage" {
						continue
					}
					allowed[index] = true
					for _, dep := range ctx.formulas.ReadDependencies(op.AmountProgram) {
						if dep.ReadKind != formula.ReadProcessStartState {
							continue
						}
						field, found := provider.StateFields[dep.ReadKey]
						valid := found && field.ValueType == model.ProviderStateValueInteger && field.StateKind == "" && process.SkillKey == binding.SkillKey && provider.SkillKey == binding.SkillKey
						writes := 0
						for _, moment := range process.MomentOperations {
							if moment.Moment.MomentType != "PROCESS_START" {
								continue
							}
							for _, set := range ctx.session.Operations[moment.OperationStart : moment.OperationStart+moment.OperationCount] {
								if set.Operation != "state_change" || set.Ref != dep.ReadKey {
									continue
								}
								writes++
								valid = valid && !set.HasCondition && set.StateScope == "state_scope/provider" && (set.Target == "self" || set.Target == "source") && (set.ValuePolicy == "set" || set.ValuePolicy == "override") && set.HasAmount && set.OwnerProviderIndex == int(initial.ProviderIndex)
							}
						}
						if !valid || writes != 1 {
							ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path+".amount", "process start state requires its own integer counter and exactly one unconditional START SET", dep.ReadKey)
							continue
						}
						seen := false
						for _, key := range process.StartStateKeys {
							seen = seen || key == dep.ReadKey
						}
						if !seen {
							process.StartStateKeys = append(process.StartStateKeys, dep.ReadKey)
						}
					}
				}
			}
		}
	}
	for i, op := range ctx.session.Operations {
		if !op.HasAmount {
			continue
		}
		for _, dep := range ctx.formulas.ReadDependencies(op.AmountProgram) {
			if dep.ReadKind == formula.ReadProcessStartState && !allowed[i] {
				ctx.collector.addError(model.GenericErrFormulaTypeError, op.Path+".amount", "process start state requires the actual same-process empowered execution payload", dep.ReadKey)
			}
		}
	}
}
