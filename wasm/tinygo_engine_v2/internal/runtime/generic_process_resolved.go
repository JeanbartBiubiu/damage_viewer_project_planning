package runtime

import "tinygo_engine_v2/internal/model"

// A terminal fact shares the enclosing event budget and follows every bound hit.
// No declaration means no work or output change for existing callers.
func (s *genericRunState) publishProcessResolved(p *processRuntime) *model.EngineError {
	if !s.compiled.RuntimeTypes.ProcessResolved.Declared {
		return nil
	}
	use := s.skillUses[p.UseKey]
	if use == nil || use.historyState != model.SkillHitHistoryComplete || use.source != p.Owner || use.skillKey != p.SkillKey {
		return s.processErr("event.skill_use.contactCount", "completed process requires its real complete skill-use history", p.UseKey)
	}
	var storage executionFrame
	s.initExecutionFrame(&storage, p.Owner, p.Target, p.abilityRef)
	storage.castInstanceID, storage.castOrigin = p.castID, p.ability.CastOrigin
	snapshot := storage.captureEmitSnapshot(model.EventTypeProcessResolved, p.Owner, p.Target)
	snapshot.hasUseContactCount = true
	snapshot.useContactCount = len(use.prior) + len(use.contacts)
	event := emittedEvent{eventType: model.EventTypeProcessResolved, sourceKey: p.Owner, targetKey: p.Target,
		types:    []string{model.EventTypeProcessResolved, "ability/" + p.SkillKey, "event/process_resolved/" + p.SkillKey + "/" + p.ProcessKey},
		snapshot: snapshot, castInstanceID: p.castID, hasUse: true, useKey: p.UseKey, useSource: p.Owner, useSkillKey: p.SkillKey}
	return s.dispatchListeners(event, p.chainDepth+1)
}
