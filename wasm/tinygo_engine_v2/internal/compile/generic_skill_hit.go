package compile

import (
	"strings"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func uniqueResolveSkillHit(ops []model.OperationDefinition) (model.OperationDefinition, bool) {
	if len(ops) != 1 || ops[0].Operation != model.OperationKindResolveSkillHit {
		return model.OperationDefinition{}, false
	}
	return ops[0], true
}

func lastSkillHitOperationIndex(session *CompiledSession) int {
	for i := len(session.Operations) - 1; i >= 0; i-- {
		if session.Operations[i].Operation == model.OperationKindResolveSkillHit {
			return i
		}
	}
	return -1
}

func compileSkillHitAbility(ability model.AbilityDefinition, op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	collector := ctx.collector
	session := ctx.session
	opPath := path + ".operations[0]"
	if op.SkillHit == nil {
		collector.addError(model.GenericErrMissingRequiredField, opPath+".skillHit", "resolve_skill_hit requires skillHit", ability.AbilityKey)
		session.Operations = append(session.Operations, CompiledOperation{Operation: model.OperationKindResolveSkillHit, Target: op.Target})
		return
	}
	if op.Payload != nil {
		collector.addError(model.GenericErrUnknownRef, opPath+".payload", "resolve_skill_hit cannot carry free payload", ability.AbilityKey)
	}
	if strings.TrimSpace(op.SkillHit.SkillKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, opPath+".skillHit.skillKey", "skillHit.skillKey is required", ability.AbilityKey)
	}
	if op.Target != model.SelectorTarget {
		collector.addError(model.GenericErrOperationTargetMissing, opPath+".target", "resolve_skill_hit must address the actual driver target", ability.AbilityKey)
	}
	wasBasic := ctx.compilingBasicAttack
	ctx.compilingBasicAttack = abilityIsBasicAttack(ability, ctx)
	defer func() { ctx.compilingBasicAttack = wasBasic }()
	if ctx.compilingBasicAttack {
		requireCatalogType(ctx, model.EventTypeBasicAttackHit, opPath+".skillHit", "basic attack resolve_skill_hit requires event/basic_attack_hit in typeCatalog")
	} else {
		requireCatalogType(ctx, model.EventTypeSkillHit, opPath+".skillHit", "resolve_skill_hit requires event/skill_hit in typeCatalog")
	}

	seenCandidate := map[string]int{}
	plan := &CompiledSkillHit{SkillKey: op.SkillHit.SkillKey}
	inboundNonNull := 0
	for i, cand := range op.SkillHit.Candidates {
		cpath := opPath + ".skillHit.candidates[" + itoa(i) + "]"
		compiled := compileSkillHitCandidate(cand, cpath, ownerProviderIndex, ctx)
		if cand.CandidateKey != "" {
			if prev, ok := seenCandidate[cand.CandidateKey]; ok {
				collector.addError(model.GenericErrUnknownRef, cpath+".candidateKey", "duplicate candidateKey", cand.CandidateKey)
				collector.addError(model.GenericErrUnknownRef, opPath+".skillHit.candidates["+itoa(prev)+"].candidateKey", "duplicate candidateKey", cand.CandidateKey)
			} else {
				seenCandidate[cand.CandidateKey] = i
			}
		}
		if compiled.HasBlockScope {
			inboundNonNull++
		}
		plan.Candidates = append(plan.Candidates, compiled)
	}
	_ = inboundNonNull
	if op.Target != "" {
		if _, ok := model.ValidCombatantSelectors[op.Target]; !ok && !strings.HasPrefix(op.Target, "source.") && !strings.HasPrefix(op.Target, "target.") {
			collector.addError(model.GenericErrOperationTargetMissing, opPath+".target", "unknown operation target", op.Target)
		}
	}
	session.Operations = append(session.Operations, CompiledOperation{
		Operation: model.OperationKindResolveSkillHit,
		Target:    op.Target,
		Ref:       op.Ref,
		SkillHit:  plan,
	})
}

func compileSkillHitCandidate(cand model.SkillHitCandidate, path string, ownerProviderIndex int, ctx *genericCompileContext) CompiledSkillHitCandidate {
	collector := ctx.collector
	out := CompiledSkillHitCandidate{
		CandidateKey:        cand.CandidateKey,
		EffectOccurrenceKey: cand.EffectOccurrenceKey,
		EffectKey:           cand.EffectKey,
		ResultKey:           cand.ResultKey,
		Semantic:            cand.Semantic,
		Path:                path,
	}
	if strings.TrimSpace(cand.CandidateKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".candidateKey", "candidateKey is required", "")
	}
	if strings.TrimSpace(cand.EffectOccurrenceKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".effectOccurrenceKey", "effectOccurrenceKey is required", cand.CandidateKey)
	}
	if strings.TrimSpace(cand.EffectKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".effectKey", "effectKey is required", cand.CandidateKey)
	}
	if strings.TrimSpace(cand.ResultKey) == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".resultKey", "resultKey is required", cand.CandidateKey)
	}
	if msg := validateSkillHitSemantic(cand.Semantic, path+".semantic"); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".semantic", msg, cand.CandidateKey)
	}
	if msg := model.ValidateSpellShieldScope(cand.Semantic, cand.SpellShieldBlockScope); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".spellShieldBlockScope", msg, cand.CandidateKey)
	}
	if cand.SpellShieldBlockScope != nil && *cand.SpellShieldBlockScope != "" {
		out.HasBlockScope = true
		out.BlockScope = *cand.SpellShieldBlockScope
	}
	if out.HasBlockScope && !candidateCanHoldOnUnblocked(cand) {
		collector.addError(model.GenericErrUnknownRef, path+".eventValueConditions", "non-null inbound result must be able to hold on blocked=0; blocked=1-only results cannot form this hit's block unit", cand.CandidateKey)
	} else if out.HasBlockScope {
		out.InboundBlockEligible = true
	}
	if cand.ParticipationCondition != nil {
		instr := formula.CompileGenericFormula(*cand.ParticipationCondition, path+".participationCondition", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if formulaHasForbiddenHitReads(instr) {
			collector.addError(model.GenericErrFormulaTypeError, path+".participationCondition", "participationCondition cannot read skill hit values, event snapshots that are not yet produced, or damage pipeline writes", cand.CandidateKey)
		}
		if len(instr) > 0 {
			out.ParticipationProgram = ctx.registerFormula(path+".participationCondition", instr)
			out.HasParticipation = true
		}
	}
	for j, cond := range cand.EventValueConditions {
		cpath := path + ".eventValueConditions[" + itoa(j) + "]"
		compiled := CompiledSkillHitValueCond{Key: cond.Key, Comparator: cond.Comparator, Path: cpath}
		if cond.Key != model.SkillHitValueFirstContact && cond.Key != model.SkillHitValueBlocked {
			collector.addError(model.GenericErrUnknownRef, cpath+".key", "eventValueConditions key must be first_contact or blocked", cond.Key)
		}
		if ctx.compilingBasicAttack && cond.Key == model.SkillHitValueFirstContact {
			collector.addError(model.GenericErrUnknownRef, cpath+".key", "basic_attack_hit cannot use firstContact eventValueConditions", cond.Key)
		}
		if _, ok := model.ValidSkillHitComparator[cond.Comparator]; !ok {
			collector.addError(model.GenericErrUnknownRef, cpath+".comparator", "unsupported eventValueConditions comparator", cond.Comparator)
		}
		instr := formula.CompileGenericFormula(cond.Value, cpath+".value", ctx.namedFormulas, map[string]bool{}, collector.addError)
		if formulaReadsKind(instr, formula.ReadEventSkillHit) {
			collector.addError(model.GenericErrFormulaTypeError, cpath+".value", "eventValueConditions value cannot reverse-read unproduced skill hit values", cand.CandidateKey)
		}
		if len(instr) > 0 {
			compiled.ValueProg = ctx.registerFormula(cpath+".value", instr)
			compiled.HasValue = true
		} else {
			collector.addError(model.GenericErrMissingRequiredField, cpath+".value", "eventValueConditions value is required", cand.CandidateKey)
		}
		out.EventValueConds = append(out.EventValueConds, compiled)
	}
	if msg := operationsMatchSemantic(cand.Operations, cand.Semantic, cand.SpellShieldBlockScope, ctx); msg != "" {
		collector.addError(model.GenericErrUnknownRef, path+".operations", msg, cand.CandidateKey)
	}
	out.OperationStart = uint16(len(ctx.session.Operations))
	damageCount := 0
	ctx.beginOutputUnit()
	for k, cop := range cand.Operations {
		if cop.Operation == model.OperationKindResolveSkillHit {
			collector.addError(model.GenericErrUnknownRef, path+".operations["+itoa(k)+"].operation", "candidate operations cannot recurse resolve_skill_hit", cand.CandidateKey)
			ctx.outputUnitIndex++
			continue
		}
		if cop.Operation == "damage" {
			damageCount++
		}
		compileOperation(cop, path+".operations["+itoa(k)+"]", ownerProviderIndex, ctx)
		ctx.outputUnitIndex++
	}
	ctx.endOutputUnit()
	if cand.Semantic.ResultType == model.SkillHitResultDamage && damageCount > 1 {
		collector.addError(model.GenericErrUnknownRef, path+".operations", "a damage candidate allows exactly one damage operation", cand.CandidateKey)
	}
	out.OperationCount = uint16(len(ctx.session.Operations)) - out.OperationStart
	return out
}

func candidateCanHoldOnUnblocked(cand model.SkillHitCandidate) bool {
	for _, cond := range cand.EventValueConditions {
		if cond.Key != model.SkillHitValueBlocked {
			continue
		}
		if cond.Value.Op == "const" && cond.Value.Value != nil {
			match, valid := model.CompareSkillHitValue(cond.Comparator, 0, *cond.Value.Value)
			if !valid || !match {
				return false
			}
		}
	}
	return true
}

func validateSkillHitSemantic(sem model.SkillHitSemantic, path string) string {
	_ = path
	switch sem.ResultType {
	case model.SkillHitResultDamage, model.SkillHitResultAttributeChange, model.SkillHitResultResourceChange,
		model.SkillHitResultCooldownChange, model.SkillHitResultStatusOperation, model.SkillHitResultLifecycleOp,
		model.SkillHitResultSpellShield, model.SkillHitResultDamageModifier, model.SkillHitResultHealingModifier,
		model.SkillHitResultDamageImmunity, model.SkillHitResultHealthFloor:
	case "":
		return "semantic.resultType is required"
	default:
		return "unknown semantic.resultType"
	}
	if _, ok := model.SemanticSelector(sem.Target); !ok {
		return "semantic.target must be TARGET, SOURCE or SELF"
	}
	if sem.Moment != model.SkillHitMomentInstant && sem.Moment != model.SkillHitMomentPersistent {
		return "semantic.moment must be INSTANT or PERSISTENT"
	}
	if sem.ResultType == model.SkillHitResultStatusOperation {
		if sem.StatusOperation != model.StatusOperationApply && sem.StatusOperation != model.StatusOperationRemove {
			return "STATUS_OPERATION requires statusOperation APPLY or REMOVE"
		}
		if strings.TrimSpace(sem.StatusKind) == "" {
			return "STATUS_OPERATION requires statusKind"
		}
		if sem.StatusKind != model.StatusKindMovementSlow {
			if _, ok := model.ClosedStatusKindProviderType[sem.StatusKind]; !ok {
				return "unknown control statusKind"
			}
		}
		if strings.TrimSpace(sem.StatusKey) == "" {
			return "STATUS_OPERATION requires statusKey"
		}
	}
	return ""
}

func operationsMatchSemantic(ops []model.OperationDefinition, sem model.SkillHitSemantic, scope *string, ctx *genericCompileContext) string {
	wantTarget, ok := model.SemanticSelector(sem.Target)
	if !ok {
		return "semantic.target is invalid"
	}
	if len(ops) == 0 {
		return "candidate operations are required"
	}
	switch sem.ResultType {
	case model.SkillHitResultDamage:
		count := 0
		for _, op := range ops {
			if op.Operation != "damage" {
				return "DAMAGE semantic requires damage operations only"
			}
			if op.Target != wantTarget {
				return "DAMAGE operation target must match semantic.target"
			}
			count++
		}
		if count != 1 {
			return "DAMAGE candidate requires exactly one damage operation"
		}
		if sem.Moment != model.SkillHitMomentInstant {
			return "DAMAGE moment must be INSTANT"
		}
	case model.SkillHitResultAttributeChange:
		if !allOpsAre(ops, "attribute_change", wantTarget) {
			return "ATTRIBUTE_CHANGE requires attribute_change operations matching semantic.target"
		}
	case model.SkillHitResultResourceChange:
		if !allOpsAre(ops, "resource_change", wantTarget) {
			return "RESOURCE_CHANGE requires resource_change operations matching semantic.target"
		}
	case model.SkillHitResultCooldownChange:
		if !allOpsAre(ops, "cooldown_change", wantTarget) {
			return "COOLDOWN_CHANGE requires cooldown_change operations matching semantic.target"
		}
	case model.SkillHitResultLifecycleOp:
		for _, op := range ops {
			if op.Operation != "expire_provider" && op.Operation != "refresh_provider" {
				return "LIFECYCLE_OPERATION requires expire_provider or refresh_provider"
			}
			if op.Target != wantTarget {
				return "LIFECYCLE_OPERATION target must match semantic.target"
			}
		}
	case model.SkillHitResultSpellShield:
		if scope != nil && *scope != "" {
			return "SPELL_SHIELD result must use null spellShieldBlockScope"
		}
		for _, op := range ops {
			if op.Operation != "apply_provider" {
				return "SPELL_SHIELD semantic requires apply_provider"
			}
			if !providerHasTypeKey(ctx, op.ProviderDefinitionRef, model.ProviderTypeSpellShield) {
				return "SPELL_SHIELD apply_provider must reference provider/spell_shield"
			}
			if op.Target != wantTarget {
				return "SPELL_SHIELD target must match semantic.target"
			}
		}
	case model.SkillHitResultStatusOperation:
		if sem.StatusOperation == model.StatusOperationApply {
			for _, op := range ops {
				if op.Operation != "apply_provider" {
					return "STATUS_OPERATION APPLY requires apply_provider"
				}
				if op.Target != wantTarget {
					return "status apply target must match semantic.target"
				}
				if !providerMatchesStatusKind(ctx, op.ProviderDefinitionRef, sem.StatusKind, sem.StatusKey) {
					return "apply_provider identity does not match semantic.statusKind"
				}
			}
		} else {
			return "STATUS_OPERATION REMOVE has no verified status-key-to-instance mapping in skill hit candidates"
		}
	case model.SkillHitResultDamageModifier, model.SkillHitResultHealingModifier, model.SkillHitResultDamageImmunity, model.SkillHitResultHealthFloor:
		return "this resultType does not yet have a verified operation mapping in skill hit candidates"
	default:
		return "operations cannot match unknown resultType"
	}
	for _, op := range ops {
		if op.Operation == "shield" {
			return "numeric shield operations are not spell_shield and cannot stand in for this semantic"
		}
		if op.Operation == "emit_event" && (model.IsEngineProducedEvent(op.EventType) || model.IsEngineProducedEvent(op.Ref)) {
			return "candidate operations cannot forge engine skill hit events"
		}
	}
	return ""
}

func allOpsAre(ops []model.OperationDefinition, kind, target string) bool {
	if len(ops) == 0 {
		return false
	}
	for _, op := range ops {
		if op.Operation != kind || op.Target != target {
			return false
		}
	}
	return true
}

func providerHasTypeKey(ctx *genericCompileContext, definitionRef, typeKey string) bool {
	if ctx == nil || ctx.session == nil || definitionRef == "" {
		return false
	}
	idx, ok := ctx.providerKeyIndex[definitionRef]
	if !ok || int(idx) >= len(ctx.session.Providers) {
		return false
	}
	id, found := ctx.session.Types.Registry.Lookup(typeKey)
	if !found {
		return false
	}
	return ctx.session.Providers[idx].TypeSet.Contains(id)
}

func providerMatchesStatusKind(ctx *genericCompileContext, definitionRef, statusKind, statusKey string) bool {
	if ctx == nil || ctx.session == nil || definitionRef == "" {
		return false
	}
	idx, ok := ctx.providerKeyIndex[definitionRef]
	if !ok || int(idx) >= len(ctx.session.Providers) {
		return false
	}
	provider := ctx.session.Providers[idx]
	if statusKind == model.StatusKindMovementSlow {
		for _, item := range provider.StatusContributions {
			if item.StatusKind == model.StatusKindMovementSlow && item.StatusKey == statusKey {
				return true
			}
		}
		return false
	}
	want, ok := model.ClosedStatusKindProviderType[statusKind]
	if !ok {
		return false
	}
	return providerHasTypeKey(ctx, definitionRef, want)
}

func formulaReadsKind(instr []formula.GenericInstr, kind formula.GenericReadKind) bool {
	for _, item := range instr {
		if item.Op == formula.GenericOpRead && item.ReadKind == kind {
			return true
		}
	}
	return false
}

func formulaHasForbiddenHitReads(instr []formula.GenericInstr) bool {
	for _, item := range instr {
		if item.Op != formula.GenericOpRead {
			continue
		}
		switch item.ReadKind {
		case formula.ReadEventSkillHit, formula.ReadEventDamage, formula.ReadDamageAmount,
			formula.ReadDamageTrait, formula.ReadDamageType, formula.ReadDamageCastOrigin, formula.ReadDamageAbilityType,
			formula.ReadEventSourceAttr, formula.ReadEventTargetAttr, formula.ReadEventSourceResource, formula.ReadEventTargetResource,
			formula.ReadEventEntrySourceAttr, formula.ReadEventEntryTargetAttr, formula.ReadEventEntrySourceResource, formula.ReadEventEntryTargetResource:
			return true
		}
	}
	return false
}

func requireCatalogType(ctx *genericCompileContext, key, path, message string) {
	if ctx == nil || ctx.session == nil {
		return
	}
	if _, ok := ctx.session.Types.Registry.Lookup(key); ok {
		return
	}
	ctx.collector.addError(model.GenericErrUnknownTypeKey, path, message, key)
}

func validateProviderRefFromEvent(op model.OperationDefinition, path string, ownerProviderIndex int, listener *model.ListenerDefinition, ctx *genericCompileContext) {
	if !op.ProviderRefFromEvent {
		return
	}
	if op.Operation != "expire_provider" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on expire_provider", op.Operation)
		return
	}
	if op.ProviderRef != "" {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRef", "providerRefFromEvent cannot combine with static providerRef", op.ProviderRef)
	}
	if op.Target != model.SelectorSelf {
		ctx.collector.addError(model.GenericErrOperationTargetMissing, path+".target", "providerRefFromEvent expire_provider target must be self", op.Target)
	}
	if ownerProviderIndex < 0 || listener == nil {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".providerRefFromEvent", "providerRefFromEvent is only allowed on a provider-owned listener", "")
		return
	}
	hasBlocked := false
	for _, key := range listener.EventMatcher.All {
		if key == model.EventTypeSpellShieldBlocked {
			hasBlocked = true
			break
		}
	}
	if !hasBlocked {
		ctx.collector.addError(model.GenericErrMatcherDomainError, path+".providerRefFromEvent", "providerRefFromEvent requires eventMatcher.all to include event/spell_shield_blocked", "")
	}
	requireCatalogType(ctx, model.EventTypeSpellShieldBlocked, path+".providerRefFromEvent", "providerRefFromEvent requires event/spell_shield_blocked in typeCatalog")
}

func validateEmitEventNotForged(op model.OperationDefinition, path string, ctx *genericCompileContext) {
	if op.Operation != "emit_event" {
		return
	}
	eventType := op.EventType
	if eventType == "" {
		eventType = op.Ref
	}
	if model.IsEngineProducedEvent(eventType) {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".eventType", "emit_event cannot forge engine-produced skill hit events", eventType)
	}
}
