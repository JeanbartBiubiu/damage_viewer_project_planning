package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_kaisa P Second Skin / 体表活肤 (generic ABI, actionable 1v1 basic-attack branch).
//
// Numeric authority (archived League Wiki only; no screenshots/OCR):
//   - Template:Data Kai'Sa/Second Skin revision 4038390
//     SHA256 f7adc35c58f47d28f8bd098a1303cf5cfef5a414783cde389ecf07240e95515f
//   - Template:Passive progression level revision 4036514
//   - Module:Ability progression revision 4039181
//   - 数据参考/lol-wiki-current-champions/normalized/reviewed-contracts.json (kaisa-p)
//   - 数据参考/lol-wiki-current-champions/raw/kaisa-p.wikitext
//
// Exact linear formulas (Wiki tooltip two-decimal rounding is presentation only):
//   base(L)     = 4 + 20/17*(L-1)
//   perStack(L) = 1 + 5/17*(L-1)
//   causticRaw  = base(L) + S*perStack(L) + AP*(0.12 + 0.03*S)
//   ruptureRaw  = (hp.max - hp.current_after_caustic) * (0.15 + 0.0006*AP)
//
// Wiki note ordering on a triggering basic attack (represented exactly as ability ops):
//   1. Caustic Wounds magic damage from prior Plasma stacks
//   2. add one Plasma stack
//   3. at 5 stacks, missing-health magic rupture using HP after Caustic
//   4. reset stacks to zero
//   5. original physical basic attack damage
//   6. exactly one event/basic_attack_hit
//
// State: provider-target plasma_stacks, default 0, max 5, duration 4000 ms, refresh_on_write.
//
// Explicit non-goals: W 2/3 stacks + overflow reapply, allied CC Plasma, monster 400 cap,
// spell shield, Guinsoo phantom/buff-slot ordering, multi-target, legacy single_attacker_dps,
// production runtime/ABI/fixture changes.

const (
	kaisaSSProviderRef  = "hero:kaisa_second_skin"
	kaisaSSStableID     = "hero_kaisa_second_skin"
	kaisaSSAbilityKey   = "basic_attack"
	kaisaSSPlasmaKey    = "plasma_stacks"
	kaisaSSCausticOpRef = "op:kaisa_ss_caustic"
	kaisaSSRuptureOpRef = "op:kaisa_ss_rupture"
	kaisaSSAAOpRef      = "op:aa"
	kaisaSSHitEvent     = "event/basic_attack_hit"
	kaisaSSLevelAttr    = "champion_level"

	kaisaSSMaxStacks  = 5.0
	kaisaSSDurationMs = 4000.0
	kaisaSSAADamage   = 100.0
	kaisaSSDefaultHP  = 10000.0
	kaisaSSTol        = 1e-9
	kaisaSSTolExact   = 1e-12
)

// Independent expected-value helpers (must not re-walk the model formula AST).

func kaisaSSBase(level float64) float64 {
	return 4 + 20.0/17.0*(level-1)
}

func kaisaSSPerStack(level float64) float64 {
	return 1 + 5.0/17.0*(level-1)
}

func kaisaSSCausticRaw(level, priorStacks, ap float64) float64 {
	return kaisaSSBase(level) +
		priorStacks*kaisaSSPerStack(level) +
		ap*(0.12+0.03*priorStacks)
}

func kaisaSSRuptureRaw(missingHP, ap float64) float64 {
	return missingHP * (0.15 + 0.0006*ap)
}

func kaisaSSTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func kaisaSSStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kaisaSSPlasmaKey: kaisaSSTimedSlot(0, kaisaSSMaxStacks, kaisaSSDurationMs),
	}
}

func kaisaSSAtFiveStacksCond() *model.GenericFormulaExpr {
	five := kaisaSSMaxStacks
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + kaisaSSPlasmaKey},
			{Op: "const", Value: &five},
		},
	}
}

func kaisaSSCausticAmount() *model.GenericFormulaExpr {
	four := 4.0
	twenty := 20.0
	seventeen := 17.0
	one := 1.0
	five := 5.0
	apBase := 0.12
	apPer := 0.03
	levelPath := "source.attr." + kaisaSSLevelAttr + ".resolved"
	stackPath := "provider.target_state." + kaisaSSPlasmaKey
	apPath := "source.attr.ap.resolved"
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &four},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "div", Args: []model.GenericFormulaExpr{
										{Op: "const", Value: &twenty},
										{Op: "const", Value: &seventeen},
									}},
									{Op: "sub", Args: []model.GenericFormulaExpr{
										{Op: "read", Path: levelPath},
										{Op: "const", Value: &one},
									}},
								},
							},
						},
					},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: stackPath},
							{
								Op: "add",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &one},
									{
										Op: "mul",
										Args: []model.GenericFormulaExpr{
											{Op: "div", Args: []model.GenericFormulaExpr{
												{Op: "const", Value: &five},
												{Op: "const", Value: &seventeen},
											}},
											{Op: "sub", Args: []model.GenericFormulaExpr{
												{Op: "read", Path: levelPath},
												{Op: "const", Value: &one},
											}},
										},
									},
								},
							},
						},
					},
				},
			},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: apPath},
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &apBase},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &apPer},
									{Op: "read", Path: stackPath},
								},
							},
						},
					},
				},
			},
		},
	}
}

func kaisaSSRuptureAmount() *model.GenericFormulaExpr {
	baseRatio := 0.15
	apPerUnit := 0.0006
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "sub",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "target.attr.hp.max"},
					{Op: "read", Path: "target.attr.hp.current"},
				},
			},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &baseRatio},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &apPerUnit},
							{Op: "read", Path: "source.attr.ap.resolved"},
						},
					},
				},
			},
		},
	}
}

func kaisaSSBasicAttackOps() []model.OperationDefinition {
	one := 1.0
	zero := 0.0
	aa := kaisaSSAADamage
	atFive := kaisaSSAtFiveStacksCond()
	return []model.OperationDefinition{
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/magic",
			Ref:           kaisaSSCausticOpRef,
			CopyableOnHit: false,
			Amount:        kaisaSSCausticAmount(),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         kaisaSSPlasmaKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/magic",
			Ref:           kaisaSSRuptureOpRef,
			CopyableOnHit: false,
			Condition:     atFive,
			Amount:        kaisaSSRuptureAmount(),
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         kaisaSSPlasmaKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
			Condition:   atFive,
		},
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Ref:        kaisaSSAAOpRef,
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: kaisaSSHitEvent,
			Ref:       kaisaSSHitEvent,
		},
	}
}

func ensureKaisaSSTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: kaisaSSHitEvent, Domain: "event"},
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

func configureKaisaSSProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        kaisaSSProviderRef,
		Kind:               "champion",
		StableID:           kaisaSSStableID,
		InitialStateSchema: kaisaSSStateSchema(),
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: kaisaSSAbilityKey,
				Kind:       "active",
				Types:      []string{"ability/basic_attack"},
				Operations: kaisaSSBasicAttackOps(),
			},
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: kaisaSSProviderRef, DefinitionRef: kaisaSSProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: kaisaSSProviderRef, DefinitionRef: kaisaSSProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func kaisaSSAbilityRef() string {
	return "source.provider[" + kaisaSSProviderRef + "].ability[" + kaisaSSAbilityKey + "]"
}

type kaisaSSFixtureOpts struct {
	level float64
	ap    float64
	hp    float64
	armor float64
	mr    float64
}

func loadKaisaSSFixture(t *testing.T, opts kaisaSSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.level < 1 {
		opts.level = 1
	}
	if opts.hp <= 0 {
		opts.hp = kaisaSSDefaultHP
	}
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.kaisa_second_skin"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureKaisaSSTypes(&compileReq)
	configureKaisaSSProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, kaisaSSLevelAttr, model.AttributeSlotDef{
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

func setKaisaSSDriverHits(runReq *model.RunRequest, atMs []int64) {
	ref := kaisaSSAbilityRef()
	entries := make([]model.DriverEntry, 0, len(atMs))
	for i, at := range atMs {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "kaisa_ss_aa_" + itoaRuntime(i),
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

// runKaisaSecondSkin exercises the canonical Session frame lifecycle:
// CompileFrame → registered session → RunFrame(sessionId, expectedRulesHash) → ReleaseSessionFrame.
func runKaisaSecondSkin(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
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
		if p.ProviderKey != kaisaSSProviderRef {
			continue
		}
		field, ok := p.StateFields[kaisaSSPlasmaKey]
		if !ok {
			t.Fatal("plasma_stacks state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != kaisaSSMaxStacks || field.DurationMs != int64(kaisaSSDurationMs) {
			t.Fatalf("compiled plasma field=%+v want max=5 durationMs=4000", field)
		}
		if field.RefreshPolicy != model.ProviderStateRefreshOnWrite {
			t.Fatalf("refreshPolicy=%q want %q", field.RefreshPolicy, model.ProviderStateRefreshOnWrite)
		}
		if math.Abs(field.DefaultValue) > kaisaSSTolExact {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		fieldOK = true
		break
	}
	if !fieldOK {
		t.Fatal("kaisa second skin provider missing from compiled session")
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

func kaisaSSPlasmaStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[kaisaSSProviderRef].(map[string]interface{})
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
		v, _ := values[kaisaSSPlasmaKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func kaisaSSDamageByOp(done model.DoneResult, opRef string) (count int, rawSum, mitSum float64, items []model.EvidenceItem) {
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

func kaisaSSHitTimeline(done model.DoneResult) []string {
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

// TestKaisaSecondSkinInterpolationCrossCheck: independent level 1..18 endpoints and fill.
func TestKaisaSecondSkinInterpolationCrossCheck(t *testing.T) {
	if math.Abs(kaisaSSBase(1)-4) > kaisaSSTolExact {
		t.Fatalf("base(1)=%v want 4", kaisaSSBase(1))
	}
	if math.Abs(kaisaSSBase(18)-24) > kaisaSSTolExact {
		t.Fatalf("base(18)=%v want 24", kaisaSSBase(18))
	}
	if math.Abs(kaisaSSPerStack(1)-1) > kaisaSSTolExact {
		t.Fatalf("perStack(1)=%v want 1", kaisaSSPerStack(1))
	}
	if math.Abs(kaisaSSPerStack(18)-6) > kaisaSSTolExact {
		t.Fatalf("perStack(18)=%v want 6", kaisaSSPerStack(18))
	}
	for level := 1; level <= 18; level++ {
		l := float64(level)
		wantBase := 4 + 20.0/17.0*(l-1)
		wantPer := 1 + 5.0/17.0*(l-1)
		if math.Abs(kaisaSSBase(l)-wantBase) > kaisaSSTolExact {
			t.Fatalf("base(%d)=%v want %v", level, kaisaSSBase(l), wantBase)
		}
		if math.Abs(kaisaSSPerStack(l)-wantPer) > kaisaSSTolExact {
			t.Fatalf("perStack(%d)=%v want %v", level, kaisaSSPerStack(l), wantPer)
		}
	}
}

// TestKaisaSecondSkinProviderTargetSchemaCompiled: max 5 / 4000 ms / refresh_on_write via Session compile.
func TestKaisaSecondSkinProviderTargetSchemaCompiled(t *testing.T) {
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: 1})
	setKaisaSSDriverHits(&runReq, []int64{0})
	_ = runKaisaSecondSkin(t, compileReq, runReq)
}

// TestKaisaSecondSkinLevel1AndLevel18Damage: Caustic at prior=0, AP=0 through real pipeline.
func TestKaisaSecondSkinLevel1AndLevel18Damage(t *testing.T) {
	cases := []struct {
		name  string
		level float64
	}{
		{"level1", 1},
		{"level18", 18},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: tc.level})
			setKaisaSSDriverHits(&runReq, []int64{0})
			done := runKaisaSecondSkin(t, compileReq, runReq)

			wantRaw := kaisaSSCausticRaw(tc.level, 0, 0)
			n, raw, mit, _ := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
			if n != 1 {
				t.Fatalf("caustic count=%d want 1", n)
			}
			if math.Abs(raw-wantRaw) > kaisaSSTol {
				t.Fatalf("caustic raw=%v want %v", raw, wantRaw)
			}
			if math.Abs(mit-wantRaw) > kaisaSSTol {
				t.Fatalf("caustic mit=%v want %v (mr=0)", mit, wantRaw)
			}
			if nR, _, _, _ := kaisaSSDamageByOp(done, kaisaSSRuptureOpRef); nR != 0 {
				t.Fatalf("rupture count=%d want 0 on first hit", nR)
			}
			if got := kaisaSSPlasmaStacks(t, done); got != 1 {
				t.Fatalf("plasma_stacks=%v want 1", got)
			}
			if countEmittedEvents(done, kaisaSSHitEvent) != 1 {
				t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, kaisaSSHitEvent))
			}
		})
	}
}

// TestKaisaSecondSkinAPScalingIntermediateLevel: level 9 AP=100 prior=0.
func TestKaisaSecondSkinAPScalingIntermediateLevel(t *testing.T) {
	const level, ap = 9.0, 100.0
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: level, ap: ap})
	setKaisaSSDriverHits(&runReq, []int64{0})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	wantRaw := kaisaSSCausticRaw(level, 0, ap)
	// Independent cross-check of AP term only: base(9)+12.
	wantAlt := kaisaSSBase(level) + ap*0.12
	if math.Abs(wantRaw-wantAlt) > kaisaSSTolExact {
		t.Fatalf("helper inconsistency raw=%v alt=%v", wantRaw, wantAlt)
	}
	n, raw, _, _ := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
	if n != 1 {
		t.Fatalf("caustic count=%d want 1", n)
	}
	if math.Abs(raw-wantRaw) > kaisaSSTol {
		t.Fatalf("caustic raw=%v want %v (level9 AP100)", raw, wantRaw)
	}
}

// TestKaisaSecondSkinPriorStackScalingHits1To5: Caustic uses prior stacks 0..4; fifth ruptures.
func TestKaisaSecondSkinPriorStackScalingHits1To5(t *testing.T) {
	const level, ap = 1.0, 0.0
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: level, ap: ap})
	setKaisaSSDriverHits(&runReq, []int64{0, 100, 200, 300, 400})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	_, _, _, causticItems := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
	if len(causticItems) != 5 {
		t.Fatalf("caustic items=%d want 5", len(causticItems))
	}
	for i, item := range causticItems {
		prior := float64(i)
		want := kaisaSSCausticRaw(level, prior, ap)
		got := evidenceDataFloat(item.Data, "rawAmount")
		if math.Abs(got-want) > kaisaSSTol {
			t.Fatalf("hit%d caustic raw=%v want %v (prior=%v)", i+1, got, want, prior)
		}
	}
	nR, _, _, _ := kaisaSSDamageByOp(done, kaisaSSRuptureOpRef)
	if nR != 1 {
		t.Fatalf("rupture count=%d want 1 on fifth hit", nR)
	}
	if got := kaisaSSPlasmaStacks(t, done); got != 0 {
		t.Fatalf("plasma_stacks after consume=%v want 0", got)
	}
	if countEmittedEvents(done, kaisaSSHitEvent) != 5 {
		t.Fatalf("basic_attack_hit=%d want 5", countEmittedEvents(done, kaisaSSHitEvent))
	}
}

// TestKaisaSecondSkinFifthHitRuptureUsesPostCausticHPBeforePhysicalAA.
func TestKaisaSecondSkinFifthHitRuptureUsesPostCausticHPBeforePhysicalAA(t *testing.T) {
	const level, ap, mr = 1.0, 50.0, 0.0
	hp := kaisaSSDefaultHP
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: level, ap: ap, hp: hp, mr: mr})
	setKaisaSSDriverHits(&runReq, []int64{0, 100, 200, 300, 400})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	// Reconstruct post-Caustic missing HP on the fifth hit only (prior stacks=4).
	prior := 4.0
	causticRaw := kaisaSSCausticRaw(level, prior, ap)
	causticMit := expectedMitigatedMagic(causticRaw, mr)
	// Hits 1..4 also chipped HP; accumulate independent expected missing before hit5 caustic.
	cur := hp
	for priorS := 0.0; priorS < 4; priorS++ {
		cur -= expectedMitigatedMagic(kaisaSSCausticRaw(level, priorS, ap), mr)
		cur -= expectedMitigatedPhysical(kaisaSSAADamage, 0)
	}
	curAfterCaustic5 := cur - causticMit
	missing := hp - curAfterCaustic5
	wantRuptureRaw := kaisaSSRuptureRaw(missing, ap)

	_, _, _, ruptureItems := kaisaSSDamageByOp(done, kaisaSSRuptureOpRef)
	if len(ruptureItems) != 1 {
		t.Fatalf("rupture items=%d want 1", len(ruptureItems))
	}
	gotRaw := evidenceDataFloat(ruptureItems[0].Data, "rawAmount")
	if math.Abs(gotRaw-wantRuptureRaw) > kaisaSSTol {
		t.Fatalf("rupture raw=%v want %v (post-caustic missing=%v)", gotRaw, wantRuptureRaw, missing)
	}
	// Pre-caustic missing on hit5 would omit causticMit and understate rupture.
	wrongMissing := hp - cur
	wrongRaw := kaisaSSRuptureRaw(wrongMissing, ap)
	if math.Abs(gotRaw-wrongRaw) <= kaisaSSTol {
		t.Fatalf("rupture matched pre-caustic missing (%v); must use post-caustic HP", wrongRaw)
	}

	// Evidence/ref ordering on the fifth cast timestamp: caustic → rupture → aa → event.
	timeline := kaisaSSHitTimeline(done)
	wantSuffix := []string{
		"damage:" + kaisaSSCausticOpRef,
		"damage:" + kaisaSSRuptureOpRef,
		"damage:" + kaisaSSAAOpRef,
		"event:" + kaisaSSHitEvent,
	}
	if len(timeline) < len(wantSuffix) {
		t.Fatalf("timeline too short: %+v", timeline)
	}
	gotSuffix := timeline[len(timeline)-len(wantSuffix):]
	for i := range wantSuffix {
		if gotSuffix[i] != wantSuffix[i] {
			t.Fatalf("fifth-hit order[%d]=%q want %q full=%+v", i, gotSuffix[i], wantSuffix[i], timeline)
		}
	}
}

// TestKaisaSecondSkinArmorAndMagicResistMitigation: physical AA + magic Caustic via pipeline.
func TestKaisaSecondSkinArmorAndMagicResistMitigation(t *testing.T) {
	const level, ap, armor, mr = 1.0, 0.0, 100.0, 100.0
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{
		level: level, ap: ap, armor: armor, mr: mr,
	})
	setKaisaSSDriverHits(&runReq, []int64{0})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	wantCausticRaw := kaisaSSCausticRaw(level, 0, ap)
	wantCausticMit := expectedMitigatedMagic(wantCausticRaw, mr)
	wantAAMit := expectedMitigatedPhysical(kaisaSSAADamage, armor)

	nC, rawC, mitC, _ := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
	if nC != 1 || math.Abs(rawC-wantCausticRaw) > kaisaSSTol || math.Abs(mitC-wantCausticMit) > kaisaSSTol {
		t.Fatalf("caustic n/raw/mit=%d/%v/%v want 1/%v/%v", nC, rawC, mitC, wantCausticRaw, wantCausticMit)
	}
	nA, rawA, mitA, _ := kaisaSSDamageByOp(done, kaisaSSAAOpRef)
	if nA != 1 || math.Abs(rawA-kaisaSSAADamage) > kaisaSSTol || math.Abs(mitA-wantAAMit) > kaisaSSTol {
		t.Fatalf("aa n/raw/mit=%d/%v/%v want 1/%v/%v", nA, rawA, mitA, kaisaSSAADamage, wantAAMit)
	}
}

// TestKaisaSecondSkinPlasmaDurationRefreshAndExpiry: 4000ms refresh_on_write; gap>4000 expires.
func TestKaisaSecondSkinPlasmaDurationRefreshAndExpiry(t *testing.T) {
	t.Run("refresh_keeps_stacks", func(t *testing.T) {
		compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: 1})
		// Write at 0 → expire 4000; refresh at 3999 → expire 7999; hit at 7998 still live.
		setKaisaSSDriverHits(&runReq, []int64{0, 3999, 7998})
		done := runKaisaSecondSkin(t, compileReq, runReq)
		if got := kaisaSSPlasmaStacks(t, done); got != 3 {
			t.Fatalf("plasma_stacks=%v want 3 after refreshed window", got)
		}
		_, _, _, items := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
		if len(items) != 3 {
			t.Fatalf("caustic items=%d want 3", len(items))
		}
		// Third hit prior stacks must be 2 (not expired back to 0).
		got := evidenceDataFloat(items[2].Data, "rawAmount")
		want := kaisaSSCausticRaw(1, 2, 0)
		if math.Abs(got-want) > kaisaSSTol {
			t.Fatalf("third caustic raw=%v want %v (prior=2)", got, want)
		}
	})

	t.Run("expiry_after_gap_gt_4000", func(t *testing.T) {
		compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: 1})
		// Write at 0 → expireAt 4000; next hit at 4001 must see prior stacks 0.
		setKaisaSSDriverHits(&runReq, []int64{0, 4001})
		done := runKaisaSecondSkin(t, compileReq, runReq)
		_, _, _, items := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
		if len(items) != 2 {
			t.Fatalf("caustic items=%d want 2", len(items))
		}
		got := evidenceDataFloat(items[1].Data, "rawAmount")
		want := kaisaSSCausticRaw(1, 0, 0)
		if math.Abs(got-want) > kaisaSSTol {
			t.Fatalf("post-expiry caustic raw=%v want %v (prior=0)", got, want)
		}
		if gotStacks := kaisaSSPlasmaStacks(t, done); gotStacks != 1 {
			t.Fatalf("plasma_stacks=%v want 1 after post-expiry hit", gotStacks)
		}
	})
}

// TestKaisaSecondSkinStackCapConsumeAndSixthHitFromZero.
func TestKaisaSecondSkinStackCapConsumeAndSixthHitFromZero(t *testing.T) {
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: 1})
	setKaisaSSDriverHits(&runReq, []int64{0, 100, 200, 300, 400, 500})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	if nR, _, _, _ := kaisaSSDamageByOp(done, kaisaSSRuptureOpRef); nR != 1 {
		t.Fatalf("rupture count=%d want 1 (only fifth hit)", nR)
	}
	_, _, _, causticItems := kaisaSSDamageByOp(done, kaisaSSCausticOpRef)
	if len(causticItems) != 6 {
		t.Fatalf("caustic items=%d want 6", len(causticItems))
	}
	sixthRaw := evidenceDataFloat(causticItems[5].Data, "rawAmount")
	wantSixth := kaisaSSCausticRaw(1, 0, 0)
	if math.Abs(sixthRaw-wantSixth) > kaisaSSTol {
		t.Fatalf("sixth caustic raw=%v want %v (starts from zero after consume)", sixthRaw, wantSixth)
	}
	if got := kaisaSSPlasmaStacks(t, done); got != 1 {
		t.Fatalf("plasma_stacks after sixth=%v want 1", got)
	}
	if countEmittedEvents(done, kaisaSSHitEvent) != 6 {
		t.Fatalf("basic_attack_hit=%d want 6", countEmittedEvents(done, kaisaSSHitEvent))
	}
}

// TestKaisaSecondSkinOneBasicAttackHitEventPerAttackAndEvidenceOrder.
func TestKaisaSecondSkinOneBasicAttackHitEventPerAttackAndEvidenceOrder(t *testing.T) {
	compileReq, runReq := loadKaisaSSFixture(t, kaisaSSFixtureOpts{level: 1})
	setKaisaSSDriverHits(&runReq, []int64{0, 100})
	done := runKaisaSecondSkin(t, compileReq, runReq)

	if n := countEmittedEvents(done, kaisaSSHitEvent); n != 2 {
		t.Fatalf("basic_attack_hit=%d want 2", n)
	}
	if done.Summary.AbilityCastCount != 2 || done.Summary.AbilityAttemptCount != 2 {
		t.Fatalf("attempt/cast=%d/%d want 2/2", done.Summary.AbilityAttemptCount, done.Summary.AbilityCastCount)
	}

	timeline := kaisaSSHitTimeline(done)
	want := []string{
		"damage:" + kaisaSSCausticOpRef,
		"damage:" + kaisaSSAAOpRef,
		"event:" + kaisaSSHitEvent,
		"damage:" + kaisaSSCausticOpRef,
		"damage:" + kaisaSSAAOpRef,
		"event:" + kaisaSSHitEvent,
	}
	if len(timeline) != len(want) {
		t.Fatalf("timeline=%+v want %+v", timeline, want)
	}
	for i := range want {
		if timeline[i] != want[i] {
			t.Fatalf("timeline[%d]=%q want %q", i, timeline[i], want[i])
		}
	}
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "abilityRef") != kaisaSSAbilityRef() {
			t.Fatalf("damage abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), kaisaSSAbilityRef())
		}
		if evidenceDataString(item.Data, "providerRef") != kaisaSSProviderRef {
			t.Fatalf("damage providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), kaisaSSProviderRef)
		}
	}
}
