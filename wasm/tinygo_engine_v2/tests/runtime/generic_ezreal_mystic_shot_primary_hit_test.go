// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	strings "strings"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	ezrealMSProviderRef = "provider_hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSStableID    = "hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSAbilityID   = "ability_hero_ezreal_q_mystic_shot_primary_hit"
	ezrealMSAbilityKey  = "mystic_shot_primary_hit"
	ezrealMSDamageOpRef = "op:ezreal_mystic_shot_primary_hit_damage"
	ezrealMSTotalADMod  = "fixture_ezreal_mystic_shot_primary_hit_total_ad"

	ezrealMSBaseDamage = 120.0
	ezrealMSADRatio    = 1.30
	ezrealMSAPRatio    = 0.40
	ezrealMSManaCost   = 40.0
	ezrealMSCDMs       = 4500.0

	ezrealMSADBaseDefault      = 60.0
	ezrealMSADResolvedDefault  = 160.0
	ezrealMSFixtureAPDefault   = 100.0
	ezrealMSFixtureManaCD      = 120.0
	ezrealMSFixtureManaShort   = 39.0
	ezrealMSTargetArmorDefault = 100.0
	ezrealMSTargetHP           = 1000.0

	// Default CD schedule: 120 + 1.30*160 + 0.40*100 = 368; armor100 → 184.
	ezrealMSExpectedRawDefault = 368.0
	ezrealMSExpectedMitDefault = 184.0
	ezrealMSManaAfter2         = 40.0  // 120 - 40 - 40
	ezrealMSHPAfter2           = 632.0 // 1000 - 184 - 184

	ezrealMSRSFProviderAlias = "provider_hero_ezreal_rising_spell_force"

	ezrealMSTol = 1e-9
)

func ezrealMSExpectedRawFromStats(resolvedAD, resolvedAP float64) float64 {
	return ezrealMSBaseDamage + ezrealMSADRatio*resolvedAD + ezrealMSAPRatio*resolvedAP
}

func ezrealMSDamageAmount() *model.GenericFormulaExpr {
	base := ezrealMSBaseDamage
	adRatio := ezrealMSADRatio
	apRatio := ezrealMSAPRatio
	// Nested binary add: base + totalAD + AP (generic add is binary-only).
	// Total AD = source.attr.ad.resolved — never subtract ad.base; no crit read.
	return &model.GenericFormulaExpr{
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
							{Op: "read", Path: "source.attr.ad.resolved"},
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
	}
}

func ezrealMSCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += ezrealMSCountPathReads(&expr.Args[i], path)
	}
	return n
}

func ezrealMSAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
	t.Helper()
	if expr == nil {
		return
	}
	switch expr.Op {
	case "add", "sub", "mul", "div", "lt", "lte", "gt", "gte":
		if len(expr.Args) != 2 {
			t.Fatalf("op=%q arity=%d want binary 2", expr.Op, len(expr.Args))
		}
	}
	for i := range expr.Args {
		ezrealMSAssertBinaryArity(t, &expr.Args[i])
	}
}

func ezrealMSAbility() model.AbilityDefinition {
	cost := ezrealMSManaCost
	cd := ezrealMSCDMs
	return model.AbilityDefinition{
		AbilityKey: ezrealMSAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Exactly one direct-target physical hit; no explicit event op —
		// successful cast relies on runtime automatic ability_started.
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           ezrealMSDamageOpRef,
				Amount:        ezrealMSDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func ezrealMSProviderDef(flatTotalAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: ezrealMSProviderRef,
		Kind:        "champion",
		StableID:    ezrealMSStableID,
		Abilities:   []model.AbilityDefinition{ezrealMSAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes the intended total AD. Production/seed Q provider has zero modifiers.
	if flatTotalAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: ezrealMSTotalADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(flatTotalAD),
		}}
	}
	return p
}

func ezrealMSAbilityRef() string {
	return "source.provider[" + ezrealMSProviderRef + "].ability[" + ezrealMSAbilityKey + "]"
}

type ezrealMSFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	resolvedAP float64
	armor      float64
	mana       float64
	hp         float64
	withRSF    bool
}

func ezrealMSRSFProviderDef() model.ProviderDefinition {
	// Fine-grained same-package helpers only — never overwrite via configureEzrealRSFProvider.
	return model.ProviderDefinition{
		ProviderKey:        ezrealRSFProviderRef,
		Kind:               "champion",
		StableID:           ezrealRSFStableID,
		InitialStateSchema: ezrealRSFStateSchema(),
		Modifiers:          []model.ModifierDefinition{ezrealRSFASModifier()},
		Listeners:          []model.ListenerDefinition{ezrealRSFStackListener()},
	}
}

func configureEzrealMSProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts ezrealMSFixtureOpts) {
	flat := opts.resolvedAD - opts.baseAD
	shared := []model.ProviderDefinition{ezrealMSProviderDef(flat)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: ezrealMSProviderRef, DefinitionRef: ezrealMSProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{ProviderRef: ezrealMSProviderRef, DefinitionRef: ezrealMSProviderRef, Stacks: 1, State: map[string]interface{}{}},
	}
	if opts.withRSF {
		shared = append(shared, ezrealMSRSFProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: ezrealRSFProviderRef, DefinitionRef: ezrealRSFProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		})
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

func ensureEzrealMSTypes(req *model.CompileRequest) {
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

func loadEzrealMSFixture(t *testing.T, opts ezrealMSFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/resolvedAP/armor explicitly
	// (AD0 / AP0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = ezrealMSFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = ezrealMSTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureEzrealMSTypes(&compileReq)
	if opts.withRSF {
		ensureEzrealRSFTypes(&compileReq)
	}
	configureEzrealMSProviders(&compileReq, &runReq, opts)

	// Fixture-only AD/AP/mana/HP/armor values (external-existing-data/check-only); do not
	// claim seed materializes hero_ezreal / ad / ap / mana identity or panel/resource rows.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.resolvedAP, Current: opts.resolvedAP,
		Max: opts.resolvedAP, Resolved: opts.resolvedAP,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, ezrealMSFixtureManaCD),
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})
	if opts.withRSF {
		setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
			Base: ezrealRSFBaseAS, Current: ezrealRSFBaseAS, Max: ezrealRSFBaseAS, Resolved: ezrealRSFBaseAS,
		})
	}

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runEzrealMS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runEzrealMSFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func ezrealMSSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func ezrealMSSourceAttrBase(t *testing.T, snap model.Snapshot, attr string) float64 {
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

func ezrealMSSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func ezrealMSDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := ezrealMSAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != ezrealMSDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func ezrealMSAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func ezrealMSFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == ezrealMSProviderRef {
			return p
		}
	}
	return nil
}

func assertEzrealMSProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectTotalADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := ezrealMSFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_ezreal_q_mystic_shot_primary_hit missing from SharedProviders")
	}
	if p.ProviderKey != ezrealMSProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, ezrealMSProviderRef)
	}
	if p.StableID != ezrealMSStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, ezrealMSStableID)
	}
	if p.ProviderKey == ezrealMSRSFProviderAlias || p.ProviderKey == ezrealRSFProviderRef ||
		p.StableID == ezrealRSFStableID {
		t.Fatal("Q must not reuse Rising Spell Force provider refs")
	}
	banned := []string{
		"provider_hero_ezreal_p_", "provider_hero_ezreal_w_", "provider_hero_ezreal_e_",
		"provider_hero_ezreal_r_", "provider_hero_ezreal_basic_",
		"ability_hero_ezreal_p_", "ability_hero_ezreal_w_", "ability_hero_ezreal_e_",
		"ability_hero_ezreal_r_", "ability_hero_ezreal_basic_",
	}
	for _, b := range banned {
		if strings.Contains(p.ProviderKey, b) || strings.Contains(p.StableID, b) {
			t.Fatalf("mystic shot primary-hit must not reuse sibling/basic refs: %q", b)
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
		if p.Modifiers[0].ModifierKey != ezrealMSTotalADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], ezrealMSTotalADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when flat=0)", len(p.Modifiers))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), ezrealMSAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != ezrealMSAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, ezrealMSAbilityKey, ezrealMSAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("mystic_shot_primary_hit must not be tagged ability/basic_attack")
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
		math.Abs(*a.Cost.Amount.Value-ezrealMSManaCost) > ezrealMSTol {
		t.Fatalf("cost=%+v want mana const 40", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-ezrealMSCDMs) > ezrealMSTol {
		t.Fatalf("cooldown=%+v want const 4500", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("mystic shot damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("mystic shot damage must not be copyable on hit")
	}
	if op.Ref != ezrealMSDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, ezrealMSDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want nested add(add(const120, mul(1.30, ad.resolved)), mul(0.40, ap.resolved))", op.Amount)
	}
	ezrealMSAssertBinaryArity(t, op.Amount)
	inner := op.Amount.Args[0]
	if inner.Op != "add" || len(inner.Args) != 2 {
		t.Fatalf("inner add=%+v want add(const, mul(adRatio, ad.resolved))", inner)
	}
	if inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
		math.Abs(*inner.Args[0].Value-ezrealMSBaseDamage) > ezrealMSTol {
		t.Fatalf("base const=%+v want 120", inner.Args[0])
	}
	adMul := inner.Args[1]
	if adMul.Op != "mul" || len(adMul.Args) != 2 {
		t.Fatalf("AD branch=%+v want mul", adMul)
	}
	if adMul.Args[0].Op != "const" || adMul.Args[0].Value == nil ||
		math.Abs(*adMul.Args[0].Value-ezrealMSADRatio) > ezrealMSTol {
		t.Fatalf("AD ratio=%+v want 1.30", adMul.Args[0])
	}
	if adMul.Args[1].Op != "read" || adMul.Args[1].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD read=%+v want source.attr.ad.resolved (total AD; never subtract base)", adMul.Args[1])
	}
	if adMul.Args[1].Op == "sub" {
		t.Fatal("total-AD branch must not subtract ad.base")
	}
	apMul := op.Amount.Args[1]
	if apMul.Op != "mul" || len(apMul.Args) != 2 {
		t.Fatalf("AP branch=%+v want mul", apMul)
	}
	if apMul.Args[0].Op != "const" || apMul.Args[0].Value == nil ||
		math.Abs(*apMul.Args[0].Value-ezrealMSAPRatio) > ezrealMSTol {
		t.Fatalf("AP ratio=%+v want 0.40", apMul.Args[0])
	}
	if apMul.Args[1].Op != "read" || apMul.Args[1].Path != "source.attr.ap.resolved" {
		t.Fatalf("AP read=%+v want source.attr.ap.resolved", apMul.Args[1])
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", ezrealMSCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ap.resolved") != 1 {
		t.Fatalf("AP resolved reads=%d want exactly 1", ezrealMSCountPathReads(op.Amount, "source.attr.ap.resolved"))
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.ad.base") != 0 {
		t.Fatal("total-AD formula must not read/subtract source.attr.ad.base")
	}
	if ezrealMSCountPathReads(op.Amount, "source.attr.crit_chance.resolved") != 0 ||
		ezrealMSCountPathReads(op.Amount, "source.attr.crit_damage.resolved") != 0 {
		t.Fatal("mystic shot formula must not read crit attrs")
	}
	for _, bannedOp := range a.Operations {
		if bannedOp.Operation == "emit_event" || bannedOp.Operation == "slow" ||
			bannedOp.Operation == "stun" || bannedOp.Operation == "root" ||
			bannedOp.Operation == "projectile" || bannedOp.Operation == "multi_target" ||
			bannedOp.Operation == "state_change" || bannedOp.Operation == "repeat" ||
			bannedOp.Operation == "control" || bannedOp.Operation == "aoe" ||
			bannedOp.Operation == "field" || bannedOp.Operation == "cast_delay" ||
			bannedOp.Operation == "spell_shield" || bannedOp.Operation == "collision" ||
			bannedOp.Operation == "geometry" || bannedOp.Operation == "channel" ||
			bannedOp.Operation == "matcher" || bannedOp.Operation == "on_hit" ||
			bannedOp.Operation == "on_attack" || bannedOp.Operation == "cooldown_adjust" ||
			bannedOp.Operation == "lifesteal" || bannedOp.Operation == "vamp" ||
			bannedOp.Operation == "buffer" {
			t.Fatalf("mystic shot must not include excluded op: %+v", bannedOp)
		}
	}
}

func findEzrealMSAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := ezrealMSAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func ezrealMSAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > ezrealMSTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > ezrealMSTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != ezrealMSDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), ezrealMSDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != ezrealMSAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), ezrealMSAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != ezrealMSProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), ezrealMSProviderRef)
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

// TestEzrealMysticShotPrimaryHitConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestEzrealMysticShotPrimaryHitConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaCD,
	})
	assertEzrealMSProviderShape(t, compileReq, 1, true)
	rawX := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault, ezrealMSFixtureAPDefault)
	if math.Abs(rawX-ezrealMSExpectedRawDefault) > ezrealMSTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, ezrealMSExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, ezrealMSTargetArmorDefault)
	if math.Abs(mitX-ezrealMSExpectedMitDefault) > ezrealMSTol {
		t.Fatalf("default mit=%v want %v", mitX, ezrealMSExpectedMitDefault)
	}
	bonusAsIf := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault-ezrealMSADBaseDefault, ezrealMSFixtureAPDefault)
	if math.Abs(bonusAsIf-ezrealMSExpectedRawDefault) < ezrealMSTol {
		t.Fatal("bonus-AD substitution raw must differ from total-AD raw")
	}
}

// TestEzrealMysticShotPrimaryHitFormulaMitigationTable: frozen AD×AP vs armor100
// raw/final table; proves nested total-AD+AP formula.
func TestEzrealMysticShotPrimaryHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		resolvedAD, resolvedAP float64
		wantRaw, wantMitigated float64
	}{
		{"resolvedAD60_AP0_armor100", 60, 0, 198, 99},
		{"resolvedAD160_AP0_armor100", 160, 0, 328, 164},
		{"resolvedAD60_AP100_armor100", 60, 100, 238, 119},
		{"resolvedAD160_AP100_armor100", 160, 100, 368, 184},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := ezrealMSExpectedRawFromStats(tc.resolvedAD, tc.resolvedAP)
			if math.Abs(rawX-tc.wantRaw) > ezrealMSTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, ezrealMSTargetArmorDefault)
			if math.Abs(mitX-tc.wantMitigated) > ezrealMSTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			baseAD := ezrealMSADBaseDefault
			if tc.resolvedAD == 0 {
				baseAD = 0
			}
			compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: baseAD, resolvedAD: tc.resolvedAD, resolvedAP: tc.resolvedAP,
				armor: ezrealMSTargetArmorDefault, mana: ezrealMSFixtureManaCD,
			})
			assertEzrealMSProviderShape(t, compileReq, 1, tc.resolvedAD != baseAD)
			ref := ezrealMSAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runEzrealMS(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := ezrealMSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			ezrealMSAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > ezrealMSTol {
				t.Fatalf("ad.resolved=%v want %v (total AD)", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-baseAD) > ezrealMSTol {
				t.Fatalf("ad.base=%v want %v (total-AD formula must leave base independent)",
					ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), baseAD)
			}
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-tc.resolvedAP) > ezrealMSTol {
				t.Fatalf("ap.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ap"), tc.resolvedAP)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(ezrealMSAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(ezrealMSAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestEzrealMysticShotPrimaryHitTotalADCounterproof: baseAD0 versus baseAD60 with
// resolvedAD160/AP0/armor100 must both raw328/final164 — formula reads only
// source.attr.ad.resolved, never source.attr.ad.base.
func TestEzrealMysticShotPrimaryHitTotalADCounterproof(t *testing.T) {
	cases := []struct {
		name   string
		baseAD float64
	}{
		{"baseAD0_resolvedAD160_AP0", 0},
		{"baseAD60_resolvedAD160_AP0", 60},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: ezrealMSADResolvedDefault,
				resolvedAP: 0, armor: ezrealMSTargetArmorDefault, mana: ezrealMSFixtureManaCD,
			})
			assertEzrealMSProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runEzrealMS(t, compileReq, runReq)
			dmg := ezrealMSDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			ezrealMSAssertDamage(t, dmg[0], 328, 164)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-ezrealMSADResolvedDefault) > ezrealMSTol {
				t.Fatalf("ad.resolved=%v want 160", sourceAttrResolved(t, done.FinalSnapshot, "ad"))
			}
			if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > ezrealMSTol {
				t.Fatalf("ad.base=%v want %v", ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	bonusAsIf := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault-ezrealMSADBaseDefault, 0)
	baseAlone := ezrealMSExpectedRawFromStats(ezrealMSADBaseDefault, 0)
	total := ezrealMSExpectedRawFromStats(ezrealMSADResolvedDefault, 0)
	if math.Abs(bonusAsIf-total) < ezrealMSTol {
		t.Fatal("bonus-AD raw must differ from total-AD raw")
	}
	if math.Abs(baseAlone-total) < ezrealMSTol {
		t.Fatal("base-AD raw must differ from total-AD raw")
	}
}

// TestEzrealMysticShotPrimaryHitCooldownMana120AbilityStarted: mana120/baseAD60/
// resolvedAD160/AP100/armor100/HP1000 at t0/t4499/t4500 → success/skip/success;
// final mana40/HP632; exactly two Q physical damage items and two automatic Q
// ability_started events.
func TestEzrealMysticShotPrimaryHitCooldownMana120AbilityStarted(t *testing.T) {
	compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaCD, hp: ezrealMSTargetHP,
	})
	assertEzrealMSProviderShape(t, compileReq, 1, true)
	ref := ezrealMSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4499},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4500},
	}
	runReq.StopPolicy.DurationMs = 4600
	done := runEzrealMS(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if ezrealMSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findEzrealMSAbilityStat(t, done)
	if stat.AttemptCount != 3 || stat.CastCount != 2 || stat.SkipCount != 1 {
		t.Fatalf("abilityStat attempt/cast/skip=%d/%d/%d want 3/2/1",
			stat.AttemptCount, stat.CastCount, stat.SkipCount)
	}

	var skipAt4499 bool
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindAttemptSkipped {
			continue
		}
		if item.Data["skipReason"] != string(model.AttemptSkipCooldownNotReady) {
			continue
		}
		if item.TimeMs != 4499 {
			t.Fatalf("cooldown skip TimeMs=%d want 4499", item.TimeMs)
		}
		if numericAsInt64(item.Data["readyAtMs"]) != 4500 {
			t.Fatalf("cooldown skip readyAtMs=%v want 4500", item.Data["readyAtMs"])
		}
		skipAt4499 = true
	}
	if !skipAt4499 {
		t.Fatal("missing cooldown_not_ready skip evidence at t=4499 with readyAtMs=4500")
	}

	items := ezrealMSDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 4500}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		ezrealMSAssertDamage(t, item, ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * ezrealMSExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-ezrealMSHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, ezrealMSHPAfter2)
	}
	gotMana := ezrealMSSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-ezrealMSManaAfter2) > ezrealMSTol {
		t.Fatalf("mana=%v want %v", gotMana, ezrealMSManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := ezrealMSAbilityStartedEvidence(done)
	if len(started) != 2 {
		t.Fatalf("ability_started=%d want 2 (automatic Q; no explicit event op)", len(started))
	}
	wantStarted := []int64{0, 4500}
	for i, item := range started {
		if item.TimeMs != wantStarted[i] {
			t.Fatalf("ability_started[%d] TimeMs=%d want %d", i, item.TimeMs, wantStarted[i])
		}
	}
	if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
		t.Fatal("must not emit basic_attack_hit")
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-ezrealMSADResolvedDefault) > ezrealMSTol {
		t.Fatalf("ad.resolved=%v want %v (total AD)",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), ezrealMSADResolvedDefault)
	}
	if math.Abs(ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad")-ezrealMSADBaseDefault) > ezrealMSTol {
		t.Fatalf("ad.base=%v want %v",
			ezrealMSSourceAttrBase(t, done.FinalSnapshot, "ad"), ezrealMSADBaseDefault)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ap")-ezrealMSFixtureAPDefault) > ezrealMSTol {
		t.Fatalf("ap.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ap"), ezrealMSFixtureAPDefault)
	}
}

// TestEzrealMysticShotPrimaryHitResourceInsufficientMana39: mana39 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/event evidence.
func TestEzrealMysticShotPrimaryHitResourceInsufficientMana39(t *testing.T) {
	compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
		baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
		resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
		mana: ezrealMSFixtureManaShort, hp: ezrealMSTargetHP,
	})
	ref := ezrealMSAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runEzrealMS(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if ezrealMSSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(ezrealMSSourceMana(t, done.FinalSnapshot)-ezrealMSFixtureManaShort) > ezrealMSTol {
		t.Fatalf("mana changed: got %v want %v",
			ezrealMSSourceMana(t, done.FinalSnapshot), ezrealMSFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-ezrealMSTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, ezrealMSTargetHP)
	}
	if len(ezrealMSDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(ezrealMSAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestEzrealMysticShotPrimaryHitRSFCoexistenceAndDeterministicRelease: P coexistence
// via fine-grained same-package helpers (never configureEzrealRSFProvider) plus
// deterministic CompileGeneric/RunGeneric and frame release evidence.
func TestEzrealMysticShotPrimaryHitRSFCoexistenceAndDeterministicRelease(t *testing.T) {
	t.Run("rsf_coexistence", func(t *testing.T) {
		compileReq, runReq := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD, withRSF: true,
		})
		assertEzrealMSProviderShape(t, compileReq, 2, true)
		var rsf *model.ProviderDefinition
		var q *model.ProviderDefinition
		for i := range compileReq.SharedProviders {
			switch compileReq.SharedProviders[i].ProviderKey {
			case ezrealRSFProviderRef:
				rsf = &compileReq.SharedProviders[i]
			case ezrealMSProviderRef:
				q = &compileReq.SharedProviders[i]
			}
		}
		if q == nil || rsf == nil {
			t.Fatal("both Q and Rising Spell Force provider definitions required")
		}
		if len(rsf.Listeners) != 1 || len(rsf.InitialStateSchema) == 0 || len(rsf.Modifiers) != 1 {
			t.Fatalf("RSF provider incomplete: %+v", rsf)
		}
		if len(q.Listeners) != 0 || len(q.InitialStateSchema) != 0 {
			t.Fatal("Q must not rewrite P state/listener/modifier onto Q provider")
		}
		foundQMount, foundPMount := false, false
		for _, m := range compileReq.Combatants[0].Providers {
			if m.ProviderRef == ezrealMSProviderRef {
				foundQMount = true
			}
			if m.ProviderRef == ezrealRSFProviderRef {
				foundPMount = true
			}
		}
		if !foundQMount || !foundPMount {
			t.Fatalf("both Q and P mounts required: %+v", compileReq.Combatants[0].Providers)
		}
		ref := ezrealMSAbilityRef()
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "q_cd", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 100},
		}
		runReq.StopPolicy.DurationMs = 200
		done := runEzrealMS(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 1 {
			t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
		}
		if ezrealMSSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
			t.Fatal("want cooldown skip at t100")
		}
		if len(ezrealMSDamageEvidence(done)) != 1 {
			t.Fatal("exactly one Q damage")
		}
		ezrealMSAssertDamage(t, ezrealMSDamageEvidence(done)[0],
			ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 at successful cast only",
				countEmittedEvents(done, "event/ability_started"))
		}
		for _, item := range done.Evidence.Items {
			if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == "event/ability_started" && item.TimeMs != 0 {
				t.Fatalf("ability_started at t=%d want 0", item.TimeMs)
			}
		}
		if stacks := ezrealRSFStacks(t, done); math.Abs(stacks-1) > ezrealMSTol {
			t.Fatalf("P stacks=%v want 1 (provider-scoped)", stacks)
		}
		as := ezrealRSFSourceASSlot(t, done.FinalSnapshot)
		wantAS := ezrealRSFWantAS(1)
		if math.Abs(as.Base-ezrealRSFBaseAS) > ezrealMSTol ||
			math.Abs(as.Resolved-wantAS) > ezrealMSTol {
			t.Fatalf("AS base/resolved=%v/%v want %v/%v (1.0→1.1)", as.Base, as.Resolved, ezrealRSFBaseAS, wantAS)
		}
		if countEmittedEvents(done, "event/basic_attack_hit") != 0 {
			t.Fatal("no basic_attack_hit")
		}
		// Definitions/mounts remain present after composition (no overwrite).
		if len(compileReq.SharedProviders) != 2 {
			t.Fatalf("SharedProviders after run setup=%d want 2", len(compileReq.SharedProviders))
		}
		if len(compileReq.Combatants[0].Providers) != 2 {
			t.Fatalf("mounts after run setup=%d want 2", len(compileReq.Combatants[0].Providers))
		}
	})

	t.Run("determinism_and_release", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
				baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
				resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
				mana: ezrealMSFixtureManaCD,
			})
			ref := ezrealMSAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4499},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4500},
			}
			r.StopPolicy.DurationMs = 4600
			done := runEzrealMS(t, c, r)
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
		c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runEzrealMSFrames(t, c, r)
		if len(ezrealMSDamageEvidence(done)) != 1 {
			t.Fatal("frame-path want one Q damage")
		}
		ezrealMSAssertDamage(t, ezrealMSDamageEvidence(done)[0],
			ezrealMSExpectedRawDefault, ezrealMSExpectedMitDefault)
		if len(ezrealMSAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadEzrealMSFixture(t, ezrealMSFixtureOpts{
			baseAD: ezrealMSADBaseDefault, resolvedAD: ezrealMSADResolvedDefault,
			resolvedAP: ezrealMSFixtureAPDefault, armor: ezrealMSTargetArmorDefault,
			mana: ezrealMSFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: ezrealMSAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
