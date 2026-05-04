// 本文件验证 runtime 的基础集成行为，包括伤害、护盾、控制 pending intent 和 snapshot。
package runtime_test

import (
	"encoding/json"
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime"
	"tinygo_engine_v2/internal/testkit"
)

func TestBasicDamageAndThornmail(t *testing.T) {
	done := run(t, testkit.BasicRunInput())
	if done.StopReason != "queue_empty" {
		t.Fatalf("stop reason = %s", done.StopReason)
	}
	if got := actorHP(done, "enemy"); got != 900 {
		t.Fatalf("enemy hp got %.2f, want 900", got)
	}
	if got := actorHP(done, "self"); got != 980 {
		t.Fatalf("self hp got %.2f, want 980 from thornmail", got)
	}
}

func TestShieldInteractionByDamageType(t *testing.T) {
	input := testkit.BasicRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "sett_w"},
		{TriggerAtMs: 1, SourceActorID: "enemy", TargetActorID: "self", ActionID: "basic_attack"},
	}
	input.StopCondition.MaxEvents = 2
	done := run(t, input)
	self := actor(done, "self")
	if self.ShieldAmount != 40 {
		t.Fatalf("physical shield should absorb enemy physical damage, got %.2f", self.ShieldAmount)
	}
}

func TestControlPendingIntent(t *testing.T) {
	bundle := testkit.BenchmarkBundle()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	input := testkit.BasicRunInput()
	input.Enemy.StatusIDs = []string{"stun"}
	input.InitialActions = []model.ActionRequest{{TriggerAtMs: 0, SourceActorID: "enemy", TargetActorID: "self", ActionID: "basic_attack"}}
	mustCode(t, session.BeginRunJSON(mustJSON(t, input)))
	for session.Step(8) == 1 {
	}
	done := testkit.LastDone(session.OutboxBytes())
	if got := actorHP(done, "self"); got != 920 {
		t.Fatalf("pending intent did not run after stun expired, self hp %.2f", got)
	}
}

func TestAkaliMarkGate(t *testing.T) {
	input := testkit.BasicRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "akali_e2"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "akali_e1"},
		{TriggerAtMs: 2, SourceActorID: "self", TargetActorID: "enemy", ActionID: "akali_e2"},
	}
	done := run(t, input)
	if got := actorHP(done, "enemy"); got != 925 {
		t.Fatalf("enemy hp got %.2f, want only marked E2 damage", got)
	}
}

func TestSilenceBlocksCastSkillButAllowsBasicAttack(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.Self.StatusIDs = []string{"silence"}
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "basic_attack"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 990 {
		t.Fatalf("enemy hp got %.2f, want only basic attack damage", got)
	}
}

func TestDisarmBlocksBasicAttackButAllowsSkill(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.Self.StatusIDs = []string{"disarm"}
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "basic_attack"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 970 {
		t.Fatalf("enemy hp got %.2f, want only fireball damage", got)
	}
}

func TestGroundBlocksDashTaggedAction(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.Self.StatusIDs = []string{"ground"}
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "dash_strike"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 970 {
		t.Fatalf("enemy hp got %.2f, want non-dash fireball only", got)
	}
}

func TestUnownedActionIsDropped(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "enemy_only"}}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 1000 {
		t.Fatalf("enemy hp got %.2f, want unowned action to be dropped", got)
	}
}

func TestResourceCostSpendsAndInsufficientDoesNotConsumeMark(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "mark"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "expensive_marked"},
		{TriggerAtMs: 2, SourceActorID: "self", TargetActorID: "enemy", ActionID: "free_marked"},
		{TriggerAtMs: 3, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 940 {
		t.Fatalf("enemy hp got %.2f, want free marked and fireball damage", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 60 {
		t.Fatalf("self mana got %.2f, want only fireball cost spent", got)
	}
}

func TestCooldownBlocksUntilReady(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "cooldown_bolt"},
		{TriggerAtMs: 500, SourceActorID: "self", TargetActorID: "enemy", ActionID: "cooldown_bolt"},
		{TriggerAtMs: 1000, SourceActorID: "self", TargetActorID: "enemy", ActionID: "cooldown_bolt"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 940 {
		t.Fatalf("enemy hp got %.2f, want two cooldown bolt casts", got)
	}
}

func TestResourceCostsArePrecheckedAtomically(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "double_cost"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
	}
	done := runBundle(t, bundle, input)
	if got := actorHP(done, "enemy"); got != 970 {
		t.Fatalf("enemy hp got %.2f, want double cost dropped and fireball cast", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 60 {
		t.Fatalf("self mana got %.2f, want only fireball cost spent", got)
	}
}

func TestSnapshotCarriesResolvedAttributeState(t *testing.T) {
	done := run(t, testkit.BasicRunInput())
	self := actor(done, "self")
	ad, ok := self.Attributes["attack_damage"]
	if !ok {
		t.Fatal("attack_damage snapshot missing")
	}
	if ad.Base != 100 || ad.Resolved != 100 {
		t.Fatalf("attack_damage snapshot = %+v, want base/resolved 100", ad)
	}
}

func TestSnapshotInitialExportsActorStateWithoutRunningActions(t *testing.T) {
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, testkit.BenchmarkBundle())))
	input := testkit.BasicRunInput()
	input.Self.StatusIDs = []string{"physical_shield"}

	mustCode(t, session.SnapshotInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastSnapshot(session.OutboxBytes())
	self := snapshotActor(snapshot, "self")
	enemy := snapshotActor(snapshot, "enemy")
	if self.CurrentHP != 1000 || enemy.CurrentHP != 1000 {
		t.Fatalf("initial snapshot hp self/enemy = %.2f/%.2f, want 1000/1000", self.CurrentHP, enemy.CurrentHP)
	}
	if self.ShieldAmount != 200 {
		t.Fatalf("initial snapshot shield %.2f, want 200", self.ShieldAmount)
	}
	ad, ok := self.Attributes["attack_damage"]
	if !ok || ad.Base != 100 || ad.Resolved != 100 {
		t.Fatalf("initial attack_damage snapshot = %+v, ok=%v", ad, ok)
	}

	mustCode(t, session.BeginRunJSON(mustJSON(t, input)))
	for session.Step(64) == 1 {
	}
	done := testkit.LastDone(session.OutboxBytes())
	if got := actorHP(done, "enemy"); got != 900 {
		t.Fatalf("begin_run after initial snapshot enemy hp got %.2f, want action to still run", got)
	}
}

func TestActionSnapshotInitialExportsOwnedActionsAndResolvedRows(t *testing.T) {
	bundle := controlGateBundle()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	input := controlRunInput()

	mustCode(t, session.SnapshotActionsInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastActionSnapshot(session.OutboxBytes())
	self := actionSnapshotActor(snapshot, "self")
	enemy := actionSnapshotActor(snapshot, "enemy")
	if len(self.Actions) != 8 {
		t.Fatalf("self actions len = %d, want 8", len(self.Actions))
	}
	if len(enemy.Actions) != 2 {
		t.Fatalf("enemy actions len = %d, want 2", len(enemy.Actions))
	}

	fireball := actionState(self, "fireball")
	if !fireball.CanCast {
		t.Fatalf("fireball should be castable at time 0, got blockedReason=%q", fireball.BlockedReason)
	}
	if len(fireball.ResourceCosts) != 1 || fireball.ResourceCosts[0].ResourceID != "mana" || fireball.ResourceCosts[0].Amount != 40 {
		t.Fatalf("fireball resource cost = %+v, want mana 40", fireball.ResourceCosts)
	}
	if len(fireball.EffectRows) != 1 || !fireball.EffectRows[0].HasResolvedAmount || fireball.EffectRows[0].ResolvedAmount != 30 {
		t.Fatalf("fireball effect rows = %+v, want resolved 30", fireball.EffectRows)
	}

	cooldownBolt := actionState(self, "cooldown_bolt")
	if cooldownBolt.CooldownMs != 1000 || cooldownBolt.ReadyAtMs != 0 || !cooldownBolt.CanCast {
		t.Fatalf("cooldown_bolt snapshot = %+v, want cooldownMs=1000 readyAt=0 canCast=true", cooldownBolt)
	}
}

func TestActionSnapshotInitialCarriesBlockedReason(t *testing.T) {
	bundle := controlGateBundle()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	input := controlRunInput()
	input.Self.StatusIDs = []string{"silence"}

	mustCode(t, session.SnapshotActionsInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastActionSnapshot(session.OutboxBytes())
	self := actionSnapshotActor(snapshot, "self")
	fireball := actionState(self, "fireball")
	if fireball.CanCast {
		t.Fatal("fireball should be blocked by silence")
	}
	if fireball.BlockedReason != "blocked_by_status:silence_forbid" {
		t.Fatalf("fireball blockedReason = %q", fireball.BlockedReason)
	}
}

func TestBadSchemaFailsFast(t *testing.T) {
	bundle := testkit.BenchmarkBundle()
	bundle.SchemaVersion = 99
	session := runtime.NewSession()
	if session.InitJSON(mustJSON(t, bundle)) == 0 {
		t.Fatal("init unexpectedly succeeded")
	}
	err := testkit.LastError(session.OutboxBytes())
	if err.Code != model.ErrSchemaMismatch {
		t.Fatalf("error code got %s", err.Code)
	}
}

func run(t *testing.T, input model.EngineRunInput) model.DonePayload {
	t.Helper()
	return runBundle(t, testkit.BenchmarkBundle(), input)
}

func runBundle(t *testing.T, bundle model.EngineBundle, input model.EngineRunInput) model.DonePayload {
	t.Helper()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	mustCode(t, session.BeginRunJSON(mustJSON(t, input)))
	for session.Step(64) == 1 {
	}
	return testkit.LastDone(session.OutboxBytes())
}

func controlRunInput() model.EngineRunInput {
	return model.EngineRunInput{
		Seed:          7,
		Self:          model.CombatantRunInit{ActorID: "self", TemplateID: "fighter"},
		Enemy:         model.CombatantRunInit{ActorID: "enemy", TemplateID: "dummy"},
		StopCondition: model.StopCondition{MaxEvents: 20},
		Trace:         model.TraceOptions{EnableLogs: true, SampleEvery: 1},
	}
}

func controlGateBundle() model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes:    []model.AttributeDefinitionV2{{ID: "attack_damage"}},
		Resources:     []model.ResourceDefinitionV2{{ID: "mana", DefaultCurrent: 100, DefaultMax: 100}},
		Actors: []model.ActorTemplate{
			{ID: "fighter", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 10}}, Resources: map[string]model.ResourceValueV2{"mana": {Current: 100, Max: 100}}, Actions: []string{"basic_attack", "fireball", "dash_strike", "mark", "expensive_marked", "free_marked", "cooldown_bolt", "double_cost"}},
			{ID: "dummy", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 10}}, Resources: map[string]model.ResourceValueV2{"mana": {Current: 100, Max: 100}}, Actions: []string{"basic_attack", "enemy_only"}},
		},
		Statuses: []model.StatusTemplate{
			{ID: "silence", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/silence"}}},
			{ID: "disarm", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/disarm"}}},
			{ID: "ground", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/ground"}}},
		},
		StatusActionControlRules: []model.StatusActionControlRuleV2{
			{ID: "silence_forbid", RuleKind: "forbid", StatusTypes: model.TypeMatcherV2{Any: []string{"status/silence"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}},
			{ID: "disarm_forbid", RuleKind: "forbid", StatusTypes: model.TypeMatcherV2{Any: []string{"status/disarm"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/basic_attack"}}},
			{ID: "ground_forbid", RuleKind: "forbid", StatusTypes: model.TypeMatcherV2{Any: []string{"status/ground"}}, ActionTypes: model.TypeMatcherV2{Any: []string{"action/cast_skill"}}, ActionMatchTypes: model.TypeMatcherV2{Any: []string{"skill_tag/dash"}}},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "ad", Op: "attr", Attr: "attack_damage"},
			{ID: "flat_30", Op: "const", Value: 30},
			{ID: "flat_999", Op: "const", Value: 999},
		},
		Actions: []model.ActionTemplate{
			{ID: "basic_attack", Label: "Basic Attack", Classifier: model.ClassifierV2{Types: []string{"action/basic_attack"}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "ad", DamageType: "physical", SourceRole: "source", TargetRole: "target"}}},
			{ID: "fireball", Label: "Fireball", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: 40}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "dash_strike", Label: "Dash Strike", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}, Tags: []string{"skill_tag/dash"}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "physical", SourceRole: "source", TargetRole: "target"}}},
			{ID: "mark", Label: "Mark", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, Effects: []model.EffectDef{{Type: "apply_mark", MarkID: "test_mark", SourceRole: "source", TargetRole: "target"}}},
			{ID: "expensive_marked", Label: "Expensive Marked", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, RequiresMark: "test_mark", ConsumesMark: true, ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", FormulaID: "flat_999"}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "free_marked", Label: "Free Marked", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, RequiresMark: "test_mark", ConsumesMark: true, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "cooldown_bolt", Label: "Cooldown Bolt", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, CooldownMs: 1000, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "double_cost", Label: "Double Cost", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: 70}, {ResourceID: "mana", Amount: 70}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "enemy_only", Label: "Enemy Only", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, Effects: []model.EffectDef{{Type: "deal_damage", Amount: 99, DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func actorHP(done model.DonePayload, actorID string) float64 {
	return actor(done, actorID).CurrentHP
}

func actor(done model.DonePayload, actorID string) model.ActorSnapshot {
	for _, actor := range done.Actors {
		if actor.ActorID == actorID {
			return actor
		}
	}
	return model.ActorSnapshot{}
}

func snapshotActor(snapshot model.SnapshotV2, actorID string) model.ActorSnapshot {
	for _, actor := range snapshot.Actors {
		if actor.ActorID == actorID {
			return actor
		}
	}
	return model.ActorSnapshot{}
}

func actionSnapshotActor(snapshot model.ActionSnapshotV2, actorID string) model.ActorActionSnapshotV2 {
	for _, actor := range snapshot.Actors {
		if actor.ActorID == actorID {
			return actor
		}
	}
	return model.ActorActionSnapshotV2{}
}

func actionState(actor model.ActorActionSnapshotV2, actionID string) model.ActionInitialStateV2 {
	for _, action := range actor.Actions {
		if action.ActionID == actionID {
			return action
		}
	}
	return model.ActionInitialStateV2{}
}

func mustCode(t *testing.T, code int32) {
	t.Helper()
	if code != 0 {
		t.Fatalf("unexpected code %d", code)
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
