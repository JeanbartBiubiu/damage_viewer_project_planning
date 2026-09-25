package runtime

import (
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func phantomHealthModifier(comparator string, threshold float64, firstPerCast bool) model.ModifierDefinition {
	mod := healthGateModifier(comparator, threshold)
	mod.Channel = "all_damage"
	mod.Condition = &model.GenericFormulaExpr{Op: "min", Args: []model.GenericFormulaExpr{
		*mod.Condition, {Op: "read", Path: "damage.type.magic"},
	}}
	if firstPerCast {
		mod.Bucket = "first_per_cast"
	}
	return mod
}

func phantomHealthFixture(t *testing.T, hp float64, delayMs, repeatCount int,
	mod model.ModifierDefinition, critEligible bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	copyable := guinsooKCopyableListener("copyable_magic", 100, true)
	copyable.Operations[0].CritEligible = critEligible
	listeners := []model.ListenerDefinition{copyable}
	for i := 0; i < repeatCount; i++ {
		repeat := guinsooKRepeatListener("copy_" + itoaRuntime(i))
		repeat.Operations[0].Threshold = 1
		repeat.Operations[0].RepeatDelayMs = delayMs
		listeners = append(listeners, repeat)
	}
	c, r := loadGuinsooKFixture(t, listeners, nil, 1)
	setCombatantAttr(&c, &r, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: hp, Max: 1000, Resolved: hp,
	})
	setCombatantAttr(&c, &r, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 100, Current: 100, Max: 100, Resolved: 100,
	})
	mountPipelineProvider(&c, &r, model.SelectorSource, "item:phantom_health", "phantom_health", mod)
	if critEligible {
		setCombatantAttr(&c, &r, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
			Base: 0.5, Current: 0.5, Max: 1, Resolved: 0.5,
		})
		setCombatantAttr(&c, &r, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
			Base: 2, Current: 2, Max: 4, Resolved: 2,
		})
	}
	r.StopPolicy.DurationMs = int64(delayMs + 50)
	return c, r
}

func phantomMagicDamageItems(t *testing.T, done model.DoneResult) (original model.EvidenceItem, copies []model.EvidenceItem) {
	t.Helper()
	originalCount := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "damageType") != "damage/magic" {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			copies = append(copies, item)
		} else {
			original, originalCount = item, originalCount+1
		}
	}
	if originalCount != 1 {
		t.Fatalf("original magic damage count=%d want 1", originalCount)
	}
	return original, copies
}

func assertPhantomAmount(t *testing.T, item model.EvidenceItem, raw, mitigated float64) {
	t.Helper()
	if got := evidenceDataFloat(item.Data, "rawAmount"); math.Abs(got-raw) > 1e-9 {
		t.Fatalf("rawAmount=%v want %v: %+v", got, raw, item.Data)
	}
	if got := evidenceDataFloat(item.Data, "mitigatedAmount"); math.Abs(got-mitigated) > 1e-9 {
		t.Fatalf("mitigatedAmount=%v want %v: %+v", got, mitigated, item.Data)
	}
}

func TestPhantomDamageResamplesHealthGateAfterOriginalCrossesThreshold(t *testing.T) {
	for _, delay := range []int{0, 200} {
		t.Run(itoaRuntime(delay), func(t *testing.T) {
			c, r := phantomHealthFixture(t, 620, delay, 1, phantomHealthModifier("gt", .6, false), false)
			done := runGuinsooK(t, c, r)
			original, copies := phantomMagicDamageItems(t, done)
			if len(copies) != 1 {
				t.Fatalf("copies=%d want 1", len(copies))
			}
			assertPhantomAmount(t, original, 108, 54)
			assertPhantomAmount(t, copies[0], 100, 50)
			if len(damageEvidenceModifiers(original.Data)) != 1 || len(damageEvidenceModifiers(copies[0].Data)) != 0 {
				t.Fatalf("original/copy modifiers=%v/%v", damageEvidenceModifiers(original.Data), damageEvidenceModifiers(copies[0].Data))
			}
			if math.Abs(done.Summary.TargetFinalHp-506) > 1e-9 {
				t.Fatalf("target HP=%v want 506 (no stale frame overwrite)", done.Summary.TargetFinalHp)
			}
			if emittedOnHitCount(done) != 1 || done.Summary.AbilityCastCount != 1 {
				t.Fatalf("copy must not emit/listen/cast again: events=%d casts=%d", emittedOnHitCount(done), done.Summary.AbilityCastCount)
			}
			if hasWarningCode(done.Warnings, "pending_continuations_not_in_snapshot") != nil {
				t.Fatal("completed continuation must not warn")
			}
		})
	}
}

func TestPhantomFirstPerCastSharesOriginalAndCopyConsumption(t *testing.T) {
	for _, tc := range []struct {
		name        string
		hp          float64
		originalRaw float64
		copyRaw     []float64
	}{
		{"original_qualifies", 390, 108, []float64{100, 100}},
		{"copy_first_qualifies", 440, 100, []float64{108, 100}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, r := phantomHealthFixture(t, tc.hp, 200, 2, phantomHealthModifier("lt", .4, true), false)
			// The original and both delayed copies remain in this single Run.
			r.StopPolicy.DurationMs = 250
			done := runGuinsooK(t, c, r)
			original, copies := phantomMagicDamageItems(t, done)
			if len(copies) != 2 {
				t.Fatalf("copies=%d want 2", len(copies))
			}
			assertPhantomAmount(t, original, tc.originalRaw, tc.originalRaw/2)
			for i, copy := range copies {
				assertPhantomAmount(t, copy, tc.copyRaw[i], tc.copyRaw[i]/2)
			}
			applied := len(damageEvidenceModifiers(original.Data))
			for _, copy := range copies {
				applied += len(damageEvidenceModifiers(copy.Data))
			}
			if applied != 1 {
				t.Fatalf("first_per_cast applications=%d want 1", applied)
			}
		})
	}
}

func TestPhantomRetainsCritBranchAndAppliesIncomingCritPartWithoutRecrit(t *testing.T) {
	c, r := phantomHealthFixture(t, 620, 200, 1, phantomHealthModifier("gt", .6, false), true)
	// 暴击乘区只在原笔结算一次；复制保留冻结的暴击结果，但不把该修正列为本笔 modifiers。
	mountPipelineProvider(&c, &r, model.SelectorSource, "item:frozen_crit", "frozen_crit",
		c2PipelineMod("frozen_crit_chance", "crit", "all_damage", "crit_chance_pre_settlement", "override", .5, 0))
	critPart := model.ModifierDefinition{
		ModifierKey: "copy_crit_part", Kind: "pipeline", Command: "damage", Channel: "all_damage",
		Stage: "incoming_crit_part_post_mitigation", Bucket: "all_instances", ValuePolicy: "multiply",
		Value:     model.GenericFormulaExpr{Op: "const", Value: pipeFloat(.5)},
		Condition: &model.GenericFormulaExpr{Op: "read", Path: "damage.type.magic"},
	}
	mountPipelineProvider(&c, &r, model.SelectorTarget, "item:copy_crit_part", "copy_crit_part", critPart)
	done := runGuinsooK(t, c, r)
	original, copies := phantomMagicDamageItems(t, done)
	if len(copies) != 1 {
		t.Fatalf("copies=%d want 1", len(copies))
	}
	assertPhantomAmount(t, original, 162, 54)
	assertPhantomAmount(t, copies[0], 150, 50)
	if evidenceDataFloat(original.Data, "critAdjustedRawAmount") != 150 || evidenceDataFloat(copies[0].Data, "critAdjustedRawAmount") != 150 {
		t.Fatalf("crit branch was recomputed: original=%v copy=%v", original.Data, copies[0].Data)
	}
	if len(damageEvidenceModifiers(original.Data)) != 3 || len(damageEvidenceModifiers(copies[0].Data)) != 1 {
		t.Fatalf("modifier evidence original/copy=%v/%v", damageEvidenceModifiers(original.Data), damageEvidenceModifiers(copies[0].Data))
	}
	if got := modifiersByStage(original.Data, "crit_chance_pre_settlement"); len(got) != 1 || got[0]["modifierKey"] != "frozen_crit_chance" {
		t.Fatalf("original crit modifier=%v", got)
	}
	if got := modifiersByStage(copies[0].Data, "crit_chance_pre_settlement"); len(got) != 0 {
		t.Fatalf("copy incorrectly reports frozen original crit modifier: %v", got)
	}
	if got := modifiersByStage(copies[0].Data, "incoming_crit_part_post_mitigation"); len(got) != 1 || got[0]["modifierKey"] != "copy_crit_part" {
		t.Fatalf("copy must report its own incoming damage modifier: %v", got)
	}
}

func TestPendingDelayedCopiesWarnThatSnapshotCannotRestoreThem(t *testing.T) {
	c, r := phantomHealthFixture(t, 620, 200, 2, phantomHealthModifier("gt", .6, false), false)
	r.StopPolicy.DurationMs = 100
	done := runGuinsooK(t, c, r)
	if phantomDamageEvidenceCount(done) != 0 {
		t.Fatal("delayed copies ran before continuation")
	}
	w := hasWarningCode(done.Warnings, "pending_continuations_not_in_snapshot")
	if w == nil || w.Count != 2 || done.Summary.WarningCount < 1 {
		t.Fatalf("warning=%+v count=%d", w, done.Summary.WarningCount)
	}
	if !strings.Contains(w.Message, "omits 2 pending delayed damage copies") || !strings.Contains(w.Message, "restoring it will not replay them") {
		t.Fatalf("warning message=%q", w.Message)
	}
}
