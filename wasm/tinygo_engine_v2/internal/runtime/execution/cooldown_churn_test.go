package execution

import "tinygo_engine_v2/internal/runtime/contract"

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"fmt"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// 只依赖旧账本已有方法和len，可复制到优化前的工作副本作行为与条目数对照。
func TestCooldownChurnDynamicProvidersKeepObservableHistory(t *testing.T) {
	for _, test := range []struct {
		name     string
		cycles   int
		explicit bool
	}{
		{name: "natural-17", cycles: 17},
		{name: "natural-256", cycles: 256},
		{name: "explicit-32", cycles: 32, explicit: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, request := loadFixedTickProviderFixture(t)
			const stateKey = "churn_internal_cd"
			const tickInterval = int64(200)
			const expireAfter = int64(600)
			const initialHP = 1000000.0
			interval := int64(1000)
			if test.explicit {
				interval = 10000
			}
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
			for index := range input.Combatants {
				if input.Combatants[index].Key == model.SelectorTarget {
					input.Combatants[index].Attributes["hp"] = authoringSlot(initialHP)
				}
			}
			for index := range request.InitialSnapshot.Combatants {
				if request.InitialSnapshot.Combatants[index].Key == model.SelectorTarget {
					request.InitialSnapshot.Combatants[index].Attributes["hp"] = authoringSlot(initialHP)
				}
			}
			dynamic := &input.SharedProviders[1]
			dynamic.InitialStateSchema = map[string]interface{}{stateKey: map[string]interface{}{
				"defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(5000),
				"stateKind": model.ProviderStateKindCooldown, "refreshPolicy": model.ProviderStateRefreshStartOnFirstWrite,
			}}
			dynamic.Lifecycle.DurationMs = authoringAmount(authoringConst(float64(expireAfter)))
			dynamic.Lifecycle.TickIntervalMs = tickInterval
			tick := &dynamic.Abilities[0]
			tick.Cooldown = &model.AbilityCooldown{DurationMs: authoringConst(250)}
			tick.TickSpec.IntervalMs, tick.TickSpec.StartDelayMs = tickInterval, tickInterval
			tick.TickSpec.OnTick = append([]model.OperationDefinition{{
				Operation: "state_change", Target: model.SelectorSource, Ref: stateKey,
				Types: []string{stateScopeProvider}, ValuePolicy: "set", Amount: authoringAmount(authoringConst(1)),
			}}, tick.TickSpec.OnTick...)
			request.DriverPlan.Entries = nil
			applyRef := "source.provider[champion:source_demo].ability[apply_dot]"
			if test.explicit {
				// 每轮两条真实指令，32轮正好落在64条有限驱动上限内。
				for cycle := 0; cycle < test.cycles; cycle++ {
					providerRef := fmt.Sprintf("%s#%d", dynamic.ProviderKey, cycle+1)
					abilityKey := fmt.Sprintf("remove_%02d", cycle)
					input.SharedProviders[0].Abilities = append(input.SharedProviders[0].Abilities, model.AbilityDefinition{
						AbilityKey: abilityKey, Kind: "active", Types: []string{"ability/buff"},
						Operations: []model.OperationDefinition{{Operation: "expire_provider", Target: model.SelectorTarget, ProviderRef: providerRef}},
					})
					request.DriverPlan.Entries = append(request.DriverPlan.Entries,
						model.DriverEntry{EntryKey: fmt.Sprintf("apply_%02d", cycle), AbilityRef: applyRef, Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: int64(cycle) * interval},
						model.DriverEntry{EntryKey: fmt.Sprintf("remove_%02d", cycle), AbilityRef: "source.provider[champion:source_demo].ability[" + abilityKey + "]", Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: int64(cycle)*interval + 500},
					)
				}
			} else {
				request.DriverPlan.Entries = []model.DriverEntry{{
					EntryKey: "repeated_apply", AbilityRef: applyRef, Source: model.SelectorSource, Target: model.SelectorTarget,
					Repeat: &model.DriverRepeat{IntervalMs: interval, MaxAttempts: test.cycles},
				}}
			}
			input.Settings.MaxEvents = test.cycles*20 + 1000
			request.StopPolicy.DurationMs = int64(test.cycles-1)*interval + 6000
			request.OutputMode, request.Sampling.Disabled = model.RunOutputSummary, true
			compiled := compilebundle.CompileGeneric(input)
			if !compiled.OK {
				t.Fatalf("compile failed: %+v", compiled.Result.Errors)
			}
			state, err := newGenericRunState(compiled.Session, request)
			if err != nil {
				t.Fatal(err)
			}
			if err := state.runLoop(); err != nil || state.processFailure != nil || state.budgetCause != "" {
				t.Fatalf("long battle failed: err=%v process=%v budget=%v", err, state.processFailure, state.budgetCause)
			}
			done := state.buildDoneResult(false)
			target := state.combatants[model.SelectorTarget]
			ledger := target.cooldowns
			// 每轮的完整实例引用仍由下方冷却历史逐项验证；私有计数归效果包单测。
			if target.instances.Providers().Len() != 0 || target.providerState.Len() != 0 {
				t.Fatalf("dynamic instances were not mounted/removed independently: providers=%d bags=%d", target.instances.Providers().Len(), target.providerState.Len())
			}
			if ledger.EntryCount() != 2*test.cycles {
				t.Fatalf("history changed: entries=%d want=%d", ledger.EntryCount(), 2*test.cycles)
			}
			var snapshot model.CombatantSnapshot
			for _, combatant := range done.FinalSnapshot.Combatants {
				if combatant.Key == model.SelectorTarget {
					snapshot = combatant
				}
			}
			if len(snapshot.Cooldowns) != test.cycles || len(ledger.AbilityDeadlines()) != test.cycles {
				t.Fatalf("removed abilities lost their observable zero deadlines: snapshot=%d projection=%d", len(snapshot.Cooldowns), len(ledger.AbilityDeadlines()))
			}
			// 按真实身份分组记录候选规模，不依赖新账本索引字段或结构类型。
			entryBuckets, waitBuckets := map[string]int{}, map[string]int{}
			activeEntries, activeWaits := 0, 0
			for cycle := 1; cycle <= test.cycles; cycle++ {
				providerRef := fmt.Sprintf("%s#%d", dynamic.ProviderKey, cycle)
				abilityRef := "target.provider[" + providerRef + "].ability[burn_tick]"
				stateID := actionpkg.StateCooldownIdentity(model.SelectorTarget, providerRef, stateKey, stateScopeProvider, "")
				for _, id := range []contract.CooldownIdentity{actionpkg.AbilityCooldownIdentity(model.SelectorTarget, abilityRef), stateID} {
					if ledger.Version(id) == 0 || ledger.ReadyAt(id) != 0 {
						t.Fatalf("missing removal tombstone: %+v version=%d ready=%d", id, ledger.Version(id), ledger.ReadyAt(id))
					}
					entryBuckets[id.ProviderRef]++
					if ledger.Remaining(id, state.loop.TimeMs()) > 0 {
						activeEntries++
					}
				}
				waitKey := actionpkg.InternalCooldownWaitKey(stateID)
				wait, active := ledger.Wait(waitKey)
				if wait.Version == 0 || wait.Key != waitKey || active {
					t.Fatalf("old internal cooldown wait changed or remained current: %+v active=%v", wait, active)
				}
				waitBuckets[wait.Key.Key]++
				if active {
					activeWaits++
				}
				value, ok := snapshot.Cooldowns[abilityRef].(map[string]interface{})
				if !ok || value["readyAtMs"] != int64(0) || value["remainingMs"] != int64(0) {
					t.Fatalf("ability zero projection changed: %q=%+v", abilityRef, snapshot.Cooldowns[abilityRef])
				}
			}
			maxEntryBucket, maxWaitBucket := 0, 0
			for _, count := range entryBuckets {
				if count > maxEntryBucket {
					maxEntryBucket = count
				}
			}
			for _, count := range waitBuckets {
				if count > maxWaitBucket {
					maxWaitBucket = count
				}
			}
			counts := done.Evidence.CountsByKind
			removedKind := model.EvidenceKindProviderExpire
			if test.explicit {
				removedKind = model.EvidenceKindProviderRemove
			}
			if counts[string(model.EvidenceKindProviderApply)] != test.cycles || counts[string(removedKind)] != test.cycles || counts[string(model.EvidenceKindProviderTick)] != test.cycles {
				t.Fatalf("lifecycle or stale-event behavior changed: %+v", counts)
			}
			if done.Summary.TargetFinalHp != initialHP-float64(10*test.cycles) {
				t.Fatalf("tick damage changed: target hp=%v", done.Summary.TargetFinalHp)
			}
			t.Logf("cycles=%d simulated_ms=%d entries=%d active_entries=%d active_waits=%d mounted=%d snapshot_cooldowns=%d max_entry_bucket=%d max_wait_bucket=%d processed_events=%d", test.cycles, state.loop.TimeMs(), ledger.EntryCount(), activeEntries, activeWaits, target.instances.Providers().Len(), len(snapshot.Cooldowns), maxEntryBucket, maxWaitBucket, state.loop.ProcessedEvents())
		})
	}
}
