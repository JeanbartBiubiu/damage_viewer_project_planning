// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	regexp "regexp"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	jhinDFProviderRef = "provider_hero_jhin_w_deadly_flourish_primary_hit"
	jhinDFStableID    = "hero_jhin_w_deadly_flourish_primary_hit"
	jhinDFAbilityID   = "ability_hero_jhin_w_deadly_flourish_primary_hit"
	jhinDFAbilityKey  = "deadly_flourish_primary_hit"
	jhinDFDamageOpRef = "op:jhin_deadly_flourish_primary_hit_damage"
	jhinDFTotalADMod  = "fixture_jhin_deadly_flourish_primary_hit_total_ad"

	jhinDFBaseDamage = 210.0
	jhinDFADRatio    = 0.50
	jhinDFManaCost   = 70.0
	jhinDFCDMs       = 12000.0

	// Fixture base stays independent; flat modifier raises ad.resolved to total AD.
	jhinDFADBase            = 59.0
	jhinDFADResolvedDefault = 100.0
	jhinDFFixtureManaCD     = 210.0
	jhinDFFixtureManaShort  = 69.0
	jhinDFTargetArmor       = 100.0
	jhinDFTargetHP          = 1000.0

	jhinDFExpectedRawDefault = 260.0 // 210 + 0.50*100
	jhinDFExpectedMitDefault = 130.0 // armor100
	jhinDFManaAfter2         = 70.0  // 210 - 70 - 70
	jhinDFHPAfter2           = 740.0 // 1000 - 130 - 130

	jhinDFTol = 1e-9
)

func jhinDFExpectedRawFromTotalAD(resolvedAD float64) float64 {
	return jhinDFBaseDamage + jhinDFADRatio*resolvedAD
}

func jhinDFDamageAmount() *model.GenericFormulaExpr {
	base := jhinDFBaseDamage
	adRatio := jhinDFADRatio
	// Binary add only: const 210 + mul(0.50, source.attr.ad.resolved).
	// Total AD direct resolved read — never subtract ad.base.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &adRatio},
					{Op: "read", Path: "source.attr.ad.resolved"},
				},
			},
		},
	}
}

func jhinDFAbility() model.AbilityDefinition {
	cost := jhinDFManaCost
	cd := jhinDFCDMs
	return model.AbilityDefinition{
		AbilityKey: jhinDFAbilityKey,
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
				Ref:           jhinDFDamageOpRef,
				Amount:        jhinDFDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func jhinDFProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: jhinDFProviderRef,
		Kind:        "champion",
		StableID:    jhinDFStableID,
		Abilities:   []model.AbilityDefinition{jhinDFAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed W provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: jhinDFTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func jhinDFAbilityRef() string {
	return "source.provider[" + jhinDFProviderRef + "].ability[" + jhinDFAbilityKey + "]"
}

type jhinDFFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureJhinDFProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts jhinDFFixtureOpts) {
	flat := opts.resolvedAD - jhinDFADBase
	p := jhinDFProviderDef(flat)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: jhinDFProviderRef, DefinitionRef: jhinDFProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: jhinDFProviderRef, DefinitionRef: jhinDFProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureJhinDFTypes(req *model.CompileRequest) {
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

func loadJhinDFFixture(t *testing.T, opts jhinDFFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.resolvedAD == 0 {
		opts.resolvedAD = jhinDFADResolvedDefault
	}
	if opts.mana == 0 {
		opts.mana = jhinDFFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = jhinDFTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureJhinDFTypes(&compileReq)
	configureJhinDFProvider(&compileReq, &runReq, opts)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: jhinDFADBase, Current: jhinDFADBase,
		Max: jhinDFADBase, Resolved: jhinDFADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, jhinDFFixtureManaCD),
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

func runJhinDF(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runJhinDFFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	session := runtimeengine.NewSession()
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

func jhinDFSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func jhinDFSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source missing attr %s", attr)
		}
		return slot.Base
	}
	t.Fatal("source missing")
	return 0
}

func jhinDFSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func jhinDFDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := jhinDFAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != jhinDFDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jhinDFAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only W mounted, filter by
	// event ref and successful-cast times. Damage evidence still filters by op/ability.
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jhinDFFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == jhinDFProviderRef {
			return p
		}
	}
	return nil
}

func assertJhinDFProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := jhinDFFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_jhin_w_deadly_flourish_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != jhinDFProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, jhinDFProviderRef)
	}
	if p.StableID != jhinDFStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, jhinDFStableID)
	}
	banned := []string{
		"provider_hero_jhin_p_", "provider_hero_jhin_q_", "provider_hero_jhin_e_",
		"provider_hero_jhin_r_", "provider_hero_jhin_basic_",
		"ability_hero_jhin_p_", "ability_hero_jhin_q_", "ability_hero_jhin_e_",
		"ability_hero_jhin_r_", "ability_hero_jhin_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("deadly flourish primary-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if expectTotalADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only total-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != jhinDFTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], jhinDFTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), jhinDFAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != jhinDFAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, jhinDFAbilityKey, jhinDFAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("deadly_flourish_primary_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-jhinDFManaCost) > jhinDFTol {
		t.Fatalf("cost=%+v want mana const 70", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-jhinDFCDMs) > jhinDFTol {
		t.Fatalf("cooldown=%+v want const 12000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("deadly flourish damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("deadly flourish damage must not be copyable on hit")
	}
	if op.Ref != jhinDFDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, jhinDFDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 210, mul(0.50, ad.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-jhinDFBaseDamage) > jhinDFTol {
		t.Fatalf("base const=%+v want 210", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-jhinDFADRatio) > jhinDFTol {
		t.Fatalf("AD ratio=%+v want 0.50", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	if adMul.Args[1].Op == "sub" || (len(adMul.Args) > 1 && adMul.Args[1].Op == "sub") {
		t.Fatal("total-AD formula must not subtract ad.base")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "mark" ||
			bannedOp.Operation == "movement_speed" || bannedOp.Operation == "cast_delay" {
			t.Fatalf("deadly flourish must not include excluded op: %+v", bannedOp)
		}
	}
}

func findJhinDFAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := jhinDFAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func jhinDFAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > jhinDFTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > jhinDFTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != jhinDFDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), jhinDFDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != jhinDFAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), jhinDFAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != jhinDFProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), jhinDFProviderRef)
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
}

// TestJhinDeadlyFlourishConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestJhinDeadlyFlourishConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadJhinDFFixture(t, jhinDFFixtureOpts{
		resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor, mana: jhinDFFixtureManaCD,
	})
	assertJhinDFProviderShape(t, compileReq, 1, true)
	rawX := jhinDFExpectedRawFromTotalAD(jhinDFADResolvedDefault)
	if math.Abs(rawX-jhinDFExpectedRawDefault) > jhinDFTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, jhinDFExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, jhinDFTargetArmor)
	if math.Abs(mitX-jhinDFExpectedMitDefault) > jhinDFTol {
		t.Fatalf("default mit=%v want %v", mitX, jhinDFExpectedMitDefault)
	}
	bonusOnly := jhinDFExpectedRawFromTotalAD(jhinDFADResolvedDefault - jhinDFADBase)
	if math.Abs(bonusOnly-jhinDFExpectedRawDefault) < jhinDFTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	baseOnly := jhinDFExpectedRawFromTotalAD(jhinDFADBase)
	if math.Abs(baseOnly-jhinDFExpectedRawDefault) < jhinDFTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestJhinDeadlyFlourishFormulaMitigationTable: totalAD60/100 × armor0/100 raw/mitigated table.
func TestJhinDeadlyFlourishFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"totalAD60_armor0", 60, 0, 240, 240},
		{"totalAD60_armor100", 60, 100, 240, 120},
		{"totalAD100_armor0", 100, 0, 260, 260},
		{"totalAD100_armor100", 100, 100, 260, 130},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := jhinDFExpectedRawFromTotalAD(tc.resolvedAD)
			if math.Abs(rawX-tc.wantRaw) > jhinDFTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > jhinDFTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadJhinDFFixture(t, jhinDFFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: jhinDFFixtureManaCD,
			})
			assertJhinDFProviderShape(t, compileReq, 1, tc.resolvedAD != jhinDFADBase)
			ref := jhinDFAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJhinDF(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := jhinDFDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("W damage evidence=%d want 1", len(dmg))
			}
			jhinDFAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > jhinDFTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(jhinDFSourceAttrBase(t, done.FinalSnapshot, "ad")-jhinDFADBase) > jhinDFTol {
				t.Fatalf("ad.base=%v want %v", jhinDFSourceAttrBase(t, done.FinalSnapshot, "ad"), jhinDFADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(jhinDFAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(jhinDFAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestJhinDeadlyFlourishCooldownMana210AbilityStarted: mana210/HP1000/AD100/armor100 at
// t0/t11999/t12000 → success/skip/success; final mana70/HP740; two W damage items
// and two automatic W ability_started events.
func TestJhinDeadlyFlourishCooldownMana210AbilityStarted(t *testing.T) {
	compileReq, runReq := loadJhinDFFixture(t, jhinDFFixtureOpts{
		resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor,
		mana: jhinDFFixtureManaCD, hp: jhinDFTargetHP,
	})
	assertJhinDFProviderShape(t, compileReq, 1, true)
	ref := jhinDFAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
		{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100
	done := runJhinDF(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if jhinDFSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findJhinDFAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt11999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 11999 {
			t.Fatalf("cooldown skip TimeMs=%d want 11999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 12000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 12000", item.Data["readyAtMs"])
		}
		skipAt11999 = true
	}
	if !skipAt11999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=11999 with readyAtMs=12000")
	}

	items := jhinDFDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("W damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 12000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		jhinDFAssertDamage(t, item, jhinDFExpectedRawDefault, jhinDFExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * jhinDFExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-jhinDFHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, jhinDFHPAfter2)
	}
	gotMana := jhinDFSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-jhinDFManaAfter2) > jhinDFTol {
		t.Fatalf("mana=%v want %v", gotMana, jhinDFManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := jhinDFAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic W; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 12000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jhinDFADResolvedDefault) > jhinDFTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), jhinDFADResolvedDefault)
	}
	if math.Abs(jhinDFSourceAttrBase(t, done.FinalSnapshot, "ad")-jhinDFADBase) > jhinDFTol {
		t.Fatalf("ad.base=%v want %v", jhinDFSourceAttrBase(t, done.FinalSnapshot, "ad"), jhinDFADBase)
	}
}

// TestJhinDeadlyFlourishResourceInsufficientMana69: mana69 at t0 → resource_insufficient;
// mana/HP unchanged; zero W damage/event.
func TestJhinDeadlyFlourishResourceInsufficientMana69(t *testing.T) {
	compileReq, runReq := loadJhinDFFixture(t, jhinDFFixtureOpts{
		resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor,
		mana: jhinDFFixtureManaShort, hp: jhinDFTargetHP,
	})
	ref := jhinDFAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJhinDF(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if jhinDFSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(jhinDFSourceMana(t, done.FinalSnapshot)-jhinDFFixtureManaShort) > jhinDFTol {
		t.Fatalf("mana changed: got %v want %v",
			jhinDFSourceMana(t, done.FinalSnapshot), jhinDFFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-jhinDFTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, jhinDFTargetHP)
	}
	if len(jhinDFDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero W damage evidence")
	}
	if len(jhinDFAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestJhinDeadlyFlourishStandaloneNoSiblingSynthesis: standalone W provider does not
// synthesize P/Q/E/R/mark/root/movement-speed/basic or overwrite unrelated definitions.
func TestJhinDeadlyFlourishStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadJhinDFFixture(t, jhinDFFixtureOpts{
		resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor, mana: jhinDFFixtureManaCD,
	})
	assertJhinDFProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_jhin_deadly_flourish_unrelated_sentinel"
	sentinelStable := "fixture_jhin_deadly_flourish_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != jhinDFProviderRef {
		t.Fatalf("source mounts=%+v want only W", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != jhinDFProviderRef {
			t.Fatalf("source snapshots=%+v want only W", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_jhin_[pqer]_|ability_hero_jhin_[pqer]_|` +
		`provider_hero_jhin_basic_|ability_hero_jhin_basic_|` +
		`mark|root|movement[_-]?speed`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == jhinDFProviderRef || p.StableID == jhinDFStableID {
				// Provider/stable IDs themselves are W-scoped and must not match sibling.
				continue
			}
			t.Fatalf("must not synthesize sibling/basic/mark/root/ms provider: %+v", p)
		}
		if p.ProviderKey != jhinDFProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("W must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := jhinDFAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJhinDF(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(jhinDFDamageEvidence(done)) != 1 {
		t.Fatalf("W damage=%d want 1", len(jhinDFDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone W must not synthesize extra damage")
	}
	if len(jhinDFAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic W ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
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
	for _, snapC := range done.FinalSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		for _, ps := range snapC.Providers {
			if ps.ProviderRef == sentinelKey {
				t.Fatal("sentinel must not appear in final provider snapshots")
			}
			if siblingPat.MatchString(ps.ProviderRef) || siblingPat.MatchString(ps.DefinitionRef) {
				if ps.ProviderRef == jhinDFProviderRef || ps.DefinitionRef == jhinDFProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic/mark/root/ms: %+v", ps)
			}
		}
	}
}

// TestJhinDeadlyFlourishDeterminismAndLifecycle: repeated compile/run evidence stability plus
// CompileFrame→RunFrame→ReleaseSessionFrame and wrong/missing/released session behavior.
func TestJhinDeadlyFlourishDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadJhinDFFixture(t, jhinDFFixtureOpts{
				resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor, mana: jhinDFFixtureManaCD,
			})
			ref := jhinDFAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "w_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 11999},
				{EntryKey: "w_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
			}
			r.StopPolicy.DurationMs = 12100
			done := runJhinDF(t, c, r)
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

	t.Run("frame_release", func(t *testing.T) {
		c, r := loadJhinDFFixture(t, jhinDFFixtureOpts{
			resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor, mana: jhinDFFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: jhinDFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runJhinDFFrames(t, c, r)
		if len(jhinDFDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path W damage=%d want 1", len(jhinDFDamageEvidence(done)))
		}
		jhinDFAssertDamage(t, jhinDFDamageEvidence(done)[0], jhinDFExpectedRawDefault, jhinDFExpectedMitDefault)
		if len(jhinDFAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadJhinDFFixture(t, jhinDFFixtureOpts{
			resolvedAD: jhinDFADResolvedDefault, armor: jhinDFTargetArmor, mana: jhinDFFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: jhinDFAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50

		session := runtimeengine.NewSession()
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
