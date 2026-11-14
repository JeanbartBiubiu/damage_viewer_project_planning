package compile

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func compileSkillActionBindings(bindings []model.SkillActionBinding, ctx *genericCompileContext) {
	seen := map[string]bool{}
	seenOrigins := map[string]bool{}
	if len(bindings) > 16 {
		ctx.collector.addError(model.GenericErrUnknownRef, "rules.skillActionBindings", "at most 16 skill bindings are admitted", "")
	}
	for index, binding := range bindings {
		path := "rules.skillActionBindings[" + itoa(index) + "]"
		fail := func(message string) {
			ctx.collector.addError(model.GenericErrUnknownRef, path, message, binding.BindingKey)
		}
		if strings.TrimSpace(binding.BindingKey) == "" || strings.TrimSpace(binding.SkillKey) == "" || binding.Source != model.SelectorSource || seen[binding.BindingKey] || seenOrigins[binding.ProviderRef] {
			fail("binding requires a unique source identity and skill")
			continue
		}
		seen[binding.BindingKey], seenOrigins[binding.ProviderRef] = true, true
		if len(binding.Controls) < 1 || len(binding.Controls) > 4 || binding.Controls[0].Action != "INITIAL" || len(binding.HitBindings) > 64 {
			fail("planned binding requires an initial control and finite same-process controls and releases")
			continue
		}
		control := binding.Controls[0]
		parsed, valid := plan.ParseAbilityRef(control.AbilityRef)
		ref, found := ctx.session.AbilityRefIndex[control.AbilityRef]
		if !valid || !found || parsed.Combatant != binding.Source || parsed.ProviderRef != binding.ProviderRef {
			fail("control must belong to the actual source mount")
			continue
		}
		provider := ctx.session.Providers[ref.ProviderIndex]
		ability := ctx.session.Abilities[ref.AbilityIndex]
		if provider.ProviderKey != binding.ProviderDefinitionRef || ability.Kind != "active" || ability.IsBasicAttack || ability.SkillKey != binding.SkillKey || ability.ProcessControl == nil || ability.ProcessControl.Action != "INITIAL" || ability.ProcessControl.ProcessKey != control.ProcessKey || ability.ProcessControl.UseRefFromEvent {
			fail("binding must match a non-basic INITIAL process and definition")
			continue
		}
		if ability.ProcessControl.ProcessIndex < 0 || ability.ProcessControl.ProcessIndex >= len(provider.Processes) {
			fail("binding control requires its declared compiled process")
			continue
		}
		process := provider.Processes[ability.ProcessControl.ProcessIndex]
		if process.SkillKey != binding.SkillKey || len(process.Steps) < 1 || len(process.Steps) > 64 {
			fail("planned cast requires one declared finite process with at most 64 steps")
			continue
		}
		invalid := false
		complexStep := ""
		empowered := len(process.Steps) == 1 && process.Steps[0].StepType == "EMPOWERED_BASIC_ATTACK"
		var empoweredAbility uint16
		replacesPrimary := false
		if empowered && (len(binding.Controls) != 1 || len(binding.HitBindings) != 1) {
			fail("empowered attack requires its initial control and one complete result binding")
			invalid = true
		}
		if empowered {
			for _, moment := range process.MomentOperations {
				if moment.Moment.MomentType == "STEP_EXECUTION" && moment.OperationCount != 0 {
					fail("empowered execution results must use their one ordered payload, not separate moment operations")
					invalid = true
				}
				if process.Steps[0].MaximumAttackCount > 0 && moment.Moment.MomentType == "STEP_TIMEOUT" && moment.OperationCount != 0 {
					fail("counted attack window expires through normal process completion")
					invalid = true
				}
			}
		}
		hasDelay := false
		finiteRecast := plan.FiniteRecastProcess(&process)
		for stepIndex, step := range process.Steps {
			hasDelay = hasDelay || step.StepType == "DELAY"
			if !step.HasActionOccupancy {
				fail("every planned skill step requires an explicit occupiesAction boolean")
				invalid = true
			}
			if step.StepType == "MULTI_HIT" || step.StepType == "CHANNEL" || step.StepType == "CHARGE" || step.StepType == "RECAST" || step.StepType == "EMPOWERED_BASIC_ATTACK" {
				if complexStep != "" || stepIndex != len(process.Steps)-1 {
					fail("planned complex process admits only one final complex step")
					invalid = true
				}
				complexStep = step.StepKey
			}
		}
		if _, exists := ctx.session.Types.Registry.LookupDomain("event", "event/ability_started"); !exists {
			fail("single cast requires its real successful-use event catalog")
			continue
		}
		controls := map[string]uint16{"INITIAL": ref.AbilityIndex}
		for _, selected := range binding.Controls[1:] {
			selectedRef, exists := ctx.session.AbilityRefIndex[selected.AbilityRef]
			selectedMount, valid := plan.ParseAbilityRef(selected.AbilityRef)
			_, duplicate := controls[selected.Action]
			if duplicate || !exists || !valid || selectedMount.Combatant != binding.Source || selectedMount.ProviderRef != binding.ProviderRef || selected.ProcessKey != control.ProcessKey || (selected.Action != "RECAST" && selected.Action != "CHARGE_RELEASE" && selected.Action != "CANCEL") || selectedRef.ProviderIndex != ref.ProviderIndex {
				fail("control must name a unique declared phase on the original source process")
				invalid = true
				continue
			}
			selectedAbility := ctx.session.Abilities[selectedRef.AbilityIndex]
			if selectedAbility.Kind != "active" || selectedAbility.IsBasicAttack || selectedAbility.SkillKey != binding.SkillKey || selectedAbility.ProcessControl == nil || selectedAbility.ProcessControl.Action != selected.Action || selectedAbility.ProcessControl.ProcessKey != control.ProcessKey || selectedAbility.ProcessControl.UseRefFromEvent {
				fail("control must match the actual stage ability without another initial use")
				invalid = true
				continue
			}
			controls[selected.Action] = selectedRef.AbilityIndex
		}
		seenHits, seenMoments := map[string]bool{}, map[string]bool{}
		hitSteps := map[string]int{}
		hasExplicitSteps, hasImplicitCompletion := false, false
		for _, hit := range binding.HitBindings {
			parsedHit, validHit := plan.ParseAbilityRef(hit.HitAbilityRef)
			hitRef, foundHit := ctx.session.AbilityRefIndex[hit.HitAbilityRef]
			momentKey := hit.Moment.MomentType
			validMoment := complexStep == "" && hit.Moment.MomentType == "PROCESS_COMPLETE" && hit.Moment.StepKey == nil
			stepIndex := len(process.Steps) - 1
			if hit.Moment.MomentType == "STEP_EXECUTION" && hit.Moment.StepKey != nil {
				validMoment = complexStep != "" && *hit.Moment.StepKey == complexStep
				if complexStep == "" || finiteRecast {
					for index, step := range process.Steps {
						if step.StepKey == *hit.Moment.StepKey && (step.StepType == "IMMEDIATE" || step.StepType == "DELAY") {
							stepIndex, validMoment = index, true
							break
						}
					}
				}
				momentKey += "|" + *hit.Moment.StepKey
			}
			if !validHit || !foundHit || parsedHit.Combatant != binding.Source || parsedHit.ProviderRef != binding.ProviderRef || strings.TrimSpace(hit.HitBindingKey) == "" || seenHits[hit.HitBindingKey] || seenMoments[momentKey] || hit.ProcessKey != control.ProcessKey || !validMoment || hit.Moment.FailureReason != nil {
				fail("hit binding must uniquely name this process real execution or successful completion")
				invalid = true
				continue
			}
			seenHits[hit.HitBindingKey], seenMoments[momentKey] = true, true
			hitSteps[hit.HitBindingKey] = stepIndex
			hasExplicitSteps = hasExplicitSteps || hit.Moment.MomentType == "STEP_EXECUTION" && complexStep == ""
			hasImplicitCompletion = hasImplicitCompletion || hit.Moment.MomentType == "PROCESS_COMPLETE"
			hitAbility := ctx.session.Abilities[hitRef.AbilityIndex]
			if hitRef.ProviderIndex != ref.ProviderIndex || !hitAbility.HasSkillHit || hitAbility.IsBasicAttack || hitAbility.SkillKey != binding.SkillKey || hitAbility.Kind != "active" || hitAbility.Cost != nil || hitAbility.Cooldown != nil || hitAbility.ProcessControl != nil {
				fail("release must resolve the same skill with no independent cost or cooldown")
				invalid = true
				continue
			}
			if empowered {
				if hitAbility.HasCastCondition || hitAbility.TickSpec != nil || hitAbility.OperationCount != 1 || ctx.session.Operations[hitAbility.OperationStart].Operation != model.OperationKindResolveSkillHit {
					fail("empowered result must contain only its complete own native hit plan")
					invalid = true
				}
				empoweredAbility = hitRef.AbilityIndex
				if hitAbility.OperationCount == 1 {
					hitPlan := ctx.session.Operations[hitAbility.OperationStart].SkillHit
					replacesPrimary = hitPlan != nil && hitPlan.ReplacesPrimary
				}
			}
		}
		if hasExplicitSteps && hasImplicitCompletion {
			fail("explicit step hits cannot mix with an implicit completion hit")
			invalid = true
		}
		if empowered && process.Steps[0].MaximumAttackCount > 0 && replacesPrimary {
			fail("counted attack windows only admit attached damage, never primary replacement")
			invalid = true
		}
		if hasExplicitSteps && len(process.Steps) > 1 && !hasDelay && !finiteRecast {
			fail("explicit multi-step hits require at least one finite positive delay")
			invalid = true
		}
		if finiteRecast && (len(binding.HitBindings) != 2 || len(hitSteps) != 2 || binding.HitBindings[0].RequiresPriorHitBindingKey != nil || binding.HitBindings[1].RequiresPriorHitBindingKey != nil) {
			fail("finite recast requires one independent execution hit on each of its two steps")
			invalid = true
		}
		for _, hit := range binding.HitBindings {
			if hit.RequiresPriorHitBindingKey == nil {
				continue
			}
			priorStep, priorFound := hitSteps[*hit.RequiresPriorHitBindingKey]
			currentStep, currentFound := hitSteps[hit.HitBindingKey]
			if strings.TrimSpace(*hit.RequiresPriorHitBindingKey) == "" || !priorFound || !currentFound || priorStep >= currentStep {
				fail("required prior hit must name a strictly earlier actual step in this same binding")
				invalid = true
			}
		}
		if !invalid {
			compiled := plan.CompiledSkillActionBinding{SkillActionBinding: binding, Slot: uint16(len(ctx.session.SkillActionBindings)), InitialAbilityIndex: ref.AbilityIndex, ControlAbilityIndices: controls}
			compiled.HasEmpoweredAttack, compiled.EmpoweredAbilityIndex = empowered, empoweredAbility
			compiled.ReplacesPrimary = replacesPrimary
			compiled.HasFiniteRecast = finiteRecast
			compiled.AutomaticIneligiblePath, compiled.AutomaticIneligibleReason = automaticSkillAdmission(binding, process, ability, path, ctx)
			compiled.AutomaticEligible = compiled.AutomaticIneligibleReason == ""
			ctx.session.SkillActionBindings = append(ctx.session.SkillActionBindings, compiled)
		}
	}
}

// 同一绑定可用于有限手动计划；自动准入单独保存，避免拒绝合法手动控制。
func automaticSkillAdmission(binding model.SkillActionBinding, process plan.CompiledProcess, ability plan.CompiledAbility, path string, ctx *genericCompileContext) (string, string) {
	finiteRecast := plan.FiniteRecastProcess(&process)
	if (!finiteRecast && len(binding.Controls) != 1 || finiteRecast && (len(binding.Controls) != 2 || binding.Controls[1].Action != "RECAST")) || binding.Controls[0].Action != "INITIAL" {
		return path + ".controls", "automatic skills admit only the initial control"
	}
	if len(process.Steps) < 1 || len(process.Steps) > 64 {
		return process.Path + ".steps", "automatic skills require 1 to 64 finite steps"
	}
	hasDelay := false
	for _, step := range process.Steps {
		hasDelay = hasDelay || step.StepType == "DELAY"
		if step.StepType != "IMMEDIATE" && step.StepType != "DELAY" && !(finiteRecast && step.StepType == "RECAST") && !(len(process.Steps) == 1 && (step.StepType == "CHANNEL" || step.StepType == "EMPOWERED_BASIC_ATTACK")) {
			return step.Path + ".stepType", "automatic skills admit finite immediate or delay sequences, or one channel or empowered step"
		}
	}
	if len(process.Steps) > 1 && !hasDelay && !finiteRecast {
		return process.Path + ".steps", "automatic multi-step skills require at least one finite positive delay"
	}
	if process.Cooldown == nil || !process.Cooldown.HasDuration || int(process.Cooldown.DurationProgram) >= ctx.formulas.Count() {
		return process.Path + ".cooldown", "automatic skills require an authored positive process cooldown"
	}
	cd := process.Cooldown
	if cd.StartMoment.MomentType == "PROCESS_FAILURE" {
		return cd.Path + ".startMoment", "automatic skills require cooldown on a successful process path"
	}
	program := ctx.formulas.Instructions(cd.DurationProgram)
	if value, constant := ctx.formulas.FoldInstructions(program); constant {
		if cd.RoundPositiveMs && value > 0 {
			value = math.Max(1, math.Round(value))
		}
		if !formula.ValidPositiveInt64DurationMs(value) || value > 9007199254740991 {
			return cd.Path + ".durationMs", "automatic skills require a positive safe integer cooldown"
		}
	}
	return stableCastConditionIssue(ability, path+".controls[0].abilityRef", ctx)
}

// 首次手动和自动施放共用稳定启动上下文，不能读取尚不存在的事件或同次使用字段。
func stableCastConditionIssue(ability plan.CompiledAbility, path string, ctx *genericCompileContext) (string, string) {
	if ability.HasCastCondition {
		conditionPath := path
		if int(ability.CastConditionProgram) < ctx.formulas.Count() {
			conditionPath = ctx.formulas.Info(formula.GenericProgramID(ability.CastConditionProgram)).Key
		}
		for _, instruction := range ctx.formulas.ReadDependencies(ability.CastConditionProgram) {
			switch instruction.ReadKind {
			case formula.ReadSourceAttr, formula.ReadTargetAttr, formula.ReadSourceResource, formula.ReadTargetResource,
				formula.ReadAbilityParam, formula.ReadProviderState, formula.ReadProviderTargetState,
				formula.ReadSourceStatusPresent, formula.ReadTargetStatusPresent:
			default:
				return conditionPath, "cast conditions require a stable candidate context"
			}
		}
	}
	return "", ""
}
