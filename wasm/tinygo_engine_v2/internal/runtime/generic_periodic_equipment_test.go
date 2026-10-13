package runtime

import (
	"math"
	"reflect"
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func periodicEquipmentDefinition(amount float64, first, interval int64) model.ProviderDefinition {
	return model.ProviderDefinition{Abilities: []model.AbilityDefinition{{AbilityKey: "periodic", Kind: "tick", SkillKey: "test_periodic",
		TickSpec: &model.TickSpec{StartDelayMs: first, IntervalMs: interval, OnTick: []model.OperationDefinition{
			{Operation: "damage", Target: "target", Ref: "periodic_damage", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(amount))},
		}},
	}}}
}

func periodicOpponentDefenseInputs(input *model.CompileRequest, request *model.RunRequest) {
	setCombatantAttr(input, request, "source", "armor", authoringSlot(0))
	setCombatantAttr(input, request, "target", "armor_pen_percent", authoringSlot(0))
	setCombatantAttr(input, request, "target", "armor_pen_flat", authoringSlot(0))
}

func TestContinuousPeriodicEquipmentIndependentDamageAndMountedReference(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2500)
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, 1000))
	input.Combatants[0].Providers[len(input.Combatants[0].Providers)-1].ProviderRef = "distinct_tick_mount"
	request.InitialSnapshot.Combatants[0].Providers[len(request.InitialSnapshot.Combatants[0].Providers)-1].ProviderRef = "distinct_tick_mount"
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != 45 || done.Summary.TargetHpLoss != 45 || done.Summary.BasicAttack.CompletedCount != 3 || done.Recording.DamageRecordCount != 6 {
		test.Fatal(done.Summary, done.Recording)
	}
	var tickTimes []int64
	for _, row := range done.DamageRecords {
		if row["operationRef"] != "periodic_damage" {
			continue
		}
		if row["attackIndex"] != 0 || row["useRef"] != "" || row["source"] != "source" || row["target"] != "target" || row["abilityRef"] != "source.provider[distinct_tick_mount].ability[periodic]" {
			test.Fatal(row)
		}
		tickTimes = append(tickTimes, row["timeMs"].(int64))
	}
	if !reflect.DeepEqual(tickTimes, []int64{500, 1500, 2500}) || done.AttackRecords[2].TargetHpAfter != 9960 || done.Summary.TargetFinalHp != 9955 {
		test.Fatal(tickTimes, done.AttackRecords, done.Summary)
	}
	for _, attack := range done.AttackRecords {
		if attack.PostDefenseDamage != 10 || attack.ActualHpLoss != 10 {
			test.Fatal("independent damage entered an attack", attack)
		}
	}
	if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
		test.Fatal("periodic run is not reproducible")
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
	request.Sampling.Disabled = false
	request.Sampling.SampleEveryMs = 100
	request.Sampling.MaxSeriesPoints = 100
	truncated := authoringRun(test, input, request)
	if truncated.Summary.SourceDamageDealt != 45 || truncated.Summary.TargetFinalHp != 9955 || truncated.Recording.DamageRecordCount != 6 || len(truncated.AttackRecords)+len(truncated.DamageRecords) != 0 || !truncated.Summary.Execution.Complete {
		test.Fatal(truncated.Summary, truncated.Recording)
	}
}

func TestContinuousPeriodicEquipmentObservationIncludesEndpoint(test *testing.T) {
	for _, scenario := range []struct {
		duration int64
		ticks    int
	}{{499, 0}, {500, 1}, {1499, 1}, {1500, 2}} {
		test.Run(strconv.FormatInt(scenario.duration, 10), func(test *testing.T) {
			input, request := continuousAttackInput(1, 10000, 10, 0, 0, scenario.duration)
			addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, 1000))
			done := authoringRun(test, input, request)
			expected := float64(scenario.duration/1000+1)*10 + float64(scenario.ticks)*5
			if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != expected || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != scenario.ticks || done.FinalSnapshot.TimeMs != scenario.duration {
				test.Fatal(scenario, done.Summary, done.Evidence.CountsByKind)
			}
		})
	}
}

func TestContinuousPeriodicEquipmentKillsBetweenAttacks(test *testing.T) {
	input, request := continuousAttackInput(1, 27, 10, 0, 0, 4000)
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, 1000))
	done := authoringRun(test, input, request)
	if done.Summary.StopReason != model.StopReasonTargetDead || !done.Summary.Execution.Complete || !done.Summary.Execution.TargetKilled || *done.Summary.Execution.TargetKilledAtMs != 1500 || done.Summary.BasicAttack.CompletedCount != 2 || done.Summary.SourceDamageDealt != 30 || done.Summary.TargetHpLoss != 27 {
		test.Fatal(done.Summary)
	}
	last := done.AttackRecords[len(done.AttackRecords)-1]
	if last.TargetHpAfter != 2 || last.NextStartAtMs != nil || done.FinalSnapshot.TimeMs != 1500 || done.Recording.DamageRecordCount != 4 {
		test.Fatal(last, done.FinalSnapshot.TimeMs, done.Recording)
	}
}

func TestContinuousPeriodicEquipmentOpponentCanKillSource(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 4000)
	periodicOpponentDefenseInputs(&input, &request)
	health := input.Combatants[0].Attributes["hp"]
	health.Current = 12
	input.Combatants[0].Attributes["hp"] = health
	request.InitialSnapshot.Combatants[0].Attributes["hp"] = health
	addCadenceEquipment(&input, &request, 1, "periodic", periodicEquipmentDefinition(7, 500, 1000))
	done := authoringRun(test, input, request)
	if done.Summary.StopReason != model.StopReasonSourceDead || !done.Summary.Execution.Complete || done.Summary.Execution.TargetKilled || done.Summary.Execution.TargetKilledAtMs != nil || done.Summary.BasicAttack.CompletedCount != 2 || done.Summary.SourceDamageDealt != 20 || done.Summary.TargetDamageDealt != 14 || done.Summary.SourceHpLoss != 12 {
		test.Fatal(done.Summary)
	}
	last := done.AttackRecords[len(done.AttackRecords)-1]
	if last.SourceHpAfter != 5 || last.NextStartAtMs != nil || done.FinalSnapshot.TimeMs != 1500 {
		test.Fatal(last, done.FinalSnapshot.TimeMs)
	}
}

func TestContinuousPeriodicEquipmentStableSameTimeOrder(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	periodicOpponentDefenseInputs(&input, &request)
	addCadenceEquipment(&input, &request, 1, "periodic", periodicEquipmentDefinition(7, 500, 1000))
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, 1000))
	done := authoringRun(test, input, request)
	var owners []string
	for _, row := range done.DamageRecords {
		if row["operationRef"] == "periodic_damage" {
			owners = append(owners, row["owner"].(string))
		}
	}
	if !reflect.DeepEqual(owners, []string{"source", "target", "source", "target"}) {
		test.Fatal(owners)
	}
	for attempt := 0; attempt < 12; attempt++ {
		if repeated := authoringRun(test, input, request); !reflect.DeepEqual(done, repeated) {
			test.Fatal("same-time ordering changed", attempt)
		}
	}
}

func TestContinuousPeriodicEquipmentQueuePreflightIsAtomic(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	input.Settings.MaxQueueEvents = 2
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	definition := periodicEquipmentDefinition(5, 500, 1000)
	definition.InitialStateSchema = map[string]interface{}{"active": map[string]interface{}{
		"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite,
	}}
	definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick, cadenceStateOperation("active", "override", 1, nil))
	provider := addCadenceEquipment(&input, &request, 0, "periodic", definition)
	done := authoringRun(test, input, request)
	if done.Summary.Execution.Complete || done.Summary.Execution.BudgetCause == nil || *done.Summary.Execution.BudgetCause != model.BudgetCauseMaxQueueEvents || done.Summary.SourceDamageDealt != 10 || done.Summary.TargetFinalHp != 9990 || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 0 {
		test.Fatal(done.Summary, done.Evidence.CountsByKind)
	}
	if _, written := done.FinalSnapshot.Combatants[0].ProviderState[provider]; written {
		test.Fatal("failed next tick published state", done.FinalSnapshot.Combatants[0].ProviderState)
	}
}

func TestContinuousPeriodicEquipmentDoesNotAdvanceHitCounter(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 3000)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	counter := addCadenceEquipment(&input, &request, 0, "counter", counterEquipmentDefinition(40))
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, 1000))
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 95 || done.Summary.BasicAttack.CompletedCount != 4 || cadenceStateValue(test, done, 0, counter, "hits") != 1 {
		test.Fatal(done.Summary, done.FinalSnapshot.Combatants)
	}
	for index, row := range done.AttackRecords {
		expected := float64(10)
		if index == 2 {
			expected = 50
		}
		if row.PostDefenseDamage != expected {
			test.Fatal(index, row)
		}
	}
}

func TestContinuousPeriodicEquipmentStateRefreshDoesNotReseed(test *testing.T) {
	for _, scenario := range []struct {
		speed    float64
		duration int64
		ticks    int
		damage   float64
	}{{1, 1500, 5, 30}, {5, 550, 5, 55}} {
		test.Run(strconv.FormatInt(scenario.duration, 10), func(test *testing.T) {
			input, request := continuousAttackInput(scenario.speed, 10000, 10, 0, 0, scenario.duration)
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
			interval := int64(300)
			if scenario.speed == 5 {
				interval = 100
			}
			definition := periodicEquipmentDefinition(5, interval, interval)
			definition.InitialStateSchema = map[string]interface{}{"active": map[string]interface{}{
				"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(400), "refreshPolicy": model.ProviderStateRefreshOnWrite,
			}}
			definition.Abilities[0].TickSpec.OnTick[0].Condition = cadenceComparison("active", "gt", 0)
			definition.Listeners = []model.ListenerDefinition{{ListenerKey: "refresh", MaxTriggersPerEvent: 1,
				EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, eventSourceOwner}},
				Operations:   []model.OperationDefinition{cadenceStateOperation("active", "override", 1, nil)},
			}}
			addCadenceEquipment(&input, &request, 0, "periodic", definition)
			done := authoringRun(test, input, request)
			if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != scenario.damage || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != scenario.ticks {
				test.Fatal(scenario, done.Summary, done.Evidence.CountsByKind)
			}
		})
	}
}

func TestContinuousPeriodicEquipmentStateChangesAndExpiryAdjustWaiting(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1400)
	request.DriverPlan.BasicAttack.AttackSpeedInputMax = 10
	for key, value := range map[string]float64{"bonus_attack_speed_percent": 0, "attack_speed_ratio": 1} {
		setCombatantAttr(&input, &request, "source", key, authoringSlot(value))
	}
	input.Rules.AttributeDerivations = []model.AttributeDerivationDefinition{attackSpeedDerivation("source")}
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	definition := periodicEquipmentDefinition(5, 400, 1000)
	definition.InitialStateSchema = map[string]interface{}{"active": map[string]interface{}{
		"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(400), "refreshPolicy": model.ProviderStateRefreshOnWrite,
	}}
	definition.Modifiers = []model.ModifierDefinition{{ModifierKey: "periodic_speed", Kind: "attribute", Target: "self.attr.bonus_attack_speed_percent", ValuePolicy: "add",
		Value: model.GenericFormulaExpr{Op: "read", Path: "provider.state.active"},
	}}
	definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick, cadenceStateOperation("active", "override", 1, nil))
	addCadenceEquipment(&input, &request, 0, "periodic", definition)
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != 30 || done.Summary.BasicAttack.CompletedCount != 2 || done.AttackRecords[1].StartAtMs != 700 || done.AttackRecords[1].AttackSpeed != 2 || *done.AttackRecords[1].FinalReadyAtMs != 1500 || done.AttackRecords[1].NextStartAtMs != nil {
		test.Fatal(done.Summary, done.AttackRecords)
	}
	if done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 2 {
		test.Fatal("state expiry or attack rescheduling duplicated periodic nodes", done.Evidence.CountsByKind)
	}
}

func TestContinuousPeriodicEquipmentDefaultDelayIsNotImmediate(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 0, 1000))
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 25 || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 1 {
		test.Fatal(done.Summary, done.Evidence.CountsByKind)
	}
	for _, row := range done.DamageRecords {
		if row["operationRef"] == "periodic_damage" && row["timeMs"] != int64(1000) {
			test.Fatal("default delay became an immediate tick", row)
		}
	}
}

func TestContinuousPeriodicEquipmentLargeIntervalCannotOverflowTime(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(5, 500, math.MaxInt64))
	done := authoringRun(test, input, request)
	if !done.Summary.Execution.Complete || done.Summary.SourceDamageDealt != 25 || done.Summary.BasicAttack.CompletedCount != 2 || done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)] != 1 || done.FinalSnapshot.TimeMs != 1500 {
		test.Fatal(done.Summary, done.Evidence.CountsByKind)
	}
	for _, row := range done.DamageRecords {
		if row["timeMs"].(int64) < 0 {
			test.Fatal("overflowed period moved time backwards", row)
		}
	}
}

func TestContinuousPeriodicEquipmentReadsDeclaredDefaultState(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2500)
	definition := periodicEquipmentDefinition(5, 500, 1000)
	definition.InitialStateSchema = map[string]interface{}{"power": float64(5)}
	definition.Abilities[0].TickSpec.OnTick[0].Amount = &model.GenericFormulaExpr{Op: "read", Path: "provider.state.power"}
	addCadenceEquipment(&input, &request, 0, "periodic", definition)
	done := authoringRun(test, input, request)
	if done.Summary.SourceDamageDealt != 45 {
		test.Fatal("declared state default was silently replaced with zero", done.Summary)
	}
}

func periodicSelfVampInputs(input *model.CompileRequest, request *model.RunRequest, rate float64) {
	efficiency := float64(1)
	input.Rules.VampRules = []model.VampRuleDefinition{{VampType: "LIFE_STEAL", SourceAttributeKey: "life_steal_percent",
		BasisOutputKind: "POST_DEFENSE_DAMAGE", DefaultEfficiency: &efficiency,
		TargetMatcher:  model.TypeMatcher{All: []string{"combatant/champion"}},
		AbilityMatcher: model.TypeMatcher{Any: []string{"ability/basic_attack", "ability/passive"}},
		DamageMatcher:  model.TypeMatcher{All: []string{"damage_trait/origin_direct"}, Any: []string{"damage_trait/delivery_skill", "damage_trait/delivery_basic_attack"}},
	}}
	for _, entry := range []model.TypeCatalogEntry{
		{Key: "combatant/champion", Domain: "combatant"}, {Key: "ability/passive", Domain: "ability"},
		{Key: "damage_trait/delivery_skill", Domain: "damage_trait"}, {Key: "damage_trait/delivery_basic_attack", Domain: "damage_trait"},
		{Key: "damage_trait/origin_direct", Domain: "damage_trait"},
	} {
		exists := false
		for _, declared := range input.TypeCatalog.Types {
			exists = exists || declared.Key == entry.Key
		}
		if !exists {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, entry)
		}
	}
	for index := range input.Combatants {
		input.Combatants[index].Types = []string{"combatant/champion"}
	}
	for _, side := range []string{"source", "target"} {
		setCombatantAttr(input, request, side, "life_steal_percent", authoringSlot(rate))
	}
	for providerIndex := range input.SharedProviders {
		for abilityIndex := range input.SharedProviders[providerIndex].Abilities {
			ability := &input.SharedProviders[providerIndex].Abilities[abilityIndex]
			qualifyCadenceVampOperations(ability.Operations, "damage_trait/delivery_basic_attack")
			if ability.TickSpec != nil {
				ability.Types = []string{"ability/passive"}
				qualifyCadenceVampOperations(ability.TickSpec.OnTick, "damage_trait/delivery_skill")
			}
		}
	}
}

func qualifyCadenceVampOperations(operations []model.OperationDefinition, delivery string) {
	for index := range operations {
		operation := &operations[index]
		if operation.Operation == "damage" {
			operation.VampQualification = "RESOLVED"
			operation.Types = []string{delivery, "damage_trait/origin_direct"}
		}
		if operation.SkillHit != nil {
			for candidateIndex := range operation.SkillHit.Candidates {
				qualifyCadenceVampOperations(operation.SkillHit.Candidates[candidateIndex].Operations, delivery)
			}
		}
	}
}

func TestContinuousPeriodicEquipmentFreezesEachSourceVampReceipt(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	health := input.Combatants[0].Attributes["hp"]
	health.Current = 500
	setCombatantAttr(&input, &request, "source", "hp", health)
	definition := periodicEquipmentDefinition(5, 500, 1000)
	second := definition.Abilities[0].TickSpec.OnTick[0]
	second.Amount = authoringAmount(authoringConst(15))
	second.Ref = "second_periodic_damage"
	definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick, second)
	addCadenceEquipment(&input, &request, 0, "periodic", definition)
	periodicSelfVampInputs(&input, &request, .1)
	done := authoringRun(test, input, request)
	if done.Summary.SourceVampHealing == nil || *done.Summary.SourceVampHealing != 6 || *done.Summary.TargetVampHealing != 0 || done.Summary.SourceFinalHp != 506 || done.Summary.SourceDamageDealt != 60 {
		test.Fatal(done.Summary)
	}
	previous := float64(500)
	for _, row := range done.DamageRecords {
		if row["sourceHpBefore"] != previous || row["sourceHpAfter"] != previous+row["postDefenseDamage"].(float64)*.1 {
			test.Fatal("source receipt was not frozen per operation", previous, row)
		}
		previous = row["sourceHpAfter"].(float64)
	}
	if done.AttackRecords[1].SourceHpAfter != 504 || previous != 506 {
		test.Fatal(done.AttackRecords, previous)
	}
	zero := 0
	request.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero}
	state, failure := newGenericRunState(authoringCompile(test, input), request)
	if failure != nil {
		test.Fatal(failure)
	}
	state.budget.MaxEvidenceItems = 0
	if failure := state.runLoop(); failure != nil {
		test.Fatal(failure)
	}
	truncated := state.buildDoneResult()
	if len(truncated.DamageRecords) != 0 || truncated.Summary.SourceVampHealing == nil || *truncated.Summary.SourceVampHealing != 6 || truncated.Summary.SourceFinalHp != 506 || truncated.Summary.SourceDamageDealt != 60 || !truncated.Summary.Execution.Complete {
		test.Fatal(truncated.Summary, truncated.Recording)
	}
}

func TestContinuousPeriodicEquipmentSelfVampCapsAndReverseDirection(test *testing.T) {
	for _, scenario := range []struct {
		current float64
		gain    float64
	}{{1000, 0}, {999, 1}, {500, 2}} {
		test.Run(strconv.FormatFloat(scenario.current, 'f', -1, 64), func(test *testing.T) {
			input, request := continuousAttackInput(1, 10000, 10, 0, 0, 500)
			health := input.Combatants[0].Attributes["hp"]
			health.Current = scenario.current
			setCombatantAttr(&input, &request, "source", "hp", health)
			addCadenceEquipment(&input, &request, 0, "periodic", periodicEquipmentDefinition(10, 500, 1000))
			periodicSelfVampInputs(&input, &request, .1)
			done := authoringRun(test, input, request)
			if *done.Summary.SourceVampHealing != scenario.gain || done.Summary.SourceFinalHp != scenario.current+scenario.gain {
				test.Fatal(scenario, done.Summary)
			}
		})
	}
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
	periodicOpponentDefenseInputs(&input, &request)
	addCadenceEquipment(&input, &request, 1, "periodic", periodicEquipmentDefinition(5, 500, 1000))
	periodicSelfVampInputs(&input, &request, .1)
	done := authoringRun(test, input, request)
	if *done.Summary.TargetVampHealing != 1 || done.Summary.TargetFinalHp != 9981 || done.Summary.SourceFinalHp != 991 || *done.Summary.SourceVampHealing != 1 {
		test.Fatal(done.Summary)
	}
	for _, row := range done.DamageRecords {
		if row["source"] == "target" && row["sourceHpAfter"].(float64)-row["sourceHpBefore"].(float64) != .5 {
			test.Fatal(row)
		}
	}
}

func TestContinuousPeriodicEquipmentFailedFrameDoesNotPublishVamp(test *testing.T) {
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 2000)
	input.Settings.MaxQueueEvents = 2
	health := input.Combatants[0].Attributes["hp"]
	health.Current = 500
	setCombatantAttr(&input, &request, "source", "hp", health)
	input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	definition := periodicEquipmentDefinition(5, 500, 1000)
	definition.InitialStateSchema = map[string]interface{}{"active": map[string]interface{}{
		"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(100), "refreshPolicy": model.ProviderStateRefreshOnWrite,
	}}
	definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick, cadenceStateOperation("active", "override", 1, nil))
	addCadenceEquipment(&input, &request, 0, "periodic", definition)
	periodicSelfVampInputs(&input, &request, .1)
	done := authoringRun(test, input, request)
	if done.Summary.Execution.Complete || *done.Summary.SourceVampHealing != 1 || done.Summary.SourceFinalHp != 501 || done.Recording.DamageRecordCount != 1 || done.Summary.SourceDamageDealt != 10 {
		test.Fatal(done.Summary, done.DamageRecords)
	}
}

func TestContinuousPeriodicEquipmentRejectsUnsupportedSubsets(test *testing.T) {
	for _, mode := range []string{"negative_delay", "anchored", "extra_operations", "extra_tick", "active", "other_target", "extra_event", "unselected", "temporary"} {
		test.Run(mode, func(test *testing.T) {
			input, request := continuousAttackInput(1, 10000, 10, 0, 0, 1500)
			definition := periodicEquipmentDefinition(5, 500, 1000)
			switch mode {
			case "negative_delay":
				definition.Abilities[0].TickSpec.StartDelayMs = -1
			case "anchored":
				definition.Abilities[0].TickSpec.AnchorScope = "provider_target"
				definition.Abilities[0].TickSpec.AnchorStateKey = "active"
			case "extra_operations":
				definition.Abilities[0].Operations = []model.OperationDefinition{definition.Abilities[0].TickSpec.OnTick[0]}
			case "extra_tick":
				second := definition.Abilities[0]
				second.AbilityKey = "second_tick"
				definition.Abilities = append(definition.Abilities, second)
			case "active":
				definition.Abilities = append(definition.Abilities, model.AbilityDefinition{AbilityKey: "active", Kind: "active"})
			case "other_target":
				definition.Abilities[0].TickSpec.OnTick[0].Target = "self"
			case "extra_event":
				definition.Abilities[0].TickSpec.OnTick = append(definition.Abilities[0].TickSpec.OnTick,
					model.OperationDefinition{Operation: "emit_event", Target: "target", EventType: model.EventTypeBasicAttackHit})
			case "temporary":
				definition.Lifecycle = &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(1000)), MaxStacks: 1}
			}
			addCadenceEquipment(&input, &request, 0, "periodic", definition)
			if mode == "unselected" {
				input.Combatants[0].Providers = append(input.Combatants[0].Providers[:1], input.Combatants[0].Providers[2:]...)
				request.InitialSnapshot.Combatants[0].Providers = append(request.InitialSnapshot.Combatants[0].Providers[:1], request.InitialSnapshot.Combatants[0].Providers[2:]...)
			}
			compiled := compile.CompileGeneric(input)
			if !compiled.OK {
				return
			}
			if _, failure := RunGeneric(compiled.Session, request); failure == nil {
				test.Fatal("unsupported periodic subset was accepted", mode)
			}
		})
	}
}
