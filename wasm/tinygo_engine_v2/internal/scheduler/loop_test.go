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
	loop      *Loop
	state     LoopState
	stop      LoopStopState
	rows      []loopObservation
	processed []GenericEventKind
	failKind  GenericEventKind
	failure   *model.EngineError
	selection *model.EngineError
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
func (p *loopProbe) LoopBudgetExceeded(cause model.BudgetCause, _ string) {
	p.stop.BudgetCause = cause
}
func (p *loopProbe) EnsureLoopBudgetCause() {
	if p.stop.BudgetCause == "" {
		p.stop.BudgetCause = model.BudgetCauseMaxEvents
	}
}

func TestLoopObservesAfterEverySameTimeEventAndAdvancesEndpoint(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{StopWhenNoEvents: model.BoolPtr(false)})
	loop.Queue().Push(GenericEvent{TimeMs: 5, Kind: GenericEventAbilityAttempt, Category: GenericCategoryAbilityAttempt})
	loop.Queue().Push(GenericEvent{TimeMs: 5, Kind: GenericEventProviderTick, Category: GenericCategoryProviderTick})
	loop.Queue().Push(GenericEvent{TimeMs: 10, Kind: GenericEventProcessTimer, Category: GenericCategoryProcessTimer})
	probe := &loopProbe{loop: loop, state: LoopState{MaxEvents: 10}}
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
	loop.Queue().Push(GenericEvent{TimeMs: 5, Kind: GenericEventAbilityAttempt})
	loop.Queue().Push(GenericEvent{TimeMs: 10, Kind: GenericEventProviderTick})
	issue := &model.EngineError{BudgetCause: model.BudgetCauseMaxCommandsPerEvent}
	probe := &loopProbe{loop: loop, state: LoopState{MaxEvents: 10, Automated: true}, stop: LoopStopState{SourceDead: true, TargetDead: true, BudgetCause: model.BudgetCauseMaxCommandsPerEvent}, failKind: GenericEventProviderTick, failure: issue}
	if err := loop.Run(probe); err != nil {
		t.Fatal(err)
	}
	if loop.ProcessedEvents() != 2 || loop.TimeMs() != 10 || loop.Reason() != model.StopReasonBudgetExceeded || !reflect.DeepEqual(probe.processed, []GenericEventKind{GenericEventAbilityAttempt, GenericEventProviderTick}) {
		t.Fatal("later budget failure erased committed history or lost stop priority")
	}
}

func TestLoopSelectionFailureDoesNotAdvanceClockOrObserve(t *testing.T) {
	loop := NewLoop(0, 20, model.StopPolicy{})
	loop.Queue().Push(GenericEvent{TimeMs: 10, Kind: GenericEventProcessTimer})
	issue := &model.EngineError{Code: model.GenericErrRuntimeInvariantFailed}
	probe := &loopProbe{loop: loop, state: LoopState{MaxEvents: 10}, selection: issue}
	if err := loop.Run(probe); err != issue || loop.TimeMs() != 0 || loop.ProcessedEvents() != 0 || len(probe.rows) != 0 {
		t.Fatal("selection failure published time, observation or processing", err, probe.rows)
	}
}
