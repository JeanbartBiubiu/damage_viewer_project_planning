// 本文件验证 runtime 的基础集成行为，包括伤害、护盾、控制 pending intent 和 snapshot。
package runtime_test

import (
	"bytes"
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

func TestM3ActionResultCarriesSingleSkillEvidence(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m3_bolt"},
	}
	done := runBundle(t, bundle, input)
	result := actionResult(done, "m3_bolt")
	if !result.Accepted || result.BlockedReason != "" {
		t.Fatalf("m3_bolt result = %+v, want accepted without blocked reason", result)
	}
	if result.SourceActorID != "self" || result.TargetActorID != "enemy" {
		t.Fatalf("actor ids = %s -> %s", result.SourceActorID, result.TargetActorID)
	}
	if len(result.ResourceDeltas) != 1 || result.ResourceDeltas[0].ResourceID != "mana" || result.ResourceDeltas[0].Before != 100 || result.ResourceDeltas[0].After != 60 || result.ResourceDeltas[0].Delta != -40 {
		t.Fatalf("resource deltas = %+v, want mana 100 -> 60", result.ResourceDeltas)
	}
	if result.CooldownBefore.ReadyAtMs != 0 || result.CooldownAfter.ReadyAtMs != 1000 || result.CooldownAfter.CooldownMs != 1000 {
		t.Fatalf("cooldown = before %+v after %+v, want readyAt 0 -> 1000", result.CooldownBefore, result.CooldownAfter)
	}
	if len(result.Effects) != 1 {
		t.Fatalf("effects = %+v, want one damage effect", result.Effects)
	}
	effect := result.Effects[0]
	if effect.FormulaID != "flat_30" || !effect.HasRawAmount || effect.RawAmount != 30 || !effect.HasFinalDamage || effect.FinalDamage != 30 {
		t.Fatalf("effect amount = %+v, want raw/final damage 30 from flat_30", effect)
	}
	if effect.TargetHPBefore != 1000 || effect.TargetHPAfter != 970 || effect.DamageType != "magic" {
		t.Fatalf("effect target state = %+v, want magic damage hp 1000 -> 970", effect)
	}
	if len(effect.FormulaBreakdown) == 0 {
		t.Fatalf("formula breakdown missing: %+v", effect)
	}
}

func TestM3ActionResultCarriesBlockedReason(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "double_cost"},
	}
	done := runBundle(t, bundle, input)
	result := actionResult(done, "double_cost")
	if result.Accepted || result.BlockedReason != "insufficient resource" {
		t.Fatalf("blocked result = %+v, want insufficient resource", result)
	}
	if len(result.ResourceDeltas) != 0 || len(result.Effects) != 0 {
		t.Fatalf("blocked result should not carry deltas/effects: %+v", result)
	}
}

func TestM3SingleSkillResultIsDeterministicForSameSeed(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m3_bolt"},
	}
	first := runBundle(t, bundle, input)
	second := runBundle(t, bundle, input)
	firstResult := actionResult(first, "m3_bolt")
	secondResult := actionResult(second, "m3_bolt")
	if firstResult.Effects[0].FinalDamage != secondResult.Effects[0].FinalDamage ||
		firstResult.ResourceDeltas[0].After != secondResult.ResourceDeltas[0].After ||
		firstResult.CooldownAfter.ReadyAtMs != secondResult.CooldownAfter.ReadyAtMs {
		t.Fatalf("same seed result mismatch: first %+v second %+v", firstResult, secondResult)
	}
}

func TestM4DirectDamageRegressionUsesAhriQCanonicalEvidence(t *testing.T) {
	done := runBundle(t, m4AhriQRegressionBundle(843), m4AhriQRegressionRunInput())
	result := actionResult(done, "self::skill_ahri_q")

	if done.StopReason != "queue_empty" {
		t.Fatalf("stop reason = %s, want queue_empty", done.StopReason)
	}
	if !result.Accepted || result.BlockedReason != "" {
		t.Fatalf("Ahri Q result = %+v, want accepted without blocked reason", result)
	}
	if len(result.ResourceDeltas) != 1 || result.ResourceDeltas[0].ResourceID != "mana" ||
		result.ResourceDeltas[0].Before != 843 || result.ResourceDeltas[0].After != 748 || result.ResourceDeltas[0].Delta != -95 {
		t.Fatalf("Ahri Q resource deltas = %+v, want mana 843 -> 748", result.ResourceDeltas)
	}
	if result.CooldownBefore.ReadyAtMs != 0 || result.CooldownAfter.CooldownMs != 7000 || result.CooldownAfter.ReadyAtMs != 7000 {
		t.Fatalf("Ahri Q cooldown = before %+v after %+v, want readyAt 0 -> 7000", result.CooldownBefore, result.CooldownAfter)
	}
	if len(result.Effects) != 2 {
		t.Fatalf("Ahri Q effects = %+v, want magic outbound and true return damage", result.Effects)
	}

	magic := result.Effects[0]
	if magic.FormulaID != "ahri_q_out_damage" || !magic.HasRawAmount || magic.RawAmount != 144 || !magic.HasFinalDamage || magic.FinalDamage != 144 ||
		magic.DamageType != "magic" || magic.TargetHPBefore != 1000 || magic.TargetHPAfter != 856 {
		t.Fatalf("Ahri Q outbound effect = %+v, want 144 magic and target HP 1000 -> 856", magic)
	}
	if len(magic.FormulaBreakdown) == 0 {
		t.Fatalf("Ahri Q outbound formula breakdown missing: %+v", magic)
	}

	returned := result.Effects[1]
	if returned.FormulaID != "ahri_q_return_damage" || !returned.HasRawAmount || returned.RawAmount != 144 || !returned.HasFinalDamage || returned.FinalDamage != 144 ||
		returned.DamageType != "true" || returned.TargetHPBefore != 856 || returned.TargetHPAfter != 712 {
		t.Fatalf("Ahri Q return effect = %+v, want 144 true and target HP 856 -> 712", returned)
	}
	if len(returned.FormulaBreakdown) == 0 {
		t.Fatalf("Ahri Q return formula breakdown missing: %+v", returned)
	}
	if got := actorHP(done, "enemy"); got != 712 {
		t.Fatalf("enemy hp got %.2f, want 712 after 144 magic + 144 true", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 748 {
		t.Fatalf("self mana got %.2f, want 748 after 95 mana cost", got)
	}
}

func TestM4InsufficientResourceGateBlocksAhriQWithoutSideEffects(t *testing.T) {
	done := runBundle(t, m4AhriQRegressionBundle(50), m4AhriQRegressionRunInput())
	result := actionResult(done, "self::skill_ahri_q")

	if result.Accepted || result.BlockedReason != "insufficient resource" {
		t.Fatalf("Ahri Q blocked result = %+v, want insufficient resource", result)
	}
	if len(result.ResourceDeltas) != 0 || len(result.Effects) != 0 {
		t.Fatalf("blocked Ahri Q should not carry resource deltas or effects: %+v", result)
	}
	if got := actorHP(done, "enemy"); got != 1000 {
		t.Fatalf("enemy hp got %.2f, want unchanged target HP 1000", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 50 {
		t.Fatalf("self mana got %.2f, want failed cast to preserve 50 mana", got)
	}
}

func TestM4CooldownGateBlocksImmediateSecondCastWithoutSideEffects(t *testing.T) {
	bundle := controlGateBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "cooldown_bolt"},
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "cooldown_bolt"},
	}
	done := runBundle(t, bundle, input)
	results := actionResults(done, "cooldown_bolt")
	if len(results) != 2 {
		t.Fatalf("cooldown_bolt results = %+v, want accepted and blocked attempts", results)
	}

	first := results[0]
	if !first.Accepted || first.BlockedReason != "" {
		t.Fatalf("first cooldown_bolt result = %+v, want accepted", first)
	}
	if first.CooldownBefore.ReadyAtMs != 0 || first.CooldownAfter.CooldownMs != 1000 || first.CooldownAfter.ReadyAtMs != 1000 {
		t.Fatalf("first cooldown evidence = before %+v after %+v, want readyAt 0 -> 1000", first.CooldownBefore, first.CooldownAfter)
	}
	if len(first.Effects) != 1 || first.Effects[0].FinalDamage != 30 || first.Effects[0].TargetHPBefore != 1000 || first.Effects[0].TargetHPAfter != 970 {
		t.Fatalf("first cooldown_bolt effects = %+v, want one 30 damage segment", first.Effects)
	}

	blocked := results[1]
	if blocked.Accepted || blocked.BlockedReason != "cooldown" {
		t.Fatalf("second cooldown_bolt result = %+v, want blocked by cooldown", blocked)
	}
	if blocked.CooldownBefore.CooldownMs != 1000 || blocked.CooldownBefore.ReadyAtMs != 1000 ||
		blocked.CooldownAfter.CooldownMs != 1000 || blocked.CooldownAfter.ReadyAtMs != 1000 {
		t.Fatalf("blocked cooldown evidence = before %+v after %+v, want readyAt still 1000", blocked.CooldownBefore, blocked.CooldownAfter)
	}
	if len(blocked.ResourceDeltas) != 0 || len(blocked.Effects) != 0 {
		t.Fatalf("blocked cooldown cast should not carry resource deltas or effects: %+v", blocked)
	}
	if got := actorHP(done, "enemy"); got != 970 {
		t.Fatalf("enemy hp got %.2f, want only first cast damage to leave 970", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 100 {
		t.Fatalf("self mana got %.2f, want cooldown-blocked cast to preserve mana", got)
	}
}

func TestM4ChannelExecutionArenaFullBlocksWithoutSideEffects(t *testing.T) {
	bundle := m4ExecutionArenaBundle()
	input := controlRunInput()
	input.InitialActions = make([]model.ActionRequest, 0, 17)
	for i := 0; i < 17; i++ {
		input.InitialActions = append(input.InitialActions, model.ActionRequest{
			TriggerAtMs:   0,
			SourceActorID: "self",
			TargetActorID: "enemy",
			ActionID:      channelArenaActionID(i),
		})
	}
	input.StopCondition.MaxEvents = 17

	done := runBundle(t, bundle, input)
	blocked := actionResult(done, channelArenaActionID(16))
	if blocked.Accepted || blocked.BlockedReason != "execution_arena_full" || blocked.ExecutionStarted {
		t.Fatalf("arena-full channel result = %+v, want blocked before execution starts", blocked)
	}
	if len(blocked.ResourceDeltas) != 0 || len(blocked.Effects) != 0 {
		t.Fatalf("arena-full channel should not carry resource deltas or effects: %+v", blocked)
	}
	if blocked.CooldownBefore.ReadyAtMs != 0 || blocked.CooldownAfter.ReadyAtMs != 0 || blocked.CooldownAfter.CooldownMs != 1000 {
		t.Fatalf("arena-full cooldown evidence = before %+v after %+v, want no readyAt change", blocked.CooldownBefore, blocked.CooldownAfter)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 84 {
		t.Fatalf("self mana got %.2f, want only first 16 channel starts to spend mana", got)
	}
}

func TestM4MultiHitDamageCarriesOrderedSegmentEvidence(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_multi_hit_combo"},
	}
	done := runBundle(t, m4Batch1MechanismBundle(), input)
	result := actionResult(done, "m4_multi_hit_combo")

	if !result.Accepted || result.BlockedReason != "" {
		t.Fatalf("multi-hit result = %+v, want accepted", result)
	}
	if len(result.Effects) != 3 {
		t.Fatalf("multi-hit effects = %+v, want three deterministic damage segments", result.Effects)
	}
	assertDamageSegment(t, result.Effects[0], 0, "m4_multi_hit_physical", "physical", 12, 1000, 988)
	assertDamageSegment(t, result.Effects[1], 1, "m4_multi_hit_magic", "magic", 18, 988, 970)
	assertDamageSegment(t, result.Effects[2], 2, "m4_multi_hit_true", "true", 5, 970, 965)
	if got := actorHP(done, "enemy"); got != 965 {
		t.Fatalf("enemy hp got %.2f, want final HP 965 after ordered multi-hit damage", got)
	}
}

func TestM4ActionGateHasAcceptedAndOwnershipBlockedPaths(t *testing.T) {
	acceptedInput := controlRunInput()
	acceptedInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "fireball"},
	}
	acceptedDone := runBundle(t, controlGateBundle(), acceptedInput)
	accepted := actionResult(acceptedDone, "fireball")
	if !accepted.Accepted || accepted.BlockedReason != "" {
		t.Fatalf("accepted gate path = %+v, want fireball accepted without blocked reason", accepted)
	}
	if len(accepted.ResourceDeltas) != 1 || accepted.ResourceDeltas[0].ResourceID != "mana" ||
		accepted.ResourceDeltas[0].Before != 100 || accepted.ResourceDeltas[0].After != 60 || accepted.ResourceDeltas[0].Delta != -40 {
		t.Fatalf("accepted gate resource evidence = %+v, want mana 100 -> 60", accepted.ResourceDeltas)
	}
	if len(accepted.Effects) != 1 || accepted.Effects[0].FinalDamage != 30 || accepted.Effects[0].TargetHPBefore != 1000 || accepted.Effects[0].TargetHPAfter != 970 {
		t.Fatalf("accepted gate effect evidence = %+v, want fireball damage 30", accepted.Effects)
	}

	blockedInput := controlRunInput()
	blockedInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "enemy", TargetActorID: "self", ActionID: "fireball"},
	}
	blockedDone := runBundle(t, controlGateBundle(), blockedInput)
	blocked := actionResult(blockedDone, "fireball")
	if blocked.Accepted || blocked.BlockedReason != "action_not_owned" {
		t.Fatalf("blocked gate path = %+v, want ownership gate to block fireball", blocked)
	}
	if len(blocked.ResourceDeltas) != 0 || len(blocked.Effects) != 0 {
		t.Fatalf("blocked action gate should not carry resource deltas or effects: %+v", blocked)
	}
	if got := actorHP(blockedDone, "self"); got != 1000 {
		t.Fatalf("self hp got %.2f, want ownership-blocked cast to keep target HP 1000", got)
	}
	if got := actor(blockedDone, "enemy").Resources["mana"].Current; got != 100 {
		t.Fatalf("enemy mana got %.2f, want ownership-blocked cast to preserve mana", got)
	}
}

func TestM4ShieldAbsorbsDamageAndCarriesActionEvidence(t *testing.T) {
	bundle := m4Batch2MechanismBundle()
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "self", ActionID: "m4_grant_shield"},
		{TriggerAtMs: 1, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_shield_hit"},
	}
	done := runBundle(t, bundle, input)

	grant := actionResult(done, "m4_grant_shield")
	if !grant.Accepted || len(grant.Effects) != 1 {
		t.Fatalf("grant shield result = %+v, want one accepted shield effect", grant)
	}
	shield := grant.Effects[0]
	if shield.Kind != "grant_shield" || shield.StatusID != "m4_shield_50" || !shield.HasRawAmount || shield.RawAmount != 50 ||
		!shield.HasShieldGranted || shield.ShieldGranted != 50 || !shield.HasShieldBefore || shield.ShieldBefore != 0 ||
		!shield.HasShieldAfter || shield.ShieldAfter != 50 {
		t.Fatalf("grant shield evidence = %+v, want 50 shield 0 -> 50", shield)
	}

	hit := actionResult(done, "m4_shield_hit")
	if !hit.Accepted || len(hit.Effects) != 1 {
		t.Fatalf("shield hit result = %+v, want one accepted damage effect", hit)
	}
	damage := hit.Effects[0]
	if damage.Kind != "deal_damage" || damage.DamageType != "physical" || !damage.HasRawAmount || damage.RawAmount != 80 ||
		!damage.HasShieldAbsorbed || damage.ShieldAbsorbed != 50 || !damage.HasShieldBefore || damage.ShieldBefore != 50 ||
		!damage.HasShieldAfter || damage.ShieldAfter != 0 || !damage.HasFinalDamage || damage.FinalDamage != 30 ||
		damage.TargetHPBefore != 1000 || damage.TargetHPAfter != 970 {
		t.Fatalf("shield damage evidence = %+v, want 50 absorbed and HP 1000 -> 970", damage)
	}
	self := actor(done, "self")
	if self.CurrentHP != 970 || self.ShieldAmount != 0 {
		t.Fatalf("self final state = %+v, want HP 970 and no shield", self)
	}
}

func TestM4ShieldKindSuffixMatchesDamageType(t *testing.T) {
	bundle := m4Batch2MechanismBundle()
	for i := range bundle.Statuses {
		if bundle.Statuses[i].ID == "m4_shield_50" {
			bundle.Statuses[i].ShieldKind = "magic_shield"
		}
	}
	for i := range bundle.Actions {
		if bundle.Actions[i].ID == "m4_shield_hit" {
			bundle.Actions[i].Effects[0].DamageType = "magic"
		}
	}
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "self", ActionID: "m4_grant_shield"},
		{TriggerAtMs: 1, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_shield_hit"},
	}
	done := runBundle(t, bundle, input)

	hit := actionResult(done, "m4_shield_hit")
	if !hit.Accepted || len(hit.Effects) != 1 {
		t.Fatalf("magic_shield hit result = %+v, want one accepted damage effect", hit)
	}
	damage := hit.Effects[0]
	if damage.DamageType != "magic" || !damage.HasShieldAbsorbed || damage.ShieldAbsorbed != 50 ||
		!damage.HasShieldAfter || damage.ShieldAfter != 0 || !damage.HasFinalDamage || damage.FinalDamage != 30 {
		t.Fatalf("magic_shield damage evidence = %+v, want 50 absorbed and 30 HP damage", damage)
	}
	if got := actorHP(done, "self"); got != 970 {
		t.Fatalf("self hp got %.2f, want magic_shield to absorb magic damage before HP", got)
	}
}

func TestM4HealClampsToMaxHPAndCarriesActionEvidence(t *testing.T) {
	bundle := m4Batch2MechanismBundle()
	bundle.Actors[0].InitialHP = 700
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "self", ActionID: "m4_heal_400"},
	}
	done := runBundle(t, bundle, input)
	result := actionResult(done, "m4_heal_400")

	if !result.Accepted || len(result.Effects) != 1 {
		t.Fatalf("heal result = %+v, want one accepted heal effect", result)
	}
	heal := result.Effects[0]
	if heal.Kind != "heal" || !heal.HasRawAmount || heal.RawAmount != 400 ||
		!heal.HasHealApplied || heal.HealApplied != 300 || !heal.HasOverheal || heal.OverhealAmount != 100 ||
		heal.TargetHPBefore != 700 || heal.TargetHPAfter != 1000 {
		t.Fatalf("heal evidence = %+v, want raw 400 applied 300 overheal 100 and HP 700 -> 1000", heal)
	}
	if got := actorHP(done, "self"); got != 1000 {
		t.Fatalf("self hp got %.2f, want 1000 after clamped heal", got)
	}
}

func TestM4DotStatusSchedulesFixedDamageTicks(t *testing.T) {
	done := runBundle(t, m4Batch2MechanismBundle(), m4Batch2RunInput("enemy", "m4_apply_dot"))
	apply := actionResult(done, "m4_apply_dot")
	if !apply.Accepted || len(apply.Effects) != 1 || apply.Effects[0].Kind != "apply_status" || apply.Effects[0].StatusID != "m4_burn_3x" {
		t.Fatalf("dot apply result = %+v, want accepted apply_status m4_burn_3x", apply)
	}
	if len(done.TickResults) != 3 {
		t.Fatalf("dot tick results = %+v, want three ticks", done.TickResults)
	}
	wantTimes := []int64{1000, 2000, 3000}
	wantHP := []float64{980, 960, 940}
	for i, tick := range done.TickResults {
		if tick.StatusID != "m4_burn_3x" || tick.Kind != "deal_damage" || tick.TickIndex != i+1 || tick.TickCount != 3 ||
			tick.TimeMs != wantTimes[i] || !tick.HasRawAmount || tick.RawAmount != 20 ||
			tick.DamageType != "magic" || !tick.HasFinalDamage || tick.FinalDamage != 20 || tick.TargetHPAfter != wantHP[i] {
			t.Fatalf("dot tick[%d] = %+v, want 20 magic at %d and hp %.2f", i, tick, wantTimes[i], wantHP[i])
		}
	}
	if got := actorHP(done, "enemy"); got != 940 {
		t.Fatalf("enemy hp got %.2f, want 940 after three dot ticks", got)
	}
}

func TestM4DotDamageFiresOneLevelDamageTriggers(t *testing.T) {
	done := runBundle(t, m4DotTriggerBundle(), m4Batch2RunInput("enemy", "m4_apply_dot"))
	if len(done.TickResults) != 3 {
		t.Fatalf("dot tick results = %+v, want three ticks", done.TickResults)
	}
	if len(done.TriggerResults) != 6 {
		t.Fatalf("dot trigger results = %+v, want on_damage_dealt and on_damage_taken for each tick only", done.TriggerResults)
	}
	dealt, taken := 0, 0
	for _, result := range done.TriggerResults {
		if result.ChainDepth != 1 || result.EffectCount != 1 {
			t.Fatalf("dot trigger result = %+v, want one-level trigger evidence", result)
		}
		switch result.Event {
		case "on_damage_dealt":
			dealt++
		case "on_damage_taken":
			taken++
		default:
			t.Fatalf("unexpected dot trigger event = %+v", result)
		}
	}
	if dealt != 3 || taken != 3 {
		t.Fatalf("dot trigger event counts dealt=%d taken=%d, want 3/3", dealt, taken)
	}
	if got := actorHP(done, "enemy"); got != 910 {
		t.Fatalf("enemy hp got %.2f, want 60 dot + 30 trigger damage without recursive expansion", got)
	}
}

func TestM4HotStatusSchedulesFixedHealTicksAndClamps(t *testing.T) {
	bundle := m4Batch2MechanismBundle()
	bundle.Actors[0].InitialHP = 930
	done := runBundle(t, bundle, m4Batch2RunInput("self", "m4_apply_hot"))
	apply := actionResult(done, "m4_apply_hot")
	if !apply.Accepted || len(apply.Effects) != 1 || apply.Effects[0].Kind != "apply_status" || apply.Effects[0].StatusID != "m4_regen_3x" {
		t.Fatalf("hot apply result = %+v, want accepted apply_status m4_regen_3x", apply)
	}
	if len(done.TickResults) != 3 {
		t.Fatalf("hot tick results = %+v, want three ticks", done.TickResults)
	}
	wantApplied := []float64{40, 30, 0}
	wantOverheal := []float64{0, 10, 40}
	wantHP := []float64{970, 1000, 1000}
	for i, tick := range done.TickResults {
		if tick.StatusID != "m4_regen_3x" || tick.Kind != "heal" || tick.TickIndex != i+1 || tick.TickCount != 3 ||
			tick.TimeMs != int64((i+1)*1000) || !tick.HasRawAmount || tick.RawAmount != 40 ||
			!tick.HasHealApplied || tick.HealApplied != wantApplied[i] || !tick.HasOverheal || tick.OverhealAmount != wantOverheal[i] ||
			tick.TargetHPAfter != wantHP[i] {
			t.Fatalf("hot tick[%d] = %+v, want applied %.2f overheal %.2f hp %.2f", i, tick, wantApplied[i], wantOverheal[i], wantHP[i])
		}
	}
	if got := actorHP(done, "self"); got != 1000 {
		t.Fatalf("self hp got %.2f, want 1000 after clamped hot ticks", got)
	}
}

func TestLegacyStatusWithoutCritFieldsKeepsBehavior(t *testing.T) {
	done := runBundle(t, m4Batch2MechanismBundle(), m4Batch2RunInput("enemy", "m4_apply_dot"))
	if len(done.TickResults) != 3 {
		t.Fatalf("dot tick results = %+v, want three ticks", done.TickResults)
	}
	for i, tick := range done.TickResults {
		if tick.CritPolicy != "" || tick.HasCritRoll || tick.HasCritResult || tick.HasCritMultiplier {
			t.Fatalf("legacy tick[%d] unexpectedly carries crit evidence: %+v", i, tick)
		}
	}
}

func TestM4MarkApplyCarriesStateEvidence(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "mark"},
	}
	done := runBundle(t, controlGateBundle(), input)
	result := actionResult(done, "mark")

	if !result.Accepted || result.BlockedReason != "" || len(result.Effects) != 1 {
		t.Fatalf("mark result = %+v, want one accepted mark effect", result)
	}
	effect := result.Effects[0]
	if effect.Kind != "apply_mark" || effect.MarkID != "test_mark" || !effect.HasMarkState ||
		!effect.MarkActive || effect.MarkCount != 1 || effect.SourceActorID != "self" || effect.TargetActorID != "enemy" {
		t.Fatalf("mark apply evidence = %+v, want active test_mark on enemy with count 1", effect)
	}
	if len(result.ResourceDeltas) != 0 || actorHP(done, "self") != 1000 || actorHP(done, "enemy") != 1000 {
		t.Fatalf("mark apply should not spend resources or damage actors: result=%+v done=%+v", result, done.Actors)
	}
}

func TestM4ConditionalHitUsesMarkConditionTrueAndFalse(t *testing.T) {
	falseInput := controlRunInput()
	falseInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "free_marked"},
	}
	falseDone := runBundle(t, controlGateBundle(), falseInput)
	blocked := actionResult(falseDone, "free_marked")
	if blocked.Accepted || blocked.BlockedReason != "required_mark_missing" || !blocked.HasCondition ||
		blocked.ConditionKind != "mark" || blocked.ConditionID != "test_mark" || blocked.ConditionPassed {
		t.Fatalf("false condition result = %+v, want required mark condition to fail", blocked)
	}
	if len(blocked.ResourceDeltas) != 0 || len(blocked.Effects) != 0 || actorHP(falseDone, "enemy") != 1000 {
		t.Fatalf("false condition should have no side effects: result=%+v enemyHP=%.2f", blocked, actorHP(falseDone, "enemy"))
	}

	trueInput := controlRunInput()
	trueInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "mark"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "free_marked"},
	}
	trueDone := runBundle(t, controlGateBundle(), trueInput)
	accepted := actionResult(trueDone, "free_marked")
	if !accepted.Accepted || accepted.BlockedReason != "" || !accepted.HasCondition ||
		accepted.ConditionKind != "mark" || accepted.ConditionID != "test_mark" || !accepted.ConditionPassed {
		t.Fatalf("true condition result = %+v, want required mark condition to pass", accepted)
	}
	if len(accepted.Effects) != 1 || accepted.Effects[0].FinalDamage != 30 ||
		accepted.Effects[0].TargetHPBefore != 1000 || accepted.Effects[0].TargetHPAfter != 970 {
		t.Fatalf("true condition damage evidence = %+v, want 30 damage after mark", accepted.Effects)
	}
	if got := actorHP(trueDone, "enemy"); got != 970 {
		t.Fatalf("enemy hp got %.2f, want 970 after marked hit", got)
	}
}

func TestM4CritDeterministicCarriesCritEvidence(t *testing.T) {
	critDone := runBundle(t, m4Batch3MechanismBundle(), m4Batch3RunInput(7, "m4_crit_yes"))
	critResult := actionResult(critDone, "m4_crit_yes")
	if !critResult.Accepted || len(critResult.Effects) != 1 {
		t.Fatalf("crit result = %+v, want one accepted effect", critResult)
	}
	critEffect := critResult.Effects[0]
	if !critEffect.HasRawAmount || critEffect.RawAmount != 40 || !critEffect.HasFinalDamage || critEffect.FinalDamage != 80 ||
		critEffect.HasCritRoll || !critEffect.HasCritResult || !critEffect.CritResult ||
		!critEffect.HasCritMultiplier || critEffect.CritMultiplier != 2 || critEffect.TargetHPAfter != 920 {
		t.Fatalf("deterministic crit evidence = %+v, want raw 40 final 80 crit x2", critEffect)
	}

	nonCritDone := runBundle(t, m4Batch3MechanismBundle(), m4Batch3RunInput(7, "m4_crit_no"))
	nonCritResult := actionResult(nonCritDone, "m4_crit_no")
	if !nonCritResult.Accepted || len(nonCritResult.Effects) != 1 {
		t.Fatalf("non-crit result = %+v, want one accepted effect", nonCritResult)
	}
	nonCritEffect := nonCritResult.Effects[0]
	if !nonCritEffect.HasRawAmount || nonCritEffect.RawAmount != 40 || !nonCritEffect.HasFinalDamage || nonCritEffect.FinalDamage != 40 ||
		nonCritEffect.HasCritRoll || !nonCritEffect.HasCritResult || nonCritEffect.CritResult ||
		!nonCritEffect.HasCritMultiplier || nonCritEffect.CritMultiplier != 2 || nonCritEffect.TargetHPAfter != 960 {
		t.Fatalf("deterministic non-crit evidence = %+v, want raw/final 40 and crit=false", nonCritEffect)
	}
}

func TestM4RNGSeededCritIsRepeatableAndBranchable(t *testing.T) {
	seedOneFirst := runBundle(t, m4Batch3MechanismBundle(), m4Batch3RunInput(1, "m4_seeded_crit"))
	seedOneSecond := runBundle(t, m4Batch3MechanismBundle(), m4Batch3RunInput(1, "m4_seeded_crit"))
	seedTwo := runBundle(t, m4Batch3MechanismBundle(), m4Batch3RunInput(2, "m4_seeded_crit"))

	firstEffect := actionResult(seedOneFirst, "m4_seeded_crit").Effects[0]
	secondEffect := actionResult(seedOneSecond, "m4_seeded_crit").Effects[0]
	otherEffect := actionResult(seedTwo, "m4_seeded_crit").Effects[0]
	if len(seedOneFirst.RNG) != 1 || len(seedOneSecond.RNG) != 1 || len(seedTwo.RNG) != 1 {
		t.Fatalf("rng draws = %+v / %+v / %+v, want one draw per run", seedOneFirst.RNG, seedOneSecond.RNG, seedTwo.RNG)
	}
	firstDraw := seedOneFirst.RNG[0]
	secondDraw := seedOneSecond.RNG[0]
	if firstDraw.Stream != "main" || firstDraw.Index != 0 || firstDraw.Use != "crit" {
		t.Fatalf("seed 1 draw metadata = %+v, want main/0/crit", firstDraw)
	}
	if firstDraw != secondDraw || firstEffect.FinalDamage != secondEffect.FinalDamage || firstEffect.CritResult != secondEffect.CritResult {
		t.Fatalf("same seed should repeat: draw %+v/%+v effect %+v/%+v", firstDraw, secondDraw, firstEffect, secondEffect)
	}
	if !firstEffect.HasCritRoll || !firstEffect.HasCritResult || !firstEffect.CritResult || firstEffect.FinalDamage != 80 || actorHP(seedOneFirst, "enemy") != 920 {
		t.Fatalf("seed 1 effect = %+v, want crit branch with final 80", firstEffect)
	}
	if !otherEffect.HasCritRoll || !otherEffect.HasCritResult || otherEffect.CritResult || otherEffect.FinalDamage != 40 || actorHP(seedTwo, "enemy") != 960 {
		t.Fatalf("seed 2 effect = %+v, want non-crit branch with final 40", otherEffect)
	}
	if seedTwo.RNG[0].Value == firstDraw.Value {
		t.Fatalf("different seeds should document a different draw: seed1=%+v seed2=%+v", firstDraw, seedTwo.RNG[0])
	}
}

func TestDirectEffectCritReadsAttackerCritChance(t *testing.T) {
	done := runBundle(t, m4BatchJCritBundle(0.5), m4BatchJCritRunInput("m4_attr_crit_damage"))
	result := actionResult(done, "m4_attr_crit_damage")
	if !result.Accepted || len(result.Effects) != 1 {
		t.Fatalf("direct attr crit result = %+v, want one accepted effect", result)
	}
	effect := result.Effects[0]
	if effect.CritPolicy != "expected" || effect.HasCritRoll || !effect.HasCritResult || effect.CritResult ||
		!effect.HasCritMultiplier || effect.CritMultiplier != 1.45 {
		t.Fatalf("direct attr crit evidence = %+v, want expected policy with x1.45 and no roll", effect)
	}
	if !effect.HasRawAmount || effect.RawAmount != 40 || !effect.HasFinalDamage || effect.FinalDamage != 49 {
		t.Fatalf("direct attr crit damage = %+v, want raw 40 final 49", effect)
	}
	if got := actorHP(done, "enemy"); got != 951 {
		t.Fatalf("enemy hp got %.2f, want 951 after expected crit damage", got)
	}
}

func TestStatusTickDamageUsesPublishedCritMultiplier(t *testing.T) {
	done := runBundle(t, m4BatchJCritBundle(0.5), m4BatchJCritRunInput("m4_apply_crit_dot"))
	if len(done.TickResults) != 1 {
		t.Fatalf("tick results = %+v, want one crit dot tick", done.TickResults)
	}
	tick := done.TickResults[0]
	if tick.CritPolicy != "expected" || tick.HasCritRoll || !tick.HasCritResult || tick.CritResult ||
		!tick.HasCritMultiplier || tick.CritMultiplier != 1.45 {
		t.Fatalf("tick crit evidence = %+v, want expected policy with x1.45 and no roll", tick)
	}
	if !tick.HasRawAmount || tick.RawAmount != 40 || !tick.HasFinalDamage || tick.FinalDamage != 49 {
		t.Fatalf("tick damage = %+v, want raw 40 final 49", tick)
	}
	if got := actorHP(done, "enemy"); got != 951 {
		t.Fatalf("enemy hp got %.2f, want 951 after crit dot tick", got)
	}
}

func TestStatusTickHealUsesPublishedCritMultiplier(t *testing.T) {
	bundle := m4BatchJCritBundle(0.5)
	bundle.Actors[0].InitialHP = 900
	done := runBundle(t, bundle, m4BatchJCritRunInput("m4_apply_crit_hot"))
	if len(done.TickResults) != 1 {
		t.Fatalf("tick results = %+v, want one crit hot tick", done.TickResults)
	}
	tick := done.TickResults[0]
	if tick.CritPolicy != "expected" || tick.HasCritRoll || !tick.HasCritResult || tick.CritResult ||
		!tick.HasCritMultiplier || tick.CritMultiplier != 1.45 {
		t.Fatalf("tick heal crit evidence = %+v, want expected policy with x1.45 and no roll", tick)
	}
	if !tick.HasRawAmount || tick.RawAmount != 40 || !tick.HasHealApplied || tick.HealApplied != 49 ||
		!tick.HasOverheal || tick.OverhealAmount != 0 || tick.TargetHPAfter != 949 {
		t.Fatalf("tick heal = %+v, want raw 40 applied 49 hp 900 -> 949", tick)
	}
	if got := actorHP(done, "self"); got != 949 {
		t.Fatalf("self hp got %.2f, want 949 after crit hot tick", got)
	}
}

func TestDirectHealCritReadsAttackerCritChance(t *testing.T) {
	bundle := m4BatchJCritBundle(0.5)
	bundle.Actors[0].InitialHP = 900
	done := runBundle(t, bundle, m4BatchJCritRunInput("m4_attr_crit_heal"))
	result := actionResult(done, "m4_attr_crit_heal")
	if !result.Accepted || len(result.Effects) != 1 {
		t.Fatalf("direct attr crit heal result = %+v, want one accepted effect", result)
	}
	effect := result.Effects[0]
	if effect.CritPolicy != "expected" || effect.HasCritRoll || !effect.HasCritResult || effect.CritResult ||
		!effect.HasCritMultiplier || effect.CritMultiplier != 1.45 {
		t.Fatalf("direct attr crit heal evidence = %+v, want expected policy with x1.45 and no roll", effect)
	}
	if !effect.HasRawAmount || effect.RawAmount != 40 || !effect.HasHealApplied || effect.HealApplied != 49 ||
		!effect.HasOverheal || effect.OverhealAmount != 0 || effect.TargetHPBefore != 900 || effect.TargetHPAfter != 949 {
		t.Fatalf("direct attr crit heal = %+v, want raw 40 applied 49 hp 900 -> 949", effect)
	}
	if got := actorHP(done, "self"); got != 949 {
		t.Fatalf("self hp got %.2f, want 949 after expected crit heal", got)
	}
}

func TestM4ControlAppliesStatusAndBlocksCastWhileActive(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_apply_silence"},
		{TriggerAtMs: 1, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_enemy_cast"},
	}
	done := runBundle(t, m4Batch4MechanismBundle(), input)

	apply := actionResult(done, "m4_apply_silence")
	if !apply.Accepted || len(apply.Effects) != 1 || apply.Effects[0].Kind != "apply_status" || apply.Effects[0].StatusID != "m4_silence_1000" {
		t.Fatalf("control apply result = %+v, want accepted apply_status m4_silence_1000", apply)
	}
	blocked := actionResult(done, "m4_enemy_cast")
	if blocked.Accepted || blocked.BlockedReason != "blocked_by_status:silence_forbid" ||
		blocked.BlockedRuleID != "silence_forbid" || blocked.BlockedStatusID != "m4_silence_1000" {
		t.Fatalf("blocked control result = %+v, want silence_forbid with status id evidence", blocked)
	}
	if len(blocked.Effects) != 0 || actorHP(done, "self") != 1000 {
		t.Fatalf("control-blocked action should not damage self: result=%+v selfHP=%.2f", blocked, actorHP(done, "self"))
	}
	if !hasLogAt(done, "status_apply", "m4_silence_1000", 0) || !hasLogAt(done, "status_expire", "m4_silence_1000", 1000) {
		t.Fatalf("control logs = %+v, want status apply at 0ms and expire at 1000ms", done.Logs)
	}
}

func TestM4InterruptStopsRunningActionBeforeCompletion(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_channel_blast"},
		{TriggerAtMs: 500, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_interrupt"},
	}
	done := runBundle(t, m4Batch4MechanismBundle(), input)
	start := actionResults(done, "m4_channel_blast")[0]
	if !start.Accepted || !start.ExecutionStarted || start.ExecutionCompleted || start.Interrupted || start.ExecutionCompleteAtMs != 1000 {
		t.Fatalf("channel start result = %+v, want running action scheduled to complete at 1000", start)
	}
	interrupt := actionResult(done, "m4_interrupt")
	if !interrupt.Accepted || len(interrupt.Effects) != 1 || interrupt.Effects[0].Kind != "interrupt" ||
		!interrupt.Effects[0].HasInterrupt || interrupt.Effects[0].InterruptedActionID != "m4_channel_blast" {
		t.Fatalf("interrupt result = %+v, want m4_channel_blast interrupted", interrupt)
	}
	channelResults := actionResults(done, "m4_channel_blast")
	if len(channelResults) != 2 || !channelResults[1].Interrupted || channelResults[1].ExecutionCompleted {
		t.Fatalf("channel results = %+v, want start + interrupted record and no completion", channelResults)
	}
	if got := actorHP(done, "enemy"); got != 1000 {
		t.Fatalf("enemy hp got %.2f, want interrupted channel to produce no completed damage", got)
	}
}

func TestM4TriggerChainRunsOneFollowUpEffectInOrder(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_trigger_starter"},
	}
	done := runBundle(t, m4Batch4TriggerBundle(), input)
	result := actionResult(done, "m4_trigger_starter")
	if !result.Accepted || len(result.Effects) != 1 || result.Effects[0].FinalDamage != 10 {
		t.Fatalf("trigger starter result = %+v, want accepted 10 damage starter", result)
	}
	if len(done.TriggerResults) != 1 || done.TriggerResults[0].TriggerID != "m4_followup_on_damage_taken" ||
		done.TriggerResults[0].Event != "on_damage_taken" || done.TriggerResults[0].EffectCount != 1 || done.TriggerResults[0].ChainDepth != 1 {
		t.Fatalf("trigger results = %+v, want one on_damage_taken follow-up at depth 1", done.TriggerResults)
	}
	if got := actorHP(done, "enemy"); got != 985 {
		t.Fatalf("enemy hp got %.2f, want starter 10 + trigger 5 to leave 985", got)
	}
}

func TestM4OwnerScopedTriggerDoesNotFireGlobally(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_history_hit"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_trigger_starter"},
	}
	done := runBundle(t, m4OwnerScopedTriggerBundle(), input)
	if len(done.TriggerResults) != 1 || done.TriggerResults[0].TriggerID != "m4_self_takes_damage_thorns" ||
		done.TriggerResults[0].SourceActorID != "enemy" || done.TriggerResults[0].TargetActorID != "self" {
		t.Fatalf("owner-scoped trigger results = %+v, want only self-as-target damage to fire", done.TriggerResults)
	}
	if got := actorHP(done, "self"); got != 970 {
		t.Fatalf("self hp got %.2f, want only initial 30 damage and no global trigger on enemy damage", got)
	}
	if got := actorHP(done, "enemy"); got != 985 {
		t.Fatalf("enemy hp got %.2f, want 5 thorns + 10 starter damage", got)
	}
}

func TestM4HistoryWindowReadsRecentDamageInsideAndOutsideWindow(t *testing.T) {
	insideInput := controlRunInput()
	insideInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_history_hit"},
		{TriggerAtMs: 3000, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_recent_repay"},
	}
	insideDone := runBundle(t, m4Batch4MechanismBundle(), insideInput)
	inside := actionResult(insideDone, "m4_recent_repay")
	if !inside.Accepted || len(inside.Effects) != 1 || inside.Effects[0].Kind != "damage_from_recent" ||
		!inside.Effects[0].HasHistoryWindow || inside.Effects[0].HistoryWindowMs != 4000 ||
		inside.Effects[0].RawAmount != 30 || inside.Effects[0].FinalDamage != 30 || actorHP(insideDone, "enemy") != 970 {
		t.Fatalf("inside history window result = %+v enemyHP=%.2f, want recent 30 damage reflected", inside, actorHP(insideDone, "enemy"))
	}

	outsideInput := controlRunInput()
	outsideInput.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_history_hit"},
		{TriggerAtMs: 5001, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_recent_repay"},
	}
	outsideDone := runBundle(t, m4Batch4MechanismBundle(), outsideInput)
	outside := actionResult(outsideDone, "m4_recent_repay")
	if !outside.Accepted || len(outside.Effects) != 1 || outside.Effects[0].RawAmount != 0 ||
		outside.Effects[0].FinalDamage != 0 || actorHP(outsideDone, "enemy") != 1000 {
		t.Fatalf("outside history window result = %+v enemyHP=%.2f, want expired window to read 0", outside, actorHP(outsideDone, "enemy"))
	}
}

func TestM4HistoryWindowRecordsHPDamageAfterShieldAbsorb(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "self", ActionID: "m4_grant_shield"},
		{TriggerAtMs: 1, SourceActorID: "enemy", TargetActorID: "self", ActionID: "m4_shield_hit"},
		{TriggerAtMs: 2, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_recent_repay"},
	}
	done := runBundle(t, m4HistoryShieldBundle(), input)
	repay := actionResult(done, "m4_recent_repay")
	if !repay.Accepted || len(repay.Effects) != 1 || repay.Effects[0].RawAmount != 30 || repay.Effects[0].FinalDamage != 30 {
		t.Fatalf("shielded history repay = %+v, want only 30 HP damage recorded after shield absorb", repay)
	}
	if actorHP(done, "self") != 970 || actorHP(done, "enemy") != 970 {
		t.Fatalf("final hp self/enemy = %.2f/%.2f, want shielded 30 and repay 30", actorHP(done, "self"), actorHP(done, "enemy"))
	}
}

func TestM4HistoryWindowRecordsAppliedHPDamageOnOverkill(t *testing.T) {
	bundle := m4OverkillHistoryBundle()
	bundle.Actors[1].InitialHP = 20
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_history_hit"},
	}
	done := runBundle(t, bundle, input)
	if len(done.TriggerResults) != 1 || done.TriggerResults[0].TriggerID != "m4_overkill_history_repay" {
		t.Fatalf("overkill trigger results = %+v, want one history repay trigger", done.TriggerResults)
	}
	if got := actorHP(done, "self"); got != 980 {
		t.Fatalf("self hp got %.2f, want overkill history to record 20 actual HP loss only", got)
	}
	if got := actorHP(done, "enemy"); got != 0 {
		t.Fatalf("enemy hp got %.2f, want overkill target dead", got)
	}
}

func TestM4CounterIncrementsThenFeedsFormulaRead(t *testing.T) {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_counter_increment"},
		{TriggerAtMs: 1, SourceActorID: "self", TargetActorID: "enemy", ActionID: "m4_counter_damage"},
	}
	done := runBundle(t, m4Batch4MechanismBundle(), input)
	increment := actionResult(done, "m4_counter_increment")
	if !increment.Accepted || len(increment.Effects) != 1 || increment.Effects[0].Kind != "increment_counter" ||
		increment.Effects[0].CounterKey != "m4_stack" || increment.Effects[0].CounterBefore != 0 || increment.Effects[0].CounterAfter != 1 {
		t.Fatalf("counter increment result = %+v, want m4_stack 0 -> 1", increment)
	}
	damage := actionResult(done, "m4_counter_damage")
	if !damage.Accepted || len(damage.Effects) != 1 || damage.Effects[0].RawAmount != 10 || damage.Effects[0].FinalDamage != 10 ||
		!breakdownHas(damage.Effects[0].FormulaBreakdown, "counter", "m4_stack", 1) {
		t.Fatalf("counter damage result = %+v, want formula read counter m4_stack=1 for 10 damage", damage)
	}
	if got := actorHP(done, "enemy"); got != 990 {
		t.Fatalf("enemy hp got %.2f, want 990 after counter-fed damage", got)
	}
}

func TestM4ModeAugmentChangesKnownActionResult(t *testing.T) {
	normal := runBundle(t, m4Batch4MechanismBundle(), m4Batch4RunInput("m4_mode_damage", nil))
	augmented := runBundle(t, m4Batch4MechanismBundle(), m4Batch4RunInput("m4_mode_damage", []string{"m4_empowered"}))

	normalEffect := actionResult(normal, "m4_mode_damage").Effects[0]
	if normalEffect.RawAmount != 40 || normalEffect.FinalDamage != 40 || !normalEffect.HasModeState ||
		normalEffect.ModeAugmentID != "m4_empowered" || normalEffect.ModeActive || normalEffect.ModeMultiplier != 2 {
		t.Fatalf("normal mode effect = %+v, want inactive augment and 40 damage", normalEffect)
	}
	augmentedEffect := actionResult(augmented, "m4_mode_damage").Effects[0]
	if augmentedEffect.RawAmount != 40 || augmentedEffect.FinalDamage != 80 || !augmentedEffect.HasModeState ||
		augmentedEffect.ModeAugmentID != "m4_empowered" || !augmentedEffect.ModeActive || augmentedEffect.ModeMultiplier != 2 {
		t.Fatalf("augmented mode effect = %+v, want active augment and 80 damage", augmentedEffect)
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
	if len(self.Actions) != 9 {
		t.Fatalf("self actions len = %d, want 9", len(self.Actions))
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

func TestActionSnapshotInitialNamesM4Batch4EffectKinds(t *testing.T) {
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, m4Batch4MechanismBundle())))
	input := controlRunInput()

	mustCode(t, session.SnapshotActionsInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastActionSnapshot(session.OutboxBytes())
	self := actionSnapshotActor(snapshot, "self")
	enemy := actionSnapshotActor(snapshot, "enemy")
	counterIncrement := actionState(self, "m4_counter_increment")
	if len(counterIncrement.EffectRows) != 1 || counterIncrement.EffectRows[0].Kind != "increment_counter" {
		t.Fatalf("counter increment action snapshot = %+v, want increment_counter effect kind", counterIncrement)
	}
	interrupt := actionState(enemy, "m4_interrupt")
	if len(interrupt.EffectRows) != 1 || interrupt.EffectRows[0].Kind != "interrupt" {
		t.Fatalf("interrupt action snapshot = %+v, want interrupt effect kind", interrupt)
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

func TestActionSnapshotInitialCalculatesM2PanelFormulaRows(t *testing.T) {
	bundle := m2PanelBundle()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	input := m2PanelRunInput()

	mustCode(t, session.SnapshotActionsInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastActionSnapshot(session.OutboxBytes())
	self := actionSnapshotActor(snapshot, "self")
	levelBolt := actionState(self, "level_bolt")

	if levelBolt.SkillLevel != 4 || levelBolt.PanelInputs["skillLevel"] != 4 {
		t.Fatalf("level_bolt inputs = level %d panel %+v, want level/panel skillLevel 4", levelBolt.SkillLevel, levelBolt.PanelInputs)
	}
	if levelBolt.CooldownMs != 400 || levelBolt.CooldownFormulaID != "level_cooldown" || len(levelBolt.CooldownBreakdown) == 0 {
		t.Fatalf("level_bolt cooldown = %+v, want formula cooldown 400 with breakdown", levelBolt)
	}
	if len(levelBolt.ResourceCosts) != 1 {
		t.Fatalf("level_bolt costs = %+v, want one panel cost row", levelBolt.ResourceCosts)
	}
	cost := levelBolt.ResourceCosts[0]
	if cost.Source != "panel" || cost.ResourceID != "mana" || cost.FormulaID != "level_cost" || cost.Amount != 20 || cost.FinalAmount != 20 || len(cost.Breakdown) == 0 {
		t.Fatalf("level_bolt cost = %+v, want calculated panel mana cost 20", cost)
	}
	if len(levelBolt.EffectRows) != 1 {
		t.Fatalf("level_bolt effects = %+v, want one panel effect row", levelBolt.EffectRows)
	}
	effect := levelBolt.EffectRows[0]
	if effect.Source != "panel" || effect.FormulaID != "level_damage" || !effect.HasResolvedAmount || effect.ResolvedAmount != 40 || effect.FinalAmount != 40 || len(effect.Breakdown) == 0 {
		t.Fatalf("level_bolt effect = %+v, want calculated panel damage 40", effect)
	}
}

func TestActionSnapshotInitialCalculatesM2AbilityHasteCooldown(t *testing.T) {
	bundle := m2AbilityHasteCooldownBundle()
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, bundle)))
	input := m2AbilityHasteCooldownRunInput()

	mustCode(t, session.SnapshotActionsInitialJSON(mustJSON(t, input)))
	snapshot := testkit.LastActionSnapshot(session.OutboxBytes())
	self := actionSnapshotActor(snapshot, "self")
	hasteBurst := actionState(self, "haste_burst")

	if hasteBurst.CooldownMs != 5833 {
		t.Fatalf("haste_burst cooldownMs = %d, want rounded 5833 from 7000*100/(100+20)", hasteBurst.CooldownMs)
	}
	if hasteBurst.CooldownFormulaID != "haste_cooldown" {
		t.Fatalf("haste_burst cooldownFormulaId = %q, want haste_cooldown", hasteBurst.CooldownFormulaID)
	}
	if len(hasteBurst.CooldownBreakdown) == 0 {
		t.Fatalf("haste_burst cooldownBreakdown missing: %+v", hasteBurst)
	}
	if hasteBurst.ReadyAtMs != 0 || !hasteBurst.CanCast {
		t.Fatalf("haste_burst readiness = readyAtMs %d canCast %v blockedReason %q, want ready at 0 and castable", hasteBurst.ReadyAtMs, hasteBurst.CanCast, hasteBurst.BlockedReason)
	}

	encoded := mustJSON(t, hasteBurst)
	for _, field := range []string{"cooldownFormulaId", "cooldownBreakdown", "readyAtMs", "canCast"} {
		if !bytes.Contains(encoded, []byte(`"`+field+`"`)) {
			t.Fatalf("haste_burst action snapshot JSON missing %q: %s", field, encoded)
		}
	}
}

func TestRunInputSkillLevelAffectsM2ResourceCostEffectAndCooldown(t *testing.T) {
	done := runBundle(t, m2PanelBundle(), m2PanelRunInputWithAction())
	if got := actorHP(done, "enemy"); got != 960 {
		t.Fatalf("enemy hp got %.2f, want level-scaled damage to leave 960", got)
	}
	if got := actor(done, "self").Resources["mana"].Current; got != 80 {
		t.Fatalf("self mana got %.2f, want level-scaled cost to leave 80", got)
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
			{ID: "fighter", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 10}}, Resources: map[string]model.ResourceValueV2{"mana": {Current: 100, Max: 100}}, Actions: []string{"basic_attack", "fireball", "dash_strike", "mark", "expensive_marked", "free_marked", "cooldown_bolt", "double_cost", "m3_bolt"}},
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
			{ID: "m3_bolt", Label: "M3 Bolt", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, CooldownMs: 1000, ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: 40}}, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "enemy_only", Label: "Enemy Only", Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}}, Effects: []model.EffectDef{{Type: "deal_damage", Amount: 99, DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func m2PanelRunInput() model.EngineRunInput {
	input := controlRunInput()
	input.Self.ActionInputs = map[string]model.ActionRunInput{
		"level_bolt": {
			SkillLevel:  4,
			PanelInputs: map[string]float64{"skillLevel": 4},
		},
	}
	return input
}

func m2PanelRunInputWithAction() model.EngineRunInput {
	input := m2PanelRunInput()
	input.InitialActions = []model.ActionRequest{{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "level_bolt"}}
	return input
}

func m2AbilityHasteCooldownRunInput() model.EngineRunInput {
	return model.EngineRunInput{
		Seed:          7,
		Self:          model.CombatantRunInit{ActorID: "self", TemplateID: "haste_mage"},
		Enemy:         model.CombatantRunInit{ActorID: "enemy", TemplateID: "dummy"},
		StopCondition: model.StopCondition{MaxEvents: 20},
	}
}

func m2PanelBundle() model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes:    []model.AttributeDefinitionV2{{ID: "attack_damage"}},
		Resources:     []model.ResourceDefinitionV2{{ID: "mana", DefaultCurrent: 100, DefaultMax: 100}},
		Actors: []model.ActorTemplate{
			{ID: "fighter", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 10}}, Resources: map[string]model.ResourceValueV2{"mana": {Current: 100, Max: 100}}, Actions: []string{"level_bolt"}},
			{ID: "dummy", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"attack_damage": {Base: 10}}, Resources: map[string]model.ResourceValueV2{"mana": {Current: 100, Max: 100}}},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "skill_level", Op: "input"},
			{ID: "five", Op: "const", Value: 5},
			{ID: "hundred", Op: "const", Value: 100},
			{ID: "ad", Op: "attr", Attr: "attack_damage"},
			{ID: "level_cost", Op: "mul", Left: "skill_level", Right: "five"},
			{ID: "level_damage", Op: "mul", Left: "skill_level", Right: "ad"},
			{ID: "level_cooldown", Op: "mul", Left: "skill_level", Right: "hundred"},
		},
		Actions: []model.ActionTemplate{
			{
				ID:                "level_bolt",
				Label:             "Level Bolt",
				SkillLevel:        2,
				PanelInputs:       map[string]float64{"skillLevel": 2},
				CooldownFormulaID: "level_cooldown",
				ResourceCost:      []model.ResourceCostV2{{ResourceID: "mana", FormulaID: "level_cost"}},
				PanelCosts:        []model.ActionPanelCostV2{{ResourceID: "mana", FormulaID: "level_cost"}},
				Effects:           []model.EffectDef{{Type: "deal_damage", FormulaID: "level_damage", DamageType: "magic", SourceRole: "source", TargetRole: "target"}},
				PanelEffects:      []model.ActionPanelEffectV2{{EffectIndex: 0, Kind: "deal_damage", FormulaID: "level_damage", DamageType: "magic", SourceRole: "source", TargetRole: "target"}},
			},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func m2AbilityHasteCooldownBundle() model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "ability_haste"},
		},
		Actors: []model.ActorTemplate{
			{ID: "haste_mage", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"ability_haste": {Base: 20}}, Actions: []string{"haste_burst"}},
			{ID: "dummy", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{"ability_haste": {Base: 0}}},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "base_cooldown_ms", Op: "const", Value: 7000},
			{ID: "hundred", Op: "const", Value: 100},
			{ID: "ability_haste_value", Op: "attr", Attr: "ability_haste"},
			{ID: "cooldown_numerator", Op: "mul", Left: "base_cooldown_ms", Right: "hundred"},
			{ID: "cooldown_denominator", Op: "add", Left: "hundred", Right: "ability_haste_value"},
			{ID: "haste_cooldown", Op: "div", Left: "cooldown_numerator", Right: "cooldown_denominator"},
		},
		Actions: []model.ActionTemplate{
			{
				ID:                "haste_burst",
				Label:             "Haste Burst",
				Classifier:        model.ClassifierV2{Types: []string{"action/cast_skill"}},
				CooldownMs:        7000,
				CooldownFormulaID: "haste_cooldown",
			},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func m4AhriQRegressionRunInput() model.EngineRunInput {
	return model.EngineRunInput{
		Seed: 7,
		Self: model.CombatantRunInit{
			ActorID:    "self",
			TemplateID: "ahri",
			ActionInputs: map[string]model.ActionRunInput{
				"self::skill_ahri_q": {
					SkillLevel:  5,
					PanelInputs: map[string]float64{"skillLevel": 5},
				},
			},
		},
		Enemy: model.CombatantRunInit{
			ActorID:    "enemy",
			TemplateID: "training_dummy",
		},
		InitialActions: []model.ActionRequest{
			{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "self::skill_ahri_q"},
		},
		StopCondition: model.StopCondition{MaxEvents: 8},
		Trace:         model.TraceOptions{EnableLogs: true, SampleEvery: 1, ValueTrace: true},
	}
}

func m4AhriQRegressionBundle(selfMana float64) model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "ap"},
		},
		Resources: []model.ResourceDefinitionV2{
			{ID: "mana", DefaultCurrent: 843, DefaultMax: 843},
		},
		Actors: []model.ActorTemplate{
			{
				ID:        "ahri",
				MaxHP:     2000,
				InitialHP: 2000,
				Attributes: map[string]model.AttributeValueV2{
					"ap": {Base: 18},
				},
				Resources: map[string]model.ResourceValueV2{
					"mana": {Current: selfMana, Max: 843},
				},
				Actions: []string{"self::skill_ahri_q"},
			},
			{
				ID:        "training_dummy",
				MaxHP:     1000,
				InitialHP: 1000,
				Attributes: map[string]model.AttributeValueV2{
					"ap": {Base: 0},
				},
			},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "ahri_q_rank5_base", Op: "const", Value: 135},
			{ID: "ahri_q_ap_ratio", Op: "const", Value: 0.5},
			{ID: "ahri_ap", Op: "attr", Attr: "ap"},
			{ID: "ahri_q_ap_bonus", Op: "mul", Left: "ahri_ap", Right: "ahri_q_ap_ratio"},
			{ID: "ahri_q_out_damage", Op: "add", Left: "ahri_q_rank5_base", Right: "ahri_q_ap_bonus"},
			{ID: "ahri_q_return_damage", Op: "add", Left: "ahri_q_rank5_base", Right: "ahri_q_ap_bonus"},
		},
		Actions: []model.ActionTemplate{
			{
				ID:           "self::skill_ahri_q",
				Label:        "Ahri Q Orb of Deception",
				Classifier:   model.ClassifierV2{Types: []string{"action/cast_skill"}},
				SkillLevel:   5,
				PanelInputs:  map[string]float64{"skillLevel": 5},
				CooldownMs:   7000,
				ResourceCost: []model.ResourceCostV2{{ResourceID: "mana", Amount: 95}},
				Effects: []model.EffectDef{
					{Type: "deal_damage", FormulaID: "ahri_q_out_damage", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
					{Type: "deal_damage", FormulaID: "ahri_q_return_damage", DamageType: "true", SourceRole: "source", TargetRole: "target"},
				},
			},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func m4Batch1MechanismBundle() model.EngineBundle {
	bundle := controlGateBundle()
	bundle.Formulas = append(bundle.Formulas,
		model.FormulaDefinition{ID: "m4_multi_hit_physical", Op: "const", Value: 12},
		model.FormulaDefinition{ID: "m4_multi_hit_magic", Op: "const", Value: 18},
		model.FormulaDefinition{ID: "m4_multi_hit_true", Op: "const", Value: 5},
	)
	bundle.Actions = append(bundle.Actions, model.ActionTemplate{
		ID:         "m4_multi_hit_combo",
		Label:      "M4 Multi-hit Combo",
		Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
		Effects: []model.EffectDef{
			{Type: "deal_damage", FormulaID: "m4_multi_hit_physical", DamageType: "physical", SourceRole: "source", TargetRole: "target"},
			{Type: "deal_damage", FormulaID: "m4_multi_hit_magic", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
			{Type: "deal_damage", FormulaID: "m4_multi_hit_true", DamageType: "true", SourceRole: "source", TargetRole: "target"},
		},
	})
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_multi_hit_combo")
	return bundle
}

func m4Batch2MechanismBundle() model.EngineBundle {
	bundle := controlGateBundle()
	bundle.Statuses = append(bundle.Statuses,
		model.StatusTemplate{ID: "m4_shield_50", Kind: "shield", DurationMs: 4000, Magnitude: 50, ShieldKind: "physical"},
		model.StatusTemplate{ID: "m4_burn_3x", Kind: "dot", DurationMs: 3000, TickIntervalMs: 1000, TickCount: 3, TickAmount: 20, TickDamageType: "magic"},
		model.StatusTemplate{ID: "m4_regen_3x", Kind: "hot", DurationMs: 3000, TickIntervalMs: 1000, TickCount: 3, TickEffectType: model.EffectTypeHeal, TickAmount: 40},
	)
	bundle.Formulas = append(bundle.Formulas,
		model.FormulaDefinition{ID: "m4_shield_amount", Op: "const", Value: 50},
		model.FormulaDefinition{ID: "m4_shield_hit_damage", Op: "const", Value: 80},
		model.FormulaDefinition{ID: "m4_heal_amount", Op: "const", Value: 400},
	)
	bundle.Actions = append(bundle.Actions,
		model.ActionTemplate{
			ID:         "m4_grant_shield",
			Label:      "M4 Grant Shield",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "grant_shield", StatusID: "m4_shield_50", FormulaID: "m4_shield_amount", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_shield_hit",
			Label:      "M4 Shield Hit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_shield_hit_damage", DamageType: "physical", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_heal_400",
			Label:      "M4 Heal 400",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "heal", FormulaID: "m4_heal_amount", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_apply_dot",
			Label:      "M4 Apply DoT",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "apply_status", StatusID: "m4_burn_3x", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_apply_hot",
			Label:      "M4 Apply HoT",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "apply_status", StatusID: "m4_regen_3x", SourceRole: "source", TargetRole: "target"},
			},
		},
	)
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_grant_shield", "m4_heal_400", "m4_apply_dot", "m4_apply_hot")
	bundle.Actors[1].Actions = append(bundle.Actors[1].Actions, "m4_shield_hit")
	return bundle
}

func m4Batch2RunInput(targetActorID string, actionID string) model.EngineRunInput {
	input := controlRunInput()
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: targetActorID, ActionID: actionID},
	}
	input.StopCondition.MaxEvents = 10
	return input
}

func m4Batch3MechanismBundle() model.EngineBundle {
	bundle := controlGateBundle()
	bundle.Formulas = append(bundle.Formulas,
		model.FormulaDefinition{ID: "m4_crit_flat", Op: "const", Value: 40},
	)
	bundle.Actions = append(bundle.Actions,
		model.ActionTemplate{
			ID:         "m4_crit_yes",
			Label:      "M4 Deterministic Crit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_crit_flat", DamageType: "physical", SourceRole: "source", TargetRole: "target", CritPolicy: "deterministic", CritChance: 1, CritMultiplier: 2},
			},
		},
		model.ActionTemplate{
			ID:         "m4_crit_no",
			Label:      "M4 Deterministic Non-Crit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_crit_flat", DamageType: "physical", SourceRole: "source", TargetRole: "target", CritPolicy: "deterministic", CritChance: 0, CritMultiplier: 2},
			},
		},
		model.ActionTemplate{
			ID:         "m4_seeded_crit",
			Label:      "M4 Seeded Crit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_crit_flat", DamageType: "physical", SourceRole: "source", TargetRole: "target", CritPolicy: "seeded_random", CritChance: 0.5, CritMultiplier: 2},
			},
		},
	)
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_crit_yes", "m4_crit_no", "m4_seeded_crit")
	return bundle
}

func m4Batch3RunInput(seed uint64, actionID string) model.EngineRunInput {
	input := controlRunInput()
	input.Seed = seed
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: actionID},
	}
	return input
}

func m4BatchJCritBundle(attackerCritChance float64) model.EngineBundle {
	bundle := controlGateBundle()
	bundle.Attributes = append(bundle.Attributes, model.AttributeDefinitionV2{ID: "crit_chance"})
	bundle.Actors[0].Attributes["crit_chance"] = model.AttributeValueV2{Base: attackerCritChance}
	bundle.Actors[1].Attributes["crit_chance"] = model.AttributeValueV2{Base: 0}
	bundle.Statuses = append(bundle.Statuses,
		model.StatusTemplate{
			ID:                   "m4_crit_dot_status",
			Kind:                 "dot",
			DurationMs:           1000,
			TickIntervalMs:       1000,
			TickCount:            1,
			TickAmount:           40,
			TickDamageType:       "magic",
			TickCritPolicy:       "expected",
			TickCritChanceSource: "attacker_crit_chance",
			TickCritMultiplier:   1.45,
		},
		model.StatusTemplate{
			ID:                   "m4_crit_hot_status",
			Kind:                 "hot",
			DurationMs:           1000,
			TickIntervalMs:       1000,
			TickCount:            1,
			TickEffectType:       model.EffectTypeHeal,
			TickAmount:           40,
			TickCritPolicy:       "expected",
			TickCritChanceSource: "attacker_crit_chance",
			TickCritMultiplier:   1.45,
		},
	)
	bundle.Actions = append(bundle.Actions,
		model.ActionTemplate{
			ID:         "m4_attr_crit_damage",
			Label:      "M4 Attr Crit Damage",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", Amount: 40, DamageType: "magic", SourceRole: "source", TargetRole: "target", CritPolicy: "expected", CritChanceSource: "attacker_crit_chance", CritMultiplier: 1.45},
			},
		},
		model.ActionTemplate{
			ID:         "m4_attr_crit_heal",
			Label:      "M4 Attr Crit Heal",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "heal", Amount: 40, SourceRole: "source", TargetRole: "target", CritPolicy: "expected", CritChanceSource: "attacker_crit_chance", CritMultiplier: 1.45},
			},
		},
		model.ActionTemplate{
			ID:         "m4_apply_crit_dot",
			Label:      "M4 Apply Crit Dot",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "apply_status", StatusID: "m4_crit_dot_status", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_apply_crit_hot",
			Label:      "M4 Apply Crit Hot",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "apply_status", StatusID: "m4_crit_hot_status", SourceRole: "source", TargetRole: "target"},
			},
		},
	)
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_attr_crit_damage", "m4_attr_crit_heal", "m4_apply_crit_dot", "m4_apply_crit_hot")
	return bundle
}

func m4BatchJCritRunInput(actionID string) model.EngineRunInput {
	input := controlRunInput()
	targetActorID := "enemy"
	if actionID == "m4_attr_crit_heal" || actionID == "m4_apply_crit_hot" {
		targetActorID = "self"
	}
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: targetActorID, ActionID: actionID},
	}
	input.StopCondition.MaxEvents = 10
	return input
}

func m4Batch4MechanismBundle() model.EngineBundle {
	bundle := controlGateBundle()
	bundle.Statuses = append(bundle.Statuses,
		model.StatusTemplate{ID: "m4_silence_1000", Kind: "control", Classifier: model.ClassifierV2{Types: []string{"status/silence"}}, DurationMs: 1000},
	)
	bundle.Formulas = append(bundle.Formulas,
		model.FormulaDefinition{ID: "m4_damage_5", Op: "const", Value: 5},
		model.FormulaDefinition{ID: "m4_damage_10", Op: "const", Value: 10},
		model.FormulaDefinition{ID: "m4_damage_30", Op: "const", Value: 30},
		model.FormulaDefinition{ID: "m4_damage_40", Op: "const", Value: 40},
		model.FormulaDefinition{ID: "m4_damage_80", Op: "const", Value: 80},
		model.FormulaDefinition{ID: "m4_counter_read", Op: "counter", Counter: "m4_stack"},
		model.FormulaDefinition{ID: "m4_counter_scale", Op: "const", Value: 10},
		model.FormulaDefinition{ID: "m4_counter_damage_formula", Op: "mul", Left: "m4_counter_read", Right: "m4_counter_scale"},
	)
	bundle.Actions = append(bundle.Actions,
		model.ActionTemplate{
			ID:         "m4_apply_silence",
			Label:      "M4 Apply Silence",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "apply_status", StatusID: "m4_silence_1000", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_enemy_cast",
			Label:      "M4 Enemy Cast",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_30", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:                "m4_channel_blast",
			Label:             "M4 Channel Blast",
			Classifier:        model.ClassifierV2{Types: []string{"action/cast_skill"}},
			ChannelDurationMs: 1000,
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_80", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_interrupt",
			Label:      "M4 Interrupt",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "interrupt", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_trigger_starter",
			Label:      "M4 Trigger Starter",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_10", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_history_hit",
			Label:      "M4 History Hit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_30", DamageType: "physical", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_recent_repay",
			Label:      "M4 Recent Repay",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "damage_from_recent", Amount: 1, HistoryWindowMs: 4000, DamageType: "true", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_counter_increment",
			Label:      "M4 Counter Increment",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "increment_counter", CounterKey: "m4_stack", Amount: 1, SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_counter_damage",
			Label:      "M4 Counter Damage",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_counter_damage_formula", DamageType: "magic", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_mode_damage",
			Label:      "M4 Mode Damage",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_40", DamageType: "magic", SourceRole: "source", TargetRole: "target", ModeAugmentID: "m4_empowered", ModeMultiplier: 2},
			},
		},
	)
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions,
		"m4_apply_silence", "m4_channel_blast", "m4_trigger_starter", "m4_recent_repay",
		"m4_counter_increment", "m4_counter_damage", "m4_mode_damage",
	)
	bundle.Actors[1].Actions = append(bundle.Actors[1].Actions, "m4_enemy_cast", "m4_interrupt", "m4_history_hit")
	return bundle
}

func m4Batch4TriggerBundle() model.EngineBundle {
	bundle := m4Batch4MechanismBundle()
	bundle.Triggers = append(bundle.Triggers, model.TriggerDefinition{
		ID:             "m4_followup_on_damage_taken",
		Event:          "on_damage_taken",
		RequiresDamage: true,
		Effects: []model.EffectDef{
			{Type: "deal_damage", FormulaID: "m4_damage_5", DamageType: "true", SourceRole: "source", TargetRole: "target"},
		},
	})
	return bundle
}

func m4ExecutionArenaBundle() model.EngineBundle {
	bundle := controlGateBundle()
	for i := 0; i < 17; i++ {
		actionID := channelArenaActionID(i)
		bundle.Actions = append(bundle.Actions, model.ActionTemplate{
			ID:                actionID,
			Label:             actionID,
			Classifier:        model.ClassifierV2{Types: []string{"action/cast_skill"}},
			CooldownMs:        1000,
			ChannelDurationMs: 10000,
			ResourceCost:      []model.ResourceCostV2{{ResourceID: "mana", Amount: 1}},
		})
		bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, actionID)
	}
	return bundle
}

func channelArenaActionID(index int) string {
	return "m4_channel_arena_" + string(rune('a'+index))
}

func m4HistoryShieldBundle() model.EngineBundle {
	bundle := m4Batch4MechanismBundle()
	bundle.Statuses = append(bundle.Statuses,
		model.StatusTemplate{ID: "m4_shield_50", Kind: "shield", DurationMs: 4000, Magnitude: 50, ShieldKind: "physical"},
	)
	bundle.Formulas = append(bundle.Formulas,
		model.FormulaDefinition{ID: "m4_shield_amount", Op: "const", Value: 50},
		model.FormulaDefinition{ID: "m4_shield_hit_damage", Op: "const", Value: 80},
	)
	bundle.Actions = append(bundle.Actions,
		model.ActionTemplate{
			ID:         "m4_grant_shield",
			Label:      "M4 Grant Shield",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "grant_shield", StatusID: "m4_shield_50", FormulaID: "m4_shield_amount", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.ActionTemplate{
			ID:         "m4_shield_hit",
			Label:      "M4 Shield Hit",
			Classifier: model.ClassifierV2{Types: []string{"action/cast_skill"}},
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_shield_hit_damage", DamageType: "physical", SourceRole: "source", TargetRole: "target"},
			},
		},
	)
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_grant_shield")
	bundle.Actors[1].Actions = append(bundle.Actors[1].Actions, "m4_shield_hit")
	return bundle
}

func m4OverkillHistoryBundle() model.EngineBundle {
	bundle := m4Batch4MechanismBundle()
	bundle.Actors[0].Actions = append(bundle.Actors[0].Actions, "m4_history_hit")
	bundle.Triggers = append(bundle.Triggers, model.TriggerDefinition{
		ID:             "m4_overkill_history_repay",
		Event:          "on_damage_taken",
		RequiresDamage: true,
		Effects: []model.EffectDef{
			{Type: "damage_from_recent", Amount: 1, HistoryWindowMs: 4000, DamageType: "true", SourceRole: "target", TargetRole: "source"},
		},
	})
	return bundle
}

func m4DotTriggerBundle() model.EngineBundle {
	bundle := m4Batch2MechanismBundle()
	bundle.Formulas = append(bundle.Formulas, model.FormulaDefinition{ID: "m4_damage_5", Op: "const", Value: 5})
	bundle.Triggers = append(bundle.Triggers,
		model.TriggerDefinition{
			ID:             "m4_dot_on_damage_dealt",
			Event:          "on_damage_dealt",
			RequiresDamage: true,
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_5", DamageType: "true", SourceRole: "source", TargetRole: "target"},
			},
		},
		model.TriggerDefinition{
			ID:             "m4_dot_on_damage_taken",
			Event:          "on_damage_taken",
			RequiresDamage: true,
			Effects: []model.EffectDef{
				{Type: "deal_damage", FormulaID: "m4_damage_5", DamageType: "true", SourceRole: "source", TargetRole: "target"},
			},
		},
	)
	return bundle
}

func m4OwnerScopedTriggerBundle() model.EngineBundle {
	bundle := m4Batch4MechanismBundle()
	bundle.Triggers = append(bundle.Triggers, model.TriggerDefinition{
		ID:             "m4_self_takes_damage_thorns",
		Event:          "on_damage_taken",
		OwnerRole:      "target",
		OwnerID:        "self",
		RequiresDamage: true,
		Effects: []model.EffectDef{
			{Type: "deal_damage", FormulaID: "m4_damage_5", DamageType: "true", SourceRole: "target", TargetRole: "source"},
		},
	})
	return bundle
}

func m4Batch4RunInput(actionID string, modeAugments []string) model.EngineRunInput {
	input := controlRunInput()
	input.ModeAugments = modeAugments
	input.InitialActions = []model.ActionRequest{
		{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: actionID},
	}
	return input
}

func assertDamageSegment(t *testing.T, effect model.ActionEffectRunResultV2, effectIndex int, formulaID string, damageType string, damage float64, hpBefore float64, hpAfter float64) {
	t.Helper()
	if effect.EffectIndex != effectIndex || effect.FormulaID != formulaID || effect.DamageType != damageType ||
		!effect.HasRawAmount || effect.RawAmount != damage || !effect.HasFinalDamage || effect.FinalDamage != damage ||
		effect.TargetHPBefore != hpBefore || effect.TargetHPAfter != hpAfter {
		t.Fatalf("damage segment = %+v, want index=%d formula=%s type=%s damage=%.2f hp %.2f -> %.2f", effect, effectIndex, formulaID, damageType, damage, hpBefore, hpAfter)
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

func actionResult(done model.DonePayload, actionID string) model.ActionRunResultV2 {
	for _, result := range done.ActionResults {
		if result.ActionID == actionID {
			return result
		}
	}
	return model.ActionRunResultV2{}
}

func actionResults(done model.DonePayload, actionID string) []model.ActionRunResultV2 {
	results := make([]model.ActionRunResultV2, 0)
	for _, result := range done.ActionResults {
		if result.ActionID == actionID {
			results = append(results, result)
		}
	}
	return results
}

func hasLog(done model.DonePayload, kind string, statusID string) bool {
	for _, log := range done.Logs {
		if log.Kind == kind && log.StatusID == statusID {
			return true
		}
	}
	return false
}

func hasLogAt(done model.DonePayload, kind string, statusID string, timeMs int64) bool {
	for _, log := range done.Logs {
		if log.Kind == kind && log.StatusID == statusID && log.TimeMs == timeMs {
			return true
		}
	}
	return false
}

func breakdownHas(steps []model.ActionValueBreakdownStepV2, op string, ref string, value float64) bool {
	for _, step := range steps {
		if step.Op == op && step.Ref == ref && step.Value == value {
			return true
		}
	}
	return false
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
