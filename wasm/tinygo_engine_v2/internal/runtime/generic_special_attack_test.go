package runtime

import (
	"math"
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func TestSpecialAttackStatusPresenceChoosesOneBodyAndExpiresAtBoundary(test *testing.T) {
	for _, lifetime := range []float64{1000, 3000} {
		input, request := configuredMovementEquipment(2000)
		input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/ordinary_slow", Domain: "status"})
		input.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
		request.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
		request.DriverPlan.BasicAttack.AttackSpeedInputMax = 1
		input.SharedProviders[1].Lifecycle.DurationMs = authoringAmount(authoringConst(lifetime))
		hit := input.SharedProviders[0].Abilities[2].Operations[0].SkillHit
		normal := hit.Candidates[0]
		normal.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(0)))
		special := normal
		special.CandidateKey, special.ResultKey = "status_body", "status_body"
		special.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(1)))
		special.Operations = append([]model.OperationDefinition(nil), normal.Operations...)
		special.Operations[0].Ref = "status_body"
		special.Operations[0].Amount = authoringAmount(authoringConst(200))
		hit.Candidates = []model.SkillHitCandidate{normal, special}
		done := authoringRun(test, input, request)
		expected := float64(300)
		if lifetime == 3000 {
			expected = 500
		}
		if done.Summary.SourceDamageDealt != expected || done.Summary.BasicAttack.HitCount != 3 || len(done.DamageRecords) != 3 || done.DamageRecords[0]["operationRef"] != "body" {
			test.Fatal("conditional bodies duplicated or read a future/expired status", done.Summary, done.DamageRecords)
		}
		state, err := newGenericRunState(authoringCompile(test, input), request)
		if err != nil || state.runLoop() != nil {
			test.Fatal(err)
		}
		context := state.newExecutionFrame("source", "target", authoringRef("native_hit")).evalContext(state.compiled.Abilities[2])
		if context.SourceStatuses["ordinary_slow"] || !context.TargetStatuses["ordinary_slow"] {
			test.Fatal("status presence crossed party ownership")
		}
		input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].ParticipationCondition = authoringAmount(authoringRead("target.status.undeclared.present"))
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("unknown status key compiled")
		}
	}
}

func TestSpecialAttackStatusPresenceWithoutProducerUsesDeclaredAbsence(test *testing.T) {
	input, request := configuredMovementEquipment(2000)
	input.SharedProviders = input.SharedProviders[:1]
	mounts := []model.CombatantProviderMount{}
	for _, mount := range input.Combatants[0].Providers {
		if mount.DefinitionRef == input.SharedProviders[0].ProviderKey {
			mounts = append(mounts, mount)
		}
	}
	input.Combatants[0].Providers = mounts
	snapshots := []model.CombatantProviderSnapshot{}
	for _, provider := range request.InitialSnapshot.Combatants[0].Providers {
		if provider.DefinitionRef == input.SharedProviders[0].ProviderKey {
			snapshots = append(snapshots, provider)
		}
	}
	request.InitialSnapshot.Combatants[0].Providers = snapshots
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/ordinary_slow", Domain: "status"})
	input.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
	request.InitialSnapshot.Combatants[0].Attributes["attack_speed"] = authoringSlot(1)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 1
	hit := input.SharedProviders[0].Abilities[2].Operations[0].SkillHit
	normal := hit.Candidates[0]
	normal.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(0)))
	special := normal
	special.CandidateKey, special.ResultKey = "status_body", "status_body"
	special.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("target.status.ordinary_slow.present"), authoringConst(1)))
	special.Operations = append([]model.OperationDefinition(nil), normal.Operations...)
	special.Operations[0].Amount = authoringAmount(authoringConst(200))
	hit.Candidates = []model.SkillHitCandidate{normal, special}
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 300 || done.Summary.BasicAttack.HitCount != 3 || !done.Summary.Execution.Complete {
		test.Fatal("declared absence required an active status producer", done.Summary)
	}
	input.TypeCatalog.Types = input.TypeCatalog.Types[:len(input.TypeCatalog.Types)-1]
	if result := compilebundle.CompileGeneric(input); result.OK {
		test.Fatal("status contribution inferred an undeclared catalog entry")
	}
}

func TestSpecialAttackStatusPresenceRejectsMalformedDeclaration(test *testing.T) {
	for _, key := range []string{"status/", "status/ordinary.slow", "status/Ordinary_slow"} {
		input, _ := configuredMovementEquipment(2000)
		input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "status"})
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("invalid status declaration compiled", key)
		}
	}
}

func TestSpecialAttackDamageConversionAfterOrdinaryPipelineDoesNotReapplyModifiers(test *testing.T) {
	input, request := triggeredSourceInput(1)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	input.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	request.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	input.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(.1)
	request.InitialSnapshot.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(.1)
	addFixedEquipment(&input, &request, 0, "flat_damage", "attack_damage", 25)
	addFixedEquipment(&input, &request, 0, "speed_bonus", "bonus_attack_speed_percent", .2)
	for _, modifier := range []model.ModifierDefinition{
		{ModifierKey: "ordinary_percent", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "percent_add", Value: authoringConst(.2)},
		{ModifierKey: "ordinary_multiply", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "multiply", Value: authoringConst(.75)},
	} {
		addPermanentSkillSource(&input, &request, 0, modifier.ModifierKey, "character", modifier)
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{
		{CombatantKey: "source", AttributeKey: "attack_speed", Value: authoringConst(.8)},
		{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("add", authoringConst(1), authoringRead("source.attr.bonus_attack_speed_percent.resolved"))},
	}
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 2
	done := authoringRun(test, input, request)
	if math.Abs(done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved-156) > 1e-9 || done.AttackRecords[0].AttackSpeed != .8 {
		test.Fatal("conversion reapplied ordinary modifiers or extra speed", done.FinalSnapshot.Combatants[0].Attributes)
	}
}

func TestSpecialAttackFixedSpeedRetainsDebuffWithoutScalingReload(test *testing.T) {
	input, request := ammoAttackInput(1, 1000, 2500)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	input.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(.1)
	request.InitialSnapshot.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(.1)
	addFixedEquipment(&input, &request, 0, "extra_speed", "bonus_attack_speed_percent", .2)
	addPermanentInitializer(&input, &request, 1, model.ModifierDefinition{ModifierKey: "aura", Kind: "attribute", Target: "opponent.attr.attack_speed", ValuePolicy: "multiply", Value: authoringConst(.5)})
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{
		{CombatantKey: "source", AttributeKey: "attack_speed", Value: authoringConst(.8)},
		{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("add", authoringConst(1), authoringRead("source.attr.bonus_attack_speed_percent.resolved"))},
	}
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(1000), authoringRead("source.attr.attack_speed.resolved"))
	done := authoringRun(test, input, request)
	if len(done.AttackRecords) != 2 || done.AttackRecords[0].AttackSpeed != .4 || done.AttackRecords[1].AttackSpeed != .4 || *done.AttackRecords[0].FinalReadyAtMs != 2500 || *done.AttackRecords[0].MechanicReadyAtMs != 2500 || done.AttackRecords[1].StartAtMs != 2500 || math.Abs(done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved-130) > 1e-9 {
		test.Fatal("fixed speed lost its debuff or extra speed changed reload", done.AttackRecords, done.FinalSnapshot)
	}
}

func TestSpecialAttackDynamicOrdinaryDamageDependencyRecomputesCooldownInSameFrame(test *testing.T) {
	input, request := triggeredSourceInput(1500)
	input.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	request.InitialSnapshot.Combatants[0].Attributes["attack_damage"] = authoringSlot(100)
	input.Combatants[1].Attributes["armor"] = authoringSlot(0)
	request.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(0)
	input.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(0)
	request.InitialSnapshot.Combatants[0].Attributes["bonus_attack_speed_percent"] = authoringSlot(0)
	addFixedEquipment(&input, &request, 0, "flat_damage", "attack_damage", 25)
	addFixedEquipment(&input, &request, 0, "speed_bonus", "bonus_attack_speed_percent", .2)
	definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, eventSourceOwner, stateScopeProvider, "layers", 1, 200)
	definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "dynamic_extra_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringBinary("mul", authoringConst(.5), authoringRead("provider.state.layers"))}}
	addTriggeredSkillSource(&input, &request, 0, "dynamic_conversion", "character", definition)
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{
		{CombatantKey: "source", AttributeKey: "attack_speed", Value: authoringConst(1)},
		{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("add", authoringConst(1), authoringRead("source.attr.bonus_attack_speed_percent.resolved"))},
	}
	input.SharedProviders[0].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(100000), authoringRead("source.attr.attack_damage.resolved"))
	done := authoringRun(test, input, request)
	if len(done.AttackRecords) != 3 || math.Abs(done.Summary.SourceDamageDealt-637.5) > 1e-9 || math.Abs(done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved-150) > 1e-9 {
		test.Fatal("ordinary dependency was stale or reapplied", done.Summary, done.FinalSnapshot)
	}
	for index, expected := range []int64{0, 584, 1168} {
		if done.AttackRecords[index].StartAtMs != expected || done.AttackRecords[index].AttackSpeed != 1 {
			test.Fatal(done.AttackRecords)
		}
	}
}

func TestSpecialAttackDerivationOutputLimitsAndDependencyRestrictions(test *testing.T) {
	for _, dependency := range []string{"source.attr.attack_damage.resolved", "source.attr.attack_speed.resolved", "target.attr.attack_damage.resolved", "target.attr.attack_speed.resolved"} {
		input, _ := continuousAttackInput(1, 10000, 100, 0, 0, 1)
		for actor := range input.Combatants {
			input.Combatants[actor].Attributes["attack_damage"] = authoringSlot(100)
			input.Combatants[actor].Attributes["attack_speed"] = authoringSlot(1)
			owner := input.Combatants[actor].Key
			input.Rules.AttributeDerivations = append(input.Rules.AttributeDerivations,
				model.AttributeDerivationDefinition{CombatantKey: owner, AttributeKey: "attack_speed", Value: authoringConst(1)},
				model.AttributeDerivationDefinition{CombatantKey: owner, AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringConst(1.2)})
		}
		if result := compilebundle.CompileGeneric(input); !result.OK || len(result.Session.AttributeDerivations) != 4 {
			test.Fatal("one AS and AD per side rejected", result.Result.Errors)
		}
		input.Rules.AttributeDerivations[1].Value = authoringRead(dependency)
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("derived resolved dependency compiled", dependency)
		}
		input.Rules.AttributeDerivations[1].Value = authoringRead("source.attr.attack_damage.base")
		if result := compilebundle.CompileGeneric(input); !result.OK {
			test.Fatal("frozen dependency rejected", result.Result.Errors)
		}
		input.Rules.AttributeDerivations = append(input.Rules.AttributeDerivations, input.Rules.AttributeDerivations[1])
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("duplicate output compiled")
		}
	}
	for _, attribute := range []string{"attack_speed", "armor"} {
		input, _ := continuousAttackInput(1, 10000, 100, 0, 0, 1)
		input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{{CombatantKey: "source", AttributeKey: attribute, ValuePolicy: "multiply", Value: authoringConst(1)}}
		if result := compilebundle.CompileGeneric(input); result.OK {
			test.Fatal("multiply escaped its finite AD scope", attribute)
		}
	}
}

func TestSpecialAttackFormulaPresenceRejectsMalformedPathsAndMissingContext(test *testing.T) {
	for _, path := range []string{"target.status..present", "target.status.slow.absent", "target.status.slow.present.extra", "source.status.slow", "use.ammo.after"} {
		errors := 0
		formula.CompileGenericFormula(authoringRead(path), "test", nil, map[string]bool{}, func(model.GenericErrCode, string, string, string) { errors++ })
		if errors == 0 {
			test.Fatal("malformed read path compiled", path)
		}
	}
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceStatusPresent, ReadKey: "slow"}}}}}
	if _, err := registry.Eval(0, formula.GenericEvalContext{}); err == nil {
		test.Fatal("missing status context silently returned zero")
	}
}

func TestSpecialAttackBothSidesOrdinaryDependenciesIgnoreDerivationOrderAndPreviousFrame(test *testing.T) {
	var reference model.DoneResult
	for _, reverse := range []bool{false, true} {
		input, request := triggeredSourceInput(400)
		for actor, values := range []map[string]float64{
			{"attack_damage": 100, "attack_speed": 1, "bonus_attack_speed_percent": 0},
			{"attack_damage": 50, "attack_speed": 1, "bonus_attack_speed_percent": .3, "armor": 0},
		} {
			for key, value := range values {
				input.Combatants[actor].Attributes[key] = authoringSlot(value)
				request.InitialSnapshot.Combatants[actor].Attributes[key] = authoringSlot(value)
			}
		}
		addFixedEquipment(&input, &request, 0, "source_extra_speed", "bonus_attack_speed_percent", .2)
		addFixedEquipment(&input, &request, 1, "target_extra_speed", "bonus_attack_speed_percent", .4)
		definition := sourceCounterDefinition(model.EventTypeBasicAttackStart, eventSourceOwner, stateScopeProvider, "layers", 1, 200)
		definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "dynamic_source_input", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: authoringBinary("mul", authoringConst(.5), authoringRead("provider.state.layers"))}}
		addTriggeredSkillSource(&input, &request, 0, "dynamic_source", "character", definition)
		input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{
			{CombatantKey: "source", AttributeKey: "attack_speed", Value: authoringBinary("add", authoringConst(1), authoringRead("target.attr.bonus_attack_speed_percent.resolved"))},
			{CombatantKey: "source", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("add", authoringConst(1), authoringRead("target.attr.bonus_attack_speed_percent.resolved"))},
			{CombatantKey: "target", AttributeKey: "attack_speed", Value: authoringConst(.6)},
			{CombatantKey: "target", AttributeKey: "attack_damage", ValuePolicy: "multiply", Value: authoringBinary("add", authoringConst(1), authoringRead("source.attr.bonus_attack_speed_percent.resolved"))},
		}
		if reverse {
			for index := 0; index < len(input.Rules.AttributeDerivations)/2; index++ {
				other := len(input.Rules.AttributeDerivations) - 1 - index
				input.Rules.AttributeDerivations[index], input.Rules.AttributeDerivations[other] = input.Rules.AttributeDerivations[other], input.Rules.AttributeDerivations[index]
			}
		}
		request.DriverPlan.BasicAttack.AttackSpeedInputMax = 5
		request.Sampling = model.SamplingConfig{SampleEveryMs: 100, DpsWindowMs: 1000, MaxSeriesPoints: 10}
		done := authoringRun(test, input, request)
		if done.Summary.SourceDamageDealt != 170 || done.AttackRecords[0].AttackSpeed != 1.7 || done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved != 170 || done.FinalSnapshot.Combatants[1].Attributes["attack_damage"].Resolved != 60 || done.FinalSnapshot.Combatants[1].Attributes["attack_speed"].Resolved != .6 {
			test.Fatal("cross-side ordinary input was stale or resolved in map order", done.FinalSnapshot)
		}
		if reverse && (!reflect.DeepEqual(reference.Summary, done.Summary) || !reflect.DeepEqual(reference.FinalSnapshot, done.FinalSnapshot) || !reflect.DeepEqual(reference.AttackRecords, done.AttackRecords)) {
			test.Fatal("derivation declaration order changed combat")
		}
		reference = done
	}
}
