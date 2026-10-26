package abi

import (
	"bytes"
	"encoding/json"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestOutboxDoneSnapshotPreservesAppliedZeroAndLinkedShieldReferences(t *testing.T) {
	zero, expires := int64(0), int64(1500)
	for _, automatic := range []bool{false, true} {
		value := model.DoneResult{OK: true, FinalSnapshot: model.Snapshot{Combatants: []model.CombatantSnapshot{{Key: "source",
			Providers: []model.CombatantProviderSnapshot{
				{ProviderRef: "configured_decay#1", DefinitionRef: "configured_decay", Source: "source", Owner: "source", Stacks: 1, AppliedAtMs: &zero, ExpireAt: &expires, State: map[string]interface{}{}},
				{ProviderRef: "configured_plain", DefinitionRef: "plain", Source: "source", Owner: "source", Stacks: 1, State: map[string]interface{}{}},
			}, Shields: []model.CombatantShieldSnapshot{{ShieldRef: "configured_barrier#2", DefinitionRef: "configured_barrier", LifecycleProviderRef: "configured_guard#3", Source: "source", Owner: "source", Remaining: 42, ExpireAt: &expires, State: map[string]interface{}{}}},
		}}}}
		if automatic {
			value.AutomaticSkillSummary = &model.AutomaticSkillSummary{}
		}
		outbox := NewOutbox(DefaultOutboxCapacity)
		if code := outbox.WriteJSON(model.FrameKindGenericDone, value.JSONValue()); code != model.ErrOK {
			t.Fatal(code)
		}
		frame, err := DecodeFrame(outbox.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		ordinary, err := json.Marshal(value)
		if err != nil || !bytes.Equal(frame.Payload, ordinary) {
			t.Fatal("outbox differs from standard DoneResult encoding", err)
		}
		var shape struct {
			FinalSnapshot struct {
				Combatants []struct {
					Providers []map[string]json.RawMessage `json:"providers"`
					Shields   []map[string]json.RawMessage `json:"shields"`
				} `json:"combatants"`
			} `json:"finalSnapshot"`
		}
		if err := json.Unmarshal(frame.Payload, &shape); err != nil {
			t.Fatal(err)
		}
		actor := shape.FinalSnapshot.Combatants[0]
		if string(actor.Providers[0]["appliedAtMs"]) != "0" {
			t.Fatal("legal zero application time disappeared", string(frame.Payload))
		}
		if _, exists := actor.Providers[1]["appliedAtMs"]; exists {
			t.Fatal("untracked provider gained an application-time field")
		}
		if string(actor.Shields[0]["definitionRef"]) != `"configured_barrier"` || string(actor.Shields[0]["lifecycleProviderRef"]) != `"configured_guard#3"` {
			t.Fatal("linked shield identities disappeared", actor.Shields)
		}
		var restored model.DoneResult
		if err := json.Unmarshal(frame.Payload, &restored); err != nil {
			t.Fatal(err)
		}
		provider := restored.FinalSnapshot.Combatants[0].Providers[0]
		shield := restored.FinalSnapshot.Combatants[0].Shields[0]
		if provider.AppliedAtMs == nil || *provider.AppliedAtMs != 0 || shield.DefinitionRef != "configured_barrier" || shield.LifecycleProviderRef != "configured_guard#3" {
			t.Fatal("typed JSON roundtrip lost snapshot fields", provider, shield)
		}
	}
}

func TestSnapshotOptionalFieldsKeepLegacyProviderAndShieldBytes(t *testing.T) {
	for _, tc := range []struct {
		value any
		want  string
	}{
		{model.CombatantProviderSnapshot{ProviderRef: "plain", DefinitionRef: "configured", Source: "source", Owner: "source", Stacks: 1, State: map[string]interface{}{}}, `{"providerRef":"plain","definitionRef":"configured","source":"source","owner":"source","stacks":1,"expireAt":null,"state":{}}`},
		{model.CombatantShieldSnapshot{ShieldRef: "plain", Source: "source", Owner: "source", Remaining: 42, State: map[string]interface{}{}}, `{"shieldRef":"plain","source":"source","owner":"source","remaining":42,"priority":0,"expireAt":null,"state":{}}`},
	} {
		outbox := NewOutbox(DefaultOutboxCapacity)
		if code := outbox.WriteJSON(model.FrameKindGenericSnapshot, tc.value); code != model.ErrOK {
			t.Fatal(code)
		}
		frame, err := DecodeFrame(outbox.Bytes())
		if err != nil || string(frame.Payload) != tc.want {
			t.Fatalf("legacy snapshot bytes changed: %s want %s err=%v", frame.Payload, tc.want, err)
		}
	}
}
