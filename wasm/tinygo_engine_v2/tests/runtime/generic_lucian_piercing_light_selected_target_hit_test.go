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
	lucianPLProviderRef = "provider_hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLStableID    = "hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLAbilityID   = "ability_hero_lucian_q_piercing_light_selected_target_hit"
	lucianPLAbilityKey  = "piercing_light_selected_target_hit"
	lucianPLDamageOpRef = "op:lucian_piercing_light_selected_target_hit_damage"
	lucianPLBonusADMod  = "fixture_lucian_piercing_light_selected_target_hit_bonus_ad"

	lucianPLBaseDamage   = 220.0
	lucianPLBonusADRatio = 1.00
	lucianPLManaCost     = 80.0
	lucianPLCDMs         = 5000.0

	// Fixture base stays 60; flat bonus-AD modifier raises ad.resolved.
	lucianPLADBase            = 60.0
	lucianPLADResolvedDefault = 160.0
	lucianPLFixtureManaCD     = 240.0
	lucianPLFixtureManaShort  = 79.0
	lucianPLTargetArmor       = 100.0
	lucianPLTargetHP          = 1000.0

	lucianPLExpectedRawDefault = 320.0 // 220 + 1.00*(160-60)
	lucianPLExpectedMitDefault = 160.0 // armor100
	lucianPLManaAfter2         = 80.0  // 240 - 80 - 80
	lucianPLHPAfter2           = 680.0 // 1000 - 160 - 160

	lucianPLTol = 1e-9
)

func lucianPLExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return lucianPLBaseDamage + lucianPLBonusADRatio*(resolvedAD-baseAD)
}

func lucianPLDamageAmount() *model.GenericFormulaExpr {
	base := lucianPLBaseDamage
	ratio := lucianPLBonusADRatio
	// Binary add only: const 220 + mul(1.00, sub(ad.resolved, ad.base)).
	// Bonus AD — formula must read both base and resolved.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
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
	}
}

func lucianPLAbility() model.AbilityDefinition {
	cost := lucianPLManaCost
	cd := lucianPLCDMs
	return model.AbilityDefinition{
		AbilityKey: lucianPLAbilityKey,
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
				Ref:           lucianPLDamageOpRef,
				Amount:        lucianPLDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func lucianPLProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: lucianPLProviderRef,
		Kind:        "champion",
		StableID:    lucianPLStableID,
		Abilities:   []model.AbilityDefinition{lucianPLAbility()},
	}
	// Fixture-only flat AD so ad.base stays 60 while ad.resolved can rise.
	// Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: lucianPLBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func lucianPLAbilityRef() string {
	return "source.provider[" + lucianPLProviderRef + "].ability[" + lucianPLAbilityKey + "]"
}

type lucianPLFixtureOpts struct {
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
}

func configureLucianPLProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, opts lucianPLFixtureOpts) {
	bonusAD := opts.resolvedAD - lucianPLADBase
	p := lucianPLProviderDef(bonusAD)
	compileReq.SharedProviders = []model.ProviderDefinition{p}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: lucianPLProviderRef, DefinitionRef: lucianPLProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func ensureLucianPLTypes(req *model.CompileRequest) {
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

func loadLucianPLFixture(t *testing.T, opts lucianPLFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAD/armor explicitly (armor0 is a valid branch).
	if opts.mana == 0 {
		opts.mana = lucianPLFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = lucianPLTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureLucianPLTypes(&compileReq)
	configureLucianPLProvider(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_lucian / ad / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: lucianPLADBase, Current: lucianPLADBase,
		Max: lucianPLADBase, Resolved: lucianPLADBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, lucianPLFixtureManaCD),
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

func runLucianPL(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runLucianPLFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func lucianPLSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func lucianPLSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func lucianPLSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func lucianPLDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := lucianPLAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != lucianPLDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func lucianPLAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only Q mounted, filter by
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

func lucianPLFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == lucianPLProviderRef {
			return p
		}
	}
	return nil
}

func assertLucianPLProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := lucianPLFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_lucian_q_piercing_light_selected_target_hit missing from SharedProviders")
	}
	if p.ProviderKey != lucianPLProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, lucianPLProviderRef)
	}
	if p.StableID != lucianPLStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, lucianPLStableID)
	}
	banned := []string{
		"provider_hero_lucian_p_", "provider_hero_lucian_w_", "provider_hero_lucian_e_",
		"provider_hero_lucian_r_", "provider_hero_lucian_basic_",
		"ability_hero_lucian_p_", "ability_hero_lucian_w_", "ability_hero_lucian_e_",
		"ability_hero_lucian_r_", "ability_hero_lucian_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("piercing_light selected-target-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != lucianPLBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], lucianPLBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), lucianPLAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != lucianPLAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, lucianPLAbilityKey, lucianPLAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("piercing_light_selected_target_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-lucianPLManaCost) > lucianPLTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-lucianPLCDMs) > lucianPLTol {
		t.Fatalf("cooldown=%+v want const 5000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("piercing_light damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("piercing_light damage must not be copyable on hit")
	}
	if op.Ref != lucianPLDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, lucianPLDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 220, mul(1.00, sub(ad.resolved, ad.base)))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-lucianPLBaseDamage) > lucianPLTol {
		t.Fatalf("base const=%+v want 220", op.Amount.Args[0])
	}
	adMul := op.Amount.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("bonus-AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-lucianPLBonusADRatio) > lucianPLTol {
		t.Fatalf("bonus-AD ratio=%+v want 1.00", adMul.Args[0])
	}
	sub := adMul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 ||
		sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" ||
		sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("bonus AD read=%+v want sub(ad.resolved, ad.base) — both base and resolved", sub)
	}
	if adMul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	if adMul.Args[1].Op == "read" && adMul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("must not use total-AD direct resolved read; bonus AD requires sub(resolved, base)")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "buffer" ||
			bannedOp.Operation == "lockout" {
			t.Fatalf("piercing_light must not include excluded op: %+v", bannedOp)
		}
	}
}

func findLucianPLAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := lucianPLAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func lucianPLAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > lucianPLTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > lucianPLTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != lucianPLDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), lucianPLDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != lucianPLAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), lucianPLAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != lucianPLProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), lucianPLProviderRef)
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

// TestLucianPiercingLightSelectedTargetHitConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestLucianPiercingLightSelectedTargetHitConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)
	rawX := lucianPLExpectedRawFromAD(lucianPLADResolvedDefault, lucianPLADBase)
	if math.Abs(rawX-lucianPLExpectedRawDefault) > lucianPLTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, lucianPLExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, lucianPLTargetArmor)
	if math.Abs(mitX-lucianPLExpectedMitDefault) > lucianPLTol {
		t.Fatalf("default mit=%v want %v", mitX, lucianPLExpectedMitDefault)
	}
	// Prove bonus-AD vs total-AD: total-AD would be 220+160=380, not 320.
	totalADRaw := lucianPLBaseDamage + lucianPLBonusADRatio*lucianPLADResolvedDefault
	if math.Abs(totalADRaw-lucianPLExpectedRawDefault) < lucianPLTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
	if math.Abs(totalADRaw-380) > lucianPLTol {
		t.Fatalf("total-AD cross-check=%v want 380", totalADRaw)
	}
}

// TestLucianPiercingLightSelectedTargetHitFormulaMitigationTable: base60 ×
// resolved60/160/260 × armor0/100 raw/mitigated table from the frozen
// deterministic fixtures; proves formula reads both ad.base and ad.resolved.
func TestLucianPiercingLightSelectedTargetHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, armor      float64
		wantRaw, wantMitigated float64
	}{
		{"base60_resolved60_armor0", 60, 0, 220, 220},
		{"base60_resolved60_armor100", 60, 100, 220, 110},
		{"base60_resolved160_armor0", 160, 0, 320, 320},
		{"base60_resolved160_armor100", 160, 100, 320, 160},
		{"base60_resolved260_armor100", 260, 100, 420, 210},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := lucianPLExpectedRawFromAD(tc.resolvedAD, lucianPLADBase)
			if math.Abs(rawX-tc.wantRaw) > lucianPLTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > lucianPLTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
				resolvedAD: tc.resolvedAD, armor: tc.armor, mana: lucianPLFixtureManaCD,
			})
			assertLucianPLProviderShape(t, compileReq, 1, tc.resolvedAD != lucianPLADBase)
			ref := lucianPLAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runLucianPL(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := lucianPLDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			lucianPLAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > lucianPLTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad")-lucianPLADBase) > lucianPLTol {
				t.Fatalf("ad.base=%v want %v (formula must read base)", lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad"), lucianPLADBase)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(lucianPLAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(lucianPLAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestLucianPiercingLightSelectedTargetHitCooldownMana240AbilityStarted: mana240/
// base60/resolved160/HP1000/armor100 at t0/t4999/t5000 → success/skip/success;
// final mana80/HP680; two Q damage items and two automatic Q ability_started events.
func TestLucianPiercingLightSelectedTargetHitCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor,
		mana: lucianPLFixtureManaCD, hp: lucianPLTargetHP,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)
	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if lucianPLSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findLucianPLAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt4999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 4999 {
			t.Fatalf("cooldown skip TimeMs=%d want 4999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 5000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 5000", item.Data["readyAtMs"])
		}
		skipAt4999 = true
	}
	if !skipAt4999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=4999 with readyAtMs=5000")
	}

	items := lucianPLDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 5000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		lucianPLAssertDamage(t, item, lucianPLExpectedRawDefault, lucianPLExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * lucianPLExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianPLHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, lucianPLHPAfter2)
	}
	gotMana := lucianPLSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-lucianPLManaAfter2) > lucianPLTol {
		t.Fatalf("mana=%v want %v", gotMana, lucianPLManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := lucianPLAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 5000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-lucianPLADResolvedDefault) > lucianPLTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), lucianPLADResolvedDefault)
	}
	if math.Abs(lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad")-lucianPLADBase) > lucianPLTol {
		t.Fatalf("ad.base=%v want %v", lucianPLSourceAttrBase(t, done.FinalSnapshot, "ad"), lucianPLADBase)
	}
}

// TestLucianPiercingLightSelectedTargetHitResourceInsufficientMana79: mana79 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event evidence.
func TestLucianPiercingLightSelectedTargetHitResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor,
		mana: lucianPLFixtureManaShort, hp: lucianPLTargetHP,
	})
	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if lucianPLSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(lucianPLSourceMana(t, done.FinalSnapshot)-lucianPLFixtureManaShort) > lucianPLTol {
		t.Fatalf("mana changed: got %v want %v",
			lucianPLSourceMana(t, done.FinalSnapshot), lucianPLFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-lucianPLTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, lucianPLTargetHP)
	}
	if len(lucianPLDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(lucianPLAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestLucianPiercingLightSelectedTargetHitStandaloneNoSiblingSynthesis: standalone Q
// provider does not synthesize P/W/E/R/basic or overwrite unrelated definitions.
func TestLucianPiercingLightSelectedTargetHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadLucianPLFixture(t, lucianPLFixtureOpts{
		resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
	})
	assertLucianPLProviderShape(t, compileReq, 1, true)

	sentinelKey := "fixture_lucian_piercing_light_unrelated_sentinel"
	sentinelStable := "fixture_lucian_piercing_light_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != lucianPLProviderRef {
		t.Fatalf("source mounts=%+v want only Q", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != lucianPLProviderRef {
			t.Fatalf("source snapshots=%+v want only Q", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_lucian_[pwer]_|ability_hero_lucian_[pwer]_|` +
		`provider_hero_lucian_basic_|ability_hero_lucian_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			if p.ProviderKey == lucianPLProviderRef || p.StableID == lucianPLStableID {
				continue
			}
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != lucianPLProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("Q must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := lucianPLAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runLucianPL(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(lucianPLDamageEvidence(done)) != 1 {
		t.Fatalf("Q damage=%d want 1", len(lucianPLDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone Q must not synthesize extra damage")
	}
	if len(lucianPLAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic Q ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
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
	for _, snapC := range done.FinalSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		for _, ps := range snapC.Providers {
			if ps.ProviderRef == sentinelKey {
				t.Fatal("sentinel must not appear in final provider snapshots")
			}
			if siblingPat.MatchString(ps.ProviderRef) || siblingPat.MatchString(ps.DefinitionRef) {
				if ps.ProviderRef == lucianPLProviderRef || ps.DefinitionRef == lucianPLProviderRef {
					continue
				}
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestLucianPiercingLightSelectedTargetHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior.
func TestLucianPiercingLightSelectedTargetHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
				resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
			})
			ref := lucianPLAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
			}
			r.StopPolicy.DurationMs = 5100
			done := runLucianPL(t, c, r)
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
		c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
			resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: lucianPLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runLucianPLFrames(t, c, r)
		if len(lucianPLDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(lucianPLDamageEvidence(done)))
		}
		lucianPLAssertDamage(t, lucianPLDamageEvidence(done)[0], lucianPLExpectedRawDefault, lucianPLExpectedMitDefault)
		if len(lucianPLAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadLucianPLFixture(t, lucianPLFixtureOpts{
			resolvedAD: lucianPLADResolvedDefault, armor: lucianPLTargetArmor, mana: lucianPLFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: lucianPLAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
