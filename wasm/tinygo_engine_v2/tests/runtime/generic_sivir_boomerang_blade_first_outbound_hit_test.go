// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	regexp "regexp"
	strings "strings"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	sivirBBFOHProviderRef = "provider_hero_sivir_q_boomerang_blade_first_outbound_hit"
	sivirBBFOHStableID    = "hero_sivir_q_boomerang_blade_first_outbound_hit"
	sivirBBFOHAbilityID   = "ability_hero_sivir_q_boomerang_blade_first_outbound_hit"
	sivirBBFOHAbilityKey  = "boomerang_blade_first_outbound_hit"
	sivirBBFOHDamageOpRef = "op:sivir_boomerang_blade_first_outbound_hit_damage"
	sivirBBFOHBonusADMod  = "fixture_sivir_boomerang_blade_first_outbound_hit_bonus_ad"

	sivirBBFOHBaseDamage   = 160.0
	sivirBBFOHBonusADRatio = 0.70
	sivirBBFOHAPRatio      = 0.60
	sivirBBFOHCritScale    = 0.40
	sivirBBFOHManaCost     = 75.0
	sivirBBFOHCDMs         = 8000.0

	sivirBBFOHADBaseDefault      = 60.0
	sivirBBFOHADResolvedDefault  = 160.0
	sivirBBFOHFixtureAPDefault   = 100.0
	sivirBBFOHFixtureCritDefault = 0.0
	sivirBBFOHFixtureManaCD      = 225.0
	sivirBBFOHFixtureManaShort   = 74.0
	sivirBBFOHTargetArmorDefault = 100.0
	sivirBBFOHTargetHP           = 1000.0

	// Default CD schedule uses crit0.5: (160+70+60)*(1+0.20)=348; armor100 → 174.
	sivirBBFOHExpectedRawCrit0  = 290.0
	sivirBBFOHExpectedMitCrit0  = 145.0
	sivirBBFOHExpectedRawCrit05 = 348.0
	sivirBBFOHExpectedMitCrit05 = 174.0
	sivirBBFOHExpectedRawCrit1  = 406.0
	sivirBBFOHExpectedMitCrit1  = 203.0
	sivirBBFOHManaAfter2        = 75.0  // 225 - 75 - 75
	sivirBBFOHHPAfter2          = 652.0 // 1000 - 174 - 174

	sivirBBFOHTol = 1e-9
)

func sivirBBFOHClamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func sivirBBFOHExpectedRawFromStats(resolvedAD, baseAD, resolvedAP, critChance float64) float64 {
	base := sivirBBFOHBaseDamage +
		sivirBBFOHBonusADRatio*(resolvedAD-baseAD) +
		sivirBBFOHAPRatio*resolvedAP
	return base * (1.0 + sivirBBFOHCritScale*sivirBBFOHClamp01(critChance))
}

func sivirBBFOHDamageAmount() *model.GenericFormulaExpr {
	base := sivirBBFOHBaseDamage
	adRatio := sivirBBFOHBonusADRatio
	apRatio := sivirBBFOHAPRatio
	critScale := sivirBBFOHCritScale
	one := 1.0
	zero := 0.0
	// Nested binary AST; every read path exactly once; formula-local clamp.
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &base},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &adRatio},
									{
										Op: "sub",
										Args: []model.GenericFormulaExpr{
											{Op: "read", Path: "source.attr.ad.resolved"},
											{Op: "read", Path: "source.attr.ad.base"},
										},
									},
								},
							},
						},
					},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &apRatio},
							{Op: "read", Path: "source.attr.ap.resolved"},
						},
					},
				},
			},
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &one},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &critScale},
							{
								Op: "min",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &one},
									{
										Op: "max",
										Args: []model.GenericFormulaExpr{
											{Op: "const", Value: &zero},
											{Op: "read", Path: "source.attr.crit_chance.resolved"},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

func sivirBBFOHCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += sivirBBFOHCountPathReads(&expr.Args[i], path)
	}
	return n
}

func sivirBBFOHAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte", "min", "max":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		sivirBBFOHAssertBinaryArity(t, &expr.Args[i])
	}
}

func sivirBBFOHAbility() model.AbilityDefinition {
	cost := sivirBBFOHManaCost
	cd := sivirBBFOHCDMs
	return model.AbilityDefinition{
		AbilityKey: sivirBBFOHAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           sivirBBFOHDamageOpRef,
				Amount:        sivirBBFOHDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func sivirBBFOHProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: sivirBBFOHProviderRef,
		Kind:        "champion",
		StableID:    sivirBBFOHStableID,
		Abilities:   []model.AbilityDefinition{sivirBBFOHAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: sivirBBFOHBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func sivirBBFOHAbilityRef() string {
	return "source.provider[" + sivirBBFOHProviderRef + "].ability[" + sivirBBFOHAbilityKey + "]"
}

type sivirBBFOHFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	critChance float64
	armor      float64
	mana       float64
	hp         float64
}

func configureSivirBBFOHProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts sivirBBFOHFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	shared := []model.ProviderDefinition{sivirBBFOHProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: sivirBBFOHProviderRef, DefinitionRef: sivirBBFOHProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: sivirBBFOHProviderRef, DefinitionRef: sivirBBFOHProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	compileReq.SharedProviders = shared
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureSivirBBFOHTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "armor")
	formuladefinition.SetDamageFormula(req, "damage/physical", formuladefinition.ResistanceDefense("armor"))

	need := []model.TypeCatalogEntry{
		{Key: "damage/physical", Domain: "damage"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "event/ability_started", Domain: "event"},
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

func loadSivirBBFOHFixture(t *testing.T, opts sivirBBFOHFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/critChance/armor explicitly
	// (AD0 / AP0 / crit0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = sivirBBFOHFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = sivirBBFOHTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureSivirBBFOHTypes(&compileReq)
	configureSivirBBFOHProviders(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/crit_chance/mana/HP/armor values (external-existing-data/
	// check-only); do not claim seed materializes hero_sivir / ad / ap /
	// crit_chance / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	// Always define and populate crit_chance in compile and run snapshots.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance,
		Max: opts.critChance, Resolved: opts.critChance,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, sivirBBFOHFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runSivirBBFOH(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := runtimeengine.RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func runSivirBBFOHFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	session := runtimeengine.NewMathSession()
	session.ClearOutbox()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, compileReq)); code != 0 {
		t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
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
		SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash,
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v want ok released session %q", released, compiled.SessionID)
	}
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
		t.Fatal("after release want session_not_found")
	}
	return done
}

func sivirBBFOHSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
	return 0
}

func sivirBBFOHSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func sivirBBFOHDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := sivirBBFOHAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != sivirBBFOHDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func sivirBBFOHAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func sivirBBFOHFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == sivirBBFOHProviderRef {
			return p
		}
	}
	return nil
}

func assertSivirBBFOHProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := sivirBBFOHFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_sivir_q_boomerang_blade_first_outbound_hit missing from SharedProviders")
	}
	if p.ProviderKey != sivirBBFOHProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, sivirBBFOHProviderRef)
	}
	if p.StableID != sivirBBFOHStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, sivirBBFOHStableID)
	}
	banned := []string{
		"provider_hero_sivir_p_", "provider_hero_sivir_w_", "provider_hero_sivir_e_",
		"provider_hero_sivir_r_", "provider_hero_sivir_basic_",
		"ability_hero_sivir_p_", "ability_hero_sivir_w_", "ability_hero_sivir_e_",
		"ability_hero_sivir_r_", "ability_hero_sivir_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("boomerang first-outbound-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no return / projectile / once-per-pass state)", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != sivirBBFOHBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], sivirBBFOHBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), sivirBBFOHAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != sivirBBFOHAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, sivirBBFOHAbilityKey, sivirBBFOHAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("boomerang_blade_first_outbound_hit must not be tagged ability/basic_attack")
		}
	}
	if a.ListenerSpec != nil {
		t.Fatal("Q must not carry listenerSpec")
	}
	if a.TickSpec != nil {
		t.Fatal("Q must not carry tickSpec")
	}
	if len(a.StateSchema) != 0 {
		t.Fatalf("ability StateSchema=%d want 0", len(a.StateSchema))
	}
	if a.CastCondition != nil {
		t.Fatal("Q must not carry castCondition")
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-sivirBBFOHManaCost) > sivirBBFOHTol {
		t.Fatalf("cost=%+v want mana const 75", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-sivirBBFOHCDMs) > sivirBBFOHTol {
		t.Fatalf("cooldown=%+v want const 8000 (immediate scaffold)", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary first-outbound physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("boomerang blade damage must not be crit-eligible (deterministic amount scaling only)")
	}
	if op.CopyableOnHit {
		t.Fatal("boomerang blade damage must not be copyable on hit")
	}
	if op.Ref != sivirBBFOHDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, sivirBBFOHDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "mul" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want mul(add(add(base,bonusAD),AP), critScale)", op.Amount)
	}
	sivirBBFOHAssertBinaryArity(t, op.Amount)
	sum := op.Amount.Args[0]
	if sum.Op != "add" || len(sum.Args) != 2 {
		t.Fatalf("inner sum=%+v want add(add(base,bonusAD),AP)", sum)
	}
	inner := sum.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("base+bonusAD=%+v want add(const160, mul(0.70, sub(...)))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-sivirBBFOHBaseDamage) > sivirBBFOHTol {
		t.Fatalf("base const=%+v want 160", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-sivirBBFOHBonusADRatio) > sivirBBFOHTol {
		t.Fatalf("bonus AD ratio=%+v want 0.70", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 {
		t.Fatalf("bonus-AD sub=%+v want sub(resolved, base)", sub)
	}
	if sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD resolved read=%+v want source.attr.ad.resolved", sub.Args[0])
	}
	if sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("AD base read=%+v want source.attr.ad.base", sub.Args[1])
	}
	if adMul.Args[1].Op == "read" && adMul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	apMul := sum.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-sivirBBFOHAPRatio) > sivirBBFOHTol {
		t.Fatalf("AP ratio=%+v want 0.60", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	critScale := op.Amount.Args[1]
	if critScale.Op != "add" || len(critScale.Args) != 2 {
		t.Fatalf("crit scale=%+v want add(1.00, mul(0.40, min(1,max(0,crit))))", critScale)
	}
	if critScale.Args[0].Op != "const" || critScale.Args[0].Value == nil ||
		math.Abs(*critScale.Args[0].Value-1.0) > sivirBBFOHTol {
		t.Fatalf("crit one const=%+v want 1.00", critScale.Args[0])
	}
	critMul := critScale.Args[1]
	if critMul.Op != "mul" || len(critMul.Args) != 2 {
		t.Fatalf("crit mul=%+v want mul(0.40, min(...))", critMul)
	}
	if critMul.Args[0].Op != "const" || critMul.Args[0].Value == nil ||
		math.Abs(*critMul.Args[0].Value-sivirBBFOHCritScale) > sivirBBFOHTol {
		t.Fatalf("crit scale ratio=%+v want 0.40", critMul.Args[0])
	}
	minNode := critMul.Args[1]
	if minNode.Op != "min" || len(minNode.Args) != 2 {
		t.Fatalf("crit min=%+v want min(1.00, max(...))", minNode)
	}
	if minNode.Args[0].Op != "const" || minNode.Args[0].Value == nil ||
		math.Abs(*minNode.Args[0].Value-1.0) > sivirBBFOHTol {
		t.Fatalf("crit min const=%+v want 1.00", minNode.Args[0])
	}
	maxNode := minNode.Args[1]
	if maxNode.Op != "max" || len(maxNode.Args) != 2 {
		t.Fatalf("crit max=%+v want max(0.00, read crit_chance)", maxNode)
	}
	if maxNode.Args[0].Op != "const" || maxNode.Args[0].Value == nil ||
		math.Abs(*maxNode.Args[0].Value-0.0) > sivirBBFOHTol {
		t.Fatalf("crit max const=%+v want 0.00", maxNode.Args[0])
	}
	if maxNode.Args[1].Op != "read" || maxNode.Args[1].Path != "source.attr.crit_chance.resolved" {
		t.Fatalf("crit read=%+v want source.attr.crit_chance.resolved", maxNode.Args[1])
	}
	if sivirBBFOHCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", sivirBBFOHCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if sivirBBFOHCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", sivirBBFOHCountPathReads(op.Amount, "source.attr.ad.base"))
	}
	if sivirBBFOHCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", sivirBBFOHCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if sivirBBFOHCountPathReads(op.Amount, "source.attr.ap.base") != 0 {
		t.Fatal("formula must not invent ap.base reads")
	}
	if sivirBBFOHCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 1 {
		t.Fatalf("crit_chance reads=%d want exactly 1", sivirBBFOHCountPathReads(op.Amount, "source.attr.crit_chance.resolved"))
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "knockback" || bannedOp.Operation == "reveal" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "matcher" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "dash" || bannedOp.Operation == "movement" ||
			bannedOp.DamageType == "damage/magic" {
			t.Fatalf("boomerang blade must not include excluded op: %+v", bannedOp)
		}
	}
}

func findSivirBBFOHAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := sivirBBFOHAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func sivirBBFOHAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > sivirBBFOHTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > sivirBBFOHTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != sivirBBFOHDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), sivirBBFOHDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != sivirBBFOHAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), sivirBBFOHAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != sivirBBFOHProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), sivirBBFOHProviderRef)
	}
	if evidenceDataBool(item.Data, "phantom") {
		t.Fatal("damage must not be phantom")
	}
	if evidenceDataString(item.Data, "phase") != "original" {
		t.Fatalf("phase=%q want original", evidenceDataString(item.Data, "phase"))
	}
	if _, ok := item.Data["eligible"]; ok {
		t.Fatalf("must not carry crit evidence fields: %+v", item.Data)
	}
	if evidenceDataBool(item.Data, "copyableOnHit") || evidenceDataBool(item.Data, "copyable") {
		t.Fatalf("damage must not be copyable: %+v", item.Data)
	}
}

func sivirBBFOHHasErrorCode(errors []model.EngineError, code model.GenericErrCode) bool {
	for _, err := range errors {
		if err.Code == code {
			return true
		}
	}
	return false
}

// TestSivirBoomerangBladeFirstOutboundHitConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestSivirBoomerangBladeFirstOutboundHitConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
		baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
		resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
		armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
	})
	assertSivirBBFOHProviderShape(t, compileReq, 1, true)
	rawX := sivirBBFOHExpectedRawFromStats(
		sivirBBFOHADResolvedDefault, sivirBBFOHADBaseDefault,
		sivirBBFOHFixtureAPDefault, sivirBBFOHFixtureCritDefault)
	if math.Abs(rawX-sivirBBFOHExpectedRawCrit0) > sivirBBFOHTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, sivirBBFOHExpectedRawCrit0)
	}
	mitX := expectedMitigatedPhysical(rawX, sivirBBFOHTargetArmorDefault)
	if math.Abs(mitX-sivirBBFOHExpectedMitCrit0) > sivirBBFOHTol {
		t.Fatalf("default mit=%v want %v", mitX, sivirBBFOHExpectedMitCrit0)
	}
	totalAsIf := sivirBBFOHBaseDamage + sivirBBFOHBonusADRatio*sivirBBFOHADResolvedDefault +
		sivirBBFOHAPRatio*sivirBBFOHFixtureAPDefault
	if math.Abs(totalAsIf-rawX) < sivirBBFOHTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD+AP raw")
	}
}

// TestSivirBoomerangBladeFirstOutboundHitFormulaMitigationTable: frozen deterministic
// base60/resolved160/AP100/crit/armor raw/final table; one isolated successful Q cast per row.
func TestSivirBoomerangBladeFirstOutboundHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name       string
		critChance float64
		wantRaw    float64
		wantMit    float64
	}{
		{"crit0", sivirBBFOHFixtureCritDefault, sivirBBFOHExpectedRawCrit0, sivirBBFOHExpectedMitCrit0},
		{"crit0.5", 0.5, sivirBBFOHExpectedRawCrit05, sivirBBFOHExpectedMitCrit05},
		{"crit1", 1.0, sivirBBFOHExpectedRawCrit1, sivirBBFOHExpectedMitCrit1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := sivirBBFOHExpectedRawFromStats(
				sivirBBFOHADResolvedDefault, sivirBBFOHADBaseDefault,
				sivirBBFOHFixtureAPDefault, tc.critChance)
			if math.Abs(rawX-tc.wantRaw) > sivirBBFOHTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, sivirBBFOHTargetArmorDefault)
			if math.Abs(mitX-tc.wantMit) > sivirBBFOHTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMit)
			}
			compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
				baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
				resolvedAP: sivirBBFOHFixtureAPDefault, critChance: tc.critChance,
				armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
			})
			assertSivirBBFOHProviderShape(t, compileReq, 1, true)
			ref := sivirBBFOHAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSivirBBFOH(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := sivirBBFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			sivirBBFOHAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-sivirBBFOHADResolvedDefault) > sivirBBFOHTol {
				t.Fatalf("ad.resolved=%v want %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ad"), sivirBBFOHADResolvedDefault)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-sivirBBFOHADBaseDefault) > sivirBBFOHTol {
				t.Fatalf("ad.base=%v want %v",
					sourceAttrBase(t, done.FinalSnapshot, "ad"), sivirBBFOHADBaseDefault)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "crit_chance")-tc.critChance) > sivirBBFOHTol {
				t.Fatalf("crit_chance.resolved=%v want %v",
					sourceAttrResolved(t, done.FinalSnapshot, "crit_chance"), tc.critChance)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(sivirBBFOHAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(sivirBBFOHAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestSivirBoomerangBladeFirstOutboundHitCritChanceClamp: formula-local clamp at armor100.
func TestSivirBoomerangBladeFirstOutboundHitCritChanceClamp(t *testing.T) {
	cases := []struct {
		name       string
		critChance float64
		wantRaw    float64
		wantMit    float64
	}{
		{"crit_neg025_clamps0", -0.25, sivirBBFOHExpectedRawCrit0, sivirBBFOHExpectedMitCrit0},
		{"crit125_clamps1", 1.25, sivirBBFOHExpectedRawCrit1, sivirBBFOHExpectedMitCrit1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
				baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
				resolvedAP: sivirBBFOHFixtureAPDefault, critChance: tc.critChance,
				armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
			})
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSivirBBFOH(t, compileReq, runReq)
			dmg := sivirBBFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			sivirBBFOHAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
		})
	}
}

// TestSivirBoomerangBladeFirstOutboundHitBonusADCounterproof: base0/resolved100 and
// base60/resolved160 at AP100/crit0/armor100 must both raw/final 290/145 — equal bonus AD.
func TestSivirBoomerangBladeFirstOutboundHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"base0_resolved100", 0, 100},
		{"base60_resolved160", sivirBBFOHADBaseDefault, sivirBBFOHADResolvedDefault},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
				armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
			})
			assertSivirBBFOHProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSivirBBFOH(t, compileReq, runReq)
			dmg := sivirBBFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			sivirBBFOHAssertDamage(t, dmg[0], sivirBBFOHExpectedRawCrit0, sivirBBFOHExpectedMitCrit0)
		})
	}
}

// TestSivirBoomerangBladeFirstOutboundHitAPCounterproof: AP0 vs AP100 at bonusAD100/crit0/armor100.
func TestSivirBoomerangBladeFirstOutboundHitAPCounterproof(t *testing.T) {
	cases := []struct {
		name       string
		resolvedAP float64
		wantRaw    float64
		wantMit    float64
	}{
		{"AP0", 0, 230, 115},
		{"AP100", sivirBBFOHFixtureAPDefault, sivirBBFOHExpectedRawCrit0, sivirBBFOHExpectedMitCrit0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
				baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
				resolvedAP: tc.resolvedAP, critChance: sivirBBFOHFixtureCritDefault,
				armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
			})
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runSivirBBFOH(t, compileReq, runReq)
			dmg := sivirBBFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			sivirBBFOHAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMit)
		})
	}
}

// TestSivirBoomerangBladeFirstOutboundHitCooldownMana225AbilityStarted: mana225/
// base60/resolved160/AP100/crit0.5/HP1000/armor100 at t0/t7999/t8000 →
// success/cooldown skip/success; readyAt8000; two Q damages at 0 and 8000 with 348/174;
// two ability_started; final mana75/HP652.
func TestSivirBoomerangBladeFirstOutboundHitCooldownMana225AbilityStarted(t *testing.T) {
	compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
		baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
		resolvedAP: sivirBBFOHFixtureAPDefault, critChance: 0.5,
		armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD, hp: sivirBBFOHTargetHP,
	})
	assertSivirBBFOHProviderShape(t, compileReq, 1, true)
	ref := sivirBBFOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
	}
	runReq.StopPolicy.DurationMs = 8100
	done := runSivirBBFOH(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if sivirBBFOHSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findSivirBBFOHAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt7999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 7999 {
			t.Fatalf("cooldown skip TimeMs=%d want 7999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 8000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 8000", item.Data["readyAtMs"])
		}
		skipAt7999 = true
	}
	if !skipAt7999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=7999 with readyAtMs=8000")
	}

	items := sivirBBFOHDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 8000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		sivirBBFOHAssertDamage(t, item, sivirBBFOHExpectedRawCrit05, sivirBBFOHExpectedMitCrit05)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * sivirBBFOHExpectedMitCrit05
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-sivirBBFOHHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, sivirBBFOHHPAfter2)
	}
	gotMana := sivirBBFOHSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-sivirBBFOHManaAfter2) > sivirBBFOHTol {
		t.Fatalf("mana=%v want %v", gotMana, sivirBBFOHManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}
	started := sivirBBFOHAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2", len(started))
	}
	wantStarted := []int64{0, 8000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
}

// TestSivirBoomerangBladeFirstOutboundHitResourceInsufficientMana74: mana74 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/start evidence.
func TestSivirBoomerangBladeFirstOutboundHitResourceInsufficientMana74(t *testing.T) {
	compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
		baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
		resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
		armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaShort, hp: sivirBBFOHTargetHP,
	})
	ref := sivirBBFOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSivirBBFOH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if sivirBBFOHSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(sivirBBFOHSourceMana(t, done.FinalSnapshot)-sivirBBFOHFixtureManaShort) > sivirBBFOHTol {
		t.Fatalf("mana changed: got %v want %v",
			sivirBBFOHSourceMana(t, done.FinalSnapshot), sivirBBFOHFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-sivirBBFOHTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, sivirBBFOHTargetHP)
	}
	if len(sivirBBFOHDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(sivirBBFOHAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestSivirBoomerangBladeFirstOutboundHitStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic or overwrite unrelated definitions.
func TestSivirBoomerangBladeFirstOutboundHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
		baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
		resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
		armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
	})
	assertSivirBBFOHProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_sivir_boomerang_blade_unrelated_sentinel"
	sentinelStable := "fixture_sivir_boomerang_blade_unrelated_stable"
	sentinel := model.ProviderDefinition{
		ProviderKey: sentinelKey,
		Kind:        "champion",
		StableID:    sentinelStable,
		Abilities: []model.AbilityDefinition{{
			AbilityKey: "sentinel_noop",
			Kind:       "active",
			Operations: nil,
		}},
	}
	before, err := json.Marshal(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, sentinel)

	if len(compileReq.Combatants[0].Providers) != 1 ||
		compileReq.Combatants[0].Providers[0].ProviderRef != sivirBBFOHProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != sivirBBFOHProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_sivir_[pwer]_|ability_hero_sivir_[pwer]_|` +
		`provider_hero_sivir_basic_|ability_hero_sivir_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == sivirBBFOHProviderRef || p.StableID == sivirBBFOHStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != sivirBBFOHProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := sivirBBFOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSivirBBFOH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(sivirBBFOHDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(sivirBBFOHDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(sivirBBFOHAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic Q ability_started")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only Q", done.Summary.AbilityStats)
	}

	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == sentinelKey {
			found = &compileReq.SharedProviders[i]
		}
	}
	if found == nil {
		t.Fatal("unrelated sentinel provider definition was dropped")
	}
	after, err := json.Marshal(*found)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("unrelated sentinel definition overwritten:\nbefore=%s\nafter=%s", before, after)
	}
	for _, mount := range compileReq.Combatants[0].Providers {
		if mount.ProviderRef == sentinelKey {
			t.Fatal("sentinel must remain unmounted")
		}
	}
}

// TestSivirBoomerangBladeFirstOutboundHitCompileAndRuntimeGates: compile/run fail-closed
// gates for missing provider definition, mount, ability ref, and operation target.
func TestSivirBoomerangBladeFirstOutboundHitCompileAndRuntimeGates(t *testing.T) {
	t.Run("missing_provider_definition", func(t *testing.T) {
		compileReq, _ := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		compileReq.SharedProviders = nil
		result := compile.CompileGeneric(compileReq)
		if result.OK {
			t.Fatal("expected compile failure when SharedProviders cleared but mount retained")
		}
		if !sivirBBFOHHasErrorCode(result.Result.Errors, model.GenericErrUnknownRef) {
			t.Fatalf("errors=%+v want unknown_ref", result.Result.Errors)
		}
	})

	t.Run("missing_mount", func(t *testing.T) {
		compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		compileReq.Combatants[0].Providers = nil
		for i := range runReq.InitialSnapshot.Combatants {
			if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
				runReq.InitialSnapshot.Combatants[i].Providers = nil
			}
		}
		result := compile.CompileGeneric(compileReq)
		if !result.OK {
			t.Fatalf("compile with missing mount unexpectedly failed: %+v", result.Result.Errors)
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done, runErr := runtimeengine.RunGeneric(result.Session, runReq)
		if runErr != nil {
			t.Fatalf("run error=%+v", runErr)
		}
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("castCount=%d want 0 without mount", done.Summary.AbilityCastCount)
		}
		if sivirBBFOHSkipReasonCount(done, model.AttemptSkipUnknownAbilityRef) != 1 {
			t.Fatalf("want unknown_ability_ref skip; evidence=%+v", done.Evidence.Items)
		}
	})

	t.Run("missing_ability_ref", func(t *testing.T) {
		compileReq, runReq := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: "source.provider[" + sivirBBFOHProviderRef + "].ability[no_such_ability]",
				Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		result := compile.CompileGeneric(compileReq)
		if !result.OK {
			t.Fatalf("compile failed: %+v", result.Result.Errors)
		}
		done, runErr := runtimeengine.RunGeneric(result.Session, runReq)
		if runErr != nil {
			t.Fatalf("run error=%+v", runErr)
		}
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
		}
		if sivirBBFOHSkipReasonCount(done, model.AttemptSkipUnknownAbilityRef) != 1 {
			t.Fatal("want exactly one unknown_ability_ref skip")
		}
	})

	t.Run("missing_target", func(t *testing.T) {
		compileReq, _ := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		p := sivirBBFOHFindProvider(compileReq)
		if p == nil {
			t.Fatal("provider missing")
		}
		p.Abilities[0].Operations[0].Target = ""
		result := compile.CompileGeneric(compileReq)
		if result.OK {
			t.Fatal("expected compile failure for empty operation target")
		}
		if !sivirBBFOHHasErrorCode(result.Result.Errors, model.GenericErrOperationTargetMissing) {
			t.Fatalf("errors=%+v want operation_target_missing", result.Result.Errors)
		}
	})
}

// TestSivirBoomerangBladeFirstOutboundHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// wrong/missing/released session behavior.
func TestSivirBoomerangBladeFirstOutboundHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
				baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
				resolvedAP: sivirBBFOHFixtureAPDefault, critChance: 0.5,
				armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
			})
			ref := sivirBBFOHAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
			}
			r.StopPolicy.DurationMs = 8100
			done := runSivirBBFOH(t, c, r)
			sum, err := json.Marshal(done.Summary)
			if err != nil {
				t.Fatal(err)
			}
			ev, err := json.Marshal(done.Evidence)
			if err != nil {
				t.Fatal(err)
			}
			snap, err := json.Marshal(done.FinalSnapshot)
			if err != nil {
				t.Fatal(err)
			}
			return string(sum), string(ev), string(snap)
		}
		s1, e1, f1 := runOnce()
		s2, e2, f2 := runOnce()
		if s1 != s2 || e1 != e2 || f1 != f2 {
			t.Fatal("summary/evidence/finalSnapshot unstable across runs")
		}
	})

	t.Run("same_snapshot_repeated_run", func(t *testing.T) {
		c, r := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: 0.5,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		ref := sivirBBFOHAbilityRef()
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 7999},
			{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 8000},
		}
		r.StopPolicy.DurationMs = 8100
		result := compile.CompileGeneric(c)
		if !result.OK {
			t.Fatalf("compile failed: %+v", result.Result.Errors)
		}
		done1, err := runtimeengine.RunGeneric(result.Session, r)
		if err != nil {
			t.Fatal(err)
		}
		done2, err := runtimeengine.RunGeneric(result.Session, r)
		if err != nil {
			t.Fatal(err)
		}
		sum1, _ := json.Marshal(done1.Summary)
		sum2, _ := json.Marshal(done2.Summary)
		ev1, _ := json.Marshal(done1.Evidence)
		ev2, _ := json.Marshal(done2.Evidence)
		snap1, _ := json.Marshal(done1.FinalSnapshot)
		snap2, _ := json.Marshal(done2.FinalSnapshot)
		if string(sum1) != string(sum2) || string(ev1) != string(ev2) || string(snap1) != string(snap2) {
			t.Fatal("same compiled session + runReq produced divergent outputs")
		}
	})

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runSivirBBFOHFrames(t, c, r)
		if len(sivirBBFOHDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(sivirBBFOHDamageEvidence(done)))
		}
		sivirBBFOHAssertDamage(t, sivirBBFOHDamageEvidence(done)[0],
			sivirBBFOHExpectedRawCrit0, sivirBBFOHExpectedMitCrit0)
		if len(sivirBBFOHAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadSivirBBFOHFixture(t, sivirBBFOHFixtureOpts{
			baseAD: sivirBBFOHADBaseDefault, resolvedAD: sivirBBFOHADResolvedDefault,
			resolvedAP: sivirBBFOHFixtureAPDefault, critChance: sivirBBFOHFixtureCritDefault,
			armor: sivirBBFOHTargetArmorDefault, mana: sivirBBFOHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: sivirBBFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50

		session := runtimeengine.NewMathSession()
		session.ClearOutbox()
		if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, c)); code != 0 {
			t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
		}
		compiled := lastGenericCompileResult(session.OutboxBytes())
		if !compiled.OK || compiled.SessionID == "" {
			t.Fatalf("compile failed: %+v", compiled)
		}

		session.ClearOutbox()
		wrongHash := r
		wrongHash.SessionID = compiled.SessionID
		wrongHash.ExpectedRulesHash = "rules.wrong-hash"
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, wrongHash)); code != -1 {
			t.Fatalf("wrong hash RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrHashMismatch {
			t.Fatal("want hash_mismatch for wrong ExpectedRulesHash")
		}

		session.ClearOutbox()
		missing := r
		missing.SessionID = "missing-session"
		missing.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, missing)); code != -1 {
			t.Fatalf("missing session RunFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("want session_not_found for missing session")
		}

		session.ClearOutbox()
		releaseReq := model.ReleaseSessionRequest{
			SessionID: compiled.SessionID, ExpectedRulesHash: compiled.RulesHash,
		}
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
			t.Fatalf("ReleaseSessionFrame code=%d", code)
		}
		released := lastGenericReleaseDone(session.OutboxBytes())
		if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
			t.Fatalf("release=%+v", released)
		}

		session.ClearOutbox()
		if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != -1 {
			t.Fatalf("second ReleaseSessionFrame code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("second release want session_not_found")
		}

		session.ClearOutbox()
		rerun := r
		rerun.SessionID = compiled.SessionID
		rerun.ExpectedRulesHash = compiled.RulesHash
		if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
			t.Fatalf("RunFrame after release code=%d want -1", code)
		}
		if lastGenericError(session.OutboxBytes()).Code != model.GenericErrSessionNotFound {
			t.Fatal("released session re-run want session_not_found")
		}
	})
}
