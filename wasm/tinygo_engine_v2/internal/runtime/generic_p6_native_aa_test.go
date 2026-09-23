package runtime

import (
	"strings"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// Synthetic fixture identity only; the production runtime never invents use facts.
const nativeBasicAttackSkillPrefix = "aa:"

func isNativeHitEmit(op model.OperationDefinition) bool {
	eventType := op.EventType
	if eventType == "" {
		eventType = op.Ref
	}
	return op.Operation == "emit_event" && (eventType == model.EventTypeBasicAttackHit || eventType == model.EventTypeBasicAttackStart)
}

func stripNativeHitEmits(ops []model.OperationDefinition) (out []model.OperationDefinition, stripped int) {
	out = make([]model.OperationDefinition, 0, len(ops))
	for _, op := range ops {
		if isNativeHitEmit(op) {
			stripped++
			continue
		}
		out = append(out, op)
	}
	return out, stripped
}

func abilityHasBasicAttackType(ability model.AbilityDefinition) bool {
	for _, key := range ability.Types {
		if key == model.AbilityTypeBasicAttack {
			return true
		}
	}
	return false
}

func nativeHitAbility(abilityKey, skillKey string, candidateOps []model.OperationDefinition) model.AbilityDefinition {
	cands := []model.SkillHitCandidate{}
	if remainingCanWrapAsNativeHit(candidateOps) && len(candidateOps) == 1 {
		cands = append(cands, model.SkillHitCandidate{
			CandidateKey:        "native_aa",
			EffectOccurrenceKey: "native_aa_occ",
			EffectKey:           "native_aa_effect",
			ResultKey:           "native_aa_result",
			Semantic: model.SkillHitSemantic{
				ResultType: model.SkillHitResultDamage,
				Target:     model.SkillHitTargetTARGET,
				Moment:     model.SkillHitMomentInstant,
			},
			Operations: candidateOps,
		})
	}
	return model.AbilityDefinition{
		AbilityKey: abilityKey,
		Kind:       "active",
		SkillKey:   skillKey,
		Types:      []string{model.AbilityTypeBasicAttack},
		Operations: []model.OperationDefinition{{
			Operation: model.OperationKindResolveSkillHit,
			Target:    model.SelectorTarget,
			SkillHit:  &model.SkillHitDefinition{SkillKey: skillKey, Candidates: cands},
		}},
	}
}

func abilityRefHasKey(ref, abilityKey string) bool {
	return strings.Contains(ref, ".ability["+abilityKey+"]")
}

func ensureNativeHitEventCatalog(req *model.CompileRequest) {
	ensureC1CatalogTypes(req,
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeSkillHit, Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
	)
}

func ensureNativeBasicAttackCatalog(req *model.CompileRequest) {
	ensureC1CatalogTypes(req,
		model.TypeCatalogEntry{Key: model.AbilityTypeBasicAttack, Domain: "ability"},
		model.TypeCatalogEntry{Key: model.EventTypeBasicAttackStart, Domain: "event"},
	)
	ensureNativeHitEventCatalog(req)
}

func bindNativeHitFact(r *model.RunRequest, entry model.DriverEntry, skillKey string) {
	for _, fact := range r.SkillHitFacts {
		if fact.DriverEntryKey == entry.EntryKey {
			return
		}
	}
	useKey := nativeBasicAttackSkillPrefix + entry.EntryKey
	for _, use := range r.SkillUses {
		if use.UseKey == useKey {
			useKey = nativeBasicAttackSkillPrefix + entry.EntryKey + ":" + skillKey
			break
		}
	}
	r.SkillUses = append(r.SkillUses, model.SkillUseFact{
		UseKey:       useKey,
		Source:       entry.Source,
		SkillKey:     skillKey,
		HistoryState: model.SkillHitHistoryComplete,
	})
	r.SkillHitFacts = append(r.SkillHitFacts, model.SkillHitFact{
		DriverEntryKey: entry.EntryKey,
		UseRef:         hitUse(useKey),
	})
}

func remainingCanWrapAsNativeHit(ops []model.OperationDefinition) bool {
	if len(ops) == 0 {
		return true
	}
	if len(ops) != 1 || ops[0].Operation != "damage" {
		return false
	}
	target := ops[0].Target
	return target == "" || target == model.SelectorTarget
}

func uniqueResolve(ops []model.OperationDefinition) (model.OperationDefinition, bool) {
	if len(ops) != 1 || ops[0].Operation != model.OperationKindResolveSkillHit {
		return model.OperationDefinition{}, false
	}
	return ops[0], true
}

func bindFactsForBasicAttackResolves(c *model.CompileRequest, r *model.RunRequest) {
	skillByKey := map[string]string{}
	for _, provider := range c.SharedProviders {
		for _, ability := range provider.Abilities {
			op, ok := uniqueResolve(ability.Operations)
			if !ok || !abilityHasBasicAttackType(ability) {
				continue
			}
			skill := strings.TrimSpace(ability.SkillKey)
			if skill == "" && op.SkillHit != nil {
				skill = strings.TrimSpace(op.SkillHit.SkillKey)
			}
			if skill == "" {
				skill = nativeBasicAttackSkillPrefix + ability.AbilityKey
			}
			skillByKey[ability.AbilityKey] = skill
		}
	}
	for _, entry := range r.DriverPlan.Entries {
		for key, skill := range skillByKey {
			if abilityRefHasKey(entry.AbilityRef, key) {
				bindNativeHitFact(r, entry, skill)
			}
		}
	}
}

// prepareNativeBasicAttackHits 把手工 emit_event 的普通攻击命中改写为 resolve_skill_hit 原生事件。
func prepareNativeBasicAttackHits(c *model.CompileRequest, r *model.RunRequest) {
	if c == nil || r == nil {
		return
	}
	for pi := range c.SharedProviders {
		for ai := range c.SharedProviders[pi].Abilities {
			ability := c.SharedProviders[pi].Abilities[ai]
			if _, ok := uniqueResolve(ability.Operations); ok {
				continue
			}
			kept, stripped := stripNativeHitEmits(ability.Operations)
			if stripped == 0 {
				continue
			}
			if !abilityHasBasicAttackType(ability) {
				ability.Operations = kept
				c.SharedProviders[pi].Abilities[ai] = ability
				continue
			}
			ensureNativeHitEventCatalog(c)
			skillKey := strings.TrimSpace(ability.SkillKey)
			if skillKey == "" {
				skillKey = nativeBasicAttackSkillPrefix + ability.AbilityKey
			}
			if remainingCanWrapAsNativeHit(kept) {
				native := nativeHitAbility(ability.AbilityKey, skillKey, kept)
				native.Params = ability.Params
				native.Cost = ability.Cost
				native.Cooldown = ability.Cooldown
				native.CastCondition = ability.CastCondition
				native.CastOrigin = ability.CastOrigin
				c.SharedProviders[pi].Abilities[ai] = native
			} else {
				ability.SkillKey = skillKey
				ability.Operations = kept
				c.SharedProviders[pi].Abilities[ai] = ability
			}
		}
	}
	bindFactsForBasicAttackResolves(c, r)
}

func compileMigrated(compileReq *model.CompileRequest, runReq *model.RunRequest) compile.GenericCompileResult {
	if runReq == nil {
		empty := model.RunRequest{}
		runReq = &empty
	}
	prepareNativeBasicAttackHits(compileReq, runReq)
	return compile.CompileGeneric(*compileReq)
}
