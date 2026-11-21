package execution

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/runtime/contract"
	"tinygo_engine_v2/internal/scheduler"
)

// 本组原生注入检查真实根帧的提交边界；作者编译及生产Wasm另由固定机制用例验收。
func cumulativeRefundState(t *testing.T, total int64, accepted bool) *Engine {
	t.Helper()
	c, r := singleSkillInput(false)
	c.SharedProviders[0].Abilities = c.SharedProviders[0].Abilities[:1]
	c.SharedProviders[0].Processes[0].Steps[0].StepType = "IMMEDIATE"
	c.SharedProviders[0].Processes[0].Steps[0].DelayMs = nil
	c.SharedProviders[0].Processes[0].Steps[0].OccupiesAction = model.BoolPtr(false)
	c.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	c.SharedProviders[0].Processes[0].Cooldown = &model.ProcessCooldownDefinition{
		DurationMs: authoringConst(float64(total)), StartMoment: processMoment("PROCESS_START", "", ""),
	}
	c.SharedProviders[0].Processes[0].MomentOperations = nil
	s := frameCommitState(t, c, r)
	if accepted {
		if err := s.handleSkillAction(0); err != nil {
			t.Fatalf("accept real original use: %+v", err)
		}
		if process := s.actions.ProcessAt(0); process.Status() != "complete" || process.CastID() == 0 {
			t.Fatalf("fixture did not complete an accepted real process: status=%s cast=%d", process.Status(), process.CastID())
		}
	}
	// 这里只激活输出投影；测试不将手构造的编译操作当成作者契约验收。
	s.compiled.Features |= planbundle.FeatureCumulativeCooldownRefund
	return s
}

func cumulativeRefundFrame(s *Engine) *Frame {
	f := s.newExecutionFrame("source", "target", cumulativeRef(s))
	f.ownerCombatantKey, f.ownerProviderRef, f.mountedListener = "source", "refund_owner", true
	f.eventCtx = &eventFormulaSnapshot{EventType: eventTypeDamageInstance, HasDamageSnapshot: true,
		EventSourceKey: "source", EventTargetKey: "target", HasUse: true, UseKey: s.actions.ManualAt(0).UseRef(), UseSource: "source", UseSkillKey: s.actions.ManualAt(0).Plan().SkillKey()}
	return f
}

func cumulativeRef(s *Engine) string { return s.req.DriverPlan.SkillActions[0].AbilityRef }

func cumulativeRefundOperation(s *Engine, ratio float64) (planbundle.CompiledAbility, planbundle.CompiledOperation) {
	ability := s.actions.ProcessAt(0).Ability()
	return ability, planbundle.CompiledOperation{Operation: "cooldown_change", Target: "self", ValuePolicy: "reduce_total_ratio",
		OwnerProviderIndex: int(ability.ProviderIndex), TotalCooldownRatio: ratio,
		CumulativeLimit: &model.CumulativeRatioLimit{GroupKey: "shared_refund", MaxRatio: .39},
		AbilityRefStr:   cumulativeRef(s), HasAbilityRef: true,
		TotalCooldownTarget: &planbundle.CompiledCooldownDurationTarget{CombatantKey: "source", ProviderRef: "spell", ProviderIndex: ability.ProviderIndex},
		Path:                "injected.cumulative_refund"}
}

func cumulativeReady(s *Engine) int64 {
	return s.combatants["source"].cooldowns.ReadyAt(actionpkg.AbilityCooldownIdentity("source", cumulativeRef(s)))
}

func requireCumulativeUsed(t *testing.T, s *Engine, want float64) {
	t.Helper()
	rows := s.snapshotUseAmountBudgets()
	if len(rows) != 1 || math.Abs(rows[0].UsedValue-want) > 1e-12 {
		t.Fatalf("committed quantity: got %+v, want %.17g", rows, want)
	}
	if rows[0].UseKey != s.actions.ManualAt(0).UseRef() || rows[0].UseSource != "source" || rows[0].Target == nil || *rows[0].Target != "target" || rows[0].SubjectRef != cumulativeRef(s) {
		t.Fatalf("quantity lost actual original-use/target/subject identity: %+v", rows[0])
	}
}

func TestCumulativeRefundPreflightFailureReleasesOnlyUnpublishedFrame(t *testing.T) {
	s := cumulativeRefundState(t, 1000, true)
	ability, op := cumulativeRefundOperation(s, .13)
	first := cumulativeRefundFrame(s)
	if err := first.dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	if cumulativeReady(s) != 870 {
		t.Fatal("first real cooldown reduction was not published", cumulativeReady(s))
	}
	requireCumulativeUsed(t, s, .13)
	clearQueuedEventsForTest(s.loop)
	s.loop.SetQueueLimit(1)
	if s.loop.Enqueue(scheduler.GenericEvent{TimeMs: 500}) != model.ErrOK {
		t.Fatal("queue failure fixture")
	}
	f := cumulativeRefundFrame(s)
	f.pendingStateExpiry = []pendingFrameStateExpiry{{at: 400}}
	err := f.dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed {
		t.Fatalf("expected publication preflight queue rejection, got %+v committed=%v", err, f.committed)
	}
	if cumulativeReady(s) != 870 || s.useTriggerLedger.Pending() != 0 || len(f.pendingAmountBudgets) != 0 {
		t.Fatalf("failed preflight changed published cooldown or retained quantity: ready=%d pending=%d frame=%d", cumulativeReady(s), s.useTriggerLedger.Pending(), len(f.pendingAmountBudgets))
	}
	requireCumulativeUsed(t, s, .13)
}

func TestCumulativeRefundDispatchFailureRetainsPublishedCooldownAndQuantity(t *testing.T) {
	s := cumulativeRefundState(t, 1000, true)
	ability, op := cumulativeRefundOperation(s, .26)
	f := cumulativeRefundFrame(s)
	f.chainDepth = s.budget.MaxChainDepth
	f.pendingEvents = []emittedEvent{{eventType: eventTypeDamageInstance, sourceKey: "source", targetKey: "target"}}
	err := f.dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op})
	if err == nil || err.BudgetCause != model.BudgetCauseMaxChainDepth || !f.committed {
		t.Fatalf("expected dispatch failure after publication: %+v committed=%v", err, f.committed)
	}
	if cumulativeReady(s) != 740 || s.useTriggerLedger.Pending() != 0 || len(f.pendingAmountBudgets) != 0 {
		t.Fatalf("post-publication failure rolled back actual cooldown/quantity: ready=%d pending=%d", cumulativeReady(s), s.useTriggerLedger.Pending())
	}
	requireCumulativeUsed(t, s, .26)
}

func TestCumulativeRefundZeroMillisecondDeltaStillPublishesAuthorizedRatio(t *testing.T) {
	s := cumulativeRefundState(t, 1, true)
	ability, op := cumulativeRefundOperation(s, .13)
	f := cumulativeRefundFrame(s)
	if err := f.dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	if !f.committed || cumulativeReady(s) != 1 || s.useTriggerLedger.Pending() != 0 {
		t.Fatalf("rounded-zero ratio was dropped instead of committed: ready=%d pending=%d committed=%v", cumulativeReady(s), s.useTriggerLedger.Pending(), f.committed)
	}
	requireCumulativeUsed(t, s, .13)
}

func TestCumulativeRefundCompletedOriginalUseAcceptsDelayedEventUnderSameBudget(t *testing.T) {
	s := cumulativeRefundState(t, 1000, true)
	ability, op := cumulativeRefundOperation(s, .26)
	if err := cumulativeRefundFrame(s).dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	s.loop.Advance(300)
	tail := cumulativeRefundFrame(s)
	tail.castInstanceID, tail.eventCtx.CastInstanceID = 999, 999
	if err := tail.dispatchWithAmountBudgets(ability, []planbundle.CompiledOperation{op}); err != nil {
		t.Fatal("delayed damage lost its registered completed original use", err)
	}
	if cumulativeReady(s) != 610 || s.actions.ProcessAt(0).Status() != "complete" {
		t.Fatal("second event did not share the original allowance", cumulativeReady(s), s.actions.ProcessAt(0).Status())
	}
	requireCumulativeUsed(t, s, .39)
}

func TestCumulativeRefundRejectsUnregisteredUnacceptedAndForeignOriginalUses(t *testing.T) {
	for _, kind := range []string{"unregistered", "unaccepted", "foreign_source", "foreign_skill", "missing_process"} {
		t.Run(kind, func(t *testing.T) {
			s := cumulativeRefundState(t, 1000, kind != "unaccepted")
			f := cumulativeRefundFrame(s)
			switch kind {
			case "unregistered":
				f.eventCtx.UseKey = "unregistered"
			case "unaccepted":
				s.actions.NewUse(actionpkg.UseSeed{UseKey: f.eventCtx.UseKey, Source: f.eventCtx.UseSource, SkillKey: f.eventCtx.UseSkillKey, HistoryState: model.SkillHitHistoryComplete})
			case "foreign_source":
				f.eventCtx.UseSource = "target"
			case "foreign_skill":
				f.eventCtx.UseSkillKey = "other_skill"
			case "missing_process":
				seed := s.actions.Use(f.eventCtx.UseKey).Seed()
				seed.ProcessRef = contract.ProcessRef{}
				s.actions.NewUse(seed)
			}
			before, after, err := (cooldownRefundBridge{frame: f}).ReserveRefundRatio(model.CumulativeRatioLimit{GroupKey: "shared_refund", MaxRatio: .39}, cumulativeRef(s), .13)
			if err == nil || before != 0 || after != 0 || s.useTriggerLedger.Len() != 0 || s.useTriggerLedger.Pending() != 0 || len(f.pendingAmountBudgets) != 0 {
				t.Fatalf("invalid originating use obtained quantity: kind=%s before=%v after=%v err=%+v count=%d pending=%d", kind, before, after, err, s.useTriggerLedger.Len(), s.useTriggerLedger.Pending())
			}
		})
	}
}
