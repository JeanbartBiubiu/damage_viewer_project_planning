package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func automaticBindingCompileRequest() model.CompileRequest {
	request := processCompileRequest()
	provider := &request.SharedProviders[0]
	provider.Abilities = provider.Abilities[:1]
	process := &provider.Processes[0]
	process.Steps = []model.ProcessStepDefinition{
		{StepKey: "release", StepType: "DELAY", OccupiesAction: model.BoolPtr(true), DelayMs: processCompileNumber(250)},
	}
	known := false
	for _, entry := range request.TypeCatalog.Types {
		known = known || entry.Key == "event/ability_started"
	}
	if !known {
		request.TypeCatalog.Types = append(request.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"})
	}
	mount := request.Combatants[0].Providers[0]
	request.Rules.SkillActionBindings = []model.SkillActionBinding{{BindingKey: "bound_q", Source: "source", ProviderRef: mount.ProviderRef,
		ProviderDefinitionRef: provider.ProviderKey, SkillKey: "skill:q", Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "cast", AbilityRef: "source.provider[" + mount.ProviderRef + "].ability[initial]"}}, HitBindings: []model.SkillActionHitBinding{}}}
	return request
}

func TestSkillActionCompileMarksAutomaticFirstProcessAdmission(t *testing.T) {
	for _, rounded := range []bool{false, true} {
		request := automaticBindingCompileRequest()
		if rounded {
			request.SharedProviders[0].Processes[0].Cooldown.RoundPositiveMs = true
			request.SharedProviders[0].Processes[0].Cooldown.DurationMs = *processCompileNumber(.4)
		}
		result := CompileGeneric(request)
		if !result.OK || len(result.Session.SkillActionBindings) != 1 {
			t.Fatal(result.Result.Errors)
		}
		binding := result.Session.SkillActionBindings[0]
		if !binding.AutomaticEligible || binding.AutomaticIneligiblePath != "" || binding.AutomaticIneligibleReason != "" || binding.InitialAbilityIndex != 0 {
			t.Fatal(binding)
		}
	}
}

func TestAutomaticAdmissionDoesNotRejectManualShapes(t *testing.T) {
	cases := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"multiple steps", ".steps", func(request *model.CompileRequest) {
			process := &request.SharedProviders[0].Processes[0]
			process.Steps = append(process.Steps, model.ProcessStepDefinition{StepKey: "extra", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)})
		}},
		{"missing cooldown", ".cooldown", func(request *model.CompileRequest) { request.SharedProviders[0].Processes[0].Cooldown = nil }},
		{"zero cooldown", ".durationMs", func(request *model.CompileRequest) {
			request.SharedProviders[0].Processes[0].Cooldown.DurationMs = *processCompileNumber(0)
		}},
		{"failure-only cooldown", ".startMoment", func(request *model.CompileRequest) {
			request.SharedProviders[0].Processes[0].Cooldown.StartMoment.MomentType = "PROCESS_FAILURE"
		}},
		{"recast step", ".stepType", func(request *model.CompileRequest) {
			step := &request.SharedProviders[0].Processes[0].Steps[0]
			step.StepType, step.DelayMs, step.WindowMs = "RECAST", nil, processCompileNumber(1000)
		}},
		{"explicit cancel", ".controls", func(request *model.CompileRequest) {
			request.SharedProviders[0].Abilities = append(request.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "cancel", Kind: "active", SkillKey: "skill:q", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "cast", Action: "CANCEL", FailureReason: "ACTIVE_CANCELLED"}})
			binding := &request.Rules.SkillActionBindings[0]
			binding.Controls = append(binding.Controls, model.SkillActionControl{Action: "CANCEL", ProcessKey: "cast", AbilityRef: "source.provider[" + binding.ProviderRef + "].ability[cancel]"})
		}},
	}
	for _, scenario := range cases {
		t.Run(scenario.name, func(t *testing.T) {
			request := automaticBindingCompileRequest()
			scenario.mutate(&request)
			result := CompileGeneric(request)
			if !result.OK || len(result.Session.SkillActionBindings) != 1 {
				t.Fatalf("manual shape lost: %+v", result.Result.Errors)
			}
			binding := result.Session.SkillActionBindings[0]
			if binding.AutomaticEligible || binding.AutomaticIneligibleReason == "" || !strings.HasSuffix(binding.AutomaticIneligiblePath, scenario.path) {
				t.Fatal(binding)
			}
		})
	}
}

func TestAutomaticBindingInvalidProcessCannotPanic(t *testing.T) {
	request := automaticBindingCompileRequest()
	request.SharedProviders[0].Processes = nil
	result := CompileGeneric(request)
	if result.OK || len(result.Session.SkillActionBindings) != 0 {
		t.Fatal("invalid process binding was admitted", result.Result)
	}
}

func TestSkillActionBindingLimitRemainsSixteen(t *testing.T) {
	request := automaticBindingCompileRequest()
	for len(request.Rules.SkillActionBindings) < 17 {
		request.Rules.SkillActionBindings = append(request.Rules.SkillActionBindings, request.Rules.SkillActionBindings[0])
	}
	result := CompileGeneric(request)
	if result.OK || !hasErrorPath(result.Result.Errors, "rules.skillActionBindings") {
		t.Fatal(result.Result)
	}
}
