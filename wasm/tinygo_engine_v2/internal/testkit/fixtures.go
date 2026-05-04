// 本文件提供 TinyGo V2 测试 fixture、run helper 和 outbox 解析辅助。
package testkit

import (
	"encoding/json"

	"tinygo_engine_v2/internal/abi"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/runtime"
)

func BenchmarkBundle() model.EngineBundle {
	return model.EngineBundle{
		SchemaVersion: model.SchemaVersion,
		Attributes: []model.AttributeDefinitionV2{
			{ID: "attack_damage"},
			{ID: "ability_power"},
		},
		Actors: []model.ActorTemplate{
			{ID: "fighter", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{
				"attack_damage": {Base: 100},
				"ability_power": {Base: 50},
			}, Actions: []string{"basic_attack", "thorn_hit", "sett_w", "akali_e1", "akali_e2"}},
			{ID: "dummy", MaxHP: 1000, InitialHP: 1000, Attributes: map[string]model.AttributeValueV2{
				"attack_damage": {Base: 80},
				"ability_power": {Base: 20},
			}, Actions: []string{"basic_attack"}},
		},
		Statuses: []model.StatusTemplate{
			{ID: "stun", Kind: "control", DurationMs: 1000, BlocksActions: true, RetryOnRelease: true},
			{ID: "physical_shield", Kind: "shield", DurationMs: 4000, Magnitude: 200, ShieldKind: "physical"},
			{ID: "magic_shield", Kind: "shield", DurationMs: 4000, Magnitude: 200, ShieldKind: "magic"},
		},
		Formulas: []model.FormulaDefinition{
			{ID: "ad", Op: "attr", Attr: "attack_damage"},
			{ID: "flat_50", Op: "const", Value: 50},
			{ID: "flat_75", Op: "const", Value: 75},
			{ID: "flat_120", Op: "const", Value: 120},
		},
		Actions: []model.ActionTemplate{
			{ID: "basic_attack", Label: "Basic Attack", Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "ad", DamageType: "physical", SourceRole: "source", TargetRole: "target"}}},
			{ID: "thorn_hit", Label: "Thorn Hit", Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_50", DamageType: "physical", SourceRole: "source", TargetRole: "target"}}},
			{ID: "sett_w", Label: "Sett W", Effects: []model.EffectDef{{Type: "grant_shield", StatusID: "physical_shield", FormulaID: "flat_120", TargetRole: "source"}, {Type: "damage_from_recent", Amount: 0.5, DamageType: "true", SourceRole: "source", TargetRole: "target", HistoryWindowMs: 4000}}},
			{ID: "akali_e1", Label: "Akali E1", Effects: []model.EffectDef{{Type: "apply_mark", MarkID: "akali_e", SourceRole: "source", TargetRole: "target"}}},
			{ID: "akali_e2", Label: "Akali E2", RequiresMark: "akali_e", ConsumesMark: true, Effects: []model.EffectDef{{Type: "deal_damage", FormulaID: "flat_75", DamageType: "magic", SourceRole: "source", TargetRole: "target"}}},
			{ID: "stunning_blow", Label: "Stunning Blow", Effects: []model.EffectDef{{Type: "apply_status", StatusID: "stun", TargetRole: "target"}}},
		},
		Triggers: []model.TriggerDefinition{
			{ID: "thornmail", Event: "on_damage_taken", OwnerRole: "target", RequiresDamage: true, Effects: []model.EffectDef{{Type: "deal_damage", Amount: 20, DamageType: "magic", SourceRole: "target", TargetRole: "source"}}},
		},
		Settings: model.BundleSettings{MaxEvents: 1000, MaxCommandsPerEvent: 64},
	}
}

func BasicRunInput() model.EngineRunInput {
	return model.EngineRunInput{
		Seed:           7,
		Self:           model.CombatantRunInit{ActorID: "self", TemplateID: "fighter"},
		Enemy:          model.CombatantRunInit{ActorID: "enemy", TemplateID: "dummy"},
		InitialActions: []model.ActionRequest{{TriggerAtMs: 0, SourceActorID: "self", TargetActorID: "enemy", ActionID: "basic_attack"}},
		StopCondition:  model.StopCondition{MaxEvents: 20},
		Trace:          model.TraceOptions{EnableLogs: true, SampleEvery: 1},
	}
}

func RunBenchmarkBattle() model.DonePayload {
	session := runtime.NewSession()
	must(session.InitJSON(mustJSON(BenchmarkBundle())))
	must(session.BeginRunJSON(mustJSON(BasicRunInput())))
	for session.Step(64) == 1 {
	}
	return LastDone(session.OutboxBytes())
}

func LastDone(outbox []byte) model.DonePayload {
	var done model.DonePayload
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindDone {
			_ = json.Unmarshal(frame.Payload, &done)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return done
}

func LastSnapshot(outbox []byte) model.SnapshotV2 {
	var snapshot model.SnapshotV2
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindSnapshot {
			_ = json.Unmarshal(frame.Payload, &snapshot)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return snapshot
}

func LastActionSnapshot(outbox []byte) model.ActionSnapshotV2 {
	var snapshot model.ActionSnapshotV2
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindActionSnapshot {
			_ = json.Unmarshal(frame.Payload, &snapshot)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return snapshot
}

func LastError(outbox []byte) model.ErrorPayload {
	var payload model.ErrorPayload
	offset := 0
	for offset+abi.HeaderLen <= len(outbox) {
		frame, err := abi.DecodeFrame(outbox[offset:])
		if err != nil {
			break
		}
		if frame.Kind == model.FrameKindError {
			_ = json.Unmarshal(frame.Payload, &payload)
		}
		offset += abi.HeaderLen + len(frame.Payload)
	}
	return payload
}

func must(code int32) {
	if code != 0 {
		panic("unexpected non-zero code")
	}
}

func mustJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}
