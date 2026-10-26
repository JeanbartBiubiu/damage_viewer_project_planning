package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"testing"
	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func TestProcessExplicitSelfTargetGateBeforeAllWrites(t *testing.T) {
	for _, target := range []string{"", "target", "not_an_actor", "source", "self"} {
		t.Run("source_to_"+target, func(t *testing.T) {
			c, r := processBase(t, "RECAST")
			c.SharedProviders[0].Abilities[0].ProcessControl.RequireExplicitSelfTarget = model.BoolPtr(true)
			c.SharedProviders[0].Processes[0].Cooldown = &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: processMoment("PROCESS_START", "", "")}
			c.SharedProviders[0].Processes[0].MomentOperations = append(c.SharedProviders[0].Processes[0].MomentOperations,
				model.ProcessMomentOperations{Moment: processMoment("PROCESS_START", "", ""), Operations: []model.OperationDefinition{{Operation: "shield", Target: "self", ShieldRef: "ordinary_self_guard", Amount: timedShieldExpr(80)}}})
			r.DriverPlan.Entries[0].Target = "self"
			compiled := compile.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			state, err := newGenericRunState(compiled.Session, r)
			if err != nil {
				t.Fatal(err)
			}
			entry := r.DriverPlan.Entries[0]
			ability, ref, found := state.lookupDriverAbility(entry)
			if !found {
				t.Fatal("missing driver ability")
			}
			entry.Target = target
			if err := state.handleProcessCommand(entry, 0, ability, ref); err != nil {
				t.Fatal(err)
			}
			valid := target == "source" || target == "self"
			if valid {
				if state.actions.ProcessCount() != 1 || state.combatants["source"].resourceView().At("mana").Current != 140 || state.combatants["source"].instances.Shields().Len() != 1 {
					t.Fatalf("valid self did not execute: %+v", state.actions.ProcessViews())
				}
			} else {
				if state.actions.ProcessCount() != 0 || state.combatants["source"].resourceView().At("mana").Current != 200 || state.combatants["source"].instances.Shields().Len() != 0 || state.combatants["source"].cooldowns.ReadyAt(actionpkg.AbilityCooldownIdentity("source", ref)) != 0 {
					t.Fatal("rejected self gate published process writes")
				}
				if state.report.Totals().AttemptSkippedCount != 1 {
					t.Fatal("missing rejection")
				}
			}
		})
	}
}
