package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

func initialActionStun(c *model.CompileRequest, r *model.RunRequest, expiry int64) string {
	stun := stunProvider()
	stun.Lifecycle.DurationMs = timedShieldExpr(float64(expiry))
	c.SharedProviders = append(c.SharedProviders, stun)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stun.Types[0], Domain: "provider"})
	return "source.provider[" + c.Combatants[0].Providers[0].ProviderRef + "].ability[" + c.SharedProviders[0].Abilities[0].AbilityKey + "]"
}

// 准入仍读取新场景。包内测试经原真实帧施加已编译定义，单独检验行动消费者；
// 完整作者操作编译与对方驱动链另由真实来控用例覆盖。
func applyActionControlProbe(t *testing.T, s *Engine, ref string) {
	t.Helper()
	operation := planbundle.CompiledOperation{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "status:stun", Path: "test.control_probe"}
	f, err := actionControlFrame(s, ref, operation)
	if err != nil || !f.committed {
		t.Fatal(err)
	}
}

func actionControlFrame(s *Engine, ref string, operation planbundle.CompiledOperation) (*Frame, *model.EngineError) {
	f := s.newExecutionFrame("target", "source", ref)
	f.ownerCombatantKey, f.ownerProviderRef = "source", s.req.InitialSnapshot.Combatants[0].Providers[0].ProviderRef
	if err := f.executeOperations(s.compiled.Abilities[0], []planbundle.CompiledOperation{operation}); err != nil {
		return f, err
	}
	f.commit()
	return f, f.fatalErr
}

func actionControlInstance(t *testing.T, s *Engine, definition string) string {
	t.Helper()
	instances := s.combatants["source"].instances.Providers()
	for i := 0; i < instances.Len(); i++ {
		if instance := instances.At(i); instance.DefinitionRef == definition {
			return instance.ProviderRef
		}
	}
	t.Fatal("missing actual control instance", definition)
	return ""
}

func runWithActualInitialControl(t *testing.T, c model.CompileRequest, r model.RunRequest, ref string) model.DoneResult {
	t.Helper()
	s := frameCommitState(t, c, r)
	applyActionControlProbe(t, s, ref)
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	done, err := s.Finish()
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func TestStunnedInitialRejectsBeforePaymentForDriverAndManual(t *testing.T) {
	for _, manual := range []bool{false, true} {
		t.Run(map[bool]string{false: "driver", true: "manual"}[manual], func(t *testing.T) {
			var c model.CompileRequest
			var r model.RunRequest
			if manual {
				c, r = singleSkillInput(false)
				c.SharedProviders[0].Processes[0].Costs = []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: *timedShieldExpr(60)}}
				c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 500}
				r.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 200, Max: 500}
			} else {
				c, r = processBase(t, "CHARGE")
			}
			ref := initialActionStun(&c, &r, 200)
			r.StopPolicy.DurationMs = 150
			done := runWithActualInitialControl(t, c, r, ref)
			if len(done.FinalSnapshot.ProcessInstances) != 0 || processResource(done, "source", "mana") != 200 {
				t.Fatal("controlled initial created a process or paid cost", done.FinalSnapshot)
			}
			if manual {
				if len(done.SkillActionRecords) != 1 || done.SkillActionRecords[0].Reason == nil || *done.SkillActionRecords[0].Reason != "controlled" || done.SkillActionRecords[0].UseRef != nil {
					t.Fatal("manual rejection published an actual use or lost its reason", done.SkillActionRecords)
				}
			} else if processCount(done, "process_rejected", "") != 1 {
				t.Fatal("driver rejection was not observed once", done.Evidence.Items)
			}
		})
	}
}

func TestInitialStunPreservesBackgroundFirstAttackAndExactRecovery(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 1500)
	ref := initialActionStun(&c, &r, 300)
	done := runWithActualInitialControl(t, c, r, ref)
	want := []int64{300, 1300}
	if len(done.AttackRecords) != len(want) {
		t.Fatal("controlled first attack lost its successor", done.AttackRecords)
	}
	for i, at := range want {
		if done.AttackRecords[i].StartAtMs != at {
			t.Fatal("control changed actual attack cadence", done.AttackRecords)
		}
	}
}

func TestAutomaticStunWaitKeepsExactDeadline(t *testing.T) {
	c, r := automaticChainInput(t, 1, false)
	ref := initialActionStun(&c, &r, 333)
	r.StopPolicy.DurationMs = 540
	done := runWithActualInitialControl(t, c, r, ref)
	want := []int64{334, 534}
	if len(done.DamageRecords) != len(want) {
		t.Fatal("automatic control wait lost or duplicated casts", done.DamageRecords, done.AutomaticSkillRecords)
	}
	for i, at := range want {
		if done.DamageRecords[i]["timeMs"] != at {
			t.Fatal("automatic cast polled beyond the exact control deadline", done.DamageRecords)
		}
	}
	for _, record := range done.AutomaticSkillRecords {
		if record.TimeMs > 0 && record.TimeMs < 333 {
			t.Fatal("finite control introduced polling", done.AutomaticSkillRecords)
		}
	}
}

func TestStunRemovalShortensPermissionWithoutChangingRealAttackCooldown(t *testing.T) {
	for _, attacked := range []bool{false, true} {
		t.Run(map[bool]string{false: "before_first_attack", true: "during_real_cooldown"}[attacked], func(t *testing.T) {
			c, r := continuousAttackInput(1, 100000, 10, 0, 0, 1500)
			ref := initialActionStun(&c, &r, 1000)
			s := frameCommitState(t, c, r)
			if attacked {
				if err := s.handleBasicAttack(); err != nil {
					t.Fatal(err)
				}
				s.loop.Advance(100)
			}
			applyActionControlProbe(t, s, ref)
			s.loop.Advance(200)
			instance := actionControlInstance(t, s, "status:stun")
			operation := planbundle.CompiledOperation{Operation: "expire_provider", Target: "target", ProviderRef: instance, Path: "test.remove_control"}
			if f, err := actionControlFrame(s, ref, operation); err != nil || !f.committed {
				t.Fatal(err)
			}
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			done, err := s.Finish()
			if err != nil {
				t.Fatal(err)
			}
			want := []int64{200, 1200}
			if attacked {
				want = []int64{0, 1000}
			}
			if len(done.AttackRecords) != len(want) {
				t.Fatal("control removal lost or duplicated attack", done.AttackRecords)
			}
			for i, at := range want {
				if done.AttackRecords[i].StartAtMs != at {
					t.Fatal("old permission or modified real cooldown survived removal", done.AttackRecords, want)
				}
			}
		})
	}
}

func TestStunRefreshAndOverlappingRemovalRecomputeAttackPermission(t *testing.T) {
	for _, overlap := range []bool{false, true} {
		t.Run(map[bool]string{false: "refresh_extends", true: "remove_longer_overlap"}[overlap], func(t *testing.T) {
			c, r := continuousAttackInput(1, 100000, 10, 0, 0, 1500)
			duration := int64(300)
			if overlap {
				duration = 700
			}
			ref := initialActionStun(&c, &r, duration)
			if overlap {
				short := stunProvider()
				short.ProviderKey, short.StableID, short.Lifecycle.DurationMs = "short_stun", "short_stun", timedShieldExpr(300)
				c.SharedProviders = append(c.SharedProviders, short)
			}
			s := frameCommitState(t, c, r)
			applyActionControlProbe(t, s, ref)
			if overlap {
				operation := planbundle.CompiledOperation{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "short_stun", Path: "test.overlap"}
				if f, err := actionControlFrame(s, ref, operation); err != nil || !f.committed {
					t.Fatal(err)
				}
			}
			s.loop.Advance(100)
			operation := planbundle.CompiledOperation{Operation: "refresh_provider", Target: "target", ProviderRef: actionControlInstance(t, s, "status:stun"), Path: "test.change_control"}
			want := int64(400)
			if overlap {
				operation.Operation, want = "expire_provider", 300
			}
			if f, err := actionControlFrame(s, ref, operation); err != nil || !f.committed {
				t.Fatal(err)
			}
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			done, err := s.Finish()
			if err != nil {
				t.Fatal(err)
			}
			if len(done.AttackRecords) != 2 || done.AttackRecords[0].StartAtMs != want || done.AttackRecords[1].StartAtMs != want+1000 {
				t.Fatal("control changes retained stale permission or cooldown", done.AttackRecords, want)
			}
		})
	}
}

func TestStunFirstAttackWakeBudgetFailsBeforeControlPublication(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 1500)
	ref := initialActionStun(&c, &r, 300)
	s := frameCommitState(t, c, r)
	clearQueuedEventsForTest(s.loop)
	s.loop.SetQueueLimit(1)
	if s.loop.Enqueue(scheduler.GenericEvent{TimeMs: 1200, Kind: scheduler.GenericEventSample}) != model.ErrOK {
		t.Fatal("queue setup failed")
	}
	operation := planbundle.CompiledOperation{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "status:stun", Path: "test.control_budget"}
	f, err := actionControlFrame(s, ref, operation)
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed {
		t.Fatal("control published before its first-attack wake capacity was reserved", f.committed, err)
	}
	instances := s.combatants["source"].instances.Providers()
	for i := 0; i < instances.Len(); i++ {
		if instances.At(i).DefinitionRef == "status:stun" {
			t.Fatal("failed control frame leaked its live instance")
		}
	}
	if s.actions.BasicAttack().StartedCount() != 0 || s.loop.QueuedEvents() != 1 {
		t.Fatal("failed control changed attack count or queue")
	}
}

func TestRestoredStunFailsChargeAndChannelBeforeTheirNextMoment(t *testing.T) {
	for _, kind := range []string{"CHARGE", "CHANNEL"} {
		t.Run(kind, func(t *testing.T) {
			c, r := processBase(t, kind)
			if kind == "CHANNEL" {
				first := "IMMEDIATE"
				step := &c.SharedProviders[0].Processes[0].Steps[0]
				step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(1000), timedShieldExpr(4), &first
			}
			initialActionStun(&c, &r, 300)
			r.StopPolicy.DurationMs = 100
			first := processRun(t, c, r)
			if len(first.FinalSnapshot.ProcessInstances) != 1 || first.FinalSnapshot.ProcessInstances[0].Status != "active" {
				t.Fatal("restore setup did not retain an active process", first.FinalSnapshot.ProcessInstances)
			}
			r.InitialSnapshot = first.FinalSnapshot
			r.DriverPlan.Entries, r.ProcessCommandFacts = nil, nil
			r.StopPolicy.DurationMs = 300
			expires := int64(400)
			r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "restored_control", DefinitionRef: "status:stun", Source: "target", Owner: "source", Stacks: 1, ExpireAt: &expires})
			done := processRun(t, c, r)
			process := done.FinalSnapshot.ProcessInstances[0]
			if process.Status != "failed" || process.FailureReason == nil || *process.FailureReason != "CONTROLLED" || process.FinishedAtMs == nil || *process.FinishedAtMs != 100 {
				t.Fatal("restored control escaped before its first pending process moment", process, done.Evidence.Items)
			}
			if len(done.DamageRecords) != 0 || processCount(done, "process_moment", "PROCESS_FAILURE") != 1 {
				t.Fatal("restored controlled process executed later payload or failed twice", done.DamageRecords, done.Evidence.Items)
			}
		})
	}
}

func TestActualIncomingStunFailsOnlyItsChannelOwnerOnce(t *testing.T) {
	c, r := processBase(t, "CHANNEL")
	first := "IMMEDIATE"
	step := &c.SharedProviders[0].Processes[0].Steps[0]
	step.DurationMs, step.ExecutionCount, step.FirstExecution = timedShieldExpr(1000), timedShieldExpr(4), &first
	stun := stunProvider()
	c.SharedProviders = append(c.SharedProviders, stun, model.ProviderDefinition{ProviderKey: "enemy_control", Kind: "champion", StableID: "enemy_control", Abilities: []model.AbilityDefinition{{AbilityKey: "stun", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: stun.ProviderKey}}}}})
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stun.Types[0], Domain: "provider"})
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "enemy_mount", DefinitionRef: "enemy_control"}, model.CombatantProviderMount{ProviderRef: "enemy_channel", DefinitionRef: "champion:source_demo"})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers,
		model.CombatantProviderSnapshot{ProviderRef: "enemy_mount", DefinitionRef: "enemy_control", Source: "target", Owner: "target", Stacks: 1},
		model.CombatantProviderSnapshot{ProviderRef: "enemy_channel", DefinitionRef: "champion:source_demo", Source: "target", Owner: "target", Stacks: 1})
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: "enemy_use", Source: "target", SkillKey: "skill:q", HistoryState: "complete"})
	r.DriverPlan.Entries = append(r.DriverPlan.Entries,
		model.DriverEntry{EntryKey: "enemy_start", AbilityRef: "target.provider[enemy_channel].ability[start]", Source: "target", Target: "source"},
		model.DriverEntry{EntryKey: "incoming_control", AbilityRef: "target.provider[enemy_mount].ability[stun]", Source: "target", Target: "source", FirstAtMs: 200})
	r.ProcessCommandFacts = append(r.ProcessCommandFacts, model.ProcessCommandFact{DriverEntryKey: "enemy_start", UseRef: "enemy_use"})
	r.StopPolicy.DurationMs = 800
	done := processRun(t, c, r)
	if len(done.FinalSnapshot.ProcessInstances) != 2 || done.Summary.SourceDamageDealt != 100 || done.Summary.TargetDamageDealt != 400 || processCount(done, "process_moment", "PROCESS_FAILURE") != 1 {
		t.Fatal("control changed another owner, repeated failure, or preserved old channel ticks", done.Summary, done.FinalSnapshot.ProcessInstances, done.Evidence.Items)
	}
	for _, process := range done.FinalSnapshot.ProcessInstances {
		if process.Owner == "source" {
			if process.Status != "failed" || process.FailureReason == nil || *process.FailureReason != "CONTROLLED" || process.FinishedAtMs == nil || *process.FinishedAtMs != 200 {
				t.Fatal(process)
			}
		} else if process.Status != "active" {
			t.Fatal("uncontrolled owner was stopped", process)
		}
	}
}

func TestStunDoesNotCancelAlreadyIssuedDelayedPayload(t *testing.T) {
	c, r := processBase(t, "DELAY")
	ref := initialActionStun(&c, &r, 1000)
	s := frameCommitState(t, c, r)
	if err := s.handleAbilityAttempt(scheduler.GenericEvent{DriverEntryIndex: 0}); err != nil {
		t.Fatal(err)
	}
	s.loop.Advance(100)
	applyActionControlProbe(t, s, ref)
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	done, err := s.Finish()
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.SourceDamageDealt != 100 || len(done.DamageRecords) != 1 || done.DamageRecords[0]["timeMs"] != int64(500) || done.FinalSnapshot.ProcessInstances[0].Status != "complete" || processCount(done, "process_moment", "PROCESS_FAILURE") != 0 {
		t.Fatal("stun incorrectly blocked an already issued non-channel payload", done.Summary, done.DamageRecords, done.FinalSnapshot.ProcessInstances)
	}
}
