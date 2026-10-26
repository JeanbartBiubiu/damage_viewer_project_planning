package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import "tinygo_engine_v2/internal/model"

// A terminal fact shares the enclosing event budget and follows every bound hit.
// No declaration means no work or output change for existing callers.
func (s *Engine) publishProcessResolved(p *actionpkg.ProcessView) *model.EngineError {
	if p.HasEmpoweredWindow() {
		if p.Status() != "complete" || p.WindowPending() != 0 || p.EmpoweredResolvedPublished() {
			return nil
		}
	}
	if !s.compiled.RuntimeTypes.ProcessResolved.Declared {
		return nil
	}
	use := s.skillUses[p.UseKey()]
	if use == nil || use.identity.HistoryState() != model.SkillHitHistoryComplete || use.identity.Source() != p.Owner() || use.identity.SkillKey() != p.SkillKey() {
		return s.processErr("event.skill_use.contactCount", "completed process requires its real complete skill-use history", p.UseKey())
	}
	var storage Frame
	s.initExecutionFrame(&storage, p.Owner(), p.Target(), p.AbilityRef())
	storage.castInstanceID, storage.castOrigin = p.CastID(), p.Ability().CastOrigin
	snapshot := storage.captureEmitSnapshot(model.EventTypeProcessResolved, p.Owner(), p.Target())
	snapshot.hasUseContactCount = true
	snapshot.useContactCount = len(use.prior) + len(use.contacts)
	event := emittedEvent{eventType: model.EventTypeProcessResolved, sourceKey: p.Owner(), targetKey: p.Target(),
		types:    []string{model.EventTypeProcessResolved, "ability/" + p.SkillKey(), "event/process_resolved/" + p.SkillKey() + "/" + p.ProcessKey()},
		snapshot: snapshot, castInstanceID: p.CastID(), hasUse: true, useKey: p.UseKey(), useSource: p.Owner(), useSkillKey: p.SkillKey()}
	depth, _ := s.processExecution(p.UseKey())
	if err := s.dispatchListeners(event, depth+1); err != nil {
		return err
	}
	if p.HasEmpoweredWindow() {
		s.actions.MarkEmpoweredResolved(p)
	}
	return nil
}
