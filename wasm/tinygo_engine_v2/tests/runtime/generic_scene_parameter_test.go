// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func sceneParameterInitializationInput() (model.CompileRequest, model.RunRequest) {
	input, request := sourceInitializationInput()
	for actorIndex, skill := range []string{"unrelated_origin_alpha", "different_origin_beta"} {
		for key, value := range map[string]float64{"armor": 27, "magic_resist": 33} {
			input.Combatants[actorIndex].Attributes[key] = authoringSlot(value)
			request.InitialSnapshot.Combatants[actorIndex].Attributes[key] = authoringSlot(value)
		}
		count := float64(actorIndex * 7)
		key := skill + "/initial_bonus"
		def := formuladefinition.FromExpr(key, skill, authoringBinary("mul", authoringRead("ability.param.initial_count"), authoringConst(.2)), nil)
		def.Parameters[0].ValueType = "INTEGER"
		def.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(count)}
		input.Formulas = append(input.Formulas, def)
		for _, attribute := range []string{"armor", "magic_resist"} {
			providerKey := skill + "_" + attribute
			addPermanentSkillSource(&input, &request, actorIndex, providerKey, "character", model.ModifierDefinition{ModifierKey: attribute + "_bonus", Kind: "attribute", Target: "self.attr." + attribute, ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: key}})
			for i := range input.SharedProviders {
				provider := &input.SharedProviders[i]
				if provider.ProviderKey == providerKey || provider.ProviderKey == providerKey+"_effect" {
					provider.SkillKey = skill
				}
			}
		}
	}
	return input, request
}

func TestSceneParameterSourceInitializedPermanentDualAttributesStayFrozenPerSession(t *testing.T) {
	input, request := sceneParameterInitializationInput()
	compiled := compilebundle.CompileGeneric(input)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	request.ExpectedRulesHash = compiled.Session.RulesHash
	for actorIndex, key := range []string{"unrelated_origin_alpha/initial_bonus", "different_origin_beta/initial_bonus"} {
		got, exists := compiled.Result.Metadata.ApprovedStaticValues[key]
		if !exists || math.Abs(got-float64(actorIndex*7)*.2) > 1e-12 {
			t.Fatal("explicit initial value not statically approved", key, got, exists)
		}
	}
	// Both the nested scalar and its owner remain mutable caller DTOs, never session storage.
	for i := range input.Formulas {
		if len(input.Formulas[i].Parameters) == 0 || input.Formulas[i].Parameters[0].RuntimeSource == nil {
			continue
		}
		source := input.Formulas[i].Parameters[0].RuntimeSource
		*source.Value = math.NaN()
		source.Value, source.Kind, source.ResourceKey = model.Float64Ptr(999), "ability_parameter", "mana"
	}
	var first []byte
	for repeat := 0; repeat < 3; repeat++ {
		done, err := runtimeengine.RunGeneric(compiled.Session, request)
		if err != nil {
			t.Fatal(repeat, err)
		}
		for actorIndex, actor := range done.FinalSnapshot.Combatants {
			bonus := float64(actorIndex*7) * .2
			if math.Abs(actor.Attributes["armor"].Resolved-(27+bonus)) > 1e-12 || math.Abs(actor.Attributes["magic_resist"].Resolved-(33+bonus)) > 1e-12 {
				t.Fatal("scene count leaked across skills/actors or repeated initialization", repeat, actor.Key, actor.Attributes)
			}
			if len(actor.Providers) != len(request.InitialSnapshot.Combatants[actorIndex].Providers)+2 {
				t.Fatal("permanent effect mounted more than once", repeat, actor.Providers)
			}
		}
		if !done.Summary.Execution.Complete || len(done.AttackRecords) != 2 {
			t.Fatal("ordinary basic attacks lost while initializing", done.Summary, done.AttackRecords)
		}
		if want := 200 * 100 / (100 + 28.4); math.Abs(done.Summary.SourceDamageDealt-want) > 1e-9 {
			t.Fatal("first attack did not observe permanent armor", done.Summary.SourceDamageDealt, want)
		}
		encoded, encodeErr := json.Marshal(done)
		if encodeErr != nil {
			t.Fatal(encodeErr)
		}
		if repeat == 0 {
			first = encoded
		} else if string(encoded) != string(first) {
			t.Fatal("same-session runs changed results or records")
		}
	}
	// A later compile uses new explicit values and cannot rewrite the first session.
	newInput, newRequest := sceneParameterInitializationInput()
	for i := range newInput.Formulas {
		if len(newInput.Formulas[i].Parameters) > 0 && newInput.Formulas[i].Parameters[0].RuntimeSource != nil {
			*newInput.Formulas[i].Parameters[0].RuntimeSource.Value = 5
		}
	}
	newDone := authoringRun(t, newInput, newRequest)
	for _, actor := range newDone.FinalSnapshot.Combatants {
		if actor.Attributes["armor"].Resolved != 28 || actor.Attributes["magic_resist"].Resolved != 34 {
			t.Fatal("second session ignored its own scene values", actor.Attributes)
		}
	}
	oldDone, err := runtimeengine.RunGeneric(compiled.Session, request)
	if err != nil {
		t.Fatal(err)
	}
	encoded, encodeErr := json.Marshal(oldDone)
	if encodeErr != nil || string(encoded) != string(first) {
		t.Fatal("later compile or DTO mutations changed an existing session", encodeErr)
	}
}
