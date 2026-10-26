package execution

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func TestSummaryOutputDoesNotConstructEvidenceData(t *testing.T) {
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		state := &Engine{loop: newTestLoopAt(0), req: model.RunRequest{OutputMode: mode}, budget: model.DefaultSafetyBudget()}
		frame := &Frame{run: state}
		constructed := 0
		factory := func() model.EvidenceItem {
			constructed++
			return model.EvidenceItem{Kind: model.EvidenceKindDamage, Data: map[string]interface{}{"actualHpLoss": 10.0}}
		}
		state.recordEvidenceLazy(model.EvidenceKindDamage, factory)
		frame.recordEvidenceLazy(model.EvidenceKindDamage, factory)
		want := 2
		if mode == model.RunOutputSummary {
			want = 0
		}
		if constructed != want || state.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindDamage)] != 1 || frame.pendingEvidenceIndex() != 1 {
			t.Fatalf("mode=%q constructed=%d kind count=%v pending=%d", mode, constructed, state.report.Snapshot().Evidence.CountsByKind, frame.pendingEvidenceIndex())
		}
	}
}

func TestSummaryOutputFailedHitFramePublishesNoFacts(t *testing.T) {
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		input, request := singleSkillInput(false)
		request.OutputMode = mode
		compiled := compilebundle.CompileGeneric(input)
		if !compiled.OK {
			t.Fatal(compiled.Result.Errors)
		}
		state, err := newGenericRunState(compiled.Session, request)
		if err != nil {
			t.Fatal(err)
		}
		action := state.actions.ActionForUse("skill:cast_once")
		state.actions.Accept(action, "", false)
		frame := state.newExecutionFrame("source", "target", "source.provider[caster].ability[hit]")
		frame.recordSkillActionHit(action.UseRef(), 1)
		frame.recordEvidenceLazy(model.EvidenceKindSkillHit, func() model.EvidenceItem {
			return model.EvidenceItem{Kind: model.EvidenceKindSkillHit, Data: map[string]interface{}{"useRef": action.UseRef()}}
		})
		frame.fatal, frame.fatalErr = true, state.budgetError(model.BudgetCauseMaxCommandsPerEvent, "failed hit frame")
		frame.commit()
		if action.Uses().HitCount != 0 || state.recordingSummary().SkillUseRecordCount != 0 || state.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindSkillHit)] != 0 {
			t.Fatalf("failed hit frame published facts in mode %q", mode)
		}
	}
}
