// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

// Each real INITIAL/RECAST starts a distinct use. Two native on-cast
// listeners sharing one group must commit exactly one count for each shot.
func TestFiniteRecastOnCastOncePerUseUsesNativeCastIdentities(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		name := "manual"
		if automatic {
			name = "automatic"
		}
		t.Run(name, func(t *testing.T) {
			c, r := finiteRecastInput(2, 1000, 1000, 2000)
			recastCounters(&c, &r, false)
			for i := 1; i <= 2; i++ {
				c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = "event/ability_started"
			}
			if automatic {
				finiteRecastAutomatic(&r, c.Rules.SkillActionBindings[0])
			}
			d := timedShieldMustRun(t, c, r)
			if d.Summary.SourceDamageDealt != 300 || recastCounter(t, d, "casts") != 3 || recastCounter(t, d, "once") != 3 {
				t.Fatalf("three actual shots must each start and consume one shared quota: summary=%+v casts=%v once=%v", d.Summary, recastCounter(t, d, "casts"), recastCounter(t, d, "once"))
			}
			if len(d.FinalSnapshot.UseTriggerLedger) != 3 {
				t.Fatalf("one committed quota per actual use, got %+v", d.FinalSnapshot.UseTriggerLedger)
			}
			uses := map[string]bool{}
			for _, row := range d.FinalSnapshot.UseTriggerLedger {
				if row.UseSource != "source" || row.UseSkillKey != c.Rules.SkillActionBindings[0].SkillKey || uses[row.UseKey] {
					t.Fatalf("quota must retain distinct actual source/skill/use: %+v", row)
				}
				uses[row.UseKey] = true
			}
			starts := 0
			ids := map[uint64]bool{}
			for _, item := range d.Evidence.Items {
				if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == "event/ability_started" {
					id := recastCastID(t, item.Data["castInstanceId"])
					use, ok := item.Data["useRef"].(string)
					if id == 0 || ids[id] || !ok || !uses[use] {
						t.Fatalf("native start must carry its accepted use and fresh cast: %+v", item)
					}
					ids[id] = true
					starts++
				}
			}
			if starts != 3 {
				t.Fatalf("actual starts=%d want 3", starts)
			}
		})
	}
}

func TestOnCastOncePerUseRejectsExternalUseAndSyntheticEmit(t *testing.T) {
	for _, synthetic := range []bool{false, true} {
		name := "external_process_use"
		if synthetic {
			name = "synthetic_emit_event"
		}
		t.Run(name, func(t *testing.T) {
			c, r := singleSkillInput(false)
			recastCounters(&c, &r, false)
			for i := 1; i <= 2; i++ {
				c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = "event/ability_started"
			}
			binding := c.Rules.SkillActionBindings[0]
			r.DriverPlan.SkillActions = nil
			r.SkillUses = []model.SkillUseFact{{UseKey: "skill:external", Source: "source", SkillKey: binding.SkillKey, HistoryState: model.SkillHitHistoryComplete}}
			ref := binding.Controls[0].AbilityRef
			if synthetic {
				c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{
					AbilityKey: "synthetic", Kind: "active", SkillKey: binding.SkillKey, Types: []string{"ability/spell"},
					Operations: []model.OperationDefinition{{Operation: "emit_event", EventType: "event/ability_started", Ref: "event/ability_started", Target: "target"}},
				})
				ref = "source.provider[caster].ability[synthetic]"
			} else {
				r.ProcessCommandFacts = []model.ProcessCommandFact{{DriverEntryKey: "external", UseRef: "skill:external"}}
			}
			r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "external", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0}}
			err := p6MustFailRun(t, c, r)
			if !strings.Contains(err.Path, "oncePerUse") || !strings.Contains(err.Message, "use") {
				t.Fatalf("must reject the unauthorized originating-use event, got %+v", err)
			}
		})
	}
}

func TestOnCastOncePerUseRejectedControlsDoNotConsumeQuota(t *testing.T) {
	c, r := finiteRecastInput(2, 1000, 999, 1000, 1999, 2000, 2500)
	recastCounters(&c, &r, false)
	for i := 1; i <= 2; i++ {
		c.SharedProviders[0].Listeners[i].EventMatcher.All[0] = "event/ability_started"
	}
	d := timedShieldMustRun(t, c, r)
	if d.Summary.SkillActions.AcceptedCount != 3 || d.Summary.SkillActions.RejectedCount != 3 ||
		recastCounter(t, d, "casts") != 3 || recastCounter(t, d, "once") != 3 || len(d.FinalSnapshot.UseTriggerLedger) != 3 {
		t.Fatalf("early/exhausted controls must not start or consume a quota: %+v ledger=%+v", d.Summary, d.FinalSnapshot.UseTriggerLedger)
	}
}
