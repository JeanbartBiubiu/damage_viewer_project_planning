package execution

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/model"
)

const attributeOwnershipEvent = "event/attribute_ownership_probe"

// 对照持有独立页，避免生产代码误写共享页时，实际值与预期值一起变化。
func independentAttributeTable(t attribute.Table) attribute.Table {
	return attribute.FromMap(t.ToMap(), t.Layout())
}

func attributeOwnershipEmit() model.OperationDefinition {
	return model.OperationDefinition{Operation: "emit_event", Target: "target", EventType: attributeOwnershipEvent, Ref: attributeOwnershipEvent}
}

func attributeOwnershipChange() model.OperationDefinition {
	return model.OperationDefinition{Operation: "attribute_change", Target: "source", AttributeKey: "attack_damage", ValuePolicy: "add", Amount: authoringAmount(authoringConst(25))}
}

func attributeOwnershipState(t *testing.T, targetHP float64, ops ...model.OperationDefinition) *Engine {
	t.Helper()
	c, r := frameCommitInput(ops...)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: attributeOwnershipEvent, Domain: "event"})
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 500})
	setCombatantAttr(&c, &r, "source", "attack_damage", model.AttributeSlotDef{Base: 100, Current: 100, Max: 1000, Resolved: 100})
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: targetHP, Max: 1000, Resolved: targetHP})
	compiled := authoringCompile(t, c)
	r.ExpectedRulesHash = compiled.RulesHash
	state, err := newGenericRunState(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func attributeOwnershipFrozenCopy(snapshot eventFormulaSnapshot) eventFormulaSnapshot {
	return eventFormulaSnapshot{
		EntrySourceAttrs: independentAttributeTable(snapshot.EntrySourceAttrs),
		EntryTargetAttrs: independentAttributeTable(snapshot.EntryTargetAttrs),
		SourceAttrs:      independentAttributeTable(snapshot.SourceAttrs),
		TargetAttrs:      independentAttributeTable(snapshot.TargetAttrs),
	}
}

func assertAttributeOwnershipSnapshot(t *testing.T, label string, got, want eventFormulaSnapshot) {
	t.Helper()
	for _, item := range []struct {
		name string
		got  attribute.Table
		want attribute.Table
	}{
		{"entrySource", got.EntrySourceAttrs, want.EntrySourceAttrs},
		{"entryTarget", got.EntryTargetAttrs, want.EntryTargetAttrs},
		{"source", got.SourceAttrs, want.SourceAttrs},
		{"target", got.TargetAttrs, want.TargetAttrs},
	} {
		if !reflect.DeepEqual(item.got, item.want) {
			t.Fatalf("%s.%s changed: got %+v want %+v", label, item.name, item.got, item.want)
		}
	}
}

func TestAttributeOwnershipEntryAndEmitSurviveLaterOperationsAndNextFrame(t *testing.T) {
	state := attributeOwnershipState(t, 1000, frameCommitDamage(100), attributeOwnershipEmit(), attributeOwnershipChange(), frameCommitDamage(50))
	frame, ability, ops := frameCommitFrame(state)
	entrySource := independentAttributeTable(frame.entrySourceAttrs)
	entryTarget := independentAttributeTable(frame.entryTargetAttrs)
	if err := frame.executeOperations(ability, ops[:2]); err != nil {
		t.Fatal(err)
	}
	if len(frame.pendingEvents) != 1 {
		t.Fatalf("emitted events=%d want 1", len(frame.pendingEvents))
	}
	snapshot := frame.pendingEvents[0].snapshot
	cloned := cloneEventSnapshot(&snapshot)
	want := attributeOwnershipFrozenCopy(snapshot)
	if snapshot.EntryTargetAttrs.At("hp").Current != 1000 || snapshot.TargetAttrs.At("hp").Current != 900 || snapshot.SourceAttrs.At("attack_damage").Resolved != 100 {
		t.Fatalf("wrong entry/emit values: %+v", snapshot)
	}
	if err := frame.executeOperations(ability, ops[2:]); err != nil {
		t.Fatal(err)
	}
	if state.combatantHp("target") != 1000 || state.combatants["source"].attributesView().At("attack_damage").Resolved != 100 {
		t.Fatal("uncommitted operations changed live attributes")
	}
	if frame.stageFor("target").attributesView().At("hp").Current != 850 || frame.stageFor("source").attributesView().At("attack_damage").Resolved != 125 {
		t.Fatal("operations did not change the staged combatants")
	}
	if !reflect.DeepEqual(frame.entrySourceAttrs, entrySource) || !reflect.DeepEqual(frame.entryTargetAttrs, entryTarget) {
		t.Fatal("later operations changed frame entry attributes")
	}
	assertAttributeOwnershipSnapshot(t, "emit before commit", frame.pendingEvents[0].snapshot, want)
	assertAttributeOwnershipSnapshot(t, "cloned emit before commit", *cloned, want)
	frame.commit()
	if frame.fatal || !frame.committed || state.combatantHp("target") != 850 {
		t.Fatal(frame.fatalErr, frame.committed, state.combatantHp("target"))
	}
	assertAttributeOwnershipSnapshot(t, "emit after commit", snapshot, want)
	assertAttributeOwnershipSnapshot(t, "cloned emit after commit", *cloned, want)
	// 保存刚提交的表，模拟下一帧和事件视图仍持有该版本。
	publishedSource := state.combatants["source"].attributesView()
	publishedTarget := state.combatants["target"].attributesView()
	wantPublishedSource, wantPublishedTarget := independentAttributeTable(publishedSource), independentAttributeTable(publishedTarget)
	next, nextAbility, nextOps := frameCommitFrame(state)
	if err := next.executeOperations(nextAbility, nextOps); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(publishedSource, wantPublishedSource) || !reflect.DeepEqual(publishedTarget, wantPublishedTarget) || state.combatantHp("target") != 850 {
		t.Fatal("next frame changed the previously published version")
	}
	next.commit()
	if next.fatal || !next.committed || state.combatantHp("target") != 700 || state.combatants["source"].attributesView().At("attack_damage").Resolved != 150 {
		t.Fatal(next.fatalErr, state.combatants)
	}
	assertAttributeOwnershipSnapshot(t, "emit after next frame", snapshot, want)
	assertAttributeOwnershipSnapshot(t, "cloned emit after next frame", *cloned, want)
	if !reflect.DeepEqual(publishedSource, wantPublishedSource) || !reflect.DeepEqual(publishedTarget, wantPublishedTarget) {
		t.Fatal("next commit changed a previously published version")
	}
}

func TestAttributeOwnershipFailedFrameKeepsLiveStateAndEmittedViews(t *testing.T) {
	heal := model.OperationDefinition{Operation: "heal", Target: "source", Amount: authoringAmount(authoringConst(100))}
	state := attributeOwnershipState(t, 1000, attributeOwnershipEmit(), frameCommitDamage(100), heal, attributeOwnershipChange(), frameCommitDamage(50))
	state.budget.MaxCommandsPerEvent = 4
	liveSource, liveTarget := state.combatants["source"].attributesView(), state.combatants["target"].attributesView()
	wantSource, wantTarget := independentAttributeTable(liveSource), independentAttributeTable(liveTarget)
	frame, ability, ops := frameCommitFrame(state)
	if err := frame.executeOperations(ability, ops[:1]); err != nil {
		t.Fatal(err)
	}
	snapshot := frame.pendingEvents[0].snapshot
	cloned := cloneEventSnapshot(&snapshot)
	want := attributeOwnershipFrozenCopy(snapshot)
	err := frame.executeOperations(ability, ops[1:])
	if err == nil || err.BudgetCause != model.BudgetCauseMaxCommandsPerEvent {
		t.Fatalf("expected a failure after damage, healing and attribute change: %v", err)
	}
	if frame.stageFor("target").attributesView().At("hp").Current != 900 || frame.stageFor("source").attributesView().At("hp").Current != 600 || frame.stageFor("source").attributesView().At("attack_damage").Resolved != 125 {
		t.Fatal("failure did not occur after the intended staged writes")
	}
	frame.commit()
	if frame.committed || !reflect.DeepEqual(state.combatants["source"].attributesView(), wantSource) || !reflect.DeepEqual(state.combatants["target"].attributesView(), wantTarget) {
		t.Fatal("failed frame published attribute changes")
	}
	if !reflect.DeepEqual(liveSource, wantSource) || !reflect.DeepEqual(liveTarget, wantTarget) {
		t.Fatal("failed frame changed an already borrowed live view")
	}
	assertAttributeOwnershipSnapshot(t, "failed frame emit", snapshot, want)
	assertAttributeOwnershipSnapshot(t, "failed frame cloned emit", *cloned, want)
}

func TestAttributeOwnershipHealingAndExecutePreserveFrozenViews(t *testing.T) {
	for _, test := range []struct {
		name string
		op   model.OperationDefinition
		want float64
	}{
		{"heal", model.OperationDefinition{Operation: "heal", Target: "target", Amount: authoringAmount(authoringConst(100))}, 130},
		{"execute", model.OperationDefinition{Operation: model.OperationKindExecuteThreshold, Target: "target", Threshold: .05, Ref: "execute"}, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := attributeOwnershipState(t, 30, test.op)
			frame, ability, ops := frameCommitFrame(state)
			snapshot := frame.captureEmitSnapshot(eventTypeBasicAttackHit, "source", "target")
			cloned := cloneEventSnapshot(&snapshot)
			frame.eventCtx = cloned
			want := attributeOwnershipFrozenCopy(snapshot)
			liveTarget := state.combatants["target"].attributesView()
			wantLiveTarget := independentAttributeTable(liveTarget)
			if err := frame.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
			if frame.stageFor("target").attributesView().At("hp").Current != test.want || state.combatantHp("target") != 30 {
				t.Fatal("HP write did not remain in the staged combatant")
			}
			assertAttributeOwnershipSnapshot(t, "before commit", snapshot, want)
			assertAttributeOwnershipSnapshot(t, "cloned before commit", *cloned, want)
			frame.commit()
			if frame.fatal || !frame.committed || state.combatantHp("target") != test.want {
				t.Fatal(frame.fatalErr, state.combatantHp("target"))
			}
			if !reflect.DeepEqual(liveTarget, wantLiveTarget) {
				t.Fatal("HP settlement changed the old live attribute version")
			}
			assertAttributeOwnershipSnapshot(t, "after commit", snapshot, want)
			assertAttributeOwnershipSnapshot(t, "cloned after commit", *cloned, want)
		})
	}
}

func TestAttributeOwnershipPhantomDamageKeepsOriginalAndCurrentEventViews(t *testing.T) {
	damage := frameCommitDamage(100)
	damage.CopyableOnHit = true
	state := attributeOwnershipState(t, 1000, damage, attributeOwnershipChange())
	frame, ability, ops := frameCommitFrame(state)
	collector := newTestCopyableCollector(collectorTestSeed{})
	frame.copyableCollector = collector
	snapshot := frame.captureEmitSnapshot(eventTypeBasicAttackHit, "source", "target")
	frame.eventCtx = cloneEventSnapshot(&snapshot)
	want := attributeOwnershipFrozenCopy(snapshot)
	if err := frame.executeOperations(ability, ops); err != nil {
		t.Fatal(err)
	}
	if collector.Counts() != 0 {
		t.Fatal("copyable damage published before the real frame commit")
	}

	frame.commit()
	frozenDamages, _ := collector.CloneSorted()
	if len(frozenDamages) != 1 {
		t.Fatalf("committed copyable damage=%d want 1", len(frozenDamages))
	}
	frozenDamage := frozenDamages[0]
	if frame.fatal || !frame.committed || state.combatantHp("target") != 900 {
		t.Fatal(frame.fatalErr, state.combatantHp("target"))
	}
	observer := state.newExecutionFrame("source", "target", "observe")
	currentSnapshot := observer.captureEmitSnapshot(attributeOwnershipEvent, "source", "target")
	wantCurrent := attributeOwnershipFrozenCopy(currentSnapshot)
	publishedTarget := state.combatants["target"].attributesView()
	wantPublishedTarget := independentAttributeTable(publishedTarget)
	if err := state.applyPhantomCopyableDamage(collector, frozenDamage, "ownership"); err != nil {
		t.Fatal(err)
	}
	if state.combatantHp("target") != 800 || state.combatants["source"].attributesView().At("attack_damage").Resolved != 125 || state.report.Totals().SourceDamageDealt != 200 {
		t.Fatal("phantom did not apply to current live state", state.combatants, state.report.Totals().SourceDamageDealt)
	}
	if !reflect.DeepEqual(publishedTarget, wantPublishedTarget) {
		t.Fatal("phantom mutated the target table published by the original damage")
	}
	assertAttributeOwnershipSnapshot(t, "original emit after phantom", snapshot, want)
	assertAttributeOwnershipSnapshot(t, "frozen damage event after phantom", *frozenDamage.EventCtx, want)
	assertAttributeOwnershipSnapshot(t, "current observer after phantom", currentSnapshot, wantCurrent)
	if frozenDamage.EntryTargetAttrs.At("hp").Current != 1000 || currentSnapshot.TargetAttrs.At("hp").Current != 900 {
		t.Fatal("phantom changed its original or current frozen view")
	}
}
