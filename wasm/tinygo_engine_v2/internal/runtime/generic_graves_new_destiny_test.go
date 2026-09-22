package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_graves P New Destiny / 新命运 (generic ABI, Phase-A point-blank merged AA).
//
// League Wiki Template:Data Graves/New Destiny (NOT Meraki/DataDragon numeric truth):
//   - revision 4038342
//   - contentSha256 553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8
//   - source: 数据参考/lol-wiki-current-champions/normalized/generic/graves-p.json
//   - reviewed-contracts.json#graves-p
//
// Frozen Phase-A math (point-blank maximum pellets only):
//   x = source.attr.champion_level.resolved
//   AD = source.attr.ad.resolved
//   s = 0.33302
//   F(x) = 0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1))
//   merged normal raw physical = AD * F(x) * (1 + 3*s); CritEligible=true
//   natural/forced C2 branch override (same formula, both):
//     ((1 + 5*s)/(1 + 3*s)) * (1 + 0.5*(source.attr.crit_damage.resolved - 1))
//
// Graph: exactly one merged damage + one following event/basic_attack_hit;
// copyable_on_hit=false; ability Types include ability/basic_attack so channel
// basic_damage matches.
//
// Explicit completed-boundary exclusions (not remainingGap/blockers):
//   precise reload formula / ammo / reload scheduling / lockout / Quickdraw;
//   distance/cone/projectile/collision / secondary targets / structures /
//   wards/plants / blind/dodge/block / knockback / life steal / per-pellet
//   Black Cleaver / separate pellet instances / RNG crit / live migrate/E2E.
//
// Bootstrap panel provenance (graves-champion-data.json) is NOT P completion evidence.
// No production runtime/ABI changes; no hero-specific production branches.

const (
	gravesNDProviderRef = "hero:graves_new_destiny"
	gravesNDStableID    = "hero_graves_new_destiny"
	gravesNDAbilityKey  = "basic_attack"
	gravesNDDamageOpRef = "op:graves_new_destiny_aa"
	gravesNDHitEvent    = "event/basic_attack_hit"
	gravesNDNaturalMod  = "graves_new_destiny_crit_natural"
	gravesNDForcedMod   = "graves_new_destiny_crit_forced"
	gravesNDLevelAttr   = "champion_level"

	gravesNDPelletFraction = 0.33302
	gravesNDFConst         = 0.6895
	gravesNDFSlope         = 0.01765
	gravesNDFInnerBase     = 0.595
	gravesNDFInnerSlope    = 0.0225

	gravesNDProbeAD      = 100.0
	gravesNDTargetHP     = 100000.0
	gravesNDTargetArmor  = 100.0
	gravesNDTol          = 1e-9
	gravesNDTolExact     = 1e-12

	// Independent cross-check probes (not production constants).
	gravesNDRawL1Chance0          = 139.9345498355
	gravesNDRawL18Chance0         = 199.9163451355
	gravesNDRawL18P025CD20        = 249.88368081131247
	gravesNDRawL18P025CD23        = 259.8783230072812
)

func gravesNDFloat(v float64) *float64 { return &v }

// Independent expected helpers — must not re-walk the model formula AST.

func gravesNDFx(level float64) float64 {
	return gravesNDFConst + gravesNDFSlope*level*(gravesNDFInnerBase+gravesNDFInnerSlope*(level-1))
}

func gravesNDNormalRaw(level, ad float64) float64 {
	return ad * gravesNDFx(level) * (1 + 3*gravesNDPelletFraction)
}

func gravesNDBranchMultiplier(critDamage float64) float64 {
	return ((1 + 5*gravesNDPelletFraction) / (1 + 3*gravesNDPelletFraction)) *
		(1 + 0.5*(critDamage-1))
}

func gravesNDExpectedRaw(level, ad, chance, critDamage float64) float64 {
	base := gravesNDNormalRaw(level, ad)
	m := gravesNDBranchMultiplier(critDamage)
	p := chance
	if p < 0 {
		p = 0
	}
	if p > 1 {
		p = 1
	}
	return base*((1-p)+p*m)
}

func gravesNDFxExpr() model.GenericFormulaExpr {
	levelPath := "source.attr." + gravesNDLevelAttr + ".resolved"
	one := 1.0
	return model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: gravesNDFloat(gravesNDFConst)},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: gravesNDFloat(gravesNDFSlope)},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: levelPath},
							{
								Op: "add",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: gravesNDFloat(gravesNDFInnerBase)},
									{
										Op: "mul",
										Args: []model.GenericFormulaExpr{
											{Op: "const", Value: gravesNDFloat(gravesNDFInnerSlope)},
											{
												Op: "sub",
												Args: []model.GenericFormulaExpr{
													{Op: "read", Path: levelPath},
													{Op: "const", Value: &one},
												},
											},
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

func gravesNDDamageAmount() *model.GenericFormulaExpr {
	three := 3.0
	one := 1.0
	s := gravesNDPelletFraction
	expr := model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "source.attr.ad.resolved"},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					gravesNDFxExpr(),
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &one},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &three},
									{Op: "const", Value: &s},
								},
							},
						},
					},
				},
			},
		},
	}
	return &expr
}

func gravesNDCritBranchOverride() model.GenericFormulaExpr {
	five := 5.0
	three := 3.0
	one := 1.0
	half := 0.5
	s := gravesNDPelletFraction
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "div",
				Args: []model.GenericFormulaExpr{
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &one},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &five},
									{Op: "const", Value: &s},
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
									{Op: "const", Value: &three},
									{Op: "const", Value: &s},
								},
							},
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
							{Op: "const", Value: &half},
							{
								Op: "sub",
								Args: []model.GenericFormulaExpr{
									{Op: "read", Path: "source.attr.crit_damage.resolved"},
									{Op: "const", Value: &one},
								},
							},
						},
					},
				},
			},
		},
	}
}

func gravesNDCritBranchModifier(key, stage string) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: key,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       stage,
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "override",
		Value:       gravesNDCritBranchOverride(),
	}
}

func gravesNDBasicAttackOps() []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/physical",
			Amount:        gravesNDDamageAmount(),
			CritEligible:  true,
			CopyableOnHit: false,
			Ref:           gravesNDDamageOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: gravesNDHitEvent,
			Ref:       gravesNDHitEvent,
		},
	}
}

func gravesNDProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey: gravesNDProviderRef,
		Kind:        "champion",
		StableID:    gravesNDStableID,
		Modifiers: []model.ModifierDefinition{
			gravesNDCritBranchModifier(gravesNDNaturalMod, "crit_multiplier_natural_branch"),
			gravesNDCritBranchModifier(gravesNDForcedMod, "crit_multiplier_forced_branch"),
		},
		Abilities: []model.AbilityDefinition{{
			AbilityKey: gravesNDAbilityKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: gravesNDBasicAttackOps(),
		}},
	}
}

func gravesNDAbilityRef() string {
	return "source.provider[" + gravesNDProviderRef + "].ability[" + gravesNDAbilityKey + "]"
}

func ensureGravesNDTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: gravesNDHitEvent, Domain: "event"},
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

func configureGravesNDProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{gravesNDProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: gravesNDProviderRef, DefinitionRef: gravesNDProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: gravesNDProviderRef, DefinitionRef: gravesNDProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

type gravesNDFixtureOpts struct {
	level      float64
	ad         float64
	critChance float64
	critDamage float64
	armor      float64
	hp         float64
	shield     float64
}

func loadGravesNDFixture(t *testing.T, opts gravesNDFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.level < 1 {
		opts.level = 1
	}
	if opts.ad <= 0 {
		opts.ad = gravesNDProbeAD
	}
	if opts.critDamage <= 0 {
		opts.critDamage = 2.0
	}
	if opts.hp <= 0 {
		opts.hp = gravesNDTargetHP
	}
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.graves_new_destiny"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureGravesNDTypes(&compileReq)
	configureGravesNDProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, gravesNDLevelAttr, model.AttributeSlotDef{
		Base: opts.level, Current: opts.level, Max: opts.level, Resolved: opts.level,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: opts.ad, Current: opts.ad, Max: opts.ad, Resolved: opts.ad,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_chance", model.AttributeSlotDef{
		Base: opts.critChance, Current: opts.critChance, Max: 1, Resolved: opts.critChance,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "crit_damage", model.AttributeSlotDef{
		Base: opts.critDamage, Current: opts.critDamage, Max: opts.critDamage, Resolved: opts.critDamage,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: opts.hp, Current: opts.hp, Max: opts.hp, Resolved: opts.hp,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: opts.armor, Current: opts.armor, Max: opts.armor, Resolved: opts.armor,
	})

	if opts.shield > 0 {
		for i := range runReq.InitialSnapshot.Combatants {
			if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
				continue
			}
			runReq.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
				ShieldRef: "graves_nd_probe_shield",
				Source:    model.SelectorSource,
				Owner:     model.SelectorTarget,
				Remaining: opts.shield,
				Priority:  1,
				State:     map[string]interface{}{},
			}}
		}
	}

	runReq.DriverPlan.Entries = []model.DriverEntry{{
		EntryKey:   "graves_nd_aa",
		AbilityRef: gravesNDAbilityRef(),
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  0,
	}}
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

// runGravesND exercises CompileFrame → session → RunFrame → ReleaseSessionFrame.
func runGravesND(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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
	var found bool
	for _, p := range entry.compiled.Providers {
		if p.ProviderKey != gravesNDProviderRef {
			continue
		}
		if len(p.StateFields) != 0 {
			t.Fatalf("StateFields=%d want 0 (no reload/ammo state)", len(p.StateFields))
		}
		if len(p.Listeners) != 0 {
			t.Fatalf("Listeners=%d want 0 (no reload/projectile listeners)", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("graves new destiny provider missing from compiled session")
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

func gravesNDDamageEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != gravesNDDamageOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func gravesNDTargetShieldRemaining(done model.DoneResult) float64 {
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		var sum float64
		for _, s := range c.Shields {
			sum += s.Remaining
		}
		return sum
	}
	return 0
}

func assertGravesNDProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := compileReq.SharedProviders[0]
	if p.ProviderKey != gravesNDProviderRef {
		t.Fatalf("providerKey=%q", p.ProviderKey)
	}
	if p.InitialStateSchema != nil && len(p.InitialStateSchema) != 0 {
		t.Fatalf("InitialStateSchema=%v want empty (no reload/ammo)", p.InitialStateSchema)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0", len(p.Listeners))
	}
	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	ab := p.Abilities[0]
	if len(ab.Types) != 1 || ab.Types[0] != "ability/basic_attack" {
		t.Fatalf("ability types=%v want [ability/basic_attack]", ab.Types)
	}
	if len(ab.Operations) != 2 {
		t.Fatalf("ops=%d want 2 (damage+emit)", len(ab.Operations))
	}
	if ab.Operations[0].CopyableOnHit {
		t.Fatal("damage CopyableOnHit must be false")
	}
	if !ab.Operations[0].CritEligible {
		t.Fatal("damage CritEligible must be true")
	}
	if ab.Operations[1].EventType != gravesNDHitEvent {
		t.Fatalf("emit event=%q want %q", ab.Operations[1].EventType, gravesNDHitEvent)
	}
	if len(p.Modifiers) != 2 {
		t.Fatalf("modifiers=%d want 2 (natural+forced)", len(p.Modifiers))
	}
	for _, m := range p.Modifiers {
		if m.Channel != "basic_damage" || m.ValuePolicy != "override" || m.Command != "crit" {
			t.Fatalf("crit branch mod shape=%+v", m)
		}
	}
}

func assertGravesNDSingleHitContract(t *testing.T, done model.DoneResult) {
	t.Helper()
	dmg := gravesNDDamageEvidence(done)
	if len(dmg) != 1 {
		t.Fatalf("damage evidence/instances=%d want 1 (no phantom/on-hit replay)", len(dmg))
	}
	if n := countEmittedEvents(done, gravesNDHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", n)
	}
}

func TestGravesNewDestinyIndependentProbes(t *testing.T) {
	cases := []struct {
		name       string
		level      float64
		chance     float64
		critDamage float64
		wantRaw    float64
	}{
		{"L1_AD100_chance0", 1, 0, 2.0, gravesNDRawL1Chance0},
		{"L18_AD100_chance0", 18, 0, 2.0, gravesNDRawL18Chance0},
		{"L18_AD100_p025_cd2", 18, 0.25, 2.0, gravesNDRawL18P025CD20},
		{"L18_AD100_p025_cd2_3", 18, 0.25, 2.3, gravesNDRawL18P025CD23},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Sanity: independent helper matches frozen probe constants.
			gotHelper := gravesNDExpectedRaw(tc.level, gravesNDProbeAD, tc.chance, tc.critDamage)
			if math.Abs(gotHelper-tc.wantRaw) > gravesNDTolExact {
				t.Fatalf("helper raw=%v want probe %v", gotHelper, tc.wantRaw)
			}
			compileReq, runReq := loadGravesNDFixture(t, gravesNDFixtureOpts{
				level: tc.level, ad: gravesNDProbeAD,
				critChance: tc.chance, critDamage: tc.critDamage,
				armor: 0, hp: gravesNDTargetHP,
			})
			assertGravesNDProviderShape(t, compileReq)
			done := runGravesND(t, compileReq, runReq)
			assertGravesNDSingleHitContract(t, done)
			data := gravesNDDamageEvidence(done)[0].Data
			if math.Abs(evidenceDataFloat(data, "rawAmount")-tc.wantRaw) > gravesNDTol {
				t.Fatalf("rawAmount=%v want %v", evidenceDataFloat(data, "rawAmount"), tc.wantRaw)
			}
			wantM := gravesNDBranchMultiplier(tc.critDamage)
			if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-wantM) > gravesNDTol {
				t.Fatalf("naturalCritMultiplier=%v want %v", evidenceDataFloat(data, "naturalCritMultiplier"), wantM)
			}
			if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-wantM) > gravesNDTol {
				t.Fatalf("forcedCritMultiplier=%v want %v (same Graves formula; no double crit_damage)", evidenceDataFloat(data, "forcedCritMultiplier"), wantM)
			}
			// Absolute override owns the full branch multiplier (must not equal baseline crit_damage alone when formulas differ).
			if math.Abs(wantM-tc.critDamage) > gravesNDTol {
				if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-tc.critDamage) < gravesNDTol {
					t.Fatalf("naturalCritMultiplier unexpectedly fell back to crit_damage=%v", tc.critDamage)
				}
			}
			if tc.chance == 0 {
				if math.Abs(evidenceDataFloat(data, "naturalCritWeight")) > gravesNDTolExact {
					t.Fatalf("naturalCritWeight=%v want 0 at chance0", evidenceDataFloat(data, "naturalCritWeight"))
				}
			}
		})
	}
}

func TestGravesNewDestinyResistanceAndShieldOrdering(t *testing.T) {
	const (
		level      = 18.0
		chance     = 0.25
		critDamage = 2.0
		shieldAmt  = 40.0
	)
	wantCritAdj := gravesNDExpectedRaw(level, gravesNDProbeAD, chance, critDamage)
	wantMit := expectedMitigatedPhysical(wantCritAdj, gravesNDTargetArmor)

	compileReq, runReq := loadGravesNDFixture(t, gravesNDFixtureOpts{
		level: level, ad: gravesNDProbeAD,
		critChance: chance, critDamage: critDamage,
		armor: gravesNDTargetArmor, hp: gravesNDTargetHP, shield: shieldAmt,
	})
	done := runGravesND(t, compileReq, runReq)
	assertGravesNDSingleHitContract(t, done)
	data := gravesNDDamageEvidence(done)[0].Data

	// C2 evidence is settled before resistance: critAdjustedRawAmount stays pre-mitigation.
	if math.Abs(evidenceDataFloat(data, "critAdjustedRawAmount")-wantCritAdj) > gravesNDTol {
		t.Fatalf("critAdjustedRawAmount=%v want pre-resist %v", evidenceDataFloat(data, "critAdjustedRawAmount"), wantCritAdj)
	}
	natMods := modifiersByStage(data, "crit_multiplier_natural_branch")
	frcMods := modifiersByStage(data, "crit_multiplier_forced_branch")
	if len(natMods) != 1 || len(frcMods) != 1 {
		t.Fatalf("C2 branch mods natural=%d forced=%d want 1 each (evidence before resistance)", len(natMods), len(frcMods))
	}
	if math.Abs(evidenceDataFloat(data, "resistanceFactor")-0.5) > gravesNDTolExact {
		t.Fatalf("resistanceFactor=%v want 0.5", evidenceDataFloat(data, "resistanceFactor"))
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-wantMit) > gravesNDTol {
		t.Fatalf("mitigatedAmount=%v want %v (after C2, then resist)", evidenceDataFloat(data, "mitigatedAmount"), wantMit)
	}

	wantHP := gravesNDTargetHP - (wantMit - shieldAmt)
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > gravesNDTol {
		t.Fatalf("targetFinalHp=%v want %v (mit=%v shield=%v)", done.Summary.TargetFinalHp, wantHP, wantMit, shieldAmt)
	}
	if got := gravesNDTargetShieldRemaining(done); math.Abs(got) > gravesNDTol {
		t.Fatalf("shield remaining=%v want 0", got)
	}
}

func TestGravesNewDestinyBranchOverrideDoesNotDoubleMultiplyCritDamage(t *testing.T) {
	// With p=1, adjusted = base * M_graves. If runtime wrongly kept crit_damage then
	// multiplied again, result would be base*crit_damage*M_graves (or similar).
	const (
		level      = 18.0
		chance     = 1.0
		critDamage = 2.3
	)
	base := gravesNDNormalRaw(level, gravesNDProbeAD)
	wantM := gravesNDBranchMultiplier(critDamage)
	wantRaw := base * wantM
	wrongDouble := base * critDamage * wantM

	compileReq, runReq := loadGravesNDFixture(t, gravesNDFixtureOpts{
		level: level, ad: gravesNDProbeAD,
		critChance: chance, critDamage: critDamage,
		armor: 0, hp: gravesNDTargetHP,
	})
	done := runGravesND(t, compileReq, runReq)
	data := gravesNDDamageEvidence(done)[0].Data
	got := evidenceDataFloat(data, "rawAmount")
	if math.Abs(got-wantRaw) > gravesNDTol {
		t.Fatalf("rawAmount=%v want %v", got, wantRaw)
	}
	if math.Abs(got-wrongDouble) < gravesNDTol {
		t.Fatalf("rawAmount matched double-multiplied value %v", wrongDouble)
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-wantM) > gravesNDTol {
		t.Fatalf("natural=%v want Graves formula %v (not crit_damage=%v)", evidenceDataFloat(data, "naturalCritMultiplier"), wantM, critDamage)
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-wantM) > gravesNDTol {
		t.Fatalf("forced=%v want same Graves formula %v", evidenceDataFloat(data, "forcedCritMultiplier"), wantM)
	}
}

func TestGravesNewDestinyCompileRunReleaseNoReloadProjectileMultitarget(t *testing.T) {
	compileReq, runReq := loadGravesNDFixture(t, gravesNDFixtureOpts{
		level: 1, ad: gravesNDProbeAD, critChance: 0, critDamage: 2.0, armor: 0,
	})
	assertGravesNDProviderShape(t, compileReq)
	p := compileReq.SharedProviders[0]
	if p.InitialStateSchema != nil {
		for _, key := range []string{"reload", "shell", "ammo", "projectile", "multitarget"} {
			if _, ok := p.InitialStateSchema[key]; ok {
				t.Fatalf("unexpected state field %q", key)
			}
		}
	}
	done := runGravesND(t, compileReq, runReq)
	assertGravesNDSingleHitContract(t, done)
	if len(done.FinalSnapshot.Combatants) != 2 {
		t.Fatalf("combatants=%d want 1v1", len(done.FinalSnapshot.Combatants))
	}
}
