package compile

import (
	"strings"
	"tinygo_engine_v2/internal/model"
)

type CompiledSkillActionBinding struct {
	model.SkillActionBinding
	InitialAbilityIndex uint16
}

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
		if len(binding.Controls) != 1 || binding.Controls[0].Action != "INITIAL" || len(binding.HitBindings) > 1 {
			fail("single-cast binding requires one INITIAL control and at most one completed hit")
			continue
		}
		control := binding.Controls[0]
		parsed, valid := ParseAbilityRef(control.AbilityRef)
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
		process := provider.Processes[ability.ProcessControl.ProcessIndex]
		if process.SkillKey != binding.SkillKey || len(process.Steps) != 1 || (process.Steps[0].StepType != "DELAY" && process.Steps[0].StepType != "IMMEDIATE") {
			fail("single cast requires one declared finite immediate or delay step")
			continue
		}
		if !process.Steps[0].HasActionOccupancy {
			fail("planned skill step requires an explicit occupiesAction boolean")
			continue
		}
		if _, exists := ctx.session.Types.Registry.Lookup("event/ability_started"); !exists {
			fail("single cast requires its real successful-use event catalog")
			continue
		}
		if len(binding.HitBindings) == 1 {
			hit := binding.HitBindings[0]
			parsedHit, validHit := ParseAbilityRef(hit.HitAbilityRef)
			hitRef, foundHit := ctx.session.AbilityRefIndex[hit.HitAbilityRef]
			if !validHit || !foundHit || parsedHit.Combatant != binding.Source || parsedHit.ProviderRef != binding.ProviderRef || strings.TrimSpace(hit.HitBindingKey) == "" || hit.ProcessKey != control.ProcessKey || hit.Moment.MomentType != "PROCESS_COMPLETE" || hit.Moment.StepKey != nil || hit.Moment.FailureReason != nil {
				fail("hit binding must name this process successful completion and source mount")
				continue
			}
			hitAbility := ctx.session.Abilities[hitRef.AbilityIndex]
			if hitRef.ProviderIndex != ref.ProviderIndex || !hitAbility.HasSkillHit || hitAbility.IsBasicAttack || hitAbility.SkillKey != binding.SkillKey || hitAbility.Kind != "active" || hitAbility.Cost != nil || hitAbility.Cooldown != nil || hitAbility.ProcessControl != nil {
				fail("release must resolve the same skill with no independent cost or cooldown")
				continue
			}
		}
		ctx.session.SkillActionBindings = append(ctx.session.SkillActionBindings, CompiledSkillActionBinding{SkillActionBinding: binding, InitialAbilityIndex: ref.AbilityIndex})
	}
}
