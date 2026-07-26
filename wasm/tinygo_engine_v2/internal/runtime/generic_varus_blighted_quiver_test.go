package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_varus W Blighted Quiver / 枯萎箭袋 — Phase-A v2 Wasm exact verification slice.
//
// Frozen boundary:
//
//	fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only;
//	q_physical_then_w_active_post_q_pre_blight_then_blight_detonation;
//	rank5; no_equipment_interop
//
// Wiki authority (repository sidecar only; no screenshot/OCR; no DDragon numeric truth):
//
//	Candidate hero_skill|hero_varus|W|枯萎箭袋
//	Template:Data Varus/Blighted Quiver
//	wikiPageId 1309980 / rev 4026472 / timestamp 2026-06-09
//	SHA256 16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2
//	数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json
//
// Topology (TF/Vayne-style separate W provider + Kai'Sa-style target state / ordering):
//   - existing champion AA emits exactly one event/basic_attack_hit
//   - provider_hero_varus_w_blighted_quiver_phase_a listens All{basic_attack_hit, source_owner}
//     once/event: magic on-hit then provider_target blight_stacks += 1
//   - blight_stacks max3 / 6000ms / refresh_on_write / provider_target
//   - blighted_quiver_active max1 / 5500ms / refresh_on_write / provider
//   - W active ability_key blighted_quiver_phase_a_active: no cost/CD; override active=1
//   - W-scoped Q ordering carrier ability_key blighted_quiver_q_max_charge_carrier
//     (scaffold only; does not claim real Varus Q completion):
//     1) physical 360 + 1.20*max(0, bonusAD)
//     2) if active>=1: magic 0.21*(hp.max-hp.current) post-Q / pre-Blight
//     3) if blight>0: magic hp.max*blight*(0.05+0.00013*AP)*1.5
//     4) conditional blight reset=0
//     5) conditional active reset=0
//   - All W damage: CritEligible=false, CopyableOnHit=false; normal phys/magic resist.
//
// Explicit non-goals: ranks1-4, variable Q charge, W cooldown/recast, real Q mana/CD/
// channel/projectile/multi-target, blight CDR refund, equipment/Guinsoo interop,
// monster caps, live publish. No production runtime/model/ABI edits.

const (
	varusBQCandidateKey = "hero_skill|hero_varus|W|枯萎箭袋"
	varusBQWikiPageID   = 1309980
	varusBQRevisionID   = 4026472
	varusBQContentSHA   = "16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2"
	varusBQBoundary     = "fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only; " +
		"q_physical_then_w_active_post_q_pre_blight_then_blight_detonation; " +
		"rank5; no_equipment_interop"

	varusBQProviderRef   = "provider_hero_varus_w_blighted_quiver_phase_a"
	varusBQStableID      = "provider_hero_varus_w_blighted_quiver_phase_a"
	varusBQListenerKey   = "listener_hero_varus_w_blighted_quiver_basic_attack_hit"
	varusBQListenerShort = "blighted_quiver_on_basic_attack_hit"

	varusBQActiveAbilityID   = "ability_hero_varus_w_blighted_quiver_active"
	varusBQActiveAbilityKey  = "blighted_quiver_phase_a_active"
	varusBQCarrierAbilityID  = "ability_hero_varus_w_piercing_arrow_max_charge_carrier"
	varusBQCarrierAbilityKey = "blighted_quiver_q_max_charge_carrier"

	varusBQBlightKey = "blight_stacks"
	varusBQActiveKey = "blighted_quiver_active"

	varusBQOnHitOpRef         = "op:blighted_quiver_on_hit_magic"
	varusBQCarrierQOpRef      = "op:blighted_quiver_q_carrier_physical"
	varusBQCarrierActiveOpRef = "op:blighted_quiver_q_carrier_active_missing_hp"
	varusBQCarrierBlightOpRef = "op:blighted_quiver_q_carrier_blight_detonate"
	varusBQAAOpRef            = "op:varus_bq_aa"

	varusBQChampionRef = spellbladeChampionRef
	varusBQHitAbility  = spellbladeHitAbilityKey
	varusBQHitEvent    = spellbladeHitEvent

	varusBQMaxBlight          = 3.0
	varusBQBlightDurMs        = 6000.0
	varusBQActiveDurMs        = 5500.0
	varusBQOnHitFlat          = 40.0
	varusBQOnHitBonusAD       = 0.15
	varusBQOnHitAP            = 0.25
	varusBQCarrierQFlat       = 360.0
	varusBQCarrierQAD         = 1.20
	varusBQActiveMissingRatio = 0.21 // rank5 14% * max-charge 1.5
	varusBQBlightBaseRatio    = 0.05 // rank5 5%
	varusBQBlightAPPerUnit    = 0.00013
	varusBQMaxChargeMul       = 1.5

	varusBQAADamage   = 50.0
	varusBQADBase     = 60.0
	varusBQADResolved = 160.0 // bonusAD = 100
	varusBQAP         = 200.0
	varusBQDefaultHP  = 10000.0
	varusBQTol        = 1e-9

	varusBQBonusADModKey = "fixture_varus_bq_bonus_ad"
)

func varusBQBonusAD(resolvedAD, baseAD float64) float64 {
	b := resolvedAD - baseAD
	if b < 0 {
		return 0
	}
	return b
}

func varusBQExpectedOnHitRaw(resolvedAD, baseAD, ap float64) float64 {
	return varusBQOnHitFlat +
		varusBQOnHitBonusAD*varusBQBonusAD(resolvedAD, baseAD) +
		varusBQOnHitAP*ap
}

func varusBQExpectedCarrierQRaw(resolvedAD, baseAD float64) float64 {
	return varusBQCarrierQFlat + varusBQCarrierQAD*varusBQBonusAD(resolvedAD, baseAD)
}

func varusBQExpectedActiveMissingRaw(missingHP float64) float64 {
	return varusBQActiveMissingRatio * missingHP
}

func varusBQExpectedBlightRaw(maxHP, stacks, ap float64) float64 {
	return maxHP * stacks * (varusBQBlightBaseRatio + varusBQBlightAPPerUnit*ap) * varusBQMaxChargeMul
}

func varusBQTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func varusBQStateSchema() map[string]interface{} {
	return map[string]interface{}{
		varusBQBlightKey: varusBQTimedSlot(0, varusBQMaxBlight, varusBQBlightDurMs),
		varusBQActiveKey: varusBQTimedSlot(0, 1, varusBQActiveDurMs),
	}
}

func varusBQConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func varusBQOnHitAmount() *model.GenericFormulaExpr {
	flat := varusBQOnHitFlat
	adRatio := varusBQOnHitBonusAD
	apRatio := varusBQOnHitAP
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{
				Op: "add",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &flat},
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &adRatio},
							{
								Op: "max",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &zero},
									{
										Op: "sub",
										Args: []model.GenericFormulaExpr{
											{Op: "read", Path: "event.entry_source.attr.ad.resolved"},
											{Op: "read", Path: "event.entry_source.attr.ad.base"},
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
					{Op: "const", Value: &apRatio},
					{Op: "read", Path: "event.entry_source.attr.ap.resolved"},
				},
			},
		},
	}
}

func varusBQCarrierQAmount() *model.GenericFormulaExpr {
	flat := varusBQCarrierQFlat
	adRatio := varusBQCarrierQAD
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &adRatio},
					{
						Op: "max",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &zero},
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
		},
	}
}

func varusBQCarrierActiveMissingAmount() *model.GenericFormulaExpr {
	ratio := varusBQActiveMissingRatio
	return &model.GenericFormulaExpr{
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
	}
}

func varusBQCarrierBlightAmount() *model.GenericFormulaExpr {
	base := varusBQBlightBaseRatio
	apPer := varusBQBlightAPPerUnit
	mul := varusBQMaxChargeMul
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{
						Op: "mul",
						Args: []model.GenericFormulaExpr{
							{Op: "read", Path: "target.attr.hp.max"},
							{Op: "read", Path: "provider.target_state." + varusBQBlightKey},
						},
					},
					{
						Op: "add",
						Args: []model.GenericFormulaExpr{
							{Op: "const", Value: &base},
							{
								Op: "mul",
								Args: []model.GenericFormulaExpr{
									{Op: "const", Value: &apPer},
									{Op: "read", Path: "source.attr.ap.resolved"},
								},
							},
						},
					},
				},
			},
			{Op: "const", Value: &mul},
		},
	}
}

func varusBQActiveArmedCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + varusBQActiveKey},
			{Op: "const", Value: &one},
		},
	}
}

func varusBQBlightPresentCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "gt",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + varusBQBlightKey},
			{Op: "const", Value: &zero},
		},
	}
}

func varusBQHitListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:         varusBQListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher:        model.TypeMatcher{All: []string{varusBQHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           varusBQOnHitOpRef,
				CopyableOnHit: false,
				CritEligible:  false,
				Amount:        varusBQOnHitAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         varusBQBlightKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func varusBQActiveAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: varusBQActiveAbilityKey,
		Kind:       "active",
		// No Cost / Cooldown: Phase-A direct active override only.
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         varusBQActiveKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

func varusBQCarrierAbility() model.AbilityDefinition {
	zero := 0.0
	activeCond := varusBQActiveArmedCond()
	blightCond := varusBQBlightPresentCond()
	return model.AbilityDefinition{
		AbilityKey: varusBQCarrierAbilityKey,
		Kind:       "active",
		Operations: []model.OperationDefinition{
			{
				// W ordering scaffold only — not a claim of real Varus Q completion.
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           varusBQCarrierQOpRef,
				CopyableOnHit: false,
				CritEligible:  false,
				Amount:        varusBQCarrierQAmount(),
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           varusBQCarrierActiveOpRef,
				CopyableOnHit: false,
				CritEligible:  false,
				Condition:     activeCond,
				Amount:        varusBQCarrierActiveMissingAmount(),
			},
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Ref:           varusBQCarrierBlightOpRef,
				CopyableOnHit: false,
				CritEligible:  false,
				Condition:     blightCond,
				Amount:        varusBQCarrierBlightAmount(),
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         varusBQBlightKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   blightCond,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         varusBQActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   activeCond,
			},
		},
	}
}

func varusBQAAOps() []model.OperationDefinition {
	aa := varusBQAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        varusBQAAOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: varusBQHitEvent,
			Ref:       varusBQHitEvent,
		},
	}
}

func ensureVarusBQTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: varusBQHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func configureVarusBQChampionAA(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: varusBQHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: varusBQAAOps(),
	}}
	bonusAD := varusBQADResolved - varusBQADBase
	compileReq.SharedProviders[0].Modifiers = append(compileReq.SharedProviders[0].Modifiers, model.ModifierDefinition{
		ModifierKey: varusBQBonusADModKey,
		Kind:        "attribute",
		Target:      "ad",
		ValuePolicy: "add",
		Value:       gfConst(bonusAD),
	})
}

func mountVarusBQProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        varusBQProviderRef,
		Kind:               "passive",
		StableID:           varusBQStableID,
		InitialStateSchema: varusBQStateSchema(),
		Listeners:          []model.ListenerDefinition{varusBQHitListener()},
		Abilities: []model.AbilityDefinition{
			varusBQActiveAbility(),
			varusBQCarrierAbility(),
		},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: varusBQProviderRef, DefinitionRef: varusBQProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: varusBQProviderRef, DefinitionRef: varusBQProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

type varusBQFixtureOpts struct {
	ap    float64
	hp    float64
	armor float64
	mr    float64
}

func loadVarusBQFixture(t *testing.T, opts varusBQFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	if opts.hp <= 0 {
		opts.hp = varusBQDefaultHP
	}
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.varus_blighted_quiver_phase_a"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureVarusBQTypes(&compileReq)
	configureVarusBQChampionAA(&compileReq)
	mountVarusBQProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: varusBQADBase, Current: varusBQADBase, Max: varusBQADBase, Resolved: varusBQADBase,
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

func varusBQAARef() string {
	return "source.provider[" + varusBQChampionRef + "].ability[" + varusBQHitAbility + "]"
}

func varusBQActiveRef() string {
	return "source.provider[" + varusBQProviderRef + "].ability[" + varusBQActiveAbilityKey + "]"
}

func varusBQCarrierRef() string {
	return "source.provider[" + varusBQProviderRef + "].ability[" + varusBQCarrierAbilityKey + "]"
}

func setVarusBQDriver(runReq *model.RunRequest, entries []model.DriverEntry) {
	runReq.DriverPlan.Entries = entries
	last := int64(0)
	for _, e := range entries {
		if e.FirstAtMs > last {
			last = e.FirstAtMs
		}
	}
	runReq.StopPolicy.DurationMs = last + 100
}

func setVarusBQDriverHits(runReq *model.RunRequest, atMs []int64) {
	entries := make([]model.DriverEntry, 0, len(atMs))
	for i, at := range atMs {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "varus_bq_aa_" + itoaRuntime(i),
			AbilityRef: varusBQAARef(),
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  at,
		})
	}
	setVarusBQDriver(runReq, entries)
}

func runVarusBQ(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func varusBQFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == varusBQProviderRef {
			return p
		}
	}
	return nil
}

func varusBQProviderBag(t *testing.T, done model.DoneResult) map[string]interface{} {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[varusBQProviderRef].(map[string]interface{})
		if !ok {
			t.Fatalf("providerState missing for %s: %+v", varusBQProviderRef, c.ProviderState)
		}
		return bag
	}
	t.Fatal("source combatant missing")
	return nil
}

func varusBQBlightStacks(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := varusBQProviderBag(t, done)
	ts, ok := bag["targetState"].(map[string]interface{})
	if !ok {
		return 0
	}
	values, ok := ts["values"].(map[string]interface{})
	if !ok {
		return 0
	}
	v, _ := values[varusBQBlightKey].(float64)
	return v
}

func varusBQActiveValue(t *testing.T, done model.DoneResult) float64 {
	t.Helper()
	bag := varusBQProviderBag(t, done)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		return 0
	}
	v, _ := state[varusBQActiveKey].(float64)
	return v
}

func varusBQDamageByOp(done model.DoneResult, opRef string) (count int, rawSum, mitSum float64, items []model.EvidenceItem) {
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

func varusBQDamageTimeline(done model.DoneResult) []string {
	out := make([]string, 0, len(done.Evidence.Items))
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		out = append(out, evidenceDataString(item.Data, "operationRef"))
	}
	return out
}

func varusBQWikiSidecarPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "normalized", "generic", "varus-w.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

func varusBQWikiRawPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-current-champions", "raw", "varus-w.wikitext")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki raw missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type varusBQWikiSidecar struct {
	CandidateKey      string `json:"candidateKey"`
	WikiPageID        int    `json:"wikiPageId"`
	RevisionID        int    `json:"revisionId"`
	RevisionTimestamp string `json:"revisionTimestamp"`
	ContentSHA256     string `json:"contentSha256"`
	SkillKey          string `json:"skillKey"`
	ZhDisplayName     string `json:"zhDisplayName"`
	OwnerID           string `json:"ownerId"`
	Fields            struct {
		Leveling   string `json:"leveling"`
		Leveling2  string `json:"leveling2"`
		Leveling3  string `json:"leveling3"`
		Cooldown   string `json:"cooldown"`
		Damagetype string `json:"damagetype"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func varusBQLoadWikiSidecar(t *testing.T) varusBQWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(varusBQWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc varusBQWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

// TestVarusBlightedQuiverWikiSidecarIdentityAndRank5Fragments locks repository sidecar
// identity plus exact rank-5 variable fragments from archived wikitext.
func TestVarusBlightedQuiverWikiSidecarIdentityAndRank5Fragments(t *testing.T) {
	doc := varusBQLoadWikiSidecar(t)
	if doc.CandidateKey != varusBQCandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, varusBQCandidateKey)
	}
	if doc.WikiPageID != varusBQWikiPageID {
		t.Fatalf("wikiPageId=%d want %d", doc.WikiPageID, varusBQWikiPageID)
	}
	if doc.RevisionID != varusBQRevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, varusBQRevisionID)
	}
	if !strings.HasPrefix(doc.RevisionTimestamp, "2026-06-09") {
		t.Fatalf("revisionTimestamp=%q want 2026-06-09…", doc.RevisionTimestamp)
	}
	if doc.ContentSHA256 != varusBQContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, varusBQContentSHA)
	}
	if doc.SkillKey != "W" || doc.ZhDisplayName != "枯萎箭袋" || doc.OwnerID != "hero_varus" {
		t.Fatalf("skill/zh/owner=%q/%q/%q want W/枯萎箭袋/hero_varus",
			doc.SkillKey, doc.ZhDisplayName, doc.OwnerID)
	}
	for _, key := range []string{"leveling", "leveling2", "leveling3", "cooldown", "damagetype", "notes"} {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true", key)
		}
	}
	if doc.FieldPresence["cost"] || doc.FieldPresence["costtype"] {
		t.Fatal("fieldPresence cost/costtype must be false (wiki has no cost rows)")
	}

	raw, err := os.ReadFile(varusBQWikiRawPath(t))
	if err != nil {
		t.Fatalf("read wiki raw: %v", err)
	}
	text := string(raw)
	rank5Frags := []string{
		"{{#vardefine:o5|40}}",
		"{{#vardefine:obad|15}}",
		"{{#vardefine:oap|25}}",
		"{{#vardefine:b5|5}}",
		"{{#vardefine:ap|1.3}}",
		"{{#vardefine:a2|14}}",
	}
	for _, frag := range rank5Frags {
		if !strings.Contains(text, frag) {
			t.Fatalf("raw wikitext missing rank5 fragment %q", frag)
		}
	}
	if !strings.Contains(varusBQBoundary, "q_carrier_ordering_scaffold_only") {
		t.Fatal("frozen boundary constant drifted")
	}
	_ = varusBQActiveAbilityID
	_ = varusBQCarrierAbilityID
}

// TestVarusBlightedQuiverCompileShapeStableIDsAndNoCostCD asserts compile shape,
// separate W provider/listener, state scopes/max/durations/refresh, and no cost/CD.
func TestVarusBlightedQuiverCompileShapeStableIDsAndNoCostCD(t *testing.T) {
	compileReq, _ := loadVarusBQFixture(t, varusBQFixtureOpts{ap: varusBQAP})
	p := varusBQFindProvider(compileReq)
	if p == nil {
		t.Fatal("provider_hero_varus_w_blighted_quiver_phase_a missing")
	}
	if p.ProviderKey != varusBQProviderRef || p.StableID != varusBQStableID {
		t.Fatalf("provider key/stable=%q/%q", p.ProviderKey, p.StableID)
	}
	if len(p.Listeners) != 1 {
		t.Fatalf("listeners=%d want 1 (separate W listener)", len(p.Listeners))
	}
	l := p.Listeners[0]
	if l.ListenerKey != varusBQListenerKey {
		t.Fatalf("listenerKey=%q want %q", l.ListenerKey, varusBQListenerKey)
	}
	if l.MaxTriggersPerEvent != 1 {
		t.Fatalf("MaxTriggersPerEvent=%d want 1", l.MaxTriggersPerEvent)
	}
	if len(l.EventMatcher.All) != 2 ||
		l.EventMatcher.All[0] != varusBQHitEvent ||
		l.EventMatcher.All[1] != "event/source_owner" {
		t.Fatalf("EventMatcher.All=%v want [%s event/source_owner]", l.EventMatcher.All, varusBQHitEvent)
	}
	if len(l.Operations) != 2 ||
		l.Operations[0].Operation != "damage" ||
		l.Operations[1].Operation != "state_change" {
		t.Fatalf("listener ops must be damage then blight add: %+v", l.Operations)
	}
	if l.Operations[0].CopyableOnHit || l.Operations[0].CritEligible {
		t.Fatal("on-hit damage must be non-crit and non-copyable")
	}
	if len(l.Operations[1].Types) != 1 || l.Operations[1].Types[0] != "state_scope/provider_target" {
		t.Fatalf("blight add scope=%v want provider_target", l.Operations[1].Types)
	}

	blightSchema, ok := p.InitialStateSchema[varusBQBlightKey].(map[string]interface{})
	if !ok {
		t.Fatal("blight_stacks schema missing")
	}
	if blightSchema["refreshPolicy"] != model.ProviderStateRefreshOnWrite ||
		math.Abs(blightSchema["maxValue"].(float64)-varusBQMaxBlight) > varusBQTol ||
		math.Abs(blightSchema["durationMs"].(float64)-varusBQBlightDurMs) > varusBQTol {
		t.Fatalf("blight schema=%+v want max3/6000/refresh_on_write", blightSchema)
	}
	activeSchema, ok := p.InitialStateSchema[varusBQActiveKey].(map[string]interface{})
	if !ok {
		t.Fatal("blighted_quiver_active schema missing")
	}
	if activeSchema["refreshPolicy"] != model.ProviderStateRefreshOnWrite ||
		math.Abs(activeSchema["maxValue"].(float64)-1) > varusBQTol ||
		math.Abs(activeSchema["durationMs"].(float64)-varusBQActiveDurMs) > varusBQTol {
		t.Fatalf("active schema=%+v want max1/5500/refresh_on_write", activeSchema)
	}

	var active, carrier *model.AbilityDefinition
	for i := range p.Abilities {
		switch p.Abilities[i].AbilityKey {
		case varusBQActiveAbilityKey:
			active = &p.Abilities[i]
		case varusBQCarrierAbilityKey:
			carrier = &p.Abilities[i]
		}
	}
	if active == nil {
		t.Fatalf("active ability_key %q missing (id constant %q)", varusBQActiveAbilityKey, varusBQActiveAbilityID)
	}
	if carrier == nil {
		t.Fatalf("carrier ability_key %q missing (id constant %q)", varusBQCarrierAbilityKey, varusBQCarrierAbilityID)
	}
	if active.Cost != nil || active.Cooldown != nil {
		t.Fatalf("W active must have no cost/CD; cost=%+v cooldown=%+v", active.Cost, active.Cooldown)
	}
	if carrier.Cost != nil || carrier.Cooldown != nil {
		t.Fatalf("Q carrier must have no cost/CD; cost=%+v cooldown=%+v", carrier.Cost, carrier.Cooldown)
	}
	if len(active.Operations) != 1 || active.Operations[0].ValuePolicy != "override" ||
		active.Operations[0].Ref != varusBQActiveKey ||
		len(active.Operations[0].Types) != 1 || active.Operations[0].Types[0] != "state_scope/provider" {
		t.Fatalf("active arm op=%+v want provider override active=1", active.Operations)
	}
	if len(carrier.Operations) != 5 {
		t.Fatalf("carrier ops=%d want 5 (W ordering scaffold only)", len(carrier.Operations))
	}
	for _, op := range carrier.Operations {
		if op.Operation == "damage" && (op.CopyableOnHit || op.CritEligible) {
			t.Fatalf("carrier damage must be non-crit/non-copyable: %+v", op)
		}
	}
	// Champion AA must remain a separate provider from the W provider.
	if compileReq.SharedProviders[0].ProviderKey == varusBQProviderRef {
		t.Fatal("W provider must not replace champion AA provider")
	}
	_ = varusBQListenerShort
}

// TestVarusBlightedQuiverPassiveOnHitFormulaMitigationAndStackOrder covers passive
// bonusAD/AP raw + magic mitigation, damage-then-stack, and exactly one basic_attack_hit.
func TestVarusBlightedQuiverPassiveOnHitFormulaMitigationAndStackOrder(t *testing.T) {
	const mr = 100.0
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: varusBQAP, mr: mr})
	setVarusBQDriverHits(&runReq, []int64{0})
	done := runVarusBQ(t, compileReq, runReq)

	wantRaw := varusBQExpectedOnHitRaw(varusBQADResolved, varusBQADBase, varusBQAP)
	if math.Abs(wantRaw-105) > varusBQTol {
		t.Fatalf("helper on-hit raw=%v want 105 (40+15+50)", wantRaw)
	}
	wantMit := expectedMitigatedMagic(wantRaw, mr)
	n, raw, mit, items := varusBQDamageByOp(done, varusBQOnHitOpRef)
	if n != 1 || math.Abs(raw-wantRaw) > varusBQTol || math.Abs(mit-wantMit) > varusBQTol {
		t.Fatalf("on-hit n/raw/mit=%d/%v/%v want 1/%v/%v", n, raw, mit, wantRaw, wantMit)
	}
	if evidenceDataBool(items[0].Data, "critApplied") {
		t.Fatal("on-hit must not crit")
	}
	if got := varusBQBlightStacks(t, done); got != 1 {
		t.Fatalf("blight_stacks=%v want 1 after damage-then-stack", got)
	}
	if n := countEmittedEvents(done, varusBQHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1 (no recursive listener event)", n)
	}
	// Timeline: AA physical → emit → listener magic (stack is state, not damage evidence).
	tl := varusBQDamageTimeline(done)
	if len(tl) < 2 || tl[0] != varusBQAAOpRef || tl[1] != varusBQOnHitOpRef {
		t.Fatalf("damage order=%v want [%s %s …]", tl, varusBQAAOpRef, varusBQOnHitOpRef)
	}
}

// TestVarusBlightedQuiverBlightCapRefreshAndExpiry: max3, 6000ms refresh, no overflow.
func TestVarusBlightedQuiverBlightCapRefreshAndExpiry(t *testing.T) {
	t.Run("cap3_no_overflow", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		setVarusBQDriverHits(&runReq, []int64{0, 100, 200, 300})
		done := runVarusBQ(t, compileReq, runReq)
		if n := countEmittedEvents(done, varusBQHitEvent); n != 4 {
			t.Fatalf("basic_attack_hit=%d want 4", n)
		}
		if got := varusBQBlightStacks(t, done); got != 3 {
			t.Fatalf("blight_stacks=%v want 3 (cap; no overflow)", got)
		}
		n, _, _, _ := varusBQDamageByOp(done, varusBQOnHitOpRef)
		if n != 4 {
			t.Fatalf("on-hit damage count=%d want 4", n)
		}
	})

	t.Run("refresh_keeps_stacks", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		// Write at 0 → expire 6000; refresh at 5999 → expire 11999; hit at 11998 still live.
		setVarusBQDriverHits(&runReq, []int64{0, 5999, 11998})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQBlightStacks(t, done); got != 3 {
			t.Fatalf("blight_stacks=%v want 3 after refreshed 6000ms window", got)
		}
	})

	t.Run("expiry_after_gap_gt_6000", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		setVarusBQDriverHits(&runReq, []int64{0, 6001})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQBlightStacks(t, done); got != 1 {
			t.Fatalf("blight_stacks=%v want 1 after expiry then one new stack", got)
		}
	})
}

// TestVarusBlightedQuiverActiveArmExpiryAndConsume: arm, 5500ms expiry, carrier consume/reset.
func TestVarusBlightedQuiverActiveArmExpiryAndConsume(t *testing.T) {
	t.Run("arm_sets_active", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		setVarusBQDriver(&runReq, []model.DriverEntry{{
			EntryKey: "varus_bq_arm", AbilityRef: varusBQActiveRef(),
			Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
		}})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQActiveValue(t, done); got != 1 {
			t.Fatalf("blighted_quiver_active=%v want 1", got)
		}
	})

	t.Run("expiry_after_5500", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		// Arm at 0 → expireAt 5500; post-expiry AA advances nowMs so lazy expire clears active
		// (DurationMs alone does not process expire without a later driver event).
		setVarusBQDriver(&runReq, []model.DriverEntry{
			{EntryKey: "varus_bq_arm", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			{EntryKey: "aa_post", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5501},
		})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQActiveValue(t, done); got != 0 {
			t.Fatalf("blighted_quiver_active=%v want 0 after 5500ms expiry", got)
		}
	})

	t.Run("refresh_extends_window", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0})
		// Refresh at 5499 → expireAt 10999; AA at 10998 still inside window (same pattern as blight 11998).
		setVarusBQDriver(&runReq, []model.DriverEntry{
			{EntryKey: "arm0", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			{EntryKey: "arm1", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 5499},
			{EntryKey: "aa_live", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10998},
		})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQActiveValue(t, done); got != 1 {
			t.Fatalf("blighted_quiver_active=%v want 1 inside refreshed 5500ms window", got)
		}
	})

	t.Run("carrier_consumes_active", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0, armor: 0, mr: 0})
		setVarusBQDriver(&runReq, []model.DriverEntry{
			{EntryKey: "arm", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		})
		done := runVarusBQ(t, compileReq, runReq)
		if got := varusBQActiveValue(t, done); got != 0 {
			t.Fatalf("blighted_quiver_active=%v want 0 after carrier consume/reset", got)
		}
		nActive, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef)
		if nActive != 1 {
			t.Fatalf("active missing-HP damage count=%d want 1", nActive)
		}
	})
}

// TestVarusBlightedQuiverCarrierExactTimeline: Q physical → active magic → Blight magic → resets.
// Carrier is W ordering scaffold only; not a claim of real Varus Q completion.
func TestVarusBlightedQuiverCarrierExactTimeline(t *testing.T) {
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{
		ap: varusBQAP, armor: 0, mr: 0, hp: varusBQDefaultHP,
	})
	// Three AAs stack blight to 3, arm W, then carrier.
	setVarusBQDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "arm", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
		{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 400},
	})
	done := runVarusBQ(t, compileReq, runReq)

	tl := varusBQDamageTimeline(done)
	wantSuffix := []string{varusBQCarrierQOpRef, varusBQCarrierActiveOpRef, varusBQCarrierBlightOpRef}
	if len(tl) < len(wantSuffix) {
		t.Fatalf("timeline too short: %+v", tl)
	}
	gotSuffix := tl[len(tl)-len(wantSuffix):]
	for i := range wantSuffix {
		if gotSuffix[i] != wantSuffix[i] {
			t.Fatalf("carrier order[%d]=%q want %q full=%+v (W ordering scaffold only)",
				i, gotSuffix[i], wantSuffix[i], tl)
		}
	}
	if got := varusBQBlightStacks(t, done); got != 0 {
		t.Fatalf("blight_stacks after reset=%v want 0", got)
	}
	if got := varusBQActiveValue(t, done); got != 0 {
		t.Fatalf("active after reset=%v want 0", got)
	}
}

// TestVarusBlightedQuiverActiveMissingHPProvesPostQPreBlight independently proves
// active magic reads HP after Q physical and before Blight detonation.
func TestVarusBlightedQuiverActiveMissingHPProvesPostQPreBlight(t *testing.T) {
	const armor, mr = 100.0, 0.0
	hp := varusBQDefaultHP
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{
		ap: 0, armor: armor, mr: mr, hp: hp,
	})
	setVarusBQDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "arm", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 50},
		{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	})
	done := runVarusBQ(t, compileReq, runReq)

	qRaw := varusBQExpectedCarrierQRaw(varusBQADResolved, varusBQADBase)
	qMit := expectedMitigatedPhysical(qRaw, armor)
	// AA + on-hit also chip HP before carrier; reconstruct current entering carrier.
	aaMit := expectedMitigatedPhysical(varusBQAADamage, armor)
	onHitMit := expectedMitigatedMagic(varusBQExpectedOnHitRaw(varusBQADResolved, varusBQADBase, 0), mr)
	curEnteringCarrier := hp - aaMit - onHitMit
	curAfterQ := curEnteringCarrier - qMit
	missingPostQ := hp - curAfterQ
	wantActiveRaw := varusBQExpectedActiveMissingRaw(missingPostQ)

	n, raw, _, items := varusBQDamageByOp(done, varusBQCarrierActiveOpRef)
	if n != 1 {
		t.Fatalf("active missing-HP count=%d want 1", n)
	}
	if math.Abs(raw-wantActiveRaw) > varusBQTol {
		t.Fatalf("active raw=%v want %v (post-Q missing=%v)", raw, wantActiveRaw, missingPostQ)
	}
	// Pre-Q missing would omit qMit and understate active damage.
	wrongMissing := hp - curEnteringCarrier
	wrongRaw := varusBQExpectedActiveMissingRaw(wrongMissing)
	if math.Abs(raw-wrongRaw) <= varusBQTol {
		t.Fatalf("active matched pre-Q missing (%v); must use post-Q / pre-Blight HP", wrongRaw)
	}
	// Post-Blight missing would overstate if Blight ran first (blight raw with 1 stack).
	blightRaw := varusBQExpectedBlightRaw(hp, 1, 0)
	blightMit := expectedMitigatedMagic(blightRaw, mr)
	postBlightMissing := hp - (curAfterQ - blightMit)
	postBlightRaw := varusBQExpectedActiveMissingRaw(postBlightMissing)
	if math.Abs(raw-postBlightRaw) <= varusBQTol {
		t.Fatalf("active matched post-Blight missing (%v); must be pre-Blight", postBlightRaw)
	}
	if evidenceDataBool(items[0].Data, "critApplied") {
		t.Fatal("active missing-HP must not crit")
	}
}

// TestVarusBlightedQuiverBlightDetonateFormulaAndMitigation: maxHP/AP/stack/max-charge + MR.
func TestVarusBlightedQuiverBlightDetonateFormulaAndMitigation(t *testing.T) {
	const mr = 100.0
	hp := varusBQDefaultHP
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{
		ap: varusBQAP, armor: 0, mr: mr, hp: hp,
	})
	setVarusBQDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
	})
	done := runVarusBQ(t, compileReq, runReq)

	wantRaw := varusBQExpectedBlightRaw(hp, 3, varusBQAP)
	if math.Abs(wantRaw-3420) > varusBQTol {
		t.Fatalf("helper blight raw=%v want 3420", wantRaw)
	}
	wantMit := expectedMitigatedMagic(wantRaw, mr)
	n, raw, mit, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef)
	if n != 1 || math.Abs(raw-wantRaw) > varusBQTol || math.Abs(mit-wantMit) > varusBQTol {
		t.Fatalf("blight n/raw/mit=%d/%v/%v want 1/%v/%v", n, raw, mit, wantRaw, wantMit)
	}
	if got := varusBQBlightStacks(t, done); got != 0 {
		t.Fatalf("blight_stacks after detonate reset=%v want 0", got)
	}
}

// TestVarusBlightedQuiverCarrierQPhysicalBonusADAndMitigation: Q physical formula via
// W ordering scaffold only (not a claim of real Varus Q completion).
func TestVarusBlightedQuiverCarrierQPhysicalBonusADAndMitigation(t *testing.T) {
	const armor = 100.0
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0, armor: armor, mr: 0})
	setVarusBQDriver(&runReq, []model.DriverEntry{{
		EntryKey: "carrier", AbilityRef: varusBQCarrierRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}})
	done := runVarusBQ(t, compileReq, runReq)

	wantRaw := varusBQExpectedCarrierQRaw(varusBQADResolved, varusBQADBase)
	if math.Abs(wantRaw-480) > varusBQTol {
		t.Fatalf("helper Q physical raw=%v want 480 (W ordering scaffold only)", wantRaw)
	}
	wantMit := expectedMitigatedPhysical(wantRaw, armor)
	n, raw, mit, items := varusBQDamageByOp(done, varusBQCarrierQOpRef)
	if n != 1 || math.Abs(raw-wantRaw) > varusBQTol || math.Abs(mit-wantMit) > varusBQTol {
		t.Fatalf("Q physical n/raw/mit=%d/%v/%v want 1/%v/%v (scaffold only)", n, raw, mit, wantRaw, wantMit)
	}
	if evidenceDataBool(items[0].Data, "critApplied") {
		t.Fatal("carrier Q physical must not crit (W ordering scaffold only)")
	}
	// No active / no blight gates: only scaffold Q physical.
	if nA, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef); nA != 0 {
		t.Fatalf("active damage=%d want 0 without arm", nA)
	}
	if nB, _, _, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef); nB != 0 {
		t.Fatalf("blight damage=%d want 0 without stacks", nB)
	}
}

// TestVarusBlightedQuiverCarrierGatesWithoutActiveOrBlight: conditional steps skip correctly.
func TestVarusBlightedQuiverCarrierGatesWithoutActiveOrBlight(t *testing.T) {
	t.Run("active_only_no_blight", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: 0, armor: 0, mr: 0})
		setVarusBQDriver(&runReq, []model.DriverEntry{
			{EntryKey: "arm", AbilityRef: varusBQActiveRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 50},
		})
		done := runVarusBQ(t, compileReq, runReq)
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierQOpRef); n != 1 {
			t.Fatalf("Q physical=%d want 1", n)
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef); n != 1 {
			t.Fatalf("active=%d want 1", n)
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef); n != 0 {
			t.Fatalf("blight=%d want 0 without stacks", n)
		}
		if got := varusBQActiveValue(t, done); got != 0 {
			t.Fatalf("active after reset=%v want 0", got)
		}
		if got := varusBQBlightStacks(t, done); got != 0 {
			t.Fatalf("blight_stacks=%v want 0", got)
		}
	})

	t.Run("blight_only_no_active", func(t *testing.T) {
		compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: varusBQAP, armor: 0, mr: 0})
		setVarusBQDriver(&runReq, []model.DriverEntry{
			{EntryKey: "aa0", AbilityRef: varusBQAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
			{EntryKey: "carrier", AbilityRef: varusBQCarrierRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 50},
		})
		done := runVarusBQ(t, compileReq, runReq)
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierActiveOpRef); n != 0 {
			t.Fatalf("active=%d want 0 without arm", n)
		}
		if n, _, _, _ := varusBQDamageByOp(done, varusBQCarrierBlightOpRef); n != 1 {
			t.Fatalf("blight=%d want 1", n)
		}
		if got := varusBQBlightStacks(t, done); got != 0 {
			t.Fatalf("blight after reset=%v want 0", got)
		}
		if got := varusBQActiveValue(t, done); got != 0 {
			t.Fatalf("active=%v want 0", got)
		}
	})
}

// TestVarusBlightedQuiverNoCritCopyablePhantomOrEquipmentClaim: non-crit/non-copyable,
// no phantom recursion, no equipment provider mounted.
func TestVarusBlightedQuiverNoCritCopyablePhantomOrEquipmentClaim(t *testing.T) {
	compileReq, runReq := loadVarusBQFixture(t, varusBQFixtureOpts{ap: varusBQAP, mr: 100})
	p := varusBQFindProvider(compileReq)
	if p == nil {
		t.Fatal("W provider missing")
	}
	for _, l := range p.Listeners {
		for _, op := range l.Operations {
			if op.Operation == "damage" && (op.CopyableOnHit || op.CritEligible) {
				t.Fatalf("listener damage copyable/crit=%v/%v want false/false", op.CopyableOnHit, op.CritEligible)
			}
		}
	}
	for _, ab := range p.Abilities {
		for _, op := range ab.Operations {
			if op.Operation == "damage" && (op.CopyableOnHit || op.CritEligible) {
				t.Fatalf("ability %s damage copyable/crit=%v/%v", ab.AbilityKey, op.CopyableOnHit, op.CritEligible)
			}
		}
	}
	for _, sp := range compileReq.SharedProviders {
		if strings.Contains(strings.ToLower(sp.Kind), "item") ||
			strings.Contains(sp.ProviderKey, "item") ||
			strings.Contains(sp.StableID, "item") {
			t.Fatalf("equipment/item provider must not be mounted: %+v", sp)
		}
	}

	setVarusBQDriverHits(&runReq, []int64{0})
	done := runVarusBQ(t, compileReq, runReq)
	if n := countEmittedEvents(done, varusBQHitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1 (phantom/listener must not recurse)", n)
	}
	phantomOnHit := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != varusBQOnHitOpRef {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			phantomOnHit++
		}
	}
	if phantomOnHit != 0 {
		t.Fatalf("phantom on-hit damage=%d want 0 (copyable_on_hit=false; no equipment claim)", phantomOnHit)
	}
}
