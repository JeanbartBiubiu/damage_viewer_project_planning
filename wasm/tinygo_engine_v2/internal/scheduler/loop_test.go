package scheduler

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/model"
)

type loopObservation struct {
	kind string
	at   int64
	now  int64
}

type loopProbe struct {
	loop            *Loop
	state           LoopState
	stop            LoopStopState
	maxEvents       int
	rows            []loopObservation
	processed       []GenericEventKind
	observations    []LoopObservation
	failKind        GenericEventKind
	failure         *model.EngineError
	internalFailure bool
	selection       *model.EngineError
	decision        *LoopDecision
	decisionError   *model.EngineError
	budgetMessages  []string
}

func (p *loopProbe) DecideNext(observation LoopObservation) (LoopDecision, *model.EngineError) {
	p.observations = append(p.observations, observation)
	if p.decision != nil {
		return *p.decision, nil
	}
	if p.state.Failure != nil {
		if p.state.Automated && p.state.Failure.BudgetCause != "" {
			return LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded}, nil
		}
		return LoopDecision{}, p.state.Failure
	}
	if observation.ProcessedEvents >= p.maxEvents {
		return LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded,
			BudgetCause: model.BudgetCauseMaxEvents, BudgetMessage: "event budget exceeded"}, nil
	}
	return LoopDecision{Kind: LoopHandleNext}, nil
}
func (p *loopProbe) LoopDecisionError(message string) *model.EngineError {
	if p.decisionError == nil {
		p.decisionError = &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed, Message: message, SessionID: "probe-session"}
	}
	return p.decisionError
}
func (p *loopProbe) LoopState() LoopState         { return p.state }
func (p *loopProbe) LoopStopState() LoopStopState { return p.stop }
func (p *loopProbe) SelectLoopEvent(event GenericEvent) (GenericEvent, *model.EngineError) {
	return event, p.selection
}
func (p *loopProbe) HandleLoopEvent(event GenericEvent) *model.EngineError {
	p.rows = append(p.rows, loopObservation{"event", event.TimeMs, p.loop.TimeMs()})
	p.processed = append(p.processed, event.Kind)
	if event.Kind == p.failKind {
		if p.internalFailure {
			p.state.Failure = p.failure
			if p.failure.BudgetCause != "" {
				p.stop.BudgetCause = p.failure.BudgetCause
			}
			return nil
		}
		return p.failure
	}
	return nil
}
func (p *loopProbe) ObserveBefore(at int64) {
	p.rows = append(p.rows, loopObservation{"before", at, p.loop.TimeMs()})
}
func (p *loopProbe) ObserveThrough(at int64) {
	p.rows = append(p.rows, loopObservation{"through", at, p.loop.TimeMs()})
}
func (p *loopProbe) ObserveFinal() {
	p.rows = append(p.rows, loopObservation{"final", p.loop.TimeMs(), p.loop.TimeMs()})
}
func (p *loopProbe) PublishLoopWait() {
	p.rows = append(p.rows, loopObservation{"wait", p.loop.TimeMs(), p.loop.TimeMs()})
}
func (p *loopProbe) SettleLoopEnd() *model.EngineError {
	p.rows = append(p.rows, loopObservation{"settle", p.loop.TimeMs(), p.loop.TimeMs()})
	return nil
}
func (p *loopProbe) LoopBudgetExceeded(cause model.BudgetCause, message string) {
	p.stop.BudgetCause = cause
	p.budgetMessages = append(p.budgetMessages, message)
}
func (p *loopProbe) EnsureLoopBudgetCause() {
	if p.stop.BudgetCause == "" {
		p.stop.BudgetCause = model.BudgetCauseMaxEvents
	}
}

func TestLoopObservesAfterEverySameTimeEventAndAdvancesEndpoint(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{StopWhenNoEvents: model.BoolPtr(false)})
	loop.Enqueue(GenericEvent{TimeMs: 5, Kind: GenericEventAbilityAttempt, Category: GenericCategoryAbilityAttempt})
	loop.Enqueue(GenericEvent{TimeMs: 5, Kind: GenericEventProviderTick, Category: GenericCategoryProviderTick})
	loop.Enqueue(GenericEvent{TimeMs: 10, Kind: GenericEventProcessTimer, Category: GenericCategoryProcessTimer})
	probe := &loopProbe{loop: loop, maxEvents: 10}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(probe.processed, []GenericEventKind{GenericEventProviderTick, GenericEventAbilityAttempt, GenericEventProcessTimer}) {
		t.Fatal("same-time order changed", probe.processed)
	}
	want := []loopObservation{{"before", 5, 0}, {"event", 5, 5}, {"before", 5, 5}, {"event", 5, 5}, {"through", 5, 5}, {"before", 10, 5}, {"event", 10, 10}, {"through", 10, 10}, {"before", 20, 10}, {"settle", 20, 20}, {"wait", 20, 20}, {"through", 20, 20}, {"final", 20, 20}}
	if !reflect.DeepEqual(probe.rows, want) || loop.ProcessedEvents() != 3 || loop.Reason() != model.StopReasonDurationReached {
		t.Fatal("observation or endpoint order changed", probe.rows, loop.Reason())
	}
}

func TestLoopLaterBudgetFailureKeepsEarlierEventsAndStopPriority(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{})
	loop.Enqueue(GenericEvent{TimeMs: 5, Kind: GenericEventAbilityAttempt})
	loop.Enqueue(GenericEvent{TimeMs: 10, Kind: GenericEventProviderTick})
	issue := &model.EngineError{BudgetCause: model.BudgetCauseMaxCommandsPerEvent}
	probe := &loopProbe{loop: loop, maxEvents: 10, state: LoopState{Automated: true}, stop: LoopStopState{SourceDead: true, TargetDead: true, BudgetCause: model.BudgetCauseMaxCommandsPerEvent}, failKind: GenericEventProviderTick, failure: issue}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	if loop.ProcessedEvents() != 2 || loop.TimeMs() != 10 || loop.Reason() != model.StopReasonBudgetExceeded || !reflect.DeepEqual(probe.processed, []GenericEventKind{GenericEventAbilityAttempt, GenericEventProviderTick}) {
		t.Fatal("later budget failure erased committed history or lost stop priority")
	}
}

func TestLoopSelectionFailureDoesNotAdvanceClockOrObserve(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{})
	loop.Enqueue(GenericEvent{TimeMs: 10, Kind: GenericEventProcessTimer})
	issue := &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed}
	probe := &loopProbe{loop: loop, maxEvents: 10, selection: issue}
	if err := loop.Run(probe); err != issue || loop.TimeMs() != 0 || loop.ProcessedEvents() != 0 || len(probe.rows) != 0 {
		t.Fatal("selection failure published time, observation or processing", err, probe.rows)
	}
}

func TestLoopRejectsInvalidDecisionsBeforeChangingQueueOrTime(t *testing.T) {
	cases := []struct {
		name     string
		decision LoopDecision
		advance  int64
	}{
		{name: "unknown_kind", decision: LoopDecision{Kind: 255}},
		{name: "continue_with_stop", decision: LoopDecision{Kind: LoopHandleNext, StopReason: model.StopReasonNoEvents}},
		{name: "end_with_budget", decision: LoopDecision{Kind: LoopEndAtLimit, BudgetCause: model.BudgetCauseMaxEvents}},
		{name: "finalize_with_stop", decision: LoopDecision{Kind: LoopFinalizeNow, StopReason: model.StopReasonBothDead}},
		{name: "missing_stop_reason", decision: LoopDecision{Kind: LoopStopNow}},
		{name: "unknown_stop_reason", decision: LoopDecision{Kind: LoopStopNow, StopReason: "unknown"}},
		{name: "message_without_cause", decision: LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded, BudgetMessage: "event budget exceeded"}},
		{name: "foreign_budget_cause", decision: LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded, BudgetCause: model.BudgetCauseMaxQueueEvents, BudgetMessage: "event budget exceeded"}},
		{name: "budget_without_budget_stop", decision: LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonDurationReached, BudgetCause: model.BudgetCauseMaxEvents, BudgetMessage: "event budget exceeded"}},
		{name: "budget_without_message", decision: LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded, BudgetCause: model.BudgetCauseMaxEvents}},
		{name: "backwards_endpoint", decision: LoopDecision{Kind: LoopEndAtLimit}, advance: 21},
	}
	for _, scenario := range cases {
		t.Run(scenario.name, func(t *testing.T) {
			loop := NewLoop(7, 13, model.StopPolicy{})
			if code := loop.Enqueue(GenericEvent{TimeMs: 10, Kind: GenericEventProviderTick}); code != model.ErrOK {
				t.Fatal(code)
			}
			if scenario.advance != 0 {
				loop.Advance(scenario.advance)
			}
			before := loop.TimeMs()
			issue := &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed, SessionID: "current-session", SchemaHash: "current-schema", RulesHash: "current-rules"}
			probe := &loopProbe{loop: loop, maxEvents: 10, decision: &scenario.decision, decisionError: issue}
			if err := loop.Run(probe); err != issue || loop.TimeMs() != before || loop.ProcessedEvents() != 0 || loop.QueuedEvents() != 1 || len(probe.rows) != 0 || len(probe.budgetMessages) != 0 {
				t.Fatal("invalid decision changed state or lost the original error identity", err, probe.rows)
			}
		})
	}
}

func TestLoopPassesMechanicalFactsToDecisionBeforeTakingCandidate(t *testing.T) {
	loop := NewLoop(7, 13, model.StopPolicy{})
	if code := loop.Enqueue(GenericEvent{TimeMs: 10, Kind: GenericEventProviderTick}); code != model.ErrOK {
		t.Fatal(code)
	}
	decision := LoopDecision{Kind: LoopEndAtLimit}
	probe := &loopProbe{loop: loop, decision: &decision}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	want := []LoopObservation{{NowMs: 7, EndMs: 20, HasNextEvent: true, NextEventAtMs: 10}}
	if !reflect.DeepEqual(probe.observations, want) || loop.TimeMs() != 20 || loop.ProcessedEvents() != 0 || loop.QueuedEvents() != 1 || loop.Reason() != model.StopReasonDurationReached {
		t.Fatal("decision did not receive the original mechanical state", probe.observations)
	}
	if len(probe.rows) == 0 || probe.rows[0] != (loopObservation{"before", 20, 7}) {
		t.Fatal("endpoint advance skipped its preceding observation", probe.rows)
	}
}

func TestLoopFinalizeDecisionKeepsDeathPriorityWithoutAdvancingEndpoint(t *testing.T) {
	loop := NewLoop(7, 13, model.StopPolicy{})
	decision := LoopDecision{Kind: LoopFinalizeNow}
	probe := &loopProbe{loop: loop, decision: &decision, stop: LoopStopState{SourceDead: true, TargetDead: true}}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	if loop.TimeMs() != 7 || loop.ProcessedEvents() != 0 || loop.Reason() != model.StopReasonBothDead || len(probe.rows) == 0 || probe.rows[0].kind != "settle" {
		t.Fatal("immediate death finalization became an endpoint advance", loop.TimeMs(), loop.Reason(), probe.rows)
	}
}

func TestLoopEventBudgetDecisionRecordsCauseBeforeFinalStopPriority(t *testing.T) {
	loop := NewLoop(7, 13, model.StopPolicy{})
	decision := LoopDecision{Kind: LoopStopNow, StopReason: model.StopReasonBudgetExceeded, BudgetCause: model.BudgetCauseMaxEvents, BudgetMessage: "event budget exceeded"}
	probe := &loopProbe{loop: loop, decision: &decision, stop: LoopStopState{SourceDead: true, TargetDead: true}}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	if loop.Reason() != model.StopReasonBudgetExceeded || probe.stop.BudgetCause != model.BudgetCauseMaxEvents || !reflect.DeepEqual(probe.budgetMessages, []string{"event budget exceeded"}) || loop.TimeMs() != 7 || loop.ProcessedEvents() != 0 {
		t.Fatal("event budget decision lost its exact cause or death priority", loop.Reason(), probe.stop, probe.budgetMessages)
	}
}

func TestLoopRechecksInternalFailureBeforeSameTimeObservationOrNextDecision(t *testing.T) {
	for _, automated := range []bool{false, true} {
		t.Run(map[bool]string{false: "manual", true: "automated"}[automated], func(t *testing.T) {
			loop := NewLoop(0, 20, model.StopPolicy{})
			if code := loop.Enqueue(GenericEvent{TimeMs: 5, Kind: GenericEventProviderTick}); code != model.ErrOK {
				t.Fatal(code)
			}
			if code := loop.Enqueue(GenericEvent{TimeMs: 5, Kind: GenericEventSample}); code != model.ErrOK {
				t.Fatal(code)
			}
			issue := &model.EngineError{BudgetCause: model.BudgetCauseMaxCommandsPerEvent}
			probe := &loopProbe{loop: loop, maxEvents: 10, state: LoopState{Automated: automated}, failKind: GenericEventProviderTick, failure: issue, internalFailure: true}
			err := loop.Run(probe)
			if automated {
				if err != nil || loop.Reason() != model.StopReasonBudgetExceeded || probe.stop.BudgetCause != model.BudgetCauseMaxCommandsPerEvent || len(probe.rows) < 3 || probe.rows[2].kind != "settle" {
					t.Fatal("automatic internal failure lost its actual budget or observed before settling", err, probe.rows)
				}
			} else if err != issue || len(probe.rows) != 2 {
				t.Fatal("internal failure was delayed until the next decision or observation", err, probe.rows)
			}
			if len(probe.observations) != 1 || len(probe.processed) != 1 || loop.ProcessedEvents() != 1 || loop.TimeMs() != 5 || loop.QueuedEvents() != 1 || len(probe.budgetMessages) != 0 {
				t.Fatal("failure handling processed another event or replaced its budget cause", probe.observations, probe.processed)
			}
		})
	}
}
