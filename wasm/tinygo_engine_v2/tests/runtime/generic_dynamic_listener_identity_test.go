package runtime_test

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

// 独立通用输入仅验证已有动态监听节流，不声明管理录入或真实对象新增准入。
func TestDynamicListenerIdentityAcrossSameCastDamageAndReplay(t *testing.T) {
	for _, fixture := range []string{"dynamic_listener_no_removal_control.json", "dynamic_listener_remove_earlier_same_cast.json"} {
		t.Run(fixture, func(t *testing.T) {
			input := loadGenericFixtureCompileRequest(t, fixture)
			request := loadGenericFixtureRunRequest(t, fixture)
			session := runtimeengine.NewMathSession()
			if session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, input)) != 0 {
				t.Fatal("fixture compile failed", lastGenericError(session.OutboxBytes()))
			}
			compiled := lastGenericCompileResult(session.OutboxBytes())
			if !compiled.OK || compiled.SessionID == "" {
				t.Fatal("missing compiled identity")
			}
			request.SessionID, request.ExpectedRulesHash = compiled.SessionID, compiled.RulesHash
			var original model.DoneResult
			for replay := 0; replay < 2; replay++ {
				session.ClearOutbox()
				if session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, request)) != 0 {
					t.Fatal("runtime failed", lastGenericError(session.OutboxBytes()))
				}
				done := lastGenericRunDone(session.OutboxBytes())
				if !done.OK || done.Summary.TargetFinalHp != 800 || done.Summary.SourceDamageDealt != 200 || done.Summary.AbilityCastCount != 1 || len(done.DamageRecords) != 2 {
					t.Fatalf("two 100-point packets must remain one successful cast: %+v packets=%d", done.Summary, len(done.DamageRecords))
				}
				sourceCounter, found := float64(0), false
				for _, actor := range done.FinalSnapshot.Combatants {
					if actor.Key == model.SelectorSource {
						if slot, exists := actor.Attributes["counter"]; exists {
							sourceCounter, found = slot.Base, true
						}
					}
				}
				if !found || sourceCounter != 1 {
					t.Fatalf("one cast must increment the surviving 100ms listener once: counter=%v present=%t", sourceCounter, found)
				}
				castID, present := done.DamageRecords[0]["castInstanceId"].(float64)
				if !present || castID <= 0 || done.DamageRecords[1]["castInstanceId"] != castID {
					t.Fatal("packets did not use the same real cast")
				}
				if replay == 0 {
					original = done
				} else if !reflect.DeepEqual(done, original) {
					t.Fatal("compiled-session replay changed output")
				}
			}
			session.ClearOutbox()
			release := model.ReleaseSessionRequest{SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash}
			if session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, release)) != 0 {
				t.Fatal("session release failed")
			}
			if released := lastGenericReleaseDone(session.OutboxBytes()); !released.OK || !released.Released {
				t.Fatal("missing release result")
			}
		})
	}
}
