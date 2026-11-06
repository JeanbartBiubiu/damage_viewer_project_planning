package execution

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	"tinygo_engine_v2/internal/scheduler"
)

func TestLoopDecisionPreservesBusinessEndBeforeEventBudget(t *testing.T) {
	for _, test := range []struct {
		name                      string
		manual, basic, dead, next bool
		nextAt                    int64
		want                      scheduler.LoopDecisionKind
	}{
		{name: "generic exhausted empty queue", want: scheduler.LoopStopNow},
		{name: "manual empty queue ends window", manual: true, want: scheduler.LoopEndAtLimit},
		{name: "manual late successor ends window", manual: true, next: true, nextAt: 21, want: scheduler.LoopEndAtLimit},
		{name: "manual in-window successor spends budget", manual: true, next: true, nextAt: 20, want: scheduler.LoopStopNow},
		{name: "skill death finalizes before window or budget", manual: true, dead: true, want: scheduler.LoopFinalizeNow},
		{name: "settled basic tail ends window", basic: true, want: scheduler.LoopEndAtLimit},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, request := authoringInput()
			if test.basic {
				input, request = continuousAttackInput(1, 10000, 0, 0, 0, 4000)
			}
			state, err := newGenericRunState(authoringCompile(t, input), request)
			if err != nil {
				t.Fatal(err)
			}
			if test.manual {
				state.actions.AddManualAction(actionpkg.NewSkillAction(actionpkg.SkillActionSeed{}))
			}
			if test.basic {
				state.actions.SetAttackWindowSettled(true)
			}
			if test.dead {
				state.actions.MarkDead(model.SelectorSource)
			}
			decision, issue := state.DecideNext(scheduler.LoopObservation{NowMs: 0, EndMs: 20,
				ProcessedEvents: state.budget.MaxEvents, HasNextEvent: test.next, NextEventAtMs: test.nextAt})
			if issue != nil || decision.Kind != test.want {
				t.Fatalf("decision=%+v error=%+v", decision, issue)
			}
			if test.want == scheduler.LoopStopNow {
				if decision.StopReason != model.StopReasonBudgetExceeded || decision.BudgetCause != model.BudgetCauseMaxEvents || decision.BudgetMessage != "event budget exceeded" {
					t.Fatalf("lost event budget identity: %+v", decision)
				}
			} else if decision.StopReason != "" || decision.BudgetCause != "" || decision.BudgetMessage != "" {
				t.Fatalf("business end carried budget facts: %+v", decision)
			}
			if state.budgetCause != "" || state.processFailure != nil || state.loop.ProcessedEvents() != 0 {
				t.Fatal("decision published budget or accepted an event")
			}
		})
	}
}

func TestLoopDecisionExistingFailureKeepsOriginalErrorAndBudgetCause(t *testing.T) {
	for _, automated := range []bool{false, true} {
		for _, budget := range []bool{false, true} {
			input, request := authoringInput()
			if automated {
				input, request = continuousAttackInput(1, 10000, 0, 0, 0, 4000)
			}
			state, err := newGenericRunState(authoringCompile(t, input), request)
			if err != nil {
				t.Fatal(err)
			}
			issue := state.LoopDecisionError("existing failure")
			if budget {
				issue.BudgetCause = model.BudgetCauseMaxCommandsPerEvent
			}
			state.processFailure = issue
			decision, got := state.DecideNext(scheduler.LoopObservation{EndMs: 20, ProcessedEvents: state.budget.MaxEvents})
			if automated && budget {
				if got != nil || decision.Kind != scheduler.LoopStopNow || decision.StopReason != model.StopReasonBudgetExceeded || decision.BudgetCause != "" {
					t.Fatalf("existing command budget replaced: %+v %+v", decision, got)
				}
			} else if got != issue {
				t.Fatalf("original error replaced: got=%+v want=%+v", got, issue)
			}
			if state.processFailure != issue || issue.SchemaHash != state.compiled.SchemaHash || issue.RulesHash != state.compiled.RulesHash || issue.SessionID != request.SessionID {
				t.Fatal("failure or identity changed")
			}
		}
	}
}
