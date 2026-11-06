package execution

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func activeAmmoInput(initial float64, remaining *float64, automatic bool, duration int64) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"}, model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	p := &c.SharedProviders[0]
	recovery := map[string]any{"intervalMs": authoringConst(2500), "mode": model.AmmoRecoveryOneByOne, "startCondition": model.AmmoRecoveryAfterConsume}
	if remaining != nil {
		recovery["initialRemainingMs"] = *remaining
	}
	p.InitialStateSchema = map[string]any{
		"rounds": map[string]any{"valueType": model.ProviderStateValueInteger, "defaultValue": initial, "maxValue": 4, "stateKind": model.ProviderStateKindAmmo, "ammoRecovery": recovery},
		"fired":  map[string]any{"valueType": model.ProviderStateValueInteger, "defaultValue": 0, "maxValue": 100, "durationMs": 0},
	}
	p.Processes[0].Steps[0].DelayMs = timedShieldExpr(1)
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{
		{Operation: "state_change", Target: "self", Ref: "rounds", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(-1))},
		{Operation: "state_change", Target: "self", Ref: "fired", Types: []string{stateScopeProvider}, ValuePolicy: "add", Amount: authoringAmount(authoringConst(1))},
	}}}
	for i := range c.Combatants {
		hp := c.Combatants[i].Attributes["hp"]
		hp.Base, hp.Current, hp.Max, hp.Resolved = 1e6, 1e6, 1e6, 1e6
		c.Combatants[i].Attributes["hp"] = hp
	}
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	if automatic {
		r.DriverPlan.SkillActions = []model.SkillActionPlan{}
		r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "rounds", BindingKey: "bound_spell", SortOrder: 0, Target: "target", HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}}}}
	}
	r.StopPolicy.DurationMs = duration
	max := 200
	r.RecordBudget = &model.RecordBudget{MaxMechanicRecords: &max}
	return c, r
}

func activeAmmoStarts(done model.DoneResult) []int64 {
	out := []int64{}
	for _, row := range done.AutomaticSkillRecords {
		if row.Kind == model.AutomaticRecordStarted {
			out = append(out, row.TimeMs)
		}
	}
	for _, row := range done.SkillActionRecords {
		if row.Outcome == "ACCEPTED" {
			out = append(out, row.ActualAtMs)
		}
	}
	return out
}

func TestActiveAmmoOneByOneConsumesWhileChargingAndContinuesToFull(t *testing.T) {
	c, r := activeAmmoInput(4, nil, true, 8000)
	compiled := authoringCompile(t, c)
	s, err := newGenericRunState(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.runLoop(); err != nil {
		t.Fatal(err)
	}
	d := s.buildDoneResult(false)
	if got := activeAmmoStarts(d); !reflect.DeepEqual(got, []int64{0, 1000, 2000, 3000, 4000, 5000, 7500}) {
		t.Fatal(got, d.AutomaticSkillSummary)
	}
	for _, at := range []int64{2500, 5000, 7500} {
		found := false
		for _, row := range d.MechanicRecords {
			if row.Kind == model.MechanicWaitEnded && row.TimeMs == at {
				found = true
			}
		}
		if !found {
			t.Fatal("repeated consumption reset charge", at, d.MechanicRecords)
		}
	}
	if s.actions.AmmoCount() != 1 || s.actions.BasicAttack() != nil || s.actions.AmmoAt(0).Wait().ReadyAt != 10000 {
		t.Fatal("active-only wait was coupled to basic attack", s.actions.AmmoCount())
	}
	for _, use := range s.skillUses {
		before, present := use.ammoBefore.Before("source", "caster", "rounds")
		if !present || before < 1 {
			t.Fatal("capture missing after actual INITIAL publication", use)
		}
	}
	// 同一只读会话重跑不继承库存、代次或等待。
	again, err := runForTest(compiled, r)
	if err != nil || !reflect.DeepEqual(d, again) {
		t.Fatal("repeated session changed result", err)
	}

	c, r = activeAmmoInput(4, nil, false, 10000)
	d = authoringRun(t, c, r)
	ended := []int64{}
	for _, row := range d.MechanicRecords {
		if row.Kind == model.MechanicWaitEnded {
			ended = append(ended, row.TimeMs)
		}
	}
	if !reflect.DeepEqual(ended, []int64{2500}) {
		t.Fatal("full inventory kept charging", ended)
	}
}

func TestActiveAmmoStrictInitialRemainingAndRealBinding(t *testing.T) {
	for _, name := range []string{"missing", "full", "negative", "fraction", "unsafe", "too_long", "null", "expr", "old_mode", "mixed_mode", "listener_alias", "missing_binding", "extra_write", "late_consumption", "noninteger_extra"} {
		t.Run(name, func(t *testing.T) {
			remaining := float64(500)
			c, _ := activeAmmoInput(1, &remaining, true, 5000)
			p := &c.SharedProviders[0]
			field := p.InitialStateSchema["rounds"].(map[string]any)
			recovery := field["ammoRecovery"].(map[string]any)
			switch name {
			case "missing":
				delete(recovery, "initialRemainingMs")
			case "full":
				field["defaultValue"] = 4
			case "negative":
				recovery["initialRemainingMs"] = -1
			case "fraction":
				recovery["initialRemainingMs"] = .5
			case "unsafe":
				recovery["initialRemainingMs"] = float64(maxJSONSafeInteger) + 1
			case "too_long":
				recovery["initialRemainingMs"] = 2501
			case "null":
				recovery["initialRemainingMs"] = nil
			case "expr":
				recovery["initialRemainingMs"] = authoringConst(500)
			case "old_mode":
				recovery["mode"], recovery["startCondition"] = model.AmmoRecoveryAllAtOnce, model.AmmoRecoveryWhenEmpty
			case "mixed_mode":
				recovery["startCondition"] = model.AmmoRecoveryWhenEmpty
			case "listener_alias":
				p.Listeners = []model.ListenerDefinition{{ListenerKey: "alias", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, AbilityRef: "source.provider[caster].ability[initial]", MaxTriggersPerEvent: 1}}
			case "missing_binding":
				c.Rules.SkillActionBindings = nil
			case "extra_write":
				p.Processes[0].MomentOperations[0].Operations = append(p.Processes[0].MomentOperations[0].Operations, p.Processes[0].MomentOperations[0].Operations[0])
			case "late_consumption":
				p.Processes[0].MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
			case "noninteger_extra":
				p.InitialStateSchema["fired"].(map[string]any)["valueType"] = model.ProviderStateValueNumber
			}
			result := compilebundle.CompileGeneric(c)
			if name == "noninteger_extra" {
				if result.OK {
					_, err := newGenericRunState(result.Session, func() model.RunRequest { _, r := activeAmmoInput(1, &remaining, true, 5000); return r }())
					if err == nil {
						t.Fatal("noninteger extra field admitted")
					}
				}
				return
			}
			if result.OK {
				t.Fatal("invalid initial ammo contract compiled", name)
			}
		})
	}
	// JSON 的 0 必须保留；省略值与显式 null 均不能伪装成 0。
	raw := []byte(`{"intervalMs":{"op":"const","value":2500},"mode":"one_by_one","startCondition":"after_consume","initialRemainingMs":0}`)
	var recovery model.AmmoRecoverySchema
	if json.Unmarshal(raw, &recovery) != nil || recovery.InitialRemainingMs == nil {
		t.Fatal(recovery)
	}
}

func TestActiveAmmoRefundIsSeparateClampedRecoveryAndInvalidatesOldEvents(t *testing.T) {
	for _, amount := range []float64{500, 1500, 5000, 1499.5} {
		remaining := float64(2000)
		c, r := activeAmmoInput(0, &remaining, false, 5000)
		c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "refund", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "rounds", Types: []string{stateScopeProvider}, ValuePolicy: "subtract", Amount: authoringAmount(authoringConst(amount))}}}}
		s, err := newGenericRunState(authoringCompile(t, c), r)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.initializeDrivenAmmo(); err != nil {
			t.Fatal(err)
		}
		ammo := s.actions.AmmoAt(0)
		old := scheduler.GenericEvent{TimeMs: ammo.Wait().ReadyAt, AmmoGeneration: ammo.Wait().Generation, AmmoStateKey: "rounds", ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "caster"}}
		s.loop.Advance(500)
		var f Frame
		s.initAmmoFrame(&f, ammo)
		var opFound bool
		for _, op := range s.compiled.Operations {
			if op.Operation == model.OperationKindStateDurationChange {
				opFound = true
				if err := f.applyStateDurationChange(op, ammo.Ability()); err != nil {
					t.Fatal(err)
				}
			}
		}
		if !opFound {
			t.Fatal("missing refund")
		}
		f.commit()
		if f.fatal {
			t.Fatal(f.fatalErr)
		}
		want := int64(2000) - int64(math.Round(amount))
		if want < 500 {
			want = 500
		}
		if ammo.Wait().ReadyAt != want || s.combatants["source"].providerState.Lookup("caster").State().At("rounds") != 0 || s.recordingSummary().MechanicRecordCount != 1 {
			t.Fatal("refund changed inventory or synchronously recovered", ammo.Wait(), s.recordingSummary().MechanicRecordCount)
		}
		s.loop.Advance(old.TimeMs)
		if err = s.handleAmmoRecovery(old); err != nil || s.recordingSummary().MechanicRecordCount != 1 {
			t.Fatal("old event recovered", err)
		}
		s.loop.Advance(want)
		ev := old
		ev.TimeMs, ev.AmmoGeneration = want, ammo.Wait().Generation
		if err = s.handleAmmoRecovery(ev); err != nil {
			t.Fatal(err)
		}
		if s.combatants["source"].providerState.Lookup("caster").State().At("rounds") != 1 || ammo.Wait().ReadyAt != want+2500 {
			t.Fatal("refund overflow leaked into next cycle", ammo.Wait())
		}
		before := s.recordingSummary().MechanicRecordCount
		if err = s.handleAmmoRecovery(ev); err != nil || s.recordingSummary().MechanicRecordCount != before {
			t.Fatal("duplicate event recovered", err)
		}
	}
}

func appendActiveAmmo(t *testing.T, c *model.CompileRequest, r *model.RunRequest, name string, initial float64, remaining *float64) {
	t.Helper()
	extra, run := activeAmmoInput(initial, remaining, true, r.StopPolicy.DurationMs)
	raw, _ := json.Marshal(extra.SharedProviders[0])
	raw = []byte(strings.NewReplacer("skill_source", name+"_definition", "configured_spell", name, "damage/physical", "damage/physics").Replace(string(raw)))
	var p model.ProviderDefinition
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: name, DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[0].Providers = append(r.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: name, DefinitionRef: p.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	for _, entry := range extra.TypeCatalog.Types {
		if entry.Key == "damage/physical" {
			continue
		}
		found := false
		for _, current := range c.TypeCatalog.Types {
			found = found || current.Key == entry.Key
		}
		if !found {
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, entry)
		}
	}
	binding := extra.Rules.SkillActionBindings[0]
	binding.BindingKey, binding.SkillKey, binding.ProviderRef, binding.ProviderDefinitionRef = name+"_binding", name, name, p.ProviderKey
	binding.Controls[0].AbilityRef = "source.provider[" + name + "].ability[initial]"
	binding.HitBindings[0].HitAbilityRef = "source.provider[" + name + "].ability[hit]"
	c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, binding)
	if r.DriverPlan.AutomaticSkills == nil {
		r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{}}
	}
	rule := run.DriverPlan.AutomaticSkills.Rules[0]
	rule.RuleKey, rule.BindingKey, rule.SortOrder = name, binding.BindingKey, len(r.DriverPlan.AutomaticSkills.Rules)
	r.DriverPlan.AutomaticSkills.Rules = append(r.DriverPlan.AutomaticSkills.Rules, rule)
	max := 300
	r.RecordBudget = &model.RecordBudget{MaxMechanicRecords: &max}
}

func TestActiveAmmoSourcesAndIdleTargetStayIsolated(t *testing.T) {
	c, r := ammoAttackInput(1, 1000, 6000)
	x, y := float64(500), float64(750)
	appendActiveAmmo(t, &c, &r, "first", 0, &x)
	appendActiveAmmo(t, &c, &r, "second", 0, &y)
	c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "first", DefinitionRef: "first_definition"})
	r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "first", DefinitionRef: "first_definition", Source: "target", Owner: "target", Stacks: 1})
	// 目标方保留同字段、同挂载名的完整资料，但没有驱动来源，不启动其充能。
	compiled := authoringCompile(t, c)
	r.DriverPlan.BasicAttack = nil
	s, err := newGenericRunState(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.runLoop(); err != nil {
		t.Fatal(err)
	}
	if s.actions.AmmoCount() != 2 || s.combatants["target"].providerState.Len() != 0 {
		t.Fatal("idle target started charging", s.actions.AmmoCount(), s.combatants["target"].providerState)
	}
	d := s.buildDoneResult(false)
	starts := map[string][]int64{}
	for _, row := range d.AutomaticSkillRecords {
		if row.Kind == model.AutomaticRecordStarted {
			starts[row.RuleKey] = append(starts[row.RuleKey], row.TimeMs)
		}
	}
	if !reflect.DeepEqual(starts["first"], []int64{500, 3000, 5500}) || !reflect.DeepEqual(starts["second"], []int64{750, 3250, 5750}) {
		t.Fatal("provider waits crossed identities", starts)
	}
	// 恢复普攻，去掉目标主动资料以满足原混合准入；三份等待同时存在。
	c.Combatants[1].Providers = nil
	r.InitialSnapshot.Combatants[1].Providers = nil
	_, base := ammoAttackInput(1, 1000, 6000)
	r.DriverPlan.BasicAttack = base.DriverPlan.BasicAttack
	d = authoringRun(t, c, r)
	if len(d.AttackRecords) != 5 {
		t.Fatal("active waits changed all-at-once attack", d.AttackRecords)
	}
	for i, want := range []int64{0, 2500, 3500, 4500, 5500} {
		if d.AttackRecords[i].StartAtMs != want {
			t.Fatal(d.AttackRecords)
		}
	}
}

func TestActiveAmmoQueueAndCommandBudgetsLeaveNoPartialFrame(t *testing.T) {
	for _, stage := range []string{"initialize", "refund", "recover"} {
		t.Run(stage, func(t *testing.T) {
			remaining := float64(2000)
			c, r := activeAmmoInput(0, &remaining, true, 5000)
			c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "refund", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "rounds", Types: []string{stateScopeProvider}, ValuePolicy: "subtract", Amount: timedShieldExpr(2000)}}}}
			s, err := newGenericRunState(authoringCompile(t, c), r)
			if err != nil {
				t.Fatal(err)
			}
			ammo := s.actions.AmmoAt(0)
			if stage != "initialize" {
				if err = s.initializeDrivenAmmo(); err != nil {
					t.Fatal(err)
				}
			}
			beforeWait, beforeRecords := ammo.Wait(), s.recordingSummary().MechanicRecordCount
			beforeActor := s.buildDoneResult(false).FinalSnapshot.Combatants[0]
			clearQueuedEventsForTest(s.loop)
			s.loop.SetQueueLimit(1)
			s.loop.Enqueue(scheduler.GenericEvent{Kind: scheduler.GenericEventSample, TimeMs: 5000})
			switch stage {
			case "initialize":
				err = s.initializeDrivenAmmo()
			case "refund":
				s.loop.Advance(500)
				var f Frame
				s.initAmmoFrame(&f, ammo)
				for _, op := range s.compiled.Operations {
					if op.Operation == model.OperationKindStateDurationChange {
						if err = f.applyStateDurationChange(op, ammo.Ability()); err != nil {
							t.Fatal(err)
						}
					}
				}
				f.commit()
				err = f.fatalErr
			case "recover":
				s.loop.Advance(2000)
				err = s.handleAmmoRecovery(scheduler.GenericEvent{TimeMs: 2000, AmmoGeneration: ammo.Wait().Generation, AmmoStateKey: "rounds", ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "caster"}})
			}
			if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents || ammo.Wait() != beforeWait || s.recordingSummary().MechanicRecordCount != beforeRecords || !reflect.DeepEqual(beforeActor, s.buildDoneResult(false).FinalSnapshot.Combatants[0]) {
				t.Fatal("queue failure leaked staged ammo or wakeup", err, ammo.Wait(), beforeWait)
			}
		})
	}
	c, r := activeAmmoInput(4, nil, false, 100)
	r.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	s, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.runLoop(); err != nil {
		t.Fatal(err)
	}
	d := s.buildDoneResult(false)
	if d.Summary.Execution.BudgetCause == nil || *d.Summary.Execution.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || s.actions.AmmoAt(0).Wait().Active || len(s.skillUses) != 0 || s.actions.ProcessCount() != 0 || s.recordingSummary().MechanicRecordCount != 0 || s.combatants["source"].providerState.Len() != 0 || len(d.FinalSnapshot.Combatants[0].Cooldowns) != 0 {
		t.Fatal("command failure leaked ammo, cooldown, author state or use capture", d.Summary, d.FinalSnapshot)
	}
}

func TestActiveAmmoRemovedInstanceAndWrongStateCannotRecover(t *testing.T) {
	remaining := float64(2000)
	c, r := activeAmmoInput(0, &remaining, true, 5000)
	s, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.initializeDrivenAmmo(); err != nil {
		t.Fatal(err)
	}
	ammo := s.actions.AmmoAt(0)
	valid := scheduler.GenericEvent{TimeMs: 2000, AmmoGeneration: ammo.Wait().Generation, AmmoStateKey: "rounds", ProviderInstanceRef: scheduler.ProviderInstanceRef{CombatantKey: "source", ProviderRef: "caster"}}
	s.loop.Advance(2000)
	for _, change := range []func(*scheduler.GenericEvent){func(e *scheduler.GenericEvent) { e.AmmoStateKey = "fired" }, func(e *scheduler.GenericEvent) { e.ProviderInstanceRef.CombatantKey = "target" }, func(e *scheduler.GenericEvent) { e.ProviderInstanceRef.ProviderRef = "other" }} {
		bad := valid
		change(&bad)
		if err = s.handleAmmoRecovery(bad); err != nil || s.recordingSummary().MechanicRecordCount != 1 {
			t.Fatal("wrong recovery identity applied", err)
		}
	}
	s.loop.Advance(1000)
	original := s.combatants["source"].instances.Providers().At(0)
	s.removeProviderInstance("source", "caster", s.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
	actor := s.combatants["source"]
	actor.instances.SetProviders(actor.instances.Providers().Append(original))
	s.combatants["source"] = actor
	s.loop.Advance(2000)
	if err = s.handleAmmoRecovery(valid); err != nil || s.recordingSummary().MechanicRecordCount != 1 || ammo.Wait().Active {
		t.Fatal("removed instance event affected remount", err, ammo.Wait())
	}
}

func TestActiveAmmoInactiveRefundDoesNotEvaluateAndInvalidAmountIsAtomic(t *testing.T) {
	for _, amount := range []float64{-1, math.Inf(1), math.NaN(), float64(maxJSONSafeInteger) + 1} {
		c, r := activeAmmoInput(4, nil, false, 5000)
		c.Combatants[0].Attributes["refund_ms"] = authoringSlot(1)
		c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "refund", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: "rounds", Types: []string{stateScopeProvider}, ValuePolicy: "subtract", Amount: authoringAmount(authoringRead("source.attr.refund_ms.resolved"))}}}}
		s, err := newGenericRunState(authoringCompile(t, c), r)
		if err != nil {
			t.Fatal(err)
		}
		ammo := s.actions.AmmoAt(0)
		var opIndex int
		for i, op := range s.compiled.Operations {
			if op.Operation == model.OperationKindStateDurationChange {
				opIndex = i
			}
		}
		var inactive Frame
		s.initAmmoFrame(&inactive, ammo)
		slot := inactive.stageFor("source").attributesView().At("refund_ms")
		slot.Resolved = amount

		inactive.stageFor("source").setAttributes(inactive.stageFor("source").attributesView().With("refund_ms", slot))
		if err = inactive.applyStateDurationChange(s.compiled.Operations[opIndex], ammo.Ability()); err != nil {
			t.Fatal("inactive timer evaluated invalid amount", amount, err)
		}
		s.actions.PublishAmmoWait(ammo, actionpkg.AmmoWait{Active: true, ReadyAt: 2000, Generation: 1})
		if err = inactive.applyStateDurationChange(s.compiled.Operations[opIndex], ammo.Ability()); err == nil || len(inactive.pendingAmmoWaits) != 0 || ammo.Wait().ReadyAt != 2000 {
			t.Fatal("invalid refund changed active timer", amount, err, ammo.Wait())
		}
	}
}

func TestActiveAmmoReadinessUsesMaximumAndRegistersActualNotBefore(t *testing.T) {
	c, r := continuousAttackInput(1, 100000, 10, 0, 0, 5000)
	remaining := float64(2000)
	appendActiveAmmo(t, &c, &r, "first", 0, &remaining)
	appendActiveAmmo(t, &c, &r, "second", 4, nil)
	r.DriverPlan.AutomaticSkills.Rules[0].WaitForCooldowns = []string{"second"}
	r.DriverPlan.BasicAttack = nil
	s, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.initializeDrivenAmmo(); err != nil {
		t.Fatal(err)
	}
	first, second := s.actions.AutomaticAt(0), s.actions.AutomaticAt(1)
	ledger := s.combatants["source"].cooldowns
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", first.AbilityRef()), 1500, 0)
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", second.AbilityRef()), 3000, 0)
	occupier := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{Owner: "source", ProviderRef: "occupier", Status: "active", AdvanceAtMs: 4000}, Definition: &planbundle.CompiledProcess{Steps: []planbundle.CompiledProcessStep{{OccupiesAction: true}}}, StepIndex: 0})
	s.actions.AddProcess(occupier)
	reason, _, ready, err := s.automaticCandidate(first)
	if err != nil || reason != model.AutomaticWaitOwnCooldown || ready != 4000 {
		t.Fatal("candidate lost an independent deadline", reason, ready, err)
	}
	if err = s.handleAutomaticSkills(scheduler.GenericEvent{AutomaticGeneration: s.actions.AutomaticGeneration()}); err != nil {
		t.Fatal(err)
	}
	wait, exists := s.combatants["source"].cooldowns.Wait(actionpkg.CooldownWaitKey{Kind: "automatic", Owner: "source", Key: "first"})
	if !exists || wait.ReadyAt != 4000 {
		t.Fatal("actual registration disagrees with readiness", wait, exists)
	}
	// 没有行动占用时，库存为0的余时必须成为登记的最低期限，而非仅展示值。
	changes := actionpkg.StageProcess(occupier)
	changes.Finish("complete", "", s.loop.TimeMs())
	changes.Publish(occupier)
	ledger = s.combatants["source"].cooldowns
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", first.AbilityRef()), 500, 0)
	ledger.Set(actionpkg.AbilityCooldownIdentity("source", second.AbilityRef()), 600, 0)
	if err = s.handleAutomaticSkills(scheduler.GenericEvent{AutomaticGeneration: s.actions.AutomaticGeneration()}); err != nil {
		t.Fatal(err)
	}
	wait, _ = s.combatants["source"].cooldowns.Wait(actionpkg.CooldownWaitKey{Kind: "automatic", Owner: "source", Key: "first"})
	if wait.ReadyAt != 2000 || wait.NotBefore != 2000 {
		t.Fatal("ammo deadline was omitted from registerWait", wait)
	}
}

func TestActiveAmmoFreshRunOnlyAndClosedUseCaptureReads(t *testing.T) {
	for _, change := range []func(*model.RunRequest){func(r *model.RunRequest) { r.InitialSnapshot.TimeMs = 1 }, func(r *model.RunRequest) {
		r.InitialSnapshot.Combatants[0].ProviderState = map[string]any{"caster": map[string]any{"rounds": 1}}
	}} {
		c, r := activeAmmoInput(4, nil, true, 5000)
		change(&r)
		compiled := authoringCompile(t, c)
		if _, err := newGenericRunState(compiled, r); err == nil {
			t.Fatal("mid-run ammo snapshot was silently reconstructed")
		}
	}
	c, _ := activeAmmoInput(4, nil, true, 5000)
	c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].ParticipationCondition = authoringAmount(authoringRead("use.ammo.before"))
	if result := compilebundle.CompileGeneric(c); result.OK {
		t.Fatal("active ammo widened use.ammo.before admission")
	}
}
