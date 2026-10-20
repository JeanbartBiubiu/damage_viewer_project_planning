package runtime

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func ownedHealthPassiveInput(owner string) (model.CompileRequest, model.RunRequest) {
	input, request := sourceInitializationInput()
	for _, key := range []string{"hp", "bonus_attack_speed_percent", "attack_speed_ratio"} {
		input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "attribute"})
	}
	request.StopPolicy.DurationMs = 1
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 4
	setCombatantAttr(&input, &request, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	setCombatantAttr(&input, &request, "target", "hp", model.AttributeSlotDef{Base: 10000, Current: 2000, Max: 10000, Resolved: 10000})
	for _, side := range []string{"source", "target"} {
		setCombatantAttr(&input, &request, side, "bonus_attack_speed_percent", authoringSlot(0))
		setCombatantAttr(&input, &request, side, "attack_speed_ratio", authoringSlot(1))
		setCombatantAttr(&input, &request, side, "attack_speed", authoringSlot(1))
	}
	amount := authoringBinary("mul", authoringConst(2), authoringBinary("sub", authoringConst(1), authoringBinary("div", authoringRead("source.attr.hp.current"), authoringRead("source.attr.hp.max"))))
	input.Formulas = append(input.Formulas, formuladefinition.FromExpr("health_bonus", "health_passive", amount, nil))
	index := 0
	if owner == "target" {
		index = 1
	}
	addPermanentSkillSource(&input, &request, index, "health_passive", "character", model.ModifierDefinition{
		ModifierKey: "speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: "health_bonus"}})
	for i := len(input.SharedProviders) - 2; i < len(input.SharedProviders); i++ {
		input.SharedProviders[i].SkillKey = "health_passive"
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source"), attackSpeedDerivation("target")}
	return input, request
}

func TestOwnedHealthModifierInitializesZeroBaseAndUsesRealOwner(t *testing.T) {
	for _, owner := range []string{"source", "target"} {
		t.Run(owner, func(t *testing.T) {
			input, request := ownedHealthPassiveInput(owner)
			compiled := authoringCompile(t, input)
			marked := false
			for _, provider := range compiled.Providers {
				for _, modifier := range provider.Modifiers {
					marked = marked || modifier.OwnedHealthReads
				}
			}
			if !marked {
				t.Fatal("author health formula was not bound to its modifier owner")
			}
			done, err := RunGeneric(compiled, request)
			if err != nil {
				t.Fatal(err)
			}
			repeated, err := RunGeneric(compiled, request)
			if err != nil || !reflect.DeepEqual(done, repeated) {
				t.Fatal("same-session repeat changed health-derived output", err)
			}
			for _, actor := range done.FinalSnapshot.Combatants {
				if actor.Key != owner {
					continue
				}
				hp := actor.Attributes["hp"]
				expected := 2 * (1 - hp.Current/hp.Max)
				if math.Abs(actor.Attributes["bonus_attack_speed_percent"].Resolved-expected) > 1e-12 || math.Abs(actor.Attributes["attack_speed"].Resolved-(1+expected)) > 1e-12 {
					t.Fatalf("owner=%s expected=%v attributes=%+v", owner, expected, actor.Attributes)
				}
			}
		})
	}
}

func TestOwnedHealthModifierReverseFrameCacheUsesOwnerHealthAndPresence(t *testing.T) {
	for _, owner := range []string{"source", "target"} {
		t.Run(owner, func(t *testing.T) {
			input, request := ownedHealthPassiveInput(owner)
			request.DriverPlan.BasicAttack = nil
			compiled := authoringCompile(t, input)
			state, err := newGenericRunState(compiled, request)
			if err != nil {
				t.Fatal(err)
			}
			if err := state.runLoop(); err != nil {
				t.Fatal("real source initialization failed", err)
			}
			frame := state.newExecutionFrame("target", "source", "")
			for _, health := range []struct{ current, max float64 }{{500, 1000}, {750, 1000}, {750, 1500}, {750, 1500}} {
				staged := frame.stageFor(owner)
				hp := staged.attributes.At("hp")
				hp.Current, hp.Max = health.current, health.max
				staged.attributes = staged.attributes.With("hp", hp)
				frame.reResolveStagedAttributesTwoPass(compiled.Abilities[0])
				if frame.fatal {
					t.Fatal(frame.fatalErr)
				}
				expected := 2 * (1 - health.current/health.max)
				if got := frame.stageFor(owner).attributes.At("bonus_attack_speed_percent").Resolved; math.Abs(got-expected) > 1e-12 {
					t.Fatalf("reverse owner %s HP=%+v got=%v expected=%v", owner, health, got, expected)
				}
			}
			var absentCurrent model.AttributeSlotDef
			if err := json.Unmarshal([]byte(`{"base":1000,"max":1500,"resolved":1000}`), &absentCurrent); err != nil {
				t.Fatal(err)
			}
			frame.stageFor(owner).attributes = frame.stageFor(owner).attributes.With("hp", absentCurrent)
			frame.reResolveStagedAttributesTwoPass(compiled.Abilities[0])
			if !frame.fatal || frame.fatalErr == nil || !strings.Contains(frame.fatalErr.Path, "/expression") {
				t.Fatal("warm cache masked the missing owner CURRENT field", frame.fatalErr)
			}
		})
	}
}

func TestOwnedHealthModifierRejectsInternalOrOtherAttributeReads(t *testing.T) {
	for _, read := range []string{"target.attr.hp.current", "source.attr.armor.resolved"} {
		t.Run(read, func(t *testing.T) {
			input, request := ownedHealthPassiveInput("source")
			input.Formulas[len(input.Formulas)-1] = formuladefinition.FromExpr("health_bonus", "health_passive", authoringRead(read), nil)
			result := compile.CompileGeneric(input)
			if !result.OK {
				t.Fatal(result.Result.Errors)
			}
			_, err := RunGeneric(result.Session, request)
			if err == nil || err.Code != model.GenericErrRuntimeInvariantFailed {
				t.Fatal("unsupported dynamic initialization was admitted", err)
			}
		})
	}
	input, request := ownedHealthPassiveInput("source")
	input.SharedProviders[len(input.SharedProviders)-2].Modifiers[0].Value = authoringRead("source.attr.hp.current")
	compiled := authoringCompile(t, input)
	if _, err := RunGeneric(compiled, request); err == nil {
		t.Fatal("raw frame-relative read gained author ownership or dynamic initialization authorization")
	}
}

func TestOwnedHealthModifierVampUpdatesAttackIntervalFromPostHealingHealth(t *testing.T) {
	input, request := ownedHealthPassiveInput("source")
	request.StopPolicy.DurationMs = 700
	setCombatantAttr(&input, &request, "source", "life_steal_percent", authoringSlot(0))
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "life_steal_percent", Domain: "attribute"},
		model.TypeCatalogEntry{Key: receivedDeliveryBasic, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"})
	for index := range input.Combatants {
		input.Combatants[index].Types = []string{"combatant/champion"}
	}
	addPermanentSkillSource(&input, &request, 0, "health_vamp", "character", model.ModifierDefinition{
		ModifierKey: "vamp", Kind: "attribute", Target: "self.attr.life_steal_percent", ValuePolicy: "add", Value: model.GenericFormulaExpr{Op: "ref", Ref: "health_bonus"}})
	for i := len(input.SharedProviders) - 2; i < len(input.SharedProviders); i++ {
		input.SharedProviders[i].SkillKey = "health_passive"
	}
	efficiency := 1.0
	input.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampLifeSteal, SourceAttributeKey: "life_steal_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: &efficiency,
		TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, DamageMatcher: model.TypeMatcher{All: []string{receivedDeliveryBasic, receivedOriginDirect}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}}}
	for index := range input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates {
		candidate := &input.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[index]
		for i := range candidate.Operations {
			if candidate.Operations[i].Operation == "damage" {
				candidate.Operations[i].Types = []string{receivedDeliveryBasic, receivedOriginDirect}
				candidate.Operations[i].VampQualification = model.VampResolved
			}
		}
	}
	done := authoringRun(t, input, request)
	if len(done.AttackRecords) != 2 || done.AttackRecords[0].StartAtMs != 0 || done.AttackRecords[1].StartAtMs != 556 || done.Summary.SourceFinalHp != 680 {
		t.Fatal(done.AttackRecords, done.Summary)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" && (math.Abs(actor.Attributes["life_steal_percent"].Resolved-.64) > 1e-12 || math.Abs(actor.Attributes["attack_speed"].Resolved-1.64) > 1e-12) {
			t.Fatal(actor.Attributes)
		}
	}
}

func TestOwnedHealthModifierRejectsForeignApplicationAndPreMounts(t *testing.T) {
	for _, misuse := range []string{"initialization_target", "ability_target", "ability_self", "pre_mounted"} {
		t.Run(misuse, func(t *testing.T) {
			input, _ := ownedHealthPassiveInput("source")
			switch misuse {
			case "initialization_target":
				input.SharedProviders[len(input.SharedProviders)-1].Listeners[0].Operations[0].Target = "target"
			case "ability_target", "ability_self":
				target := "target"
				if misuse == "ability_self" {
					target = "self"
				}
				input.SharedProviders[0].Abilities[0].Operations = append(input.SharedProviders[0].Abilities[0].Operations, model.OperationDefinition{
					Operation: "apply_provider", Target: target, ProviderDefinitionRef: "health_passive_effect", ProviderRef: "foreign_health"})
			case "pre_mounted":
				input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "health_passive_effect", DefinitionRef: "health_passive_effect"})
			}
			result := compile.CompileGeneric(input)
			if result.OK {
				t.Fatal("foreign or pre-mounted owner health modifier compiled")
			}
			found := false
			for _, issue := range result.Result.Errors {
				found = found || strings.Contains(issue.Message, "owned health modifier")
			}
			if !found {
				t.Fatal("failed without checking owned-health application provenance", result.Result.Errors)
			}
		})
	}
	for _, restore := range []string{"foreign_source", "expiry", "extra_effect", "finite_definition"} {
		t.Run(restore, func(t *testing.T) {
			input, request := ownedHealthPassiveInput("source")
			expiry := int64(5000)
			switch restore {
			case "foreign_source":
				request.InitialSnapshot.Combatants[0].Providers[len(request.InitialSnapshot.Combatants[0].Providers)-1].Source = "target"
			case "expiry":
				request.InitialSnapshot.Combatants[0].Providers[len(request.InitialSnapshot.Combatants[0].Providers)-1].ExpireAt = &expiry
			case "extra_effect":
				request.InitialSnapshot.Combatants[1].Providers = append(request.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{
					ProviderRef: "restored_health", DefinitionRef: "health_passive_effect", Source: "source", Owner: "target", Stacks: 1})
			case "finite_definition":
				input.SharedProviders[len(input.SharedProviders)-2].Lifecycle = &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(5000)), MaxStacks: 1}
			}
			compiled := authoringCompile(t, input)
			if _, err := RunGeneric(compiled, request); err == nil {
				t.Fatal("unmatched owner health provenance or duration was restored")
			}
		})
	}
}
