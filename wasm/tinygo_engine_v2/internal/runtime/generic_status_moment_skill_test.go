package runtime

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

// One actual delayed contact owns damage and both independent control instances.
// The optional real basic attack plan stays active through the quiet slow phase.
func momentSlowSkillInput(t *testing.T, endpoint int64, mixed bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := singleSkillInput(false)
	index := 0
	r.DriverPlan.SkillActions[0].FirstAtMs = 0
	if mixed {
		c, r = continuousAttackInput(1, 10000, 10, 0, 0, endpoint)
		addMixedSpell(&c, &r, "delayed_control", 0, 1125, true)
		index = len(c.SharedProviders) - 1
	}
	provider := &c.SharedProviders[index]
	provider.Processes[0].Steps = []model.ProcessStepDefinition{
		{StepKey: "cast", StepType: "DELAY", DelayMs: statusDuration(500), OccupiesAction: model.BoolPtr(true)},
		{StepKey: "travel", StepType: "DELAY", DelayMs: statusDuration(625), OccupiesAction: model.BoolPtr(false)},
	}
	provider.Processes[0].Cooldown.DurationMs = statusConst(6000)
	provider.Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "PROCESS_START"}
	damage := damageCand("damage", "one_contact", "damage", model.SpellShieldScopeSkill, 0)
	damage.Operations[0].DamageType, damage.Operations[0].Amount = "damage/magic", statusDuration(80)
	airborne := stunCand("airborne", "one_contact", "airborne", model.SpellShieldScopeSkill)
	airborne.Semantic.StatusKey, airborne.Semantic.StatusKind = "airborne", model.StatusKindAirborne
	airborne.Semantic.Moment, airborne.SpellShieldBlockScope = model.SkillHitMomentPersistent, hitScope(model.SpellShieldScopeResult)
	airborne.Operations[0].ProviderDefinitionRef = "airborne"
	slow := stunCand("slow", "one_contact", "slow", model.SpellShieldScopeSkill)
	slow.Semantic.StatusKey, slow.Semantic.StatusKind = "landing", model.StatusKindMovementSlow
	slow.Semantic.Moment, slow.SpellShieldBlockScope = model.SkillHitMomentPersistent, hitScope(model.SpellShieldScopeResult)
	slow.Operations[0].ProviderDefinitionRef = "landing_slow"
	provider.Abilities[1].Operations[0].SkillHit.Candidates = []model.SkillHitCandidate{damage, airborne, slow}
	airborneProvider := stunProvider()
	airborneProvider.ProviderKey, airborneProvider.StableID = "airborne", "airborne"
	airborneProvider.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	slowProvider := momentSlowProvider()
	slowProvider.SkillKey = provider.Processes[0].SkillKey
	c.SharedProviders = append(c.SharedProviders, airborneProvider, slowProvider)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: airborneProvider.Types[0], Domain: "provider"})
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
	r.StopPolicy.DurationMs = endpoint
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	r.Sampling.Disabled = true
	return c, r
}

func TestMomentSlowSingleDelayedSkillContactAndBackgroundAttack(t *testing.T) {
	for _, mixed := range []bool{false, true} {
		for _, endpoint := range []int64{499, 500, 1124, 1125, 2124, 2125, 3624, 3625} {
			c, r := momentSlowSkillInput(t, endpoint, mixed)
			done := c1Run(t, c, r)
			wantHit := endpoint >= 1125
			skillKey := "configured_spell"
			if mixed {
				skillKey = "delayed_control"
			}
			hits := 0
			for _, item := range skillHitItems(done) {
				if item.Data["skillKey"] == skillKey {
					hits++
				}
			}
			if done.Summary.SkillUses.HitCount != boolInt(wantHit) || hits != boolInt(wantHit) {
				t.Fatal("elapsed state fabricated a second skill contact", mixed, endpoint, done.Summary, skillHitItems(done))
			}
			slow, hasSlow := momentTargetProvider(t, done, "landing_slow")
			airborne, hasAirborne := momentTargetProvider(t, done, "airborne")
			if hasSlow != (endpoint >= 1125 && endpoint < 3625) || hasAirborne != (endpoint >= 1125 && endpoint < 2125) {
				t.Fatal("independent control lifetimes diverged", mixed, endpoint, slow, airborne)
			}
			if hasSlow {
				want := 0.0
				if endpoint >= 2125 {
					want = .6
				}
				if effectiveSlow(t, done).Strength != want || slow.AppliedAtMs == nil || *slow.AppliedAtMs != 1125 || *slow.ExpireAt != 3625 {
					t.Fatal("slow used combat time instead of actual contact time", endpoint, slow, effectiveSlow(t, done))
				}
			}
			var spellDamage int
			for _, record := range done.DamageRecords {
				if record["damageType"] == "damage/magic" {
					spellDamage++
					if record["timeMs"] != int64(1125) || record["useRef"] == nil {
						t.Fatal("damage lost true delayed use identity", record)
					}
				}
			}
			if spellDamage != boolInt(wantHit) {
				t.Fatal("skill damage duplicated or disappeared", endpoint, done.DamageRecords)
			}
			if mixed && endpoint >= 500 {
				if done.Summary.BasicAttack == nil || done.Summary.BasicAttack.StartedCount == 0 || done.AttackRecords[0].StartAtMs != 500 {
					t.Fatal("cast occupancy/travel suppressed real background attack", endpoint, done.Summary.BasicAttack, done.AttackRecords)
				}
			}
		}
	}
}

func TestMomentSlowFirstShieldBlocksBothButLaterShieldDoesNotRecheck(t *testing.T) {
	for _, shieldAt := range []int64{0, 1500} {
		skill, _ := momentSlowSkillInput(t, 2125, false)
		candidates := skill.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates
		shield := spellShieldProvider()
		shield.Listeners[0].Operations = shield.Listeners[0].Operations[1:]
		c, r := withSkillHit(t, candidates, []model.ProviderDefinition{skill.SharedProviders[1], skill.SharedProviders[2], shield},
			[]model.AbilityDefinition{{AbilityKey: "grant", Kind: "active", Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "shield:spell"}}}},
			[]model.DriverEntry{{EntryKey: "shield", AbilityRef: timedShieldRef("grant"), Source: "source", Target: "target", FirstAtMs: shieldAt}, hitEntry("contact", 1125, 0)},
			[]model.SkillUseFact{{UseKey: "q", Source: "source", SkillKey: "author:q", HistoryState: model.SkillHitHistoryComplete}},
			[]model.SkillHitFact{{DriverEntryKey: "contact", UseRef: hitUse("q")}}, 2125)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: model.ClosedStatusKindProviderType[model.StatusKindAirborne], Domain: "provider"})
		formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
		done := c1Run(t, c, r)
		_, hasSlow := momentTargetProvider(t, done, "landing_slow")
		_, hasShield := momentTargetProvider(t, done, "shield:spell")
		if len(skillHitItems(done)) != 1 {
			t.Fatal("shield or slow observation fabricated a contact", done.Summary)
		}
		if shieldAt == 0 {
			if hasSlow || hasShield || done.Summary.SourceDamageDealt != 0 || len(providerEvidence(done, model.EvidenceKindProviderApply)) != 1 {
				t.Fatal("first true shield did not block both controls/damage", done.FinalSnapshot, done.Summary)
			}
		} else if !hasSlow || !hasShield || effectiveSlow(t, done).Strength != .6 || done.Summary.SourceDamageDealt != 80 {
			t.Fatal("landing rechecked a later shield", done.FinalSnapshot, done.Summary)
		}
	}
}

func TestMomentSlowMissAndDetailedSummaryZeroBudgetIsolation(t *testing.T) {
	c, r := momentSlowSkillInput(t, 2125, true)
	compiled := compile.CompileGeneric(c)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	detailed, err := RunGeneric(compiled.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	summaryRequest := r
	summaryRequest.OutputMode = model.RunOutputSummary
	summary, err := RunGeneric(compiled.Session, summaryRequest)
	if err != nil || !reflect.DeepEqual(detailed.FinalSnapshot, summary.FinalSnapshot) || !reflect.DeepEqual(detailed.Summary, summary.Summary) {
		t.Fatal("summary changed execution or current status", err, detailed.Summary, summary.Summary)
	}
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
	limited, err := RunGeneric(compiled.Session, r)
	if err != nil || !reflect.DeepEqual(detailed.FinalSnapshot, limited.FinalSnapshot) || !reflect.DeepEqual(detailed.Summary, limited.Summary) || effectiveSlow(t, limited).Strength != .6 {
		t.Fatal("zero output budget changed current state", err, limited.Summary)
	}
	miss := summaryRequest
	miss.DriverPlan.SkillActions = append([]model.SkillActionPlan(nil), miss.DriverPlan.SkillActions...)
	miss.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "MISS"}}
	done, err := RunGeneric(compiled.Session, miss)
	if err != nil || done.Summary.SkillUses.HitCount != 0 || len(effectiveSlow(t, done).Contributions) != 0 || done.Summary.BasicAttack.StartedCount == 0 {
		t.Fatal("miss mounted controls or disabled background attacks", err, done.Summary)
	}
}
