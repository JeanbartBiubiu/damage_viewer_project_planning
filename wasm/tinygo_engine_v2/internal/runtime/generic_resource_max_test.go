package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func resourceMaxInput(t *testing.T, current, maximum float64, apply bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, run := singleSkillInput(false)
	p := hitFlatProvider("health_window", "armor", 40)
	p.Lifecycle.DurationMs = timedShieldExpr(15000)
	p.Modifiers = append(p.Modifiers, model.ModifierDefinition{ModifierKey: "health", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: hitConst(300), CurrentValuePolicy: "grant_positive_delta_clamp"})
	input.SharedProviders = append(input.SharedProviders, p)
	for _, actor := range []map[string]model.AttributeSlotDef{input.Combatants[0].Attributes, run.InitialSnapshot.Combatants[0].Attributes} {
		hp := actor["hp"]
		hp.Base, hp.Max, hp.Current, hp.Resolved = maximum, maximum, current, current
		actor["hp"] = hp
	}
	if apply {
		input.SharedProviders[0].Processes[0].MomentOperations = append(input.SharedProviders[0].Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: p.ProviderKey}}})
	}
	return input, run
}

func applyHealthWindow(t *testing.T, state *genericRunState) {
	t.Helper()
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "health_test")
	frame.processUseKey = "actual_health_use"
	op := plan.CompiledOperation{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
}

func TestResourceMaxActualRunAndRetention(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, true)
	full := authoringRun(t, input, run)
	if full.Summary.SourceFinalHp != 800 || full.FinalSnapshot.Combatants[0].Attributes["hp"].Max != 1800 || full.ResourceChangeSummary.ChangeCount != 1 || len(*full.ResourceChangeRecords) != 1 {
		t.Fatal(full.Summary, full.ResourceChangeSummary, full.FinalSnapshot)
	}
	row := (*full.ResourceChangeRecords)[0]
	if row.CurrentDelta != 300 || row.MaxDelta != 300 || row.CurrentBefore != 500 || row.MaxBefore != 1500 || row.Contributors[0].UseRef != "skill:cast_once" || row.HealthOrder >= full.DamageRecords[0]["healthOrder"].(uint64) {
		t.Fatal(row, full.DamageRecords)
	}
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		for _, budget := range []int{0, 1} {
			r := run
			r.OutputMode = mode
			r.RecordBudget = &model.RecordBudget{MaxResourceChangeRecords: &budget}
			done := authoringRun(t, input, r)
			if !reflect.DeepEqual(full.Summary, done.Summary) || !reflect.DeepEqual(full.ResourceChangeSummary, done.ResourceChangeSummary) || !reflect.DeepEqual(full.FinalSnapshot, done.FinalSnapshot) {
				t.Fatal("retention changed battle", mode, budget)
			}
			want := budget
			if mode == model.RunOutputSummary {
				want = 0
			}
			if len(*done.ResourceChangeRecords) != want || *done.Recording.ReturnedResourceChangeRecords != want || *done.Recording.ResourceChangeRecordsTruncated != (budget == 0) {
				t.Fatal(done.Recording)
			}
		}
	}
	if os.Getenv("DAMAGE_NASUS_DUMP") == "1" {
		dir := filepath.Join("..", "..", "target", "nasus-mechanisms-2026-10-19", "native-v1", "fixtures")
		if configured := os.Getenv("DAMAGE_NASUS_DUMP_DIR"); configured != "" {
			dir = configured
		}
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for _, item := range []struct {
			name  string
			value interface{}
		}{{"compile", input}, {"request", run}, {"done", full}} {
			raw, err := json.MarshalIndent(item.value, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "resource-"+item.name+".json"), raw, 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestResourceMaxNetBatchesReadsAndWholeFrameRollback(t *testing.T) {
	for _, separated := range []bool{false, true} {
		input, run := resourceMaxInput(t, 900, 1000, false)
		state := frameCommitState(t, input, run)
		applyHealthWindow(t, state)
		ref := state.combatants["source"].providers[len(state.combatants["source"].providers)-1].ProviderRef
		var frame executionFrame
		state.initExecutionFrame(&frame, "source", "target", "net_batch")
		op := plan.CompiledOperation{Operation: "expire_provider", Target: "self", ProviderRef: ref}
		if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op}); err != nil {
			t.Fatal(err)
		}
		if separated {
			_ = frame.evalContext(plan.CompiledAbility{})
		}
		op = plan.CompiledOperation{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}
		if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{op}); err != nil {
			t.Fatal(err)
		}
		_ = frame.evalContext(plan.CompiledAbility{})
		want := 1200.0
		if separated {
			want = 1300
		}
		if got := frame.stageFor("source").attributes.At("hp").Current; got != want {
			t.Fatal(separated, got)
		}
		frame.commit()
		if frame.fatal {
			t.Fatal(frame.fatalErr)
		}
		count := 1
		if separated {
			count = 3
		}
		if state.resourceChangeSummary.ChangeCount != count {
			t.Fatal(separated, state.resourceChangeSummary)
		}
	}
	input, run := resourceMaxInput(t, 500, 1500, false)
	state := frameCommitState(t, input, run)
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "rollback")
	ops := []plan.CompiledOperation{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}, {Operation: "unavailable_after_flush", Target: "self"}}
	if err := frame.executeOperations(plan.CompiledAbility{}, ops); err == nil {
		t.Fatal("missing resource accepted")
	}
	frame.commit()
	if state.combatants["source"].attributes.At("hp").Current != 500 || state.resourceChangeSummary.ChangeCount != 0 || len(state.combatants["source"].providers) != 1 {
		t.Fatal("failed frame leaked resource state", state.resourceChangeSummary)
	}
}

func TestResourceMaxRefreshExpiryDeadAndRestore(t *testing.T) {
	for _, current := range []float64{0, 500, 1500} {
		input, run := resourceMaxInput(t, current, 1500, false)
		state := frameCommitState(t, input, run)
		applyHealthWindow(t, state)
		want := current
		if current > 0 {
			want += 300
		}
		if state.combatantHp("source") != want {
			t.Fatal(current, state.combatantHp("source"))
		}
		state.nowMs = 100
		applyHealthWindow(t, state)
		if state.combatantHp("source") != want || state.resourceChangeSummary.ChangeCount != 1 || len(state.combatants["source"].providers) != 2 {
			t.Fatal("refresh granted HP or appended instance")
		}
		state.nowMs = 15100
		state.settleLiveResourceExpiry()
		if want > 1500 {
			want = 1500
		}
		if state.combatantHp("source") != want || state.combatants["source"].attributes.At("hp").Max != 1500 || state.resourceChangeSummary.ChangeCount != 2 {
			t.Fatal(state.resourceChangeSummary, state.combatants["source"].attributes.At("hp"))
		}
		state.settleLiveResourceExpiry()
		if state.resourceChangeSummary.ChangeCount != 2 {
			t.Fatal("duplicate expiry")
		}
	}
	input, run := resourceMaxInput(t, 500, 1500, false)
	state := frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	run.InitialSnapshot = state.buildFinalSnapshot()
	if _, err := newGenericRunState(authoringCompile(t, input), run); err == nil {
		t.Fatal("active resource_max restored with a new anchor")
	}
	plain, plainRun := singleSkillInput(false)
	before := authoringRun(t, plain, plainRun)
	if before.ResourceChangeSummary != nil || before.ResourceChangeRecords != nil || before.Recording.ResourceChangeRecordCount != nil || before.HealingRecords != nil && len(before.HealingRecords) > 0 && before.HealingRecords[0].HealthOrder != nil {
		t.Fatal("new resource protocol leaked into old scene")
	}
}

func TestResourceMaxDamageSeparatedBatchesAndGearAnchor(t *testing.T) {
	input, run := resourceMaxInput(t, 900, 1000, false)
	gear := model.ProviderDefinition{ProviderKey: "fixed_health_gear", StableID: "fixed_health_gear", Kind: "item", Modifiers: []model.ModifierDefinition{{ModifierKey: "hp", Kind: "attribute", Target: "self.attr.hp", ValuePolicy: "add", Value: hitConst(500)}}}
	input.SharedProviders = append(input.SharedProviders, gear)
	input.Combatants[0].Providers = append(input.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "gear", DefinitionRef: gear.ProviderKey})
	run.InitialSnapshot.Combatants[0].Providers = append(run.InitialSnapshot.Combatants[0].Providers, model.CombatantProviderSnapshot{ProviderRef: "gear", DefinitionRef: gear.ProviderKey, Source: "source", Owner: "source", Stacks: 1})
	for _, attrs := range []map[string]model.AttributeSlotDef{input.Combatants[0].Attributes, run.InitialSnapshot.Combatants[0].Attributes} {
		hp := attrs["hp"]
		hp.Current = 500
		hp.Max = 1500
		hp.Resolved = 1500
		attrs["hp"] = hp
	}
	state := frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	if hp := state.combatants["source"].attributes.At("hp"); hp.Current != 800 || hp.Max != 1800 || hp.Base != 1000 {
		t.Fatal("static gear lost or double counted", hp)
	}
	input, run = resourceMaxInput(t, 900, 1000, false)
	state = frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	ref := state.combatants["source"].providers[1].ProviderRef
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "damage_separator")
	damage := state.compiled.Operations[state.compiled.Abilities[1].OperationStart].SkillHit.Candidates[0]
	damageOp := state.compiled.Operations[damage.OperationStart]
	damageOp.Target = "self"
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: ref}, damageOp, {Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}}); err != nil {
		t.Fatal(err)
	}
	frame.commit()
	if frame.fatal {
		t.Fatal(frame.fatalErr)
	}
	if hp := state.combatants["source"].attributes.At("hp"); hp.Current != 1200 || hp.Max != 1300 {
		t.Fatal(hp)
	}
	if state.resourceChangeSummary.ChangeCount != 3 || state.sourceHpLoss != 100 || state.resourceChangeSummary.Source.CurrentDecrease != 200 || state.resourceChangeSummary.Source.CurrentIncrease != 600 {
		t.Fatal(state.resourceChangeSummary, state.sourceHpLoss)
	}
	before, after := state.resourceChangeRecords[1], state.resourceChangeRecords[2]
	order := state.damageRecords[0]["healthOrder"].(uint64)
	if !(before.HealthOrder < order && order < after.HealthOrder) {
		t.Fatal(before, order, after)
	}
}

func TestResourceMaxQueueBudgetRollbackAfterVisibleFlush(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, false)
	state := frameCommitState(t, input, run)
	state.heap.SetLimit(state.heap.Len())
	var frame executionFrame
	state.initExecutionFrame(&frame, "source", "target", "queue_budget")
	if err := frame.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "health_window"}}); err != nil {
		t.Fatal(err)
	}
	_ = frame.evalContext(plan.CompiledAbility{})
	if frame.stageFor("source").attributes.At("hp").Current != 800 {
		t.Fatal("no real staged grant")
	}
	frame.commit()
	if !frame.fatal || state.combatantHp("source") != 500 || state.resourceChangeSummary.ChangeCount != 0 || len(state.combatants["source"].providers) != 1 {
		t.Fatal("preflight budget leaked staged maximum", frame.fatalErr, state.resourceChangeSummary)
	}
}

func TestResourceMaxRefreshWithoutNewUseRetainsKnownOrigin(t *testing.T) {
	input, run := resourceMaxInput(t, 500, 1500, false)
	state := frameCommitState(t, input, run)
	applyHealthWindow(t, state)
	ref := state.combatants["source"].providers[1].ProviderRef
	state.nowMs = 100
	var refresh executionFrame
	state.initExecutionFrame(&refresh, "source", "target", "unattributed_refresh")
	if err := refresh.executeOperations(plan.CompiledAbility{}, []plan.CompiledOperation{{Operation: "refresh_provider", Target: "self", ProviderRef: ref}}); err != nil {
		t.Fatal(err)
	}
	refresh.commit()
	if refresh.fatal {
		t.Fatal(refresh.fatalErr)
	}
	state.nowMs = 15100
	state.settleLiveResourceExpiry()
	row := state.resourceChangeRecords[1]
	if len(row.Contributors) != 1 || row.Contributors[0].UseRef != "actual_health_use" || row.Contributors[0].Reason != "expire" {
		t.Fatal(row)
	}
}
