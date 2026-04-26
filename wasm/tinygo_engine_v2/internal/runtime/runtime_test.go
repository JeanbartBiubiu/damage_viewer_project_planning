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
	session := runtime.NewSession()
	mustCode(t, session.InitJSON(mustJSON(t, testkit.BenchmarkBundle())))
	mustCode(t, session.BeginRunJSON(mustJSON(t, input)))
	for session.Step(64) == 1 {
	}
	return testkit.LastDone(session.OutboxBytes())
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
