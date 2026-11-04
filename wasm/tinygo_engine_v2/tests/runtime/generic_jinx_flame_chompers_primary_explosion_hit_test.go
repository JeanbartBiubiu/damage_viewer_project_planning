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
	jinxFCProviderRef = "provider_hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCStableID    = "hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCAbilityID   = "ability_hero_jinx_e_flame_chompers_primary_explosion_hit"
	jinxFCAbilityKey  = "flame_chompers_primary_explosion_hit"
	jinxFCDamageOpRef = "op:jinx_flame_chompers_primary_explosion_hit_damage"

	jinxFCBaseDamage = 290.0
	jinxFCAPRatio    = 1.00
	jinxFCManaCost   = 90.0
	jinxFCCDMs       = 10000.0

	jinxFCFixtureAPDefault = 100.0
	jinxFCFixtureManaCD    = 270.0
	jinxFCFixtureManaShort = 89.0
	jinxFCTargetMR         = 100.0
	jinxFCTargetHP         = 1000.0
	jinxFCFixtureADProbe   = 200.0 // unrelated AD must not alter E damage

	jinxFCExpectedRawAP0     = 290.0 // 290 + 1.00*0
	jinxFCExpectedMitAP0     = 145.0 // MR100
	jinxFCExpectedRawDefault = 390.0 // 290 + 1.00*100
	jinxFCExpectedMitDefault = 195.0 // MR100
	jinxFCManaAfter2         = 90.0  // 270 - 90 - 90
	jinxFCHPAfter2           = 610.0 // 1000 - 195 - 195

	jinxFCTol = 1e-9
)

func jinxFCExpectedRawFromAP(resolvedAP float64) float64 {
	return jinxFCBaseDamage + jinxFCAPRatio*resolvedAP
}

func jinxFCDamageAmount() *model.GenericFormulaExpr {
	base := jinxFCBaseDamage
	apRatio := jinxFCAPRatio
	// Binary add only: const 290 + mul(1.00, source.attr.ap.resolved).
	// AP is read exactly once.
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &apRatio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func jinxFCCountAPReads(expr *model.GenericFormulaExpr) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == "source.attr.ap.resolved" {
		n++
	}
	for i := range expr.Args {
		n += jinxFCCountAPReads(&expr.Args[i])
	}
	return n
}

func jinxFCAbility() model.AbilityDefinition {
	cost := jinxFCManaCost
	cd := jinxFCCDMs
	return model.AbilityDefinition{
		AbilityKey: jinxFCAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target magic damage; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           jinxFCDamageOpRef,
				Amount:        jinxFCDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func jinxFCProviderDef() model.ProviderDefinition {
	// Production/seed E provider has zero modifiers/listeners/state.
	return model.ProviderDefinition{
		ProviderKey: jinxFCProviderRef,
		Kind:        "champion",
		StableID:    jinxFCStableID,
		Abilities:   []model.AbilityDefinition{jinxFCAbility()},
	}
}

func jinxFCAbilityRef() string {
	return "source.provider[" + jinxFCProviderRef + "].ability[" + jinxFCAbilityKey + "]"
}

type jinxFCFixtureOpts struct {
	resolvedAP float64
	mr         float64
	mana       float64
	hp         float64
	resolvedAD float64 // unrelated AD probe; zero means leave fixture default/unset
	withW      bool
}

func configureJinxFCProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, withW bool) {
	providers := []model.ProviderDefinition{jinxFCProviderDef()}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: jinxFCProviderRef, DefinitionRef: jinxFCProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: jinxFCProviderRef, DefinitionRef: jinxFCProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if withW {
		// Same-package W helpers (read-only use); do not modify W test file.
		flat := jinxZapADResolvedDefault - jinxZapADBase
		providers = append(providers, jinxZapProviderDef(flat))
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: jinxZapProviderRef, DefinitionRef: jinxZapProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
	}
	compileReq.SharedProviders = providers
	compileReq.Combatants[0].Providers = mounts
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = snaps
	}
}

func ensureJinxFCTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "armor")
	formuladefinition.SetDamageFormula(req, "damage/physical", formuladefinition.ResistanceDefense("armor"))

	formuladefinition.DeclareAttributes(req, "magic_resist")
	formuladefinition.SetDamageFormula(req, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))

	need := []model.TypeCatalogEntry{
		{Key: "damage/magic", Domain: "damage"},
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

func loadJinxFCFixture(t *testing.T, opts jinxFCFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass resolvedAP/mr explicitly (AP0 / MR0 are valid branches).
	if opts.mana == 0 {
		opts.mana = jinxFCFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = jinxFCTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureJinxFCTypes(&compileReq)
	configureJinxFCProvider(&compileReq, &runReq, opts.withW)

	// Fixture-only AP/mana/HP/MR values (external-existing-data/check-only); do not
	// claim seed materializes hero_jinx / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, jinxFCFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
	})
	// Always set AD so AD0 isolation probes are explicit. With W mounted, match
	// loadJinxZapFixture: ad.base stays jinxZapADBase while fixture-only flat
	// modifier raises ad.resolved to jinxZapADResolvedDefault.
	adBase := opts.resolvedAD
	if opts.withW {
		adBase = jinxZapADBase
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: adBase, Current: adBase, Max: adBase, Resolved: adBase,
	})
	if opts.withW {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
			Base: jinxZapTargetArmor, Current: jinxZapTargetArmor,
			Max: jinxZapTargetArmor, Resolved: jinxZapTargetArmor,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runJinxFC(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runJinxFCFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func jinxFCSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func jinxFCSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func jinxFCDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := jinxFCAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != jinxFCDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func jinxFCAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	// Automatic ability_started has no operationRef; with only E mounted, filter by
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

func jinxFCFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == jinxFCProviderRef {
			return p
		}
	}
	return nil
}

func assertJinxFCProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := jinxFCFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_jinx_e_flame_chompers_primary_explosion_hit missing from SharedProviders")
	}
	if p.ProviderKey != jinxFCProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, jinxFCProviderRef)
	}
	if p.StableID != jinxFCStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, jinxFCStableID)
	}
	banned := []string{
		"provider_hero_jinx_p_", "provider_hero_jinx_q_", "provider_hero_jinx_w_",
		"provider_hero_jinx_r_", "provider_hero_jinx_basic_",
		"ability_hero_jinx_p_", "ability_hero_jinx_q_", "ability_hero_jinx_w_",
		"ability_hero_jinx_r_", "ability_hero_jinx_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("flame_chompers primary-explosion-hit must not reuse sibling/basic refs: %q", b)
		}
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0", len(p.InitialStateSchema))
	}
	if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), jinxFCAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != jinxFCAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, jinxFCAbilityKey, jinxFCAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("flame_chompers_primary_explosion_hit must not be tagged ability/basic_attack")
		}
	}
	if a.Cost == nil || a.Cost.ResourceKey != "mana" ||
		a.Cost.Amount.Op != "const" || a.Cost.Amount.Value == nil ||
		math.Abs(*a.Cost.Amount.Value-jinxFCManaCost) > jinxFCTol {
		t.Fatalf("cost=%+v want mana const 90", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-jinxFCCDMs) > jinxFCTol {
		t.Fatalf("cooldown=%+v want const 10000", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/magic" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single magic damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("flame chompers damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("flame chompers damage must not be copyable on hit")
	}
	if op.Ref != jinxFCDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, jinxFCDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want binary add(const 290, mul(1.00, ap.resolved))", op.Amount)
	}
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-jinxFCBaseDamage) > jinxFCTol {
		t.Fatalf("base const=%+v want 290", op.Amount.Args[0])
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-jinxFCAPRatio) > jinxFCTol {
		t.Fatalf("AP ratio=%+v want 1.00", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if jinxFCCountAPReads(op.Amount) != 1 {
		t.Fatalf("AP reads=%d want exactly 1", jinxFCCountAPReads(op.Amount))
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "knockdown" || bannedOp.Operation == "projectile" ||
			bannedOp.Operation == "multi_target" || bannedOp.Operation == "state_change" ||
			bannedOp.Operation == "repeat" || bannedOp.Operation == "control" ||
			bannedOp.Operation == "reveal" || bannedOp.Operation == "sight" ||
			bannedOp.Operation == "vision" || bannedOp.Operation == "cast_delay" {
			t.Fatalf("flame chompers must not include excluded op: %+v", bannedOp)
		}
	}
}

func findJinxFCAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := jinxFCAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func jinxFCAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > jinxFCTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > jinxFCTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/magic" {
		t.Fatalf("damageType=%q want damage/magic", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != jinxFCDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), jinxFCDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != jinxFCAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), jinxFCAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != jinxFCProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), jinxFCProviderRef)
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

// TestJinxFlameChompersPrimaryExplosionHitConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestJinxFlameChompersPrimaryExplosionHitConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
	})
	assertJinxFCProviderShape(t, compileReq, 1)
	rawX := jinxFCExpectedRawFromAP(jinxFCFixtureAPDefault)
	if math.Abs(rawX-jinxFCExpectedRawDefault) > jinxFCTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, jinxFCExpectedRawDefault)
	}
	mitX := expectedMitigatedMagic(rawX, jinxFCTargetMR)
	if math.Abs(mitX-jinxFCExpectedMitDefault) > jinxFCTol {
		t.Fatalf("default mit=%v want %v", mitX, jinxFCExpectedMitDefault)
	}
	raw0 := jinxFCExpectedRawFromAP(0)
	if math.Abs(raw0-jinxFCExpectedRawAP0) > jinxFCTol {
		t.Fatalf("AP0 raw=%v want %v", raw0, jinxFCExpectedRawAP0)
	}
	mit0 := expectedMitigatedMagic(raw0, jinxFCTargetMR)
	if math.Abs(mit0-jinxFCExpectedMitAP0) > jinxFCTol {
		t.Fatalf("AP0 mit=%v want %v", mit0, jinxFCExpectedMitAP0)
	}
}

// TestJinxFlameChompersPrimaryExplosionHitFormulaMitigationAndADIsolation:
// AP0/100 × MR100 raw/mitigated; unrelated AD change must not alter E damage.
func TestJinxFlameChompersPrimaryExplosionHitFormulaMitigationAndADIsolation(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAP, mr, ad     float64
		wantRaw, wantMitigated float64
	}{
		{"AP0_MR100_AD0", 0, 100, 0, 290, 145},
		{"AP0_MR100_AD200", 0, 100, 200, 290, 145},
		{"AP100_MR100_AD0", 100, 100, 0, 390, 195},
		{"AP100_MR100_AD200", 100, 100, 200, 390, 195},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := jinxFCExpectedRawFromAP(tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > jinxFCTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedMagic(tc.wantRaw, tc.mr)
			if math.Abs(mitX-tc.wantMitigated) > jinxFCTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
				resolvedAP: tc.resolvedAP, mr: tc.mr, mana: jinxFCFixtureManaCD,
				resolvedAD: tc.ad,
			})
			assertJinxFCProviderShape(t, compileReq, 1)
			ref := jinxFCAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runJinxFC(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := jinxFCDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("E damage evidence=%d want 1", len(dmg))
			}
			jinxFCAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > jinxFCTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.ad) > jinxFCTol {
				t.Fatalf("ad.resolved=%v want unrelated probe %v",
					sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.ad)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(jinxFCAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(jinxFCAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestJinxFlameChompersPrimaryExplosionHitCooldownMana270AbilityStarted: mana270/
// AP100/HP1000/MR100 at t0/t9999/t10000 → success/skip/success; final mana90/HP610;
// two E damage items and two automatic E ability_started events.
func TestJinxFlameChompersPrimaryExplosionHitCooldownMana270AbilityStarted(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
		mana: jinxFCFixtureManaCD, hp: jinxFCTargetHP,
		resolvedAD: jinxFCFixtureADProbe,
	})
	assertJinxFCProviderShape(t, compileReq, 1)
	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
		{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
	}
	runReq.StopPolicy.DurationMs = 10100
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if jinxFCSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findJinxFCAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt9999 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 9999 {
			t.Fatalf("cooldown skip TimeMs=%d want 9999", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 10000 {
			t.Fatalf("cooldown skip readyAtMs=%v want 10000", item.Data["readyAtMs"])
		}
		skipAt9999 = true
	}
	if !skipAt9999 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=9999 with readyAtMs=10000")
	}

	items := jinxFCDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("E damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 10000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		jinxFCAssertDamage(t, item, jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * jinxFCExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxFCHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, jinxFCHPAfter2)
	}
	gotMana := jinxFCSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-jinxFCManaAfter2) > jinxFCTol {
		t.Fatalf("mana=%v want %v", gotMana, jinxFCManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := jinxFCAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic E; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 10000}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-jinxFCFixtureAPDefault) > jinxFCTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), jinxFCFixtureAPDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-jinxFCFixtureADProbe) > jinxFCTol {
		t.Fatalf("ad.resolved=%v want unrelated probe %v (must not affect E damage)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), jinxFCFixtureADProbe)
	}
}

// TestJinxFlameChompersPrimaryExplosionHitResourceInsufficientMana89: mana89 at
// t0 → resource_insufficient; mana/HP unchanged; zero E damage/event.
func TestJinxFlameChompersPrimaryExplosionHitResourceInsufficientMana89(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
		mana: jinxFCFixtureManaShort, hp: jinxFCTargetHP,
	})
	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if jinxFCSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(jinxFCSourceMana(t, done.FinalSnapshot)-jinxFCFixtureManaShort) > jinxFCTol {
		t.Fatalf("mana changed: got %v want %v",
			jinxFCSourceMana(t, done.FinalSnapshot), jinxFCFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-jinxFCTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, jinxFCTargetHP)
	}
	if len(jinxFCDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero E damage evidence")
	}
	if len(jinxFCAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestJinxFlameChompersPrimaryExplosionHitStandaloneNoSiblingSynthesis: standalone
// E provider does not synthesize P/Q/W/R/basic or overwrite unrelated
// definitions/mounts/snapshots.
func TestJinxFlameChompersPrimaryExplosionHitStandaloneNoSiblingSynthesis(t *testing.T) {
	compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
		resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
	})
	assertJinxFCProviderShape(t, compileReq, 1)

	sentinelKey := "fixture_jinx_fc_unrelated_sentinel"
	sentinelStable := "fixture_jinx_fc_unrelated_stable"
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
		compileReq.Combatants[0].Providers[0].ProviderRef != jinxFCProviderRef {
		t.Fatalf("source mounts=%+v want only E", compileReq.Combatants[0].Providers)
	}
	for _, snapC := range runReq.InitialSnapshot.Combatants {
		if snapC.Key != model.SelectorSource {
			continue
		}
		if len(snapC.Providers) != 1 || snapC.Providers[0].ProviderRef != jinxFCProviderRef {
			t.Fatalf("source snapshots=%+v want only E", snapC.Providers)
		}
	}

	siblingPat := regexp.MustCompile(`provider_hero_jinx_[pqwr]_|ability_hero_jinx_[pqwr]_|` +
		`provider_hero_jinx_basic_|ability_hero_jinx_basic_`)
	for _, p := range compileReq.SharedProviders {
		if siblingPat.MatchString(p.ProviderKey) || siblingPat.MatchString(p.StableID) {
			t.Fatalf("must not synthesize sibling/basic provider: %+v", p)
		}
		if p.ProviderKey != jinxFCProviderRef {
			continue
		}
		for _, a := range p.Abilities {
			if a.AbilityKey == "basic_attack" || siblingPat.MatchString(a.AbilityKey) {
				t.Fatalf("E must not reuse sibling/basic ability key: %q", a.AbilityKey)
			}
		}
	}

	ref := jinxFCAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runJinxFC(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if len(jinxFCDamageEvidence(done)) != 1 {
		t.Fatalf("E damage=%d want 1", len(jinxFCDamageEvidence(done)))
	}
	if len(damageEvidenceItems(done)) != 1 {
		t.Fatal("standalone E must not synthesize extra damage")
	}
	if len(jinxFCAbilityStartedEvidence(done)) != 1 {
		t.Fatal("want exactly one automatic E ability_started")
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != ref {
		t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
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
				t.Fatalf("final snapshot synthesized sibling/basic: %+v", ps)
			}
		}
	}
}

// TestJinxFlameChompersPrimaryExplosionHitEWIsolationCoexistence: test-only
// composition of independent E + existing W graphs (same-package W helpers,
// unmodified). Both providers mount; E cast causes only E damage/event and does
// not mutate/trigger W; W cast causes only W damage/event and does not
// mutate/trigger E.
func TestJinxFlameChompersPrimaryExplosionHitEWIsolationCoexistence(t *testing.T) {
	t.Run("e_only_no_w_synthesis", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		assertJinxFCProviderShape(t, compileReq, 1)
		for _, p := range compileReq.SharedProviders {
			if p.ProviderKey == jinxZapProviderRef || p.StableID == jinxZapStableID {
				t.Fatal("E-only must not synthesize W provider")
			}
			for _, a := range p.Abilities {
				if a.AbilityKey == jinxZapAbilityKey {
					t.Fatal("E-only must not synthesize W ability key")
				}
			}
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)
		if len(jinxZapDamageEvidence(done)) != 0 {
			t.Fatal("E-only must not produce W damage")
		}
		if len(done.Summary.AbilityStats) != 1 ||
			done.Summary.AbilityStats[0].AbilityRef != jinxFCAbilityRef() {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
	})

	t.Run("combined_ew_e_cast_no_w_evidence", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
			mana: jinxFCFixtureManaCD, withW: true,
		})
		assertJinxFCProviderShape(t, compileReq, 2)
		assertJinxZapProviderShape(t, compileReq, 2, true)

		if jinxFCProviderRef == jinxZapProviderRef ||
			jinxFCStableID == jinxZapStableID ||
			jinxFCAbilityID == jinxZapAbilityID ||
			jinxFCAbilityKey == jinxZapAbilityKey ||
			jinxFCAbilityRef() == jinxZapAbilityRef() ||
			jinxFCDamageOpRef == jinxZapDamageOpRef {
			t.Fatal("E and W provider/ability/op refs must remain distinct")
		}
		foundE, foundW := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == jinxFCProviderRef {
				foundE = true
			}
			if m.ProviderRef == jinxZapProviderRef {
				foundW = true
			}
		}
		if !foundE || !foundW {
			t.Fatalf("combined mounts=%+v want both E and W", compileReq.Combatants[0].Providers)
		}

		eRef := jinxFCAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: eRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jinxFCDamageEvidence(done)) != 1 {
			t.Fatalf("E damage=%d want 1", len(jinxFCDamageEvidence(done)))
		}
		jinxFCAssertDamage(t, jinxFCDamageEvidence(done)[0],
			jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		if len(jinxZapDamageEvidence(done)) != 0 {
			t.Fatal("E cast must not produce W damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture E cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (E only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jinxZapAbilityRef() {
				t.Fatalf("E cast must not produce W AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != eRef {
			t.Fatalf("AbilityStats=%+v want only E", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jinxZapAbilityRef() {
				t.Fatalf("E cast must not produce W abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jinxZapDamageOpRef {
				t.Fatalf("E cast must not produce W operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jinxZapProviderRef {
				t.Fatalf("E cast must not produce W providerRef evidence: %+v", item)
			}
		}
	})

	t.Run("combined_ew_w_cast_no_e_evidence", func(t *testing.T) {
		compileReq, runReq := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR,
			mana: jinxFCFixtureManaCD, withW: true,
		})
		assertJinxFCProviderShape(t, compileReq, 2)
		assertJinxZapProviderShape(t, compileReq, 2, true)

		wRef := jinxZapAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "w0", AbilityRef: wRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runJinxFC(t, compileReq, runReq)

		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if len(jinxZapDamageEvidence(done)) != 1 {
			t.Fatalf("W damage=%d want 1", len(jinxZapDamageEvidence(done)))
		}
		jinxZapAssertDamage(t, jinxZapDamageEvidence(done)[0],
			jinxZapExpectedRawDefault, jinxZapExpectedMitDefault)
		if len(jinxFCDamageEvidence(done)) != 0 {
			t.Fatal("W cast must not produce E damage evidence")
		}
		if len(damageEvidenceItems(done)) != 1 {
			t.Fatal("combined fixture W cast must not synthesize extra damage")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (W only)", countEmittedEvents(done, "event/ability_started"))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == jinxFCAbilityRef() {
				t.Fatalf("W cast must not produce E AbilityStats: %+v", st)
			}
		}
		if len(done.Summary.AbilityStats) != 1 || done.Summary.AbilityStats[0].AbilityRef != wRef {
			t.Fatalf("AbilityStats=%+v want only W", done.Summary.AbilityStats)
		}
		for _, item := range done.Evidence.Items {
			if evidenceDataString(item.Data, "abilityRef") == jinxFCAbilityRef() {
				t.Fatalf("W cast must not produce E abilityRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "operationRef") == jinxFCDamageOpRef {
				t.Fatalf("W cast must not produce E operationRef evidence: %+v", item)
			}
			if evidenceDataString(item.Data, "providerRef") == jinxFCProviderRef {
				t.Fatalf("W cast must not produce E providerRef evidence: %+v", item)
			}
		}
	})
}

// TestJinxFlameChompersPrimaryExplosionHitDeterminismAndLifecycle: repeated
// compile/run evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame
// and wrong/missing/released session behavior.
func TestJinxFlameChompersPrimaryExplosionHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
				resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
			})
			ref := jinxFCAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 9999},
				{EntryKey: "e_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 10000},
			}
			r.StopPolicy.DurationMs = 10100
			done := runJinxFC(t, c, r)
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
		c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runJinxFCFrames(t, c, r)
		if len(jinxFCDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path E damage=%d want 1", len(jinxFCDamageEvidence(done)))
		}
		jinxFCAssertDamage(t, jinxFCDamageEvidence(done)[0], jinxFCExpectedRawDefault, jinxFCExpectedMitDefault)
		if len(jinxFCAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadJinxFCFixture(t, jinxFCFixtureOpts{
			resolvedAP: jinxFCFixtureAPDefault, mr: jinxFCTargetMR, mana: jinxFCFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "e0", AbilityRef: jinxFCAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
