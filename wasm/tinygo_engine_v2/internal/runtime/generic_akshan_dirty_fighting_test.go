package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_akshan P Dirty Fighting / 无所不用 (generic ABI, actionable 1v1 basic-attack branch).
//
// Numeric authority (archived League Wiki only; no screenshots/OCR):
//   - Template:Data Akshan/Dirty Fighting revision 4038197
//     SHA256 22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534
//   - 数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json (akshan-p)
//   - 数据参考/lol-wiki-current-champions/raw/akshan-p.wikitext
//
// Closed core on ability/basic_attack (exact op order):
//   1. normal physical basic-attack damage
//   2. add one per-target dirty_fighting_stacks
//   3. when stacks == 3, exactly one magic proc
//   4. when stacks == 3, reset stacks to 0
//   5. exactly one event/basic_attack_hit
//
// State: provider-target dirty_fighting_stacks, default 0, max 3, duration 5000 ms,
// refresh_on_write.
//
// Raw magic proc (independent of Wiki presentation rounding):
//   15 + 25*gte(level,6) + 40*gte(level,11) + 70*gte(level,16) + 0.60*AP
//   ≡ Wiki pp 15;40;80;150 @ 1;6;11;16 + 60% AP
//
// Explicit non-goals: passive second shot (blocked_data: delay ms unknown), stacks from
// ability hits, champion shield, cancel MS, retargeting, minion ratio, multi-target,
// legacy single_attacker_dps, production runtime/ABI/fixture changes.

const (
	akshanDFProviderRef = "hero:akshan_dirty_fighting"
	akshanDFStableID    = "hero_akshan_dirty_fighting"
	akshanDFAbilityKey  = "basic_attack"
	akshanDFStacksKey   = "dirty_fighting_stacks"
	akshanDFAAOpRef     = "op:aa"
	akshanDFProcOpRef   = "op:akshan_df_proc"
	akshanDFHitEvent    = "event/basic_attack_hit"
	akshanDFLevelAttr   = "champion_level"

	akshanDFMaxStacks  = 3.0
	akshanDFDurationMs = 5000.0
	akshanDFAADamage   = 100.0
	akshanDFDefaultHP  = 100000.0
	akshanDFAPRatio    = 0.60
	akshanDFTol        = 1e-9
	akshanDFTolExact   = 1e-12
)

// Independent expected-value helpers (must not re-walk the model formula AST).

func akshanDFGte(level, threshold float64) float64 {
	if level >= threshold {
		return 1
	}
	return 0
}

func akshanDFProcRaw(level, ap float64) float64 {
	return 15 +
		25*akshanDFGte(level, 6) +
		40*akshanDFGte(level, 11) +
		70*akshanDFGte(level, 16) +
		akshanDFAPRatio*ap
}

func akshanDFTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func akshanDFStateSchema() map[string]interface{} {
	return map[string]interface{}{
		akshanDFStacksKey: akshanDFTimedSlot(0, akshanDFMaxStacks, akshanDFDurationMs),
	}
}

func akshanDFAtThreeStacksCond() *model.GenericFormulaExpr {
	three := akshanDFMaxStacks
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + akshanDFStacksKey},
			{Op: "const", Value: &three},
		},
	}
}

func akshanDFProcAmount() *model.GenericFormulaExpr {
	base := 15.0
	t6 := 25.0
	t11 := 40.0
	t16 := 70.0
	apRatio := akshanDFAPRatio
	lvl6 := 6.0
	lvl11 := 11.0
	lvl16 := 16.0
	levelPath := "source.attr." + akshanDFLevelAttr + ".resolved"
	apPath := "source.attr.ap.resolved"
	// Nested binary add only: formula compile consumes exactly args[0]/args[1].
	term6 := model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &t6},
			{Op: "gte", Args: []model.GenericFormulaExpr{
				{Op: "read", Path: levelPath},
				{Op: "const", Value: &lvl6},
			}},
		},
	}
	term11 := model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &t11},
			{Op: "gte", Args: []model.GenericFormulaExpr{
				{Op: "read", Path: levelPath},
				{Op: "const", Value: &lvl11},
			}},
		},
	}
	term16 := model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &t16},
			{Op: "gte", Args: []model.GenericFormulaExpr{
				{Op: "read", Path: levelPath},
				{Op: "const", Value: &lvl16},
			}},
		},
	}
	termAP := model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &apRatio},
			{Op: "read", Path: apPath},
		},
	}
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{
								Op:   "add",
								Args: []model.GenericFormulaExpr{{Op: "const", Value: &base}, term6},
							},
							term11,
						},
					},
					term16,
				},
			},
			termAP,
		},
	}
}

func akshanDFBasicAttackOps() []model.OperationDefinition {
	one := 1.0
	zero := 0.0
	aa := akshanDFAADamage
	atThree := akshanDFAtThreeStacksCond()
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        akshanDFAAOpRef,
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         akshanDFStacksKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/magic",
			Ref:           akshanDFProcOpRef,
			CopyableOnHit: false,
			Condition:     atThree,
			Amount:        akshanDFProcAmount(),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         akshanDFStacksKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
			Condition:   atThree,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: akshanDFHitEvent,
			Ref:       akshanDFHitEvent,
		},
	}
}

func ensureAkshanDFTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: akshanDFHitEvent, Domain: "event"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func configureAkshanDFProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        akshanDFProviderRef,
		Kind:               "champion",
		StableID:           akshanDFStableID,
		InitialStateSchema: akshanDFStateSchema(),
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: akshanDFAbilityKey,
				Kind:       "active",
				Types:      []string{"ability/basic_attack"},
				Operations: akshanDFBasicAttackOps(),
			},
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: akshanDFProviderRef, DefinitionRef: akshanDFProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: akshanDFProviderRef, DefinitionRef: akshanDFProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func akshanDFAbilityRef() string {
	return "source.provider[" + akshanDFProviderRef + "].ability[" + akshanDFAbilityKey + "]"
}

type akshanDFFixtureOpts struct {
	level float64
	ap    float64
	hp    float64
	armor float64
	mr    float64
}

func loadAkshanDFFixture(t *testing.T, opts akshanDFFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.level < 1 {
		opts.level = 1
	}
	if opts.hp <= 0 {
		opts.hp = akshanDFDefaultHP
	}
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.akshan_dirty_fighting"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureAkshanDFTypes(&compileReq)
	configureAkshanDFProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, akshanDFLevelAttr, model.AttributeSlotDef{
		Base: opts.level, Current: opts.level, Max: opts.level, Resolved: opts.level,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.ap, Current: opts.ap, Max: opts.ap, Resolved: opts.ap,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setAkshanDFDriverHits(runReq *model.RunRequest, atMs []int64) {
	ref := akshanDFAbilityRef()
	entries := make([]model.DriverEntry, 0, len(atMs))
	for i, at := range atMs {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "akshan_df_aa_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  at,
		})
	}
	runReq.DriverPlan.Entries = entries
	last := int64(0)
	for _, at := range atMs {
		if at > last {
			last = at
		}
	}
	runReq.StopPolicy.DurationMs = last + 100
}

// runAkshanDirtyFighting exercises the canonical Session frame lifecycle:
// CompileFrame → registered session → RunFrame(sessionId, expectedRulesHash) → ReleaseSessionFrame.
func runAkshanDirtyFighting(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	prepareNativeBasicAttackHits(&compileReq, &runReq)
	session := NewSession()
	session.ClearOutbox()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, compileReq)); code != 0 {
		t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}

	entry, ok := session.genericSessions[compiled.SessionID]
	if !ok {
		t.Fatal("compiled session not registered")
	}
	var fieldOK bool
	for _, p := range entry.compiled.Providers {
		if p.ProviderKey != akshanDFProviderRef {
			continue
		}
		field, ok := p.StateFields[akshanDFStacksKey]
		if !ok {
			t.Fatal("dirty_fighting_stacks state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != akshanDFMaxStacks || field.DurationMs != int64(akshanDFDurationMs) {
			t.Fatalf("compiled stacks field=%+v want max=3 durationMs=5000", field)
		}
		if field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("refreshPolicy=%q want %q", field.RefreshPolicy, model.ProviderStateRefreshOnWrite)
		}
		if math.Abs(field.DefaultValue) > akshanDFTolExact {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		fieldOK = true
		break
	}
	if !fieldOK {
		t.Fatal("akshan dirty fighting provider missing from compiled session")
	}

	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != 0 {
		t.Fatalf("RunFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}

	session.ClearOutbox()
	releaseReq := model.ReleaseSessionRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v want ok released session %q", released, compiled.SessionID)
	}
	return done
}

func akshanDFStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[akshanDFProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		ts, ok := bag["targetState"].(map[string]interface{})
		if !ok {
			return 0
		}
		values, ok := ts["values"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := values[akshanDFStacksKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func akshanDFDamageByOp(done model.DoneResult, opRef string) (count int, rawSum, mitSum float64, items []model.EvidenceItem) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != opRef {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		count++
		rawSum += evidenceDataFloat(item.Data, "rawAmount")
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
		items = append(items, item)
	}
	return count, rawSum, mitSum, items
}

func akshanDFHitTimeline(done model.DoneResult) []string {
	out := make([]string, 0, len(done.Evidence.Items))
	for _, item := range done.Evidence.Items {
		switch item.Kind {
		case model.EvidenceKindDamage:
			out = append(out, "damage:"+evidenceDataString(item.Data, "operationRef"))
		case model.EvidenceKindEmittedEvent:
			out = append(out, "event:"+item.Ref)
		}
	}
	return out
}

// TestAkshanDirtyFightingLevelThresholdCrossCheck: independent formula at Wiki thresholds/boundaries.
func TestAkshanDirtyFightingLevelThresholdCrossCheck(t *testing.T) {
	cases := []struct {
		level float64
		want  float64
	}{
		{1, 15},
		{5, 15},
		{6, 40},
		{10, 40},
		{11, 80},
		{15, 80},
		{16, 150},
		{18, 150},
	}
	for _, tc := range cases {
		got := akshanDFProcRaw(tc.level, 0)
		if math.Abs(got-tc.want) > akshanDFTolExact {
			t.Fatalf("procRaw(level=%v, ap=0)=%v want %v", tc.level, got, tc.want)
		}
	}
	// Wiki equivalence: 15;40;80;150 at 1;6;11;16.
	if math.Abs(akshanDFProcRaw(1, 0)-15) > akshanDFTolExact ||
		math.Abs(akshanDFProcRaw(6, 0)-40) > akshanDFTolExact ||
		math.Abs(akshanDFProcRaw(11, 0)-80) > akshanDFTolExact ||
		math.Abs(akshanDFProcRaw(16, 0)-150) > akshanDFTolExact {
		t.Fatal("wiki pp equivalence failed")
	}
	const ap = 100.0
	wantAP := 15 + akshanDFAPRatio*ap
	if math.Abs(akshanDFProcRaw(1, ap)-wantAP) > akshanDFTolExact {
		t.Fatalf("ap scaling raw=%v want %v", akshanDFProcRaw(1, ap), wantAP)
	}
}

// TestAkshanDirtyFightingProviderTargetSchemaCompiled: max 3 / 5000 ms / refresh_on_write via Session compile.
func TestAkshanDirtyFightingProviderTargetSchemaCompiled(t *testing.T) {
	compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: 1})
	setAkshanDFDriverHits(&runReq, []int64{0})
	_ = runAkshanDirtyFighting(t, compileReq, runReq)
}

// TestAkshanDirtyFightingHits1To4StackProcReset: hits 1-2 no proc; hit 3 one proc+reset; hit 4 leaves stack 1.
func TestAkshanDirtyFightingHits1To4StackProcReset(t *testing.T) {
	const level = 1.0
	compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: level})
	setAkshanDFDriverHits(&runReq, []int64{0, 100, 200, 300})
	done := runAkshanDirtyFighting(t, compileReq, runReq)

	nProc, rawProc, _, procItems := akshanDFDamageByOp(done, akshanDFProcOpRef)
	if nProc != 1 {
		t.Fatalf("proc count=%d want 1 (only hit 3)", nProc)
	}
	wantRaw := akshanDFProcRaw(level, 0)
	if math.Abs(rawProc-wantRaw) > akshanDFTol {
		t.Fatalf("proc raw=%v want %v", rawProc, wantRaw)
	}
	if len(procItems) != 1 {
		t.Fatalf("proc items=%d want 1", len(procItems))
	}

	nAA, _, _, _ := akshanDFDamageByOp(done, akshanDFAAOpRef)
	if nAA != 4 {
		t.Fatalf("aa count=%d want 4", nAA)
	}
	if got := akshanDFStacks(t, done); got != 1 {
		t.Fatalf("dirty_fighting_stacks after hit4=%v want 1", got)
	}
	if countEmittedEvents(done, akshanDFHitEvent) != 4 {
		t.Fatalf("basic_attack_hit=%d want 4", countEmittedEvents(done, akshanDFHitEvent))
	}
	if done.Summary.AbilityCastCount != 4 || done.Summary.AbilityAttemptCount != 4 {
		t.Fatalf("attempt/cast=%d/%d want 4/4", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}
}

// TestAkshanDirtyFightingLevelThresholdPipeline: real pipeline raw at Wiki level boundaries.
func TestAkshanDirtyFightingLevelThresholdPipeline(t *testing.T) {
	levels := []float64{1, 5, 6, 10, 11, 15, 16, 18}
	for _, level := range levels {
		t.Run("level_"+itoaRuntime(int(level)), func(t *testing.T) {
			compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: level})
			setAkshanDFDriverHits(&runReq, []int64{0, 100, 200})
			done := runAkshanDirtyFighting(t, compileReq, runReq)

			wantRaw := akshanDFProcRaw(level, 0)
			n, raw, mit, _ := akshanDFDamageByOp(done, akshanDFProcOpRef)
			if n != 1 {
				t.Fatalf("proc count=%d want 1", n)
			}
			if math.Abs(raw-wantRaw) > akshanDFTol {
				t.Fatalf("proc raw=%v want %v (level=%v)", raw, wantRaw, level)
			}
			if math.Abs(mit-wantRaw) > akshanDFTol {
				t.Fatalf("proc mit=%v want %v (mr=0)", mit, wantRaw)
			}
			if got := akshanDFStacks(t, done); got != 0 {
				t.Fatalf("stacks after consume=%v want 0", got)
			}
		})
	}
}

// TestAkshanDirtyFightingAPScaling: non-zero AP on third-stack proc.
func TestAkshanDirtyFightingAPScaling(t *testing.T) {
	const level, ap = 1.0, 200.0
	compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: level, ap: ap})
	setAkshanDFDriverHits(&runReq, []int64{0, 100, 200})
	done := runAkshanDirtyFighting(t, compileReq, runReq)

	wantRaw := akshanDFProcRaw(level, ap)
	wantAlt := 15 + akshanDFAPRatio*ap
	if math.Abs(wantRaw-wantAlt) > akshanDFTolExact {
		t.Fatalf("helper inconsistency raw=%v alt=%v", wantRaw, wantAlt)
	}
	n, raw, _, _ := akshanDFDamageByOp(done, akshanDFProcOpRef)
	if n != 1 {
		t.Fatalf("proc count=%d want 1", n)
	}
	if math.Abs(raw-wantRaw) > akshanDFTol {
		t.Fatalf("proc raw=%v want %v (level1 AP200)", raw, wantRaw)
	}
}

// TestAkshanDirtyFightingArmorAndMRMitigation: physical AA + magic proc via pipeline.
func TestAkshanDirtyFightingArmorAndMRMitigation(t *testing.T) {
	const level, ap, armor, mr = 6.0, 50.0, 100.0, 100.0
	compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{
		level: level, ap: ap, armor: armor, mr: mr,
	})
	setAkshanDFDriverHits(&runReq, []int64{0, 100, 200})
	done := runAkshanDirtyFighting(t, compileReq, runReq)

	wantProcRaw := akshanDFProcRaw(level, ap)
	wantProcMit := expectedMitigatedMagic(wantProcRaw, mr)
	wantAAMit := expectedMitigatedPhysical(akshanDFAADamage, armor)

	nP, rawP, mitP, _ := akshanDFDamageByOp(done, akshanDFProcOpRef)
	if nP != 1 || math.Abs(rawP-wantProcRaw) > akshanDFTol || math.Abs(mitP-wantProcMit) > akshanDFTol {
		t.Fatalf("proc n/raw/mit=%d/%v/%v want 1/%v/%v", nP, rawP, mitP, wantProcRaw, wantProcMit)
	}
	nA, rawA, mitA, _ := akshanDFDamageByOp(done, akshanDFAAOpRef)
	if nA != 3 || math.Abs(rawA-3*akshanDFAADamage) > akshanDFTol {
		t.Fatalf("aa n/rawSum=%d/%v want 3/%v", nA, rawA, 3*akshanDFAADamage)
	}
	if math.Abs(mitA-3*wantAAMit) > akshanDFTol {
		t.Fatalf("aa mitSum=%v want %v", mitA, 3*wantAAMit)
	}
}

// TestAkshanDirtyFightingDurationRefreshAndExpiry: 5000ms refresh_on_write; gap>5000 expires.
func TestAkshanDirtyFightingDurationRefreshAndExpiry(t *testing.T) {
	t.Run("refresh_keeps_stacks_through_original_expiry", func(t *testing.T) {
		compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: 1})
		// Write at 0 → expire 5000; refresh at 4999 → expire 9999; hit at 9998 still live → 3rd stack procs.
		setAkshanDFDriverHits(&runReq, []int64{0, 4999, 9998})
		done := runAkshanDirtyFighting(t, compileReq, runReq)
		nProc, _, _, _ := akshanDFDamageByOp(done, akshanDFProcOpRef)
		if nProc != 1 {
			t.Fatalf("proc count=%d want 1 (refresh preserved stacks to third hit)", nProc)
		}
		if got := akshanDFStacks(t, done); got != 0 {
			t.Fatalf("stacks after third-hit consume=%v want 0", got)
		}
	})

	t.Run("refresh_two_hits_leave_stack_2", func(t *testing.T) {
		compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: 1})
		setAkshanDFDriverHits(&runReq, []int64{0, 4999})
		done := runAkshanDirtyFighting(t, compileReq, runReq)
		if nProc, _, _, _ := akshanDFDamageByOp(done, akshanDFProcOpRef); nProc != 0 {
			t.Fatalf("proc count=%d want 0 before third stack", nProc)
		}
		if got := akshanDFStacks(t, done); got != 2 {
			t.Fatalf("stacks=%v want 2 after refreshed window", got)
		}
	})

	t.Run("expiry_after_gap_gt_5000", func(t *testing.T) {
		compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: 1})
		// Write at 0 → expireAt 5000; next hit at 5001 must see prior stacks 0 → leave stack 1.
		setAkshanDFDriverHits(&runReq, []int64{0, 5001})
		done := runAkshanDirtyFighting(t, compileReq, runReq)
		if nProc, _, _, _ := akshanDFDamageByOp(done, akshanDFProcOpRef); nProc != 0 {
			t.Fatalf("proc count=%d want 0", nProc)
		}
		if got := akshanDFStacks(t, done); got != 1 {
			t.Fatalf("stacks=%v want 1 after post-expiry hit (not 2)", got)
		}
	})
}

// TestAkshanDirtyFightingOneBasicAttackHitEventPerAttackAndEvidenceOrder.
func TestAkshanDirtyFightingOneBasicAttackHitEventPerAttackAndEvidenceOrder(t *testing.T) {
	compileReq, runReq := loadAkshanDFFixture(t, akshanDFFixtureOpts{level: 1})
	setAkshanDFDriverHits(&runReq, []int64{0, 100, 200})
	done := runAkshanDirtyFighting(t, compileReq, runReq)

	if n := countEmittedEvents(done, akshanDFHitEvent); n != 3 {
		t.Fatalf("basic_attack_hit=%d want 3", n)
	}
	if done.Summary.AbilityCastCount != 3 || done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("attempt/cast=%d/%d want 3/3", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}

	// Hits 1-2: aa → event only (no proc). Hit 3: aa → proc → event.
	timeline := akshanDFHitTimeline(done)
	want := []string{
		"damage:" + akshanDFAAOpRef,
		"event:" + akshanDFHitEvent,
		"damage:" + akshanDFAAOpRef,
		"event:" + akshanDFHitEvent,
		"damage:" + akshanDFAAOpRef,
		"damage:" + akshanDFProcOpRef,
		"event:" + akshanDFHitEvent,
	}
	if len(timeline) != len(want) {
		t.Fatalf("timeline=%+v want %+v", timeline, want)
	}
	for i := range want {
		if timeline[i] != want[i] {
			t.Fatalf("timeline[%d]=%q want %q full=%+v", i, timeline[i], want[i], timeline)
		}
	}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "abilityRef") != akshanDFAbilityRef() {
			t.Fatalf("damage abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), akshanDFAbilityRef())
		}
		if evidenceDataString(item.Data, "providerRef") != akshanDFProviderRef {
			t.Fatalf("damage providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), akshanDFProviderRef)
		}
	}
}
