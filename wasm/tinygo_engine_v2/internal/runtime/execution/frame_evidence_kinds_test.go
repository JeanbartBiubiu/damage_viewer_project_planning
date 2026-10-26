package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

import (
	"bytes"
	"maps"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestFrameSummaryEvidenceKeepsOrderedBudgetsAndPostCommitRecording(t *testing.T) {
	kinds := []model.EvidenceKind{model.EvidenceKindDamage, model.EvidenceKindHeal, model.EvidenceKindDamage, model.EvidenceKindSkillHit}
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		for _, limit := range []int{0, 2, 4} {
			state := &Engine{loop: newTestLoopAt(0), req: model.RunRequest{OutputMode: mode}, budget: model.DefaultSafetyBudget()}
			state.budget.MaxEvidenceItems = limit
			frame := &Frame{run: state}
			items := make([]model.EvidenceItem, len(kinds))
			constructed := 0
			for index, kind := range kinds {
				items[index] = model.EvidenceItem{TimeMs: int64(index), Kind: kind, Ref: "ordered", Data: map[string]interface{}{"index": index}}
				if index == 0 {
					frame.recordEvidence(items[index])
				} else {
					frame.recordEvidenceLazy(kind, func() model.EvidenceItem {
						constructed++
						return items[index]
					})
				}
			}
			if frame.pendingEvidenceIndex() != len(kinds) || len(state.report.Snapshot().Evidence.CountsByKind) != 0 || reportedEvidenceRetained(state) != 0 {
				t.Fatal("uncommitted evidence changed the live budget or count")
			}
			if mode == model.RunOutputSummary {
				if len(frame.pendingEvidence) != 0 || !reflect.DeepEqual(frame.pendingEvidenceKinds, kinds) || constructed != 0 {
					t.Fatal("summary frame retained full evidence items or reordered kinds")
				}
			} else if len(frame.pendingEvidenceKinds) != 0 || !bytes.Equal(mustJSON(frame.pendingEvidence), mustJSON(items)) || constructed != len(kinds)-1 {
				t.Fatal("detailed frame changed its original evidence bytes")
			}
			frame.commitFrameFacts()
			wantCounts := map[string]int{"damage": 2, "heal": 1, "skill_hit": 1}
			if !maps.Equal(state.report.Snapshot().Evidence.CountsByKind, wantCounts) || reportedEvidenceRetained(state) != limit || state.report.Snapshot().Evidence.TruncatedEvidenceCount != len(kinds)-limit || state.report.Snapshot().Evidence.Truncated != (limit < len(kinds)) {
				t.Fatal("compact frame changed evidence classification or truncation", mode, limit)
			}

			if mode == model.RunOutputSummary {
				if len(state.report.Snapshot().Evidence.Items) != 0 {
					t.Fatal("summary retention did not consume kinds in the original order")
				}
			} else if limit > 0 && !bytes.Equal(mustJSON(state.report.Snapshot().Evidence.Items), mustJSON(items[:limit])) {
				t.Fatal("detailed commit changed its retained evidence bytes")
			}
			frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindExecute, Data: map[string]interface{}{"direct": true}})
			frame.recordEvidenceLazy(model.EvidenceKindProviderTick, func() model.EvidenceItem {
				return model.EvidenceItem{Kind: model.EvidenceKindProviderTick, Ref: "direct-lazy"}
			})
			if frame.pendingEvidenceIndex() != len(kinds) || state.report.Snapshot().Evidence.CountsByKind["execute"] != 1 || state.report.Snapshot().Evidence.CountsByKind["provider_tick"] != 1 || state.report.Snapshot().Evidence.TruncatedEvidenceCount != len(kinds)+2-limit {
				t.Fatal("post-commit recording was delayed or restaged")
			}
		}
	}
	t.Logf("evidenceItemBytes=%d evidenceKindBytes=%d", reflect.TypeOf(model.EvidenceItem{}).Size(), reflect.TypeOf(model.EvidenceKind("")).Size())
}

func TestFrameSummaryEvidenceFailedFrameAndReinitializationKeepViews(t *testing.T) {
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		state := &Engine{loop: newTestLoopAt(0), req: model.RunRequest{OutputMode: mode}, budget: model.DefaultSafetyBudget()}
		var frame Frame
		state.initExecutionFrame(&frame, "source", "target", "failed")
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindDamage})
		frame.recordEvidenceLazy(model.EvidenceKindHeal, func() model.EvidenceItem { return model.EvidenceItem{Kind: model.EvidenceKindHeal} })
		kinds := frame.pendingEvidenceKinds
		frame.fatal = true
		frame.commit()
		if frame.committed || len(state.report.Snapshot().Evidence.CountsByKind) != 0 || reportedEvidenceRetained(state) != 0 || state.report.Snapshot().Evidence.TruncatedEvidenceCount != 0 {
			t.Fatal("failed frame published compact evidence facts")
		}
		state.initExecutionFrame(&frame, "target", "target", "fresh")
		if frame.pendingEvidenceIndex() != 0 || len(frame.pendingEvidence)+len(frame.pendingEvidenceKinds) != 0 || frame.fatal {
			t.Fatal("reinitialized frame retained earlier pending evidence")
		}
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindExecute})
		if mode == model.RunOutputSummary && !reflect.DeepEqual(kinds, []model.EvidenceKind{model.EvidenceKindDamage, model.EvidenceKindHeal}) {
			t.Fatal("reinitialization changed an earlier compact evidence view")
		}
	}
}

func TestFrameSummaryEvidenceHitIndexesFollowMixedKindsDespiteTruncation(t *testing.T) {
	for _, mode := range []model.RunOutputMode{"", model.RunOutputSummary} {
		input, request := singleSkillInput(false)
		request.OutputMode = mode
		state := frameCommitState(t, input, request)
		state.budget.MaxEvidenceItems = 1
		action := state.actions.ActionForUse("skill:cast_once")
		state.actions.Accept(action, "", false)
		state.actions.AddProcess(actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{UseKey: action.UseRef(), Owner: "source", Target: "target", Status: "complete"}}))
		frame := state.newExecutionFrame("source", "target", "")
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindHeal})
		frame.recordSkillActionHit(action.UseRef(), 1)
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindSkillHit})
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindEmittedEvent})
		frame.recordSkillActionHit(action.UseRef(), 2)
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindSkillHit})
		if len(frame.pendingSkillHits) != 2 || frame.pendingSkillHits[0].evidenceIndex != 1 || frame.pendingSkillHits[1].evidenceIndex != 3 || action.Uses().HitCount != 0 {
			t.Fatal("mixed compact evidence lost the hit's original pending position")
		}
		frame.commitFrameFacts()
		if action.Uses().HitCount != 2 || state.recordingSummary().SkillUseRecordCount != 2 || state.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindSkillHit)] != 2 || state.report.Snapshot().Evidence.TruncatedEvidenceCount != 3 {
			t.Fatal("evidence truncation changed committed hit facts", mode)
		}
		frame.recordSkillActionHit(action.UseRef(), 3)
		frame.recordEvidence(model.EvidenceItem{Kind: model.EvidenceKindSkillHit})
		if action.Uses().HitCount != 3 || state.recordingSummary().SkillUseRecordCount != 3 || len(frame.pendingSkillHits) != 2 || state.report.Snapshot().Evidence.CountsByKind[string(model.EvidenceKindSkillHit)] != 3 {
			t.Fatal("post-commit hit or evidence was restaged", mode)
		}
	}
}
