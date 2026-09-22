package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// hero_kindred P Mark of the Kindred / 千珏之印 — fixed 25-mark Phase-A (generic ABI).
//
// Wiki-only constants (baked; no kindred_marks state/key anywhere):
//   - P rev3994253 / SHA 9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a
//     Mark range table: +75@4 then +25 every 3 stacks → +250 at 25 marks.
//   - Q rev4007746: bonus AS = 35% + 5%*25 = 160% for 4000ms at 25 marks.
//   - W rev4038396: rank5 champion raw magic with bonus AD/AP zero =
//     45 + 0.265 * target.attr.hp.current
//     (Wiki: 45 + 20% bonus AD + 20% AP + (1.5%+1%*25)=26.5% current HP).
//   - E rev4022506: rank5 raw physical with bonus AD zero, crit branch excluded =
//     200 + 0.175 * (target.attr.hp.max - target.attr.hp.current)
//     (Wiki: 200 + 100% bonus AD + (5%+0.5%*25)=17.5% missing HP).
//   - Attack-range baseline 500 (Q effect-radius equals Kindred attack range;
//     E 0-mark target range 500) → resolved 750 with +250.
//
// Explicit non-claims: Q/W/E inventory mechanisms are NOT completed here —
// probe abilities prove only P-derived coefficients at fixed 25 marks.
// Excluded: hunting/takedown/kill, mark acquisition/intermediate stacks,
// monster branches/caps, multi-target, W pet scheduling, E crit/third-hit
// full mechanism, RNG, live publish.
//
// Path: CompileGeneric → RunGeneric only.

const (
	kindredMMProviderRef = "provider_hero_kindred_mark_of_kindred"
	kindredMMStableID    = "hero_kindred_p_mark_of_kindred"

	kindredMMQASActiveKey = "kindred_p_q_as_active"
	kindredMMRangeModKey  = "kindred_p_attack_range"
	kindredMMASModKey     = "kindred_p_q_attack_speed"

	kindredMMQKey     = "kindred_p_q_as_probe"
	kindredMMWKey     = "kindred_p_w_damage_probe"
	kindredMMEKey     = "kindred_p_e_damage_probe"
	kindredMMProbeKey = "kindred_p_resolve_probe"

	kindredMMWDamageOpRef = "op:kindred_p_w_damage_probe"
	kindredMMEDamageOpRef = "op:kindred_p_e_damage_probe"
	kindredMMProbeOpRef   = "op:kindred_p_resolve_probe"

	// 25-mark algebra (baked constants — no marks state):
	kindredMMRangeBonus   = 250.0 // +75@4 + 25*(25-4)/3 = +250
	kindredMMASBonus      = 1.60  // 0.35 + 0.05*25
	kindredMMASDurationMs = 4000.0
	kindredMMWBase        = 45.0
	kindredMMWHPRatio     = 0.265 // 0.015 + 0.01*25
	kindredMMEBase        = 200.0
	kindredMMEMissingRatio = 0.175 // 0.05 + 0.005*25

	kindredMMBaseRange     = 500.0
	kindredMMResolvedRange = 750.0 // 500 + 250
	kindredMMBaseAS        = 0.625
	kindredMMResolvedAS    = 1.625 // 0.625 * (1 + 1.60)

	kindredMMTol = 1e-9
)

func kindredMMTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func kindredMMStateSchema() map[string]interface{} {
	return map[string]interface{}{
		kindredMMQASActiveKey: kindredMMTimedSlot(0, 1, kindredMMASDurationMs),
	}
}

func kindredMMRangeModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: kindredMMRangeModKey,
		Kind:        "attribute",
		Target:      "attack_range",
		ValuePolicy: "add",
		Value:       gfConst(kindredMMRangeBonus),
	}
}

func kindredMMASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: kindredMMASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(kindredMMASBonus),
				{Op: "read", Path: "provider.state." + kindredMMQASActiveKey},
			},
		},
	}
}

func kindredMMQAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kindredMMQKey,
		Kind:       "active",
		Types:      []string{},
		// Cast overrides timed AS gate to 1 (Quinn/Xayah-shaped window via state × permanent modifier).
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         kindredMMQASActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func kindredMMWAmount() *model.GenericFormulaExpr {
	base := kindredMMWBase
	ratio := kindredMMWHPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &base},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "target.attr.hp.current"},
				},
			},
		},
	}
}

func kindredMMEAmount() *model.GenericFormulaExpr {
	base := kindredMMEBase
	ratio := kindredMMEMissingRatio
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
							{Op: "read", Path: "target.attr.hp.max"},
							{Op: "read", Path: "target.attr.hp.current"},
						},
					},
				},
			},
		},
	}
}

func kindredMMWAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: kindredMMWKey,
		Kind:       "active",
		Types:      []string{},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Ref:        kindredMMWDamageOpRef,
				Amount:     kindredMMWAmount(),
			},
		},
	}
}

func kindredMMEAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: kindredMMEKey,
		Kind:       "active",
		Types:      []string{},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Ref:        kindredMMEDamageOpRef,
				Amount:     kindredMMEAmount(),
			},
		},
	}
}

func kindredMMResolveProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: kindredMMProbeKey,
		Kind:       "active",
		// basic_attack so the probe does not synthesize ability_started noise.
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        kindredMMProbeOpRef,
			},
		},
	}
}

func kindredMMProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        kindredMMProviderRef,
		Kind:               "passive",
		StableID:           kindredMMStableID,
		InitialStateSchema: kindredMMStateSchema(),
		Modifiers: []model.ModifierDefinition{
			kindredMMRangeModifier(),
			kindredMMASModifier(),
		},
		Abilities: []model.AbilityDefinition{
			kindredMMQAbility(),
			kindredMMWAbility(),
			kindredMMEAbility(),
			kindredMMResolveProbeAbility(),
		},
	}
}

func ensureKindredMMTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func mountKindredMMProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, kindredMMProviderDef())
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: kindredMMProviderRef, DefinitionRef: kindredMMProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: kindredMMProviderRef, DefinitionRef: kindredMMProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func kindredMMQRef() string {
	return "source.provider[" + kindredMMProviderRef + "].ability[" + kindredMMQKey + "]"
}

func kindredMMWRef() string {
	return "source.provider[" + kindredMMProviderRef + "].ability[" + kindredMMWKey + "]"
}

func kindredMMERef() string {
	return "source.provider[" + kindredMMProviderRef + "].ability[" + kindredMMEKey + "]"
}

func kindredMMProbeRef() string {
	return "source.provider[" + kindredMMProviderRef + "].ability[" + kindredMMProbeKey + "]"
}

func loadKindredMMFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureKindredMMTypes(&compileReq)
	mountKindredMMProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_range", model.AttributeSlotDef{
		Base: kindredMMBaseRange, Current: kindredMMBaseRange, Max: kindredMMBaseRange, Resolved: kindredMMBaseRange,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: kindredMMBaseAS, Current: kindredMMBaseAS, Max: kindredMMBaseAS, Resolved: kindredMMBaseAS,
	})
	// Probe formulas bake zero bonus AD/AP terms; keep AP/AD inert.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func setKindredMMTargetHP(compileReq *model.CompileRequest, runReq *model.RunRequest, maxHP, currentHP float64) {
	setCombatantAttr(compileReq, runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: maxHP, Current: currentHP, Max: maxHP, Resolved: maxHP,
	})
}

func runKindredMM(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func kindredMMCompile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compileMigrated(&compileReq, nil)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func kindredMMFindProvider(t *testing.T, result compile.GenericCompileResult) *compile.CompiledProvider {
	t.Helper()
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == kindredMMProviderRef {
			return p
		}
	}
	t.Fatal("missing kindred mark-of-kindred provider")
	return nil
}

func kindredMMFindAbility(t *testing.T, result compile.GenericCompileResult, abilityKey string) compile.CompiledAbility {
	t.Helper()
	found := kindredMMFindProvider(t, result)
	for i := 0; i < int(found.AbilityCount); i++ {
		a := result.Session.Abilities[int(found.AbilityStart)+i]
		if a.AbilityKey == abilityKey {
			return a
		}
	}
	t.Fatalf("missing ability %q", abilityKey)
	return compile.CompiledAbility{}
}

func kindredMMProgramInstr(t *testing.T, result compile.GenericCompileResult, id formula.GenericProgramID) []formula.GenericInstr {
	t.Helper()
	idx := int(id)
	if idx < 0 || idx >= len(result.Session.Formulas.Programs) {
		t.Fatalf("formula program id %d out of range (n=%d)", idx, len(result.Session.Formulas.Programs))
	}
	return result.Session.Formulas.Programs[idx].Instr
}

func kindredMMStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[kindredMMProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[key].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func kindredMMSourceAttrSlot(t *testing.T, snap model.Snapshot, attr string) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("source missing attr %s", attr)
		}
		return slot
	}
	t.Fatal("source combatant missing")
	return model.AttributeSlotDef{}
}

func kindredMMExpectedWRaw(currentHP float64) float64 {
	return kindredMMWBase + kindredMMWHPRatio*currentHP
}

func kindredMMExpectedERaw(maxHP, currentHP float64) float64 {
	return kindredMMEBase + kindredMMEMissingRatio*(maxHP-currentHP)
}

// TestKindredMarkOfKindredMaxMarksAlgebraCrossCheck: 25-mark algebra for baked constants.
func TestKindredMarkOfKindredMaxMarksAlgebraCrossCheck(t *testing.T) {
	// Range: +75 at 4, then +25 every 3 stacks through 25 → +250.
	rangeFromMarks := 75.0 + 25.0*((25.0-4.0)/3.0)
	if math.Abs(rangeFromMarks-kindredMMRangeBonus) > kindredMMTol {
		t.Fatalf("range algebra=%v want %v", rangeFromMarks, kindredMMRangeBonus)
	}
	asFromMarks := 0.35 + 0.05*25.0
	if math.Abs(asFromMarks-kindredMMASBonus) > kindredMMTol {
		t.Fatalf("AS algebra=%v want %v", asFromMarks, kindredMMASBonus)
	}
	wRatio := 0.015 + 0.01*25.0
	if math.Abs(wRatio-kindredMMWHPRatio) > kindredMMTol {
		t.Fatalf("W HP ratio algebra=%v want %v", wRatio, kindredMMWHPRatio)
	}
	// Wiki: 5% + 0.5% per mark → 0.05 + 0.005*25 = 0.175 at 25 marks.
	eRatio := 0.05 + 0.005*25.0
	if math.Abs(eRatio-kindredMMEMissingRatio) > kindredMMTol {
		t.Fatalf("E missing-HP ratio algebra=%v want %v", eRatio, kindredMMEMissingRatio)
	}
	wantAS := kindredMMBaseAS * (1 + kindredMMASBonus)
	if math.Abs(wantAS-kindredMMResolvedAS) > kindredMMTol {
		t.Fatalf("resolved AS=%v want %v", wantAS, kindredMMResolvedAS)
	}
	if math.Abs(kindredMMBaseRange+kindredMMRangeBonus-kindredMMResolvedRange) > kindredMMTol {
		t.Fatalf("resolved range=%v want %v", kindredMMBaseRange+kindredMMRangeBonus, kindredMMResolvedRange)
	}
}

// TestKindredMarkOfKindredMaxMarksCompileContract: state schema, modifier policies/bytecode,
// stable probe ids and operations. Asserts absence of kindred_marks.
func TestKindredMarkOfKindredMaxMarksCompileContract(t *testing.T) {
	compileReq, _ := loadKindredMMFixture(t)
	result := kindredMMCompile(t, compileReq)
	found := kindredMMFindProvider(t, result)

	if found.StableID != kindredMMStableID {
		t.Fatalf("StableID=%q want %q", found.StableID, kindredMMStableID)
	}
	if _, bad := found.StateFields["kindred_marks"]; bad {
		t.Fatal("kindred_marks must not exist in StateFields")
	}
	qas := found.StateFields[kindredMMQASActiveKey]
	if qas.DefaultValue != 0 || !qas.HasCap || qas.MaxValue != 1 ||
		qas.DurationMs != int64(kindredMMASDurationMs) ||
		qas.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("kindred_p_q_as_active field=%+v want default0/max1/duration4000/refresh_on_write", qas)
	}
	if len(found.Modifiers) != 2 {
		t.Fatalf("modifiers=%d want 2 (range + AS)", len(found.Modifiers))
	}

	rangeMod := found.Modifiers[0]
	if rangeMod.ModifierKey != kindredMMRangeModKey || rangeMod.Kind != "attribute" ||
		rangeMod.Target != "attack_range" || rangeMod.ValuePolicy != "add" || !rangeMod.HasValue {
		t.Fatalf("range modifier=%+v want attribute/attack_range/add", rangeMod)
	}
	rangeInstr := kindredMMProgramInstr(t, result, rangeMod.ValueProgram)
	if len(rangeInstr) != 1 || rangeInstr[0].Op != formula.GenericOpConst ||
		math.Abs(rangeInstr[0].Value-kindredMMRangeBonus) > kindredMMTol {
		t.Fatalf("range bytecode=%+v want const 250", rangeInstr)
	}

	asMod := found.Modifiers[1]
	if asMod.ModifierKey != kindredMMASModKey || asMod.Kind != "attribute" ||
		asMod.Target != "attack_speed" || asMod.ValuePolicy != "percent_add" || !asMod.HasValue {
		t.Fatalf("AS modifier=%+v want attribute/attack_speed/percent_add", asMod)
	}
	asInstr := kindredMMProgramInstr(t, result, asMod.ValueProgram)
	if len(asInstr) != 3 ||
		asInstr[0].Op != formula.GenericOpConst || math.Abs(asInstr[0].Value-kindredMMASBonus) > kindredMMTol ||
		asInstr[1].Op != formula.GenericOpRead || asInstr[1].ReadKind != formula.ReadProviderState ||
		asInstr[1].ReadKey != kindredMMQASActiveKey ||
		asInstr[2].Op != formula.GenericOpMul {
		t.Fatalf("AS bytecode=%+v want 1.60 * provider.state.kindred_p_q_as_active", asInstr)
	}

	q := kindredMMFindAbility(t, result, kindredMMQKey)
	if q.OperationCount != 1 {
		t.Fatalf("Q OperationCount=%d want 1", q.OperationCount)
	}
	qOp := result.Session.Operations[q.OperationStart]
	if qOp.Operation != "state_change" || qOp.Ref != kindredMMQASActiveKey ||
		qOp.ValuePolicy != "override" || qOp.StateScope != "state_scope/provider" || !qOp.HasAmount {
		t.Fatalf("Q op=%+v want state_change override kindred_p_q_as_active provider-scope", qOp)
	}
	qAmt := kindredMMProgramInstr(t, result, qOp.AmountProgram)
	if len(qAmt) != 1 || qAmt[0].Op != formula.GenericOpConst || math.Abs(qAmt[0].Value-1) > kindredMMTol {
		t.Fatalf("Q amount bytecode=%+v want const 1", qAmt)
	}

	w := kindredMMFindAbility(t, result, kindredMMWKey)
	if w.OperationCount != 1 {
		t.Fatalf("W OperationCount=%d want 1", w.OperationCount)
	}
	wOp := result.Session.Operations[w.OperationStart]
	if wOp.Operation != "damage" || wOp.DamageType != "damage/magic" || wOp.Ref != kindredMMWDamageOpRef || !wOp.HasAmount {
		t.Fatalf("W op=%+v want damage/magic %s", wOp, kindredMMWDamageOpRef)
	}
	wInstr := kindredMMProgramInstr(t, result, wOp.AmountProgram)
	// 45 + (0.265 * target.attr.hp.current)
	if len(wInstr) != 5 ||
		wInstr[0].Op != formula.GenericOpConst || math.Abs(wInstr[0].Value-kindredMMWBase) > kindredMMTol ||
		wInstr[1].Op != formula.GenericOpConst || math.Abs(wInstr[1].Value-kindredMMWHPRatio) > kindredMMTol ||
		wInstr[2].Op != formula.GenericOpRead || wInstr[2].ReadKind != formula.ReadTargetAttr ||
		wInstr[2].ReadKey != "hp.current" ||
		wInstr[3].Op != formula.GenericOpMul ||
		wInstr[4].Op != formula.GenericOpAdd {
		t.Fatalf("W bytecode=%+v want 45 + 0.265 * target.attr.hp.current", wInstr)
	}

	e := kindredMMFindAbility(t, result, kindredMMEKey)
	if e.OperationCount != 1 {
		t.Fatalf("E OperationCount=%d want 1", e.OperationCount)
	}
	eOp := result.Session.Operations[e.OperationStart]
	if eOp.Operation != "damage" || eOp.DamageType != "damage/physical" || eOp.Ref != kindredMMEDamageOpRef || !eOp.HasAmount {
		t.Fatalf("E op=%+v want damage/physical %s", eOp, kindredMMEDamageOpRef)
	}
	eInstr := kindredMMProgramInstr(t, result, eOp.AmountProgram)
	// 200 + 0.175 * (hp.max - hp.current)
	if len(eInstr) != 7 ||
		eInstr[0].Op != formula.GenericOpConst || math.Abs(eInstr[0].Value-kindredMMEBase) > kindredMMTol ||
		eInstr[1].Op != formula.GenericOpConst || math.Abs(eInstr[1].Value-kindredMMEMissingRatio) > kindredMMTol ||
		eInstr[2].Op != formula.GenericOpRead || eInstr[2].ReadKind != formula.ReadTargetAttr ||
		eInstr[2].ReadKey != "hp.max" ||
		eInstr[3].Op != formula.GenericOpRead || eInstr[3].ReadKind != formula.ReadTargetAttr ||
		eInstr[3].ReadKey != "hp.current" ||
		eInstr[4].Op != formula.GenericOpSub ||
		eInstr[5].Op != formula.GenericOpMul ||
		eInstr[6].Op != formula.GenericOpAdd {
		t.Fatalf("E bytecode=%+v want 200 + 0.175 * (hp.max - hp.current)", eInstr)
	}

	probe := kindredMMFindAbility(t, result, kindredMMProbeKey)
	if probe.AbilityKey != kindredMMProbeKey || probe.OperationCount != 1 {
		t.Fatalf("resolve probe=%+v want key %s with 1 op", probe, kindredMMProbeKey)
	}
}

// TestKindredMarkOfKindredMaxMarksAttackRange500To750: permanent +250 on baseline 500.
func TestKindredMarkOfKindredMaxMarksAttackRange500To750(t *testing.T) {
	compileReq, runReq := loadKindredMMFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "probe", AbilityRef: kindredMMProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runKindredMM(t, compileReq, runReq)

	slot := kindredMMSourceAttrSlot(t, done.FinalSnapshot, "attack_range")
	if math.Abs(slot.Base-kindredMMBaseRange) > kindredMMTol {
		t.Fatalf("attack_range.base=%v want %v (modifier must not mutate base)", slot.Base, kindredMMBaseRange)
	}
	if math.Abs(slot.Resolved-kindredMMResolvedRange) > kindredMMTol {
		t.Fatalf("attack_range.resolved=%v want %v", slot.Resolved, kindredMMResolvedRange)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_range"); math.Abs(got-kindredMMResolvedRange) > kindredMMTol {
		t.Fatalf("attack_range resolved helper=%v want %v", got, kindredMMResolvedRange)
	}
}

// TestKindredMarkOfKindredMaxMarksQASBeforeActiveExpiry: before cast AS=base; cast → +160%;
// after 4000ms state expires and AS restores.
func TestKindredMarkOfKindredMaxMarksQASBeforeActiveExpiry(t *testing.T) {
	t.Run("before_cast", func(t *testing.T) {
		compileReq, runReq := loadKindredMMFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "probe", AbilityRef: kindredMMProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runKindredMM(t, compileReq, runReq)

		if got := kindredMMStateValue(t, done, kindredMMQASActiveKey); got != 0 {
			t.Fatalf("kindred_p_q_as_active=%v want 0 before cast", got)
		}
		slot := kindredMMSourceAttrSlot(t, done.FinalSnapshot, "attack_speed")
		if math.Abs(slot.Base-kindredMMBaseAS) > kindredMMTol {
			t.Fatalf("attack_speed.base=%v want %v", slot.Base, kindredMMBaseAS)
		}
		if math.Abs(slot.Resolved-kindredMMBaseAS) > kindredMMTol {
			t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, kindredMMBaseAS)
		}
	})

	t.Run("active_window", func(t *testing.T) {
		compileReq, runReq := loadKindredMMFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q", AbilityRef: kindredMMQRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "probe", AbilityRef: kindredMMProbeRef(), Source: "source", Target: "target", FirstAtMs: 100},
		}
		runReq.StopPolicy.DurationMs = 200
		done := runKindredMM(t, compileReq, runReq)

		if got := kindredMMStateValue(t, done, kindredMMQASActiveKey); got != 1 {
			t.Fatalf("kindred_p_q_as_active=%v want 1 while armed", got)
		}
		slot := kindredMMSourceAttrSlot(t, done.FinalSnapshot, "attack_speed")
		if math.Abs(slot.Base-kindredMMBaseAS) > kindredMMTol {
			t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, kindredMMBaseAS)
		}
		if math.Abs(slot.Resolved-kindredMMResolvedAS) > kindredMMTol {
			t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, kindredMMResolvedAS)
		}
		// Range remains permanent through Q window.
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_range"); math.Abs(got-kindredMMResolvedRange) > kindredMMTol {
			t.Fatalf("attack_range during Q=%v want %v", got, kindredMMResolvedRange)
		}
	})

	t.Run("expiry_after_4000ms", func(t *testing.T) {
		compileReq, runReq := loadKindredMMFixture(t)
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "q", AbilityRef: kindredMMQRef(), Source: "source", Target: "target", FirstAtMs: 0},
			{EntryKey: "probe_expired", AbilityRef: kindredMMProbeRef(), Source: "source", Target: "target", FirstAtMs: 4001},
		}
		runReq.StopPolicy.DurationMs = 4100
		done := runKindredMM(t, compileReq, runReq)

		if got := kindredMMStateValue(t, done, kindredMMQASActiveKey); got != 0 {
			t.Fatalf("kindred_p_q_as_active after expiry=%v want 0", got)
		}
		slot := kindredMMSourceAttrSlot(t, done.FinalSnapshot, "attack_speed")
		if math.Abs(slot.Resolved-kindredMMBaseAS) > kindredMMTol {
			t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, kindredMMBaseAS)
		}
		if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_range"); math.Abs(got-kindredMMResolvedRange) > kindredMMTol {
			t.Fatalf("attack_range after Q expiry=%v want permanent %v", got, kindredMMResolvedRange)
		}
	})
}

// TestKindredMarkOfKindredMaxMarksWCrossValues: rank5 magic 45+0.265*currentHP; armor/MR 0.
func TestKindredMarkOfKindredMaxMarksWCrossValues(t *testing.T) {
	cases := []struct {
		name       string
		currentHP  float64
		wantRaw    float64
	}{
		{name: "hp_1000", currentHP: 1000, wantRaw: kindredMMExpectedWRaw(1000)}, // 310
		{name: "hp_2000", currentHP: 2000, wantRaw: kindredMMExpectedWRaw(2000)}, // 575
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if math.Abs(tc.wantRaw-(kindredMMWBase+kindredMMWHPRatio*tc.currentHP)) > kindredMMTol {
				t.Fatalf("fixture wantRaw=%v inconsistent", tc.wantRaw)
			}
			compileReq, runReq := loadKindredMMFixture(t)
			setKindredMMTargetHP(&compileReq, &runReq, tc.currentHP, tc.currentHP)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w", AbilityRef: kindredMMWRef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runKindredMM(t, compileReq, runReq)

			gotRaw := sumDamageRawByOpRef(done, kindredMMWDamageOpRef)
			gotMit := sumDamageMitigatedByOpRef(done, kindredMMWDamageOpRef)
			if math.Abs(gotRaw-tc.wantRaw) > kindredMMTol {
				t.Fatalf("W raw=%v want %v (45 + 0.265*%v)", gotRaw, tc.wantRaw, tc.currentHP)
			}
			if math.Abs(gotMit-tc.wantRaw) > kindredMMTol {
				t.Fatalf("W mitigated=%v want raw %v (MR=0)", gotMit, tc.wantRaw)
			}
			item := firstDamageEvidenceByOpRef(done, kindredMMWDamageOpRef)
			if item == nil {
				t.Fatal("missing W damage evidence")
			}
			if math.Abs(evidenceDataFloat(item.Data, "rawAmount")-tc.wantRaw) > kindredMMTol {
				t.Fatalf("evidence rawAmount=%v want %v", evidenceDataFloat(item.Data, "rawAmount"), tc.wantRaw)
			}
			if math.Abs(evidenceDataFloat(item.Data, "mitigatedAmount")-tc.wantRaw) > kindredMMTol {
				t.Fatalf("evidence mitigatedAmount=%v want %v", evidenceDataFloat(item.Data, "mitigatedAmount"), tc.wantRaw)
			}
		})
	}
}

// TestKindredMarkOfKindredMaxMarksECrossValues: rank5 physical 200+0.175*missingHP; armor 0; no crit.
func TestKindredMarkOfKindredMaxMarksECrossValues(t *testing.T) {
	cases := []struct {
		name      string
		maxHP     float64
		currentHP float64
		wantRaw   float64
	}{
		{name: "missing_600", maxHP: 1000, currentHP: 400, wantRaw: kindredMMExpectedERaw(1000, 400)},   // 305
		{name: "missing_1500", maxHP: 2000, currentHP: 500, wantRaw: kindredMMExpectedERaw(2000, 500)}, // 462.5
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			missing := tc.maxHP - tc.currentHP
			if math.Abs(tc.wantRaw-(kindredMMEBase+kindredMMEMissingRatio*missing)) > kindredMMTol {
				t.Fatalf("fixture wantRaw=%v inconsistent", tc.wantRaw)
			}
			compileReq, runReq := loadKindredMMFixture(t)
			setKindredMMTargetHP(&compileReq, &runReq, tc.maxHP, tc.currentHP)
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "e", AbilityRef: kindredMMERef(), Source: "source", Target: "target", FirstAtMs: 0},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runKindredMM(t, compileReq, runReq)

			gotRaw := sumDamageRawByOpRef(done, kindredMMEDamageOpRef)
			gotMit := sumDamageMitigatedByOpRef(done, kindredMMEDamageOpRef)
			if math.Abs(gotRaw-tc.wantRaw) > kindredMMTol {
				t.Fatalf("E raw=%v want %v (200 + 0.175*%v)", gotRaw, tc.wantRaw, missing)
			}
			if math.Abs(gotMit-tc.wantRaw) > kindredMMTol {
				t.Fatalf("E mitigated=%v want raw %v (armor=0)", gotMit, tc.wantRaw)
			}
			item := firstDamageEvidenceByOpRef(done, kindredMMEDamageOpRef)
			if item == nil {
				t.Fatal("missing E damage evidence")
			}
			if math.Abs(evidenceDataFloat(item.Data, "rawAmount")-tc.wantRaw) > kindredMMTol {
				t.Fatalf("evidence rawAmount=%v want %v", evidenceDataFloat(item.Data, "rawAmount"), tc.wantRaw)
			}
			if math.Abs(evidenceDataFloat(item.Data, "mitigatedAmount")-tc.wantRaw) > kindredMMTol {
				t.Fatalf("evidence mitigatedAmount=%v want %v", evidenceDataFloat(item.Data, "mitigatedAmount"), tc.wantRaw)
			}
		})
	}
}
