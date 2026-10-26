// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	fmt "fmt"
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func coldHealthExpiryInput(t *testing.T, endpoint int64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := coldHealthMomentInput(t, endpoint, false)
	parent := &c.SharedProviders[len(c.SharedProviders)-2]
	hit := parent.Abilities[1].Operations[0].SkillHit
	airborne := stunCand("airborne", "single_contact", "airborne", "")
	airborne.Semantic.StatusKey, airborne.Semantic.StatusKind = "airborne", model.StatusKindAirborne
	airborne.Semantic.Moment = model.SkillHitMomentPersistent
	airborne.Operations[0].ProviderDefinitionRef = "cleanup_airborne"
	hit.Candidates = []model.SkillHitCandidate{hit.Candidates[0], airborne, hit.Candidates[1]}
	hit.RuleGroups = []model.SkillHitRuleGroup{
		hitRule("damage", "damage", model.OncePerUseScopeProviderTarget, hit.Candidates[0].CandidateKey),
		hitRule("control", "control", model.OncePerUseScopeProviderTarget, "airborne", "slow"),
	}
	definition := stunProvider()
	definition.ProviderKey, definition.StableID = "cleanup_airborne", "cleanup_airborne"
	definition.Types = []string{model.ClosedStatusKindProviderType[model.StatusKindAirborne]}
	c.SharedProviders = append(c.SharedProviders, definition)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: definition.Types[0], Domain: "provider"})
	return c, r
}

func TestResourceMaxMomentQueuedExpiryPhysicallyRemovesControls(t *testing.T) {
	for _, endpoint := range []int64{1124, 1125, 2124, 2125, 3624, 3625, 4000} {
		t.Run(fmt.Sprint(endpoint), func(t *testing.T) {
			c, r := coldHealthExpiryInput(t, endpoint)
			done := authoringRun(t, c, r)
			attacks := float64(endpoint/1000 + 1)
			spell := float64(boolInt(endpoint >= 1125)) * 100
			assertColdHealthResolved(t, done, 655, 1160-attacks*100-spell)
			for definition, expires := range map[string]int64{"cleanup_airborne": 2125, "landing_slow": 3625} {
				_, present := momentTargetProvider(t, done, definition)
				if present != (endpoint >= 1125 && endpoint < expires) {
					t.Fatal("real cleanup left expired control inventory", endpoint, definition, done.FinalSnapshot.Combatants)
				}
			}
			wantExpired := boolInt(endpoint >= 2125) + boolInt(endpoint >= 3625)
			expired := providerEvidence(done, model.EvidenceKindProviderExpire)
			if len(expired) != wantExpired || done.Evidence.CountsByKind[string(model.EvidenceKindProviderExpire)] != wantExpired {
				t.Fatal("cleanup did not preserve its true expiry facts", endpoint, expired, done.Evidence)
			}
			for _, fact := range expired {
				if fact.TimeMs != 2125 && fact.TimeMs != 3625 {
					t.Fatal("expiry waited for a later reapplication", fact)
				}
			}
			if done.Summary.BasicAttack.CompletedCount != int(attacks) || done.Summary.SourceDamageDealt != attacks*100+spell || done.Summary.SkillUses.HitCount != boolInt(endpoint >= 1125) || len(done.FinalSnapshot.UseTriggerLedger) != 2*boolInt(endpoint >= 1125) {
				t.Fatal("cleanup changed the real attack, contact or committed quota", done.Summary, done.FinalSnapshot.UseTriggerLedger)
			}
			for _, mode := range []model.RunOutputMode{model.RunOutputSummary, model.RunOutputDetailed} {
				boundedRequest := r
				boundedRequest.OutputMode = mode
				zero := 0
				boundedRequest.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero, MaxMechanicRecords: &zero, MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero, MaxAutomaticSkillRecords: &zero, MaxResourceChangeRecords: &zero}
				bounded := authoringRun(t, c, boundedRequest)
				if !reflect.DeepEqual(done.FinalSnapshot, bounded.FinalSnapshot) || !reflect.DeepEqual(done.ResourceChangeSummary, bounded.ResourceChangeSummary) || !reflect.DeepEqual(done.Summary, bounded.Summary) || bounded.Evidence.CountsByKind[string(model.EvidenceKindProviderExpire)] != wantExpired {
					t.Fatal("record retention changed real expiry or health", endpoint, mode)
				}
			}
		})
	}
}

func TestResourceMaxMomentQueuedRefreshIgnoresOldDeadline(t *testing.T) {
	for _, endpoint := range []int64{3625, 4125, 5624, 5625} {
		t.Run(fmt.Sprint(endpoint), func(t *testing.T) {
			c, r := coldHealthExpiryInput(t, endpoint)
			second := r.DriverPlan.SkillActions[0]
			second.InstructionKey, second.FirstAtMs = "refresh_control", 2000
			r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, second)
			done := authoringRun(t, c, r)
			provider, present := momentTargetProvider(t, done, "landing_slow")
			if present != (endpoint < 5625) {
				t.Fatal("stale or current cleanup used the wrong deadline", endpoint, provider, present)
			}
			if present {
				strength := 0.0
				if endpoint >= 4125 {
					strength = .6
				}
				if provider.AppliedAtMs == nil || *provider.AppliedAtMs != 3125 || provider.ExpireAt == nil || *provider.ExpireAt != 5625 || effectiveSlow(t, done).Strength != strength {
					t.Fatal("refresh lost real application time or lifetime", endpoint, provider, effectiveSlow(t, done))
				}
			}
			expired := providerEvidence(done, model.EvidenceKindProviderExpire)
			wantExpired := 1 + boolInt(endpoint >= 4125) + boolInt(endpoint >= 5625)
			if len(expired) != wantExpired {
				t.Fatal("cleanup omitted a control or removed the refreshed slow early", endpoint, expired)
			}
			for _, fact := range expired {
				if fact.TimeMs != 2125 && fact.TimeMs != 4125 && fact.TimeMs != 5625 {
					t.Fatal("stale cleanup emitted removal for an active refresh", fact)
				}
			}
			attacks := float64(endpoint/1000 + 1)
			assertColdHealthResolved(t, done, 655, 1160-attacks*100-200)
			if done.Summary.SkillUses.HitCount != 2 || len(done.FinalSnapshot.UseTriggerLedger) != 4 {
				t.Fatal("cleanup changed the two true uses or their quotas", done.Summary, done.FinalSnapshot.UseTriggerLedger)
			}
		})
	}
}
