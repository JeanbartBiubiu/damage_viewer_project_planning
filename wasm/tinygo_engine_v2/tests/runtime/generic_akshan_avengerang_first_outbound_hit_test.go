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
	akshanAFOHProviderRef = "provider_hero_akshan_q_avengerang_first_outbound_hit"
	akshanAFOHStableID    = "hero_akshan_q_avengerang_first_outbound_hit"
	akshanAFOHAbilityID   = "ability_hero_akshan_q_avengerang_first_outbound_hit"
	akshanAFOHAbilityKey  = "avengerang_first_outbound_hit"
	akshanAFOHDamageOpRef = "op:akshan_avengerang_first_outbound_hit_damage"
	akshanAFOHBonusADMod  = "fixture_akshan_avengerang_first_outbound_hit_bonus_ad"

	akshanAFOHBaseDamage   = 165.0
	akshanAFOHBonusADRatio = 0.70
	akshanAFOHManaCost     = 80.0
	akshanAFOHCDMs         = 5000.0

	akshanAFOHADBaseDefault      = 52.0
	akshanAFOHADResolvedDefault  = 152.0
	akshanAFOHFixtureManaCD      = 240.0
	akshanAFOHFixtureManaShort   = 79.0
	akshanAFOHTargetArmorDefault = 100.0
	akshanAFOHTargetHP           = 1000.0

	// Default fixture: bonusAD=100 → raw 235; armor100 → mitigated 117.5.
	akshanAFOHExpectedRawDefault = 235.0
	akshanAFOHExpectedMitDefault = 117.5
	akshanAFOHManaAfter2         = 80.0  // 240 - 80 - 80
	akshanAFOHHPAfter2           = 765.0 // 1000 - 117.5 - 117.5

	akshanAFOHTol = 1e-9
)

func akshanAFOHExpectedRawFromAD(resolvedAD, baseAD float64) float64 {
	return akshanAFOHBaseDamage + akshanAFOHBonusADRatio*(resolvedAD-baseAD)
}

func akshanAFOHDamageAmount() *model.GenericFormulaExpr {
	base := akshanAFOHBaseDamage
	ratio := akshanAFOHBonusADRatio
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

func akshanAFOHCountPathReads(expr *model.GenericFormulaExpr, path string) int {
	if expr == nil {
		return 0
	}
	n := 0
	if expr.Op == "read" && expr.Path == path {
		n++
	}
	for i := range expr.Args {
		n += akshanAFOHCountPathReads(&expr.Args[i], path)
	}
	return n
}

func akshanAFOHAssertBinaryArity(t *testing.T, expr *model.GenericFormulaExpr) {
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
		akshanAFOHAssertBinaryArity(t, &expr.Args[i])
	}
}

func akshanAFOHAbility() model.AbilityDefinition {
	cost := akshanAFOHManaCost
	cd := akshanAFOHCDMs
	return model.AbilityDefinition{
		AbilityKey: akshanAFOHAbilityKey,
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
				Ref:           akshanAFOHDamageOpRef,
				Amount:        akshanAFOHDamageAmount(),
				CritEligible:  false,
				CopyableOnHit: false,
			},
		},
	}
}

func akshanAFOHProviderDef(bonusAD float64) model.ProviderDefinition {
	p := model.ProviderDefinition{
		ProviderKey: akshanAFOHProviderRef,
		Kind:        "champion",
		StableID:    akshanAFOHStableID,
		Abilities:   []model.AbilityDefinition{akshanAFOHAbility()},
	}
	// Fixture-only flat AD so ad.base stays independent while ad.resolved
	// becomes base+bonus. Production/seed Q provider has zero modifiers.
	if bonusAD != 0 {
		p.Modifiers = []model.ModifierDefinition{{
			ModifierKey: akshanAFOHBonusADMod,
			Kind:        "attribute",
			Target:      "ad",
			ValuePolicy: "add",
			Value:       gfConst(bonusAD),
		}}
	}
	return p
}

func akshanAFOHAbilityRef() string {
	return "source.provider[" + akshanAFOHProviderRef + "].ability[" + akshanAFOHAbilityKey + "]"
}

// Fine-grained same-package Dirty Fighting definition — never call
// configureAkshanDFProvider (it overwrites SharedProviders/mounts).
func akshanAFOHDFProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
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
}

type akshanAFOHFixtureOpts struct {
	baseAD     float64
	resolvedAD float64
	armor      float64
	mana       float64
	hp         float64
	withDF     bool
}

func configureAkshanAFOHProviders(compileReq *model.CompileRequest, runReq *model.RunRequest, opts akshanAFOHFixtureOpts) {
	bonus := opts.resolvedAD - opts.baseAD
	shared := []model.ProviderDefinition{akshanAFOHProviderDef(bonus)}
	mounts := []model.CombatantProviderMount{
		{ProviderRef: akshanAFOHProviderRef, DefinitionRef: akshanAFOHProviderRef},
	}
	snaps := []model.CombatantProviderSnapshot{
		{
			ProviderRef: akshanAFOHProviderRef, DefinitionRef: akshanAFOHProviderRef,
			Stacks: 1, State: map[string]interface{}{},
		},
	}
	if opts.withDF {
		shared = append(shared, akshanAFOHDFProviderDef())
		mounts = append(mounts, model.CombatantProviderMount{
			ProviderRef: akshanDFProviderRef, DefinitionRef: akshanDFProviderRef,
		})
		snaps = append(snaps, model.CombatantProviderSnapshot{
			ProviderRef: akshanDFProviderRef, DefinitionRef: akshanDFProviderRef,
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

func ensureAkshanAFOHTypes(req *model.CompileRequest) {
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

func loadAkshanAFOHFixture(t *testing.T, opts akshanAFOHFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	// Callers must pass baseAD/resolvedAD/armor explicitly
	// (AD0 / armor0 are valid branches).
	if opts.mana == 0 {
		opts.mana = akshanAFOHFixtureManaCD
	}
	if opts.hp == 0 {
		opts.hp = akshanAFOHTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	ensureAkshanAFOHTypes(&compileReq)
	if opts.withDF {
		ensureAkshanDFTypes(&compileReq)
	}
	configureAkshanAFOHProviders(&compileReq, &runReq, opts)

	// Fixture-only AD/mana/HP/armor values; do not claim seed materializes them.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.baseAD, Current: opts.baseAD,
		Max: opts.baseAD, Resolved: opts.baseAD,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: opts.mana, Max: math.Max(opts.mana, akshanAFOHFixtureManaCD),
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

func runAkshanAFOH(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func runAkshanAFOHFrames(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func akshanAFOHSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func akshanAFOHSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
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

func akshanAFOHDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	wantAbility := akshanAFOHAbilityRef()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != akshanAFOHDamageOpRef {
			continue
		}
		if evidenceDataString(item.Data, "abilityRef") != wantAbility {
			continue
		}
		out = append(out, item)
	}
	return out
}

func akshanAFOHAbilityStartedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindEmittedEvent || item.Ref != "event/ability_started" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func akshanAFOHFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == akshanAFOHProviderRef {
			return p
		}
	}
	return nil
}

func akshanAFOHFindDFProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == akshanDFProviderRef {
			return p
		}
	}
	return nil
}

func assertAkshanAFOHProviderShape(t *testing.T, compileReq model.CompileRequest, expectShared int, expectBonusADMod bool) {
	t.Helper()
	if len(compileReq.SharedProviders) != expectShared {
		t.Fatalf("SharedProviders=%d want %d", len(compileReq.SharedProviders), expectShared)
	}
	p := akshanAFOHFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_akshan_q_avengerang_first_outbound_hit missing from SharedProviders")
	}
	if p.ProviderKey != akshanAFOHProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, akshanAFOHProviderRef)
	}
	if p.StableID != akshanAFOHStableID {
		t.Fatalf("stableId=%q want %q", p.StableID, akshanAFOHStableID)
	}
	if p.ProviderKey == akshanDFProviderRef || p.StableID == akshanDFStableID {
		t.Fatal("avengerang first-outbound-hit must not reuse Dirty Fighting provider refs")
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%d want 0 (no Dirty Fighting / return / projectile state)", len(p.InitialStateSchema))
	}
	if expectBonusADMod {
		if len(p.Modifiers) != 1 {
			t.Fatalf("modifiers=%d want 1 (fixture-only bonus-AD flat)", len(p.Modifiers))
		}
		if p.Modifiers[0].ModifierKey != akshanAFOHBonusADMod ||
			p.Modifiers[0].Kind != "attribute" || p.Modifiers[0].Target != "ad" ||
			p.Modifiers[0].ValuePolicy != "add" {
			t.Fatalf("modifier=%+v want fixture-only flat AD add %q", p.Modifiers[0], akshanAFOHBonusADMod)
		}
	} else if len(p.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (seed/production Q has no modifiers when bonus=0)", len(p.Modifiers))
	}
	if p.Lifecycle != nil {
		t.Fatalf("lifecycle=%+v want nil", p.Lifecycle)
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1 (ability %s)", len(p.Abilities), akshanAFOHAbilityID)
	}
	a := p.Abilities[0]
	if a.AbilityKey != akshanAFOHAbilityKey {
		t.Fatalf("abilityKey=%q want %q (id constant %q)",
			a.AbilityKey, akshanAFOHAbilityKey, akshanAFOHAbilityID)
	}
	if a.Kind != "active" {
		t.Fatalf("kind=%q want active", a.Kind)
	}
	if len(a.Types) != 0 {
		t.Fatalf("Q Types=%v want empty (no ability-specific game-local Q type)", a.Types)
	}
	for _, typ := range a.Types {
		if typ == "ability/basic_attack" {
			t.Fatal("avengerang_first_outbound_hit must not be tagged ability/basic_attack")
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
		math.Abs(*a.Cost.Amount.Value-akshanAFOHManaCost) > akshanAFOHTol {
		t.Fatalf("cost=%+v want mana const 80", a.Cost)
	}
	if a.Cooldown == nil || a.Cooldown.DurationMs.Op != "const" || a.Cooldown.DurationMs.Value == nil ||
		math.Abs(*a.Cooldown.DurationMs.Value-akshanAFOHCDMs) > akshanAFOHTol {
		t.Fatalf("cooldown=%+v want const 5000 (immediate scaffold; not after-return)", a.Cooldown)
	}
	if len(a.Operations) != 1 {
		t.Fatalf("operations=%d want exactly 1 (one selected-primary first-outbound physical hit)", len(a.Operations))
	}
	op := a.Operations[0]
	if op.Operation != "damage" || op.DamageType != "damage/physical" || op.Target != "target" {
		t.Fatalf("op shape=%+v want single physical damage to target", op)
	}
	if op.CritEligible {
		t.Fatal("avengerang damage must not be crit-eligible")
	}
	if op.CopyableOnHit {
		t.Fatal("avengerang damage must not be copyable on hit")
	}
	if op.Ref != akshanAFOHDamageOpRef {
		t.Fatalf("op ref=%q want %q", op.Ref, akshanAFOHDamageOpRef)
	}
	if op.Amount == nil || op.Amount.Op != "add" || len(op.Amount.Args) != 2 {
		t.Fatalf("damage amount=%+v want add(const165, mul(0.70, sub(ad.resolved, ad.base)))", op.Amount)
	}
	akshanAFOHAssertBinaryArity(t, op.Amount)
	if op.Amount.Args[0].Op != "const" || op.Amount.Args[0].Value == nil ||
		math.Abs(*op.Amount.Args[0].Value-akshanAFOHBaseDamage) > akshanAFOHTol {
		t.Fatalf("base const=%+v want 165", op.Amount.Args[0])
	}
	mul := op.Amount.Args[1]
	if mul.Op != "mul" || len(mul.Args) != 2 {
		t.Fatalf("bonus-AD mul=%+v want mul", mul)
	}
	if mul.Args[0].Op != "const" || mul.Args[0].Value == nil ||
		math.Abs(*mul.Args[0].Value-akshanAFOHBonusADRatio) > akshanAFOHTol {
		t.Fatalf("bonus AD ratio=%+v want 0.70", mul.Args[0])
	}
	sub := mul.Args[1]
	if sub.Op != "sub" || len(sub.Args) != 2 {
		t.Fatalf("bonus-AD sub=%+v want sub(resolved, base)", sub)
	}
	if sub.Args[0].Op != "read" || sub.Args[0].Path != "source.attr.ad.resolved" {
		t.Fatalf("AD resolved read=%+v want source.attr.ad.resolved", sub.Args[0])
	}
	if sub.Args[1].Op != "read" || sub.Args[1].Path != "source.attr.ad.base" {
		t.Fatalf("AD base read=%+v want source.attr.ad.base", sub.Args[1])
	}
	if mul.Args[1].Op == "read" && mul.Args[1].Path == "source.attr.ad.resolved" {
		t.Fatal("bonus-AD branch must not read total ad.resolved alone (must sub base)")
	}
	if mul.Args[1].Op == "const" {
		t.Fatal("bonus-AD branch must not bake fixture bonus-AD constants into the formula")
	}
	if akshanAFOHCountPathReads(op.Amount, "source.attr.ad.resolved") != 1 {
		t.Fatalf("AD resolved reads=%d want exactly 1", akshanAFOHCountPathReads(op.Amount, "source.attr.ad.resolved"))
	}
	if akshanAFOHCountPathReads(op.Amount, "source.attr.ad.base") != 1 {
		t.Fatalf("AD base reads=%d want exactly 1", akshanAFOHCountPathReads(op.Amount, "source.attr.ad.base"))
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
			t.Fatalf("avengerang must not include excluded op: %+v", bannedOp)
		}
	}
}

func findAkshanAFOHAbilityStat(t *testing.T, done model.DoneResult) model.AbilityStat {
	t.Helper()
	wantRef := akshanAFOHAbilityRef()
	for _, st := range done.Summary.AbilityStats {
		if st.AbilityRef == wantRef {
			return st
		}
	}
	t.Fatalf("AbilityStats missing ref %q (got %+v)", wantRef, done.Summary.AbilityStats)
	return model.AbilityStat{}
}

func akshanAFOHAssertDamage(t *testing.T, item model.EvidenceItem, wantRaw, wantMit float64) {
	t.Helper()
	raw := evidenceDataFloat(item.Data, "rawAmount")
	mit := evidenceDataFloat(item.Data, "mitigatedAmount")
	if math.Abs(raw-wantRaw) > akshanAFOHTol {
		t.Fatalf("raw=%v want %v", raw, wantRaw)
	}
	if math.Abs(mit-wantMit) > akshanAFOHTol {
		t.Fatalf("mitigated=%v want %v", mit, wantMit)
	}
	if evidenceDataString(item.Data, "damageType") != "damage/physical" {
		t.Fatalf("damageType=%q want damage/physical", evidenceDataString(item.Data, "damageType"))
	}
	if evidenceDataString(item.Data, "operationRef") != akshanAFOHDamageOpRef {
		t.Fatalf("operationRef=%q want %q", evidenceDataString(item.Data, "operationRef"), akshanAFOHDamageOpRef)
	}
	if evidenceDataString(item.Data, "abilityRef") != akshanAFOHAbilityRef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), akshanAFOHAbilityRef())
	}
	if evidenceDataString(item.Data, "providerRef") != akshanAFOHProviderRef {
		t.Fatalf("providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), akshanAFOHProviderRef)
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

// TestAkshanAvengerangFirstOutboundHitConstructedFixtureFormulaShape 验证固定构造的公式与机制边界。
func TestAkshanAvengerangFirstOutboundHitConstructedFixtureFormulaShape(t *testing.T) {
	compileReq, _ := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
		baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
		armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD,
	})
	assertAkshanAFOHProviderShape(t, compileReq, 1, true)
	rawX := akshanAFOHExpectedRawFromAD(akshanAFOHADResolvedDefault, akshanAFOHADBaseDefault)
	if math.Abs(rawX-akshanAFOHExpectedRawDefault) > akshanAFOHTol {
		t.Fatalf("default raw cross-check=%v want %v", rawX, akshanAFOHExpectedRawDefault)
	}
	mitX := expectedMitigatedPhysical(rawX, akshanAFOHTargetArmorDefault)
	if math.Abs(mitX-akshanAFOHExpectedMitDefault) > akshanAFOHTol {
		t.Fatalf("default mit=%v want %v", mitX, akshanAFOHExpectedMitDefault)
	}
	totalAsIf := akshanAFOHBaseDamage + akshanAFOHBonusADRatio*akshanAFOHADResolvedDefault
	if math.Abs(totalAsIf-akshanAFOHExpectedRawDefault) < akshanAFOHTol {
		t.Fatal("total-AD substitution raw must differ from bonus-AD raw")
	}
}

// TestAkshanAvengerangFirstOutboundHitFormulaMitigationTable: frozen deterministic
// baseAD/resolvedAD/armor raw/final table; one isolated successful Q cast per row.
func TestAkshanAvengerangFirstOutboundHitFormulaMitigationTable(t *testing.T) {
	cases := []struct {
		name                   string
		baseAD, resolvedAD     float64
		armor                  float64
		wantRaw, wantMitigated float64
	}{
		{"base52_resolved52_armor100", 52, 52, 100, 165, 82.5},
		{"base52_resolved152_armor100", 52, 152, 100, 235, 117.5},
		{"base0_resolved0_armor0", 0, 0, 0, 165, 165},
		{"base52_resolved52_armor0", 52, 52, 0, 165, 165},
		{"base52_resolved152_armor0", 52, 152, 0, 235, 235},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rawX := akshanAFOHExpectedRawFromAD(tc.resolvedAD, tc.baseAD)
			if math.Abs(rawX-tc.wantRaw) > akshanAFOHTol {
				t.Fatalf("cross-check raw=%v want %v", rawX, tc.wantRaw)
			}
			mitX := expectedMitigatedPhysical(tc.wantRaw, tc.armor)
			if math.Abs(mitX-tc.wantMitigated) > akshanAFOHTol {
				t.Fatalf("cross-check mit=%v want %v", mitX, tc.wantMitigated)
			}
			compileReq, runReq := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: tc.armor, mana: akshanAFOHFixtureManaCD,
			})
			assertAkshanAFOHProviderShape(t, compileReq, 1, tc.resolvedAD != tc.baseAD)
			ref := akshanAFOHAbilityRef()
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runAkshanAFOH(t, compileReq, runReq)
			if done.Summary.AbilityCastCount != 1 {
				t.Fatalf("castCount=%d want 1", done.Summary.AbilityCastCount)
			}
			dmg := akshanAFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage evidence=%d want 1", len(dmg))
			}
			akshanAFOHAssertDamage(t, dmg[0], tc.wantRaw, tc.wantMitigated)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > akshanAFOHTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > akshanAFOHTol {
				t.Fatalf("ad.base=%v want %v (bonus-AD formula must leave base independent)",
					sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
			if n := len(damageEvidenceItems(done)); n != 1 {
				t.Fatalf("total damage evidence=%d want 1", n)
			}
			if len(akshanAFOHAbilityStartedEvidence(done)) != 1 {
				t.Fatalf("ability_started=%d want 1", len(akshanAFOHAbilityStartedEvidence(done)))
			}
		})
	}
}

// TestAkshanAvengerangFirstOutboundHitBonusADCounterproof: baseAD0/resolvedAD100
// versus baseAD52/resolvedAD152 at armor0 must both raw/final 235 — equal bonus AD.
func TestAkshanAvengerangFirstOutboundHitBonusADCounterproof(t *testing.T) {
	cases := []struct {
		name               string
		baseAD, resolvedAD float64
	}{
		{"baseAD0_resolvedAD100", 0, 100},
		{"baseAD52_resolvedAD152", 52, 152},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
				baseAD: tc.baseAD, resolvedAD: tc.resolvedAD,
				armor: 0, mana: akshanAFOHFixtureManaCD,
			})
			assertAkshanAFOHProviderShape(t, compileReq, 1, true)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: akshanAFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runAkshanAFOH(t, compileReq, runReq)
			dmg := akshanAFOHDamageEvidence(done)
			if len(dmg) != 1 {
				t.Fatalf("Q damage=%d want 1", len(dmg))
			}
			akshanAFOHAssertDamage(t, dmg[0], 235, 235)
			if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-tc.resolvedAD) > akshanAFOHTol {
				t.Fatalf("ad.resolved=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "ad"), tc.resolvedAD)
			}
			if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-tc.baseAD) > akshanAFOHTol {
				t.Fatalf("ad.base=%v want %v", sourceAttrBase(t, done.FinalSnapshot, "ad"), tc.baseAD)
			}
		})
	}
	totalAsIf := akshanAFOHBaseDamage + akshanAFOHBonusADRatio*152
	bonus := akshanAFOHExpectedRawFromAD(152, 52)
	if math.Abs(totalAsIf-bonus) < akshanAFOHTol {
		t.Fatal("total-AD raw must differ from bonus-AD raw")
	}
}

// TestAkshanAvengerangFirstOutboundHitCooldownMana240AbilityStarted: mana240/
// base52/resolved152/HP1000/armor100 at t0/t4999/t5000 →
// success/cooldown skip/success; final mana80/HP765; exactly two Q damage
// items and two automatic Q ability_started events.
// Immediate 5000ms cooldown is Phase-A scaffold; real after-return timing excluded.
func TestAkshanAvengerangFirstOutboundHitCooldownMana240AbilityStarted(t *testing.T) {
	compileReq, runReq := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
		baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
		armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD, hp: akshanAFOHTargetHP,
	})
	assertAkshanAFOHProviderShape(t, compileReq, 1, true)
	ref := akshanAFOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
		{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
	}
	runReq.StopPolicy.DurationMs = 5100
	done := runAkshanAFOH(t, compileReq, runReq)

	if done.Summary.AbilityAttemptCount != 3 {
		t.Fatalf("abilityAttemptCount=%d want 3", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2", done.Summary.AbilityCastCount)
	}
	if done.Summary.AttemptSkippedCount != 1 {
		t.Fatalf("attemptSkippedCount=%d want 1", done.Summary.AttemptSkippedCount)
	}
	if akshanAFOHSkipReasonCount(done, model.AttemptSkipCooldownNotReady) != 1 {
		t.Fatal("expected exactly one cooldown_not_ready skip")
	}
	stat := findAkshanAFOHAbilityStat(t, done)
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

	items := akshanAFOHDamageEvidence(done)
	if len(items) != 2 {
		t.Fatalf("Q damage evidence=%d want 2", len(items))
	}
	wantTimes := []int64{0, 5000}
	var mitSum float64
	for i, item := range items {
		if item.TimeMs != wantTimes[i] {
			t.Fatalf("damage[%d] TimeMs=%d want %d", i, item.TimeMs, wantTimes[i])
		}
		akshanAFOHAssertDamage(t, item, akshanAFOHExpectedRawDefault, akshanAFOHExpectedMitDefault)
		mitSum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	wantDealt := 2 * akshanAFOHExpectedMitDefault
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if math.Abs(mitSum-wantDealt) > 1e-6 {
		t.Fatalf("evidence mitigated sum=%v want %v", mitSum, wantDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-akshanAFOHHPAfter2) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, akshanAFOHHPAfter2)
	}
	gotMana := akshanAFOHSourceMana(t, done.FinalSnapshot)
	if math.Abs(gotMana-akshanAFOHManaAfter2) > akshanAFOHTol {
		t.Fatalf("mana=%v want %v", gotMana, akshanAFOHManaAfter2)
	}
	if n := len(damageEvidenceItems(done)); n != 2 {
		t.Fatalf("total damage evidence=%d want 2", n)
	}

	started := akshanAFOHAbilityStartedEvidence(done)
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
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "ad")-akshanAFOHADResolvedDefault) > akshanAFOHTol {
		t.Fatalf("ad.resolved=%v want %v",
			sourceAttrResolved(t, done.FinalSnapshot, "ad"), akshanAFOHADResolvedDefault)
	}
	if math.Abs(sourceAttrBase(t, done.FinalSnapshot, "ad")-akshanAFOHADBaseDefault) > akshanAFOHTol {
		t.Fatalf("ad.base=%v want %v",
			sourceAttrBase(t, done.FinalSnapshot, "ad"), akshanAFOHADBaseDefault)
	}
}

// TestAkshanAvengerangFirstOutboundHitResourceInsufficientMana79: mana79 at t0 →
// resource_insufficient; mana/HP unchanged; zero Q damage/start evidence.
func TestAkshanAvengerangFirstOutboundHitResourceInsufficientMana79(t *testing.T) {
	compileReq, runReq := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
		baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
		armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaShort, hp: akshanAFOHTargetHP,
	})
	ref := akshanAFOHAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runAkshanAFOH(t, compileReq, runReq)

	if done.Summary.AbilityCastCount != 0 {
		t.Fatalf("castCount=%d want 0", done.Summary.AbilityCastCount)
	}
	if done.Summary.AbilityAttemptCount != 1 {
		t.Fatalf("attemptCount=%d want 1", done.Summary.AbilityAttemptCount)
	}
	if akshanAFOHSkipReasonCount(done, model.AttemptSkipResourceInsufficient) != 1 {
		t.Fatal("want exactly one resource_insufficient")
	}
	if math.Abs(akshanAFOHSourceMana(t, done.FinalSnapshot)-akshanAFOHFixtureManaShort) > akshanAFOHTol {
		t.Fatalf("mana changed: got %v want %v",
			akshanAFOHSourceMana(t, done.FinalSnapshot), akshanAFOHFixtureManaShort)
	}
	if math.Abs(done.Summary.TargetFinalHp-akshanAFOHTargetHP) > 1e-6 {
		t.Fatalf("targetFinalHp=%v want unchanged %v", done.Summary.TargetFinalHp, akshanAFOHTargetHP)
	}
	if len(akshanAFOHDamageEvidence(done)) != 0 || len(damageEvidenceItems(done)) != 0 {
		t.Fatal("want zero Q damage evidence")
	}
	if len(akshanAFOHAbilityStartedEvidence(done)) != 0 {
		t.Fatal("resource skip must not synthesize ability_started")
	}
}

// TestAkshanAvengerangFirstOutboundHitDFCoexistencePreservation: mount independent Q
// beside same-package Dirty Fighting basic definitions without calling
// configureAkshanDFProvider. Q cast alone produces exactly one Q hit and leaves
// dirty_fighting_stacks unchanged (ability-hit wiring excluded/absent); basic-attack
// sequence is not executed. AA alone still advances Dirty Fighting stacks.
func TestAkshanAvengerangFirstOutboundHitDFCoexistencePreservation(t *testing.T) {
	compileReq, _ := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
		baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
		armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD, withDF: true,
	})
	assertAkshanAFOHProviderShape(t, compileReq, 2, true)

	qRef := akshanAFOHAbilityRef()
	aaRef := akshanDFAbilityRef()
	if qRef == aaRef {
		t.Fatal("Q and Dirty Fighting ability refs must be distinct")
	}
	pQ := akshanAFOHFindProvider(compileReq)
	pDF := akshanAFOHFindDFProvider(compileReq)
	if pQ == nil || pDF == nil {
		t.Fatal("combined fixture must mount both Q and Dirty Fighting providers")
	}
	if pQ.ProviderKey == pDF.ProviderKey || pQ.StableID == pDF.StableID {
		t.Fatal("Q/DF provider keys/stable IDs must not collide")
	}
	if pDF.StableID != akshanDFStableID {
		t.Fatalf("DF stableId=%q want %q", pDF.StableID, akshanDFStableID)
	}
	if len(pDF.InitialStateSchema) != 1 {
		t.Fatalf("DF InitialStateSchema=%d want 1 (dirty_fighting_stacks)", len(pDF.InitialStateSchema))
	}
	if len(pQ.InitialStateSchema) != 0 {
		t.Fatal("Q must not carry Dirty Fighting state")
	}
	for _, mod := range pQ.Modifiers {
		if strings.Contains(mod.ModifierKey, "dirty_fighting") {
			t.Fatalf("Q must not carry Dirty Fighting modifiers: %+v", mod)
		}
	}
	foundQMount, foundDFMount := false, false
	for _, m := range compileReq.Combatants[0].Providers {
		if m.ProviderRef == akshanAFOHProviderRef {
			foundQMount = true
		}
		if m.ProviderRef == akshanDFProviderRef {
			foundDFMount = true
		}
	}
	if !foundQMount || !foundDFMount {
		t.Fatalf("both Q and DF mounts required: %+v", compileReq.Combatants[0].Providers)
	}

	t.Run("q_cast_alone_leaves_dirty_fighting_stacks_zero", func(t *testing.T) {
		c, r := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
			baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
			armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD, withDF: true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: qRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runAkshanAFOH(t, c, r)

		if got := akshanDFStacks(t, done); math.Abs(got) > akshanAFOHTol {
			t.Fatalf("dirty_fighting_stacks after Q-only=%v want 0 (ability-hit wiring absent)", got)
		}
		dmg := akshanAFOHDamageEvidence(done)
		if len(dmg) != 1 {
			t.Fatalf("Q damage evidence=%d want 1", len(dmg))
		}
		akshanAFOHAssertDamage(t, dmg[0], akshanAFOHExpectedRawDefault, akshanAFOHExpectedMitDefault)
		if n, _, _, _ := akshanDFDamageByOp(done, akshanDFAAOpRef); n != 0 {
			t.Fatalf("Q must not execute basic-attack AA damage: count=%d", n)
		}
		if n, _, _, _ := akshanDFDamageByOp(done, akshanDFProcOpRef); n != 0 {
			t.Fatalf("Q must not execute Dirty Fighting proc: count=%d", n)
		}
		if countEmittedEvents(done, akshanDFHitEvent) != 0 {
			t.Fatal("Q must not emit basic_attack_hit")
		}
		if countEmittedEvents(done, "event/ability_started") != 1 {
			t.Fatalf("ability_started=%d want 1 (Q only)", countEmittedEvents(done, "event/ability_started"))
		}
		qStat := findAkshanAFOHAbilityStat(t, done)
		if qStat.CastCount != 1 {
			t.Fatalf("Q castCount=%d want 1", qStat.CastCount)
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == aaRef && st.CastCount != 0 {
				t.Fatalf("basic_attack must not cast during Q-only schedule: %+v", st)
			}
		}
		// Definitions/mounts remain present after composition (no overwrite).
		if len(c.SharedProviders) != 2 {
			t.Fatalf("SharedProviders=%d want 2", len(c.SharedProviders))
		}
		if len(c.Combatants[0].Providers) != 2 {
			t.Fatalf("mounts=%d want 2", len(c.Combatants[0].Providers))
		}
	})

	t.Run("aa_cast_advances_stacks_no_q_damage", func(t *testing.T) {
		c, r := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
			baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
			armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD, withDF: true,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "aa0", AbilityRef: aaRef, Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runAkshanAFOH(t, c, r)

		if got := akshanDFStacks(t, done); math.Abs(got-1) > akshanAFOHTol {
			t.Fatalf("dirty_fighting_stacks after AA=%v want 1", got)
		}
		if len(akshanAFOHDamageEvidence(done)) != 0 {
			t.Fatal("AA cast must not produce Q damage")
		}
		nAA, _, _, _ := akshanDFDamageByOp(done, akshanDFAAOpRef)
		if nAA != 1 {
			t.Fatalf("AA damage count=%d want 1", nAA)
		}
		if countEmittedEvents(done, akshanDFHitEvent) != 1 {
			t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, akshanDFHitEvent))
		}
		for _, st := range done.Summary.AbilityStats {
			if st.AbilityRef == qRef && st.CastCount != 0 {
				t.Fatalf("Q must not cast during AA-only schedule: %+v", st)
			}
			if st.AbilityRef == aaRef && st.CastCount != 1 {
				t.Fatalf("AA castCount=%d want 1", st.CastCount)
			}
		}
	})
}

// TestAkshanAvengerangFirstOutboundHitDeterminismAndLifecycle: repeated compile/run
// evidence stability plus CompileFrame→RunFrame→ReleaseSessionFrame and
// post-release session_not_found.
func TestAkshanAvengerangFirstOutboundHitDeterminismAndLifecycle(t *testing.T) {
	t.Run("determinism", func(t *testing.T) {
		runOnce := func() (string, string, string) {
			c, r := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
				baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
				armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD,
			})
			ref := akshanAFOHAbilityRef()
			r.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "q0", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "q_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 4999},
				{EntryKey: "q_ready", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 5000},
			}
			r.StopPolicy.DurationMs = 5100
			done := runAkshanAFOH(t, c, r)
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
		c, r := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
			baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
			armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: akshanAFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		r.StopPolicy.DurationMs = 50
		done := runAkshanAFOHFrames(t, c, r)
		if len(akshanAFOHDamageEvidence(done)) != 1 {
			t.Fatalf("frame-path Q damage=%d want 1", len(akshanAFOHDamageEvidence(done)))
		}
		akshanAFOHAssertDamage(t, akshanAFOHDamageEvidence(done)[0],
			akshanAFOHExpectedRawDefault, akshanAFOHExpectedMitDefault)
		if len(akshanAFOHAbilityStartedEvidence(done)) != 1 {
			t.Fatal("frame-path want one automatic ability_started")
		}
	})

	t.Run("wrong_missing_released_session", func(t *testing.T) {
		c, r := loadAkshanAFOHFixture(t, akshanAFOHFixtureOpts{
			baseAD: akshanAFOHADBaseDefault, resolvedAD: akshanAFOHADResolvedDefault,
			armor: akshanAFOHTargetArmorDefault, mana: akshanAFOHFixtureManaCD,
		})
		r.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q0", AbilityRef: akshanAFOHAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
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
