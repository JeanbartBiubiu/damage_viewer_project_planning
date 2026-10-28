package action

import (
	"math"
	"strings"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

type AttackWaitView struct{ data attackWaitData }

type attackWaitData struct {
	providerState, targetState         model.NumericView
	initialReady, anchor, period       int64
	sourceAttributes, targetAttributes attribute.Table
	remaining, speed                   float64
}

type AttackWaitSeed struct {
	ProviderState, TargetState         model.NumericView
	InitialReady, Anchor, Period       int64
	SourceAttributes, TargetAttributes attribute.Table
	Remaining, Speed                   float64
}

func NewAttackWait(seed AttackWaitSeed) *AttackWaitView {
	return &AttackWaitView{data: attackWaitData{providerState: seed.ProviderState, targetState: seed.TargetState, initialReady: seed.InitialReady, anchor: seed.Anchor, period: seed.Period, sourceAttributes: seed.SourceAttributes, targetAttributes: seed.TargetAttributes, remaining: seed.Remaining, speed: seed.Speed}}
}
func (w *AttackWaitView) ProviderState() model.NumericView  { return w.data.providerState }
func (w *AttackWaitView) TargetState() model.NumericView    { return w.data.targetState }
func (w *AttackWaitView) InitialReady() int64               { return w.data.initialReady }
func (w *AttackWaitView) Anchor() int64                     { return w.data.anchor }
func (w *AttackWaitView) Period() int64                     { return w.data.period }
func (w *AttackWaitView) Remaining() float64                { return w.data.remaining }
func (w *AttackWaitView) Speed() float64                    { return w.data.speed }
func (w *AttackWaitView) SourceAttributes() attribute.Table { return w.data.sourceAttributes }
func (w *AttackWaitView) TargetAttributes() attribute.Table { return w.data.targetAttributes }
func (w *AttackWaitView) ProgressDeadline() int64 {
	return w.data.anchor + int64(BasicAttackRemainingDelay(w.data.remaining, w.data.period))
}
func BasicAttackRemainingDelay(remaining float64, period int64) float64 {
	if remaining <= 0 {
		return 0
	}
	value := remaining * float64(period)
	nearest := math.Round(value)
	spacing := math.Nextafter(value, math.Inf(1)) - value
	if nearest >= 1 && math.Abs(value-nearest) <= math.Min(1e-9, 4*spacing) {
		value = nearest
	}
	return math.Max(1, math.Ceil(value))
}
func (w *AttackWaitView) Reanchor(now, ready int64) *AttackWaitView {
	copy := *w
	copy.data.anchor = now
	copy.data.remaining = float64(ready-now) / float64(w.data.period)
	return &copy
}
func (w *AttackWaitView) RemainingAt(now int64) float64 {
	return math.Max(0, w.data.remaining-float64(now-w.data.anchor)/float64(w.data.period))
}
func (w *AttackWaitView) Recalculate(now, period int64, speed float64, source, target attribute.Table, providerState, targetState model.NumericView) *AttackWaitView {
	copy := *w
	copy.data.remaining = w.RemainingAt(now)
	copy.data.anchor, copy.data.period, copy.data.speed = now, period, speed
	copy.data.sourceAttributes, copy.data.targetAttributes = source, target
	copy.data.providerState, copy.data.targetState = providerState, targetState
	return &copy
}
func (b *BasicAttackView) WaitDependenciesChanged(wait *AttackWaitView, source, target attribute.Table, context formula.GenericEvalContext) bool {
	for _, instruction := range b.data.cooldownDependencies {
		if instruction.Op != formula.GenericOpRead {
			continue
		}
		if instruction.ReadKind == formula.ReadProviderState || instruction.ReadKind == formula.ReadProviderTargetState {
			previous, current := wait.data.providerState, context.ProviderState
			if instruction.ReadKind == formula.ReadProviderTargetState {
				previous, current = wait.data.targetState, context.ProviderTargetState
			}
			value, present := current.Lookup(instruction.ReadKey)
			if !present {
				value = context.ProviderStateDefaults.At(instruction.ReadKey)
			}
			if previous.At(instruction.ReadKey) != value {
				return true
			}
			continue
		}
		previous, current := wait.data.sourceAttributes, source
		if instruction.ReadKind == formula.ReadTargetAttr {
			previous, current = wait.data.targetAttributes, target
		} else if instruction.ReadKind != formula.ReadSourceAttr {
			continue
		}
		key := instruction.ReadKey
		if separator := strings.LastIndex(key, "."); separator >= 0 {
			key = key[:separator]
		}
		before, beforeExists := previous.Lookup(key)
		after, afterExists := current.Lookup(key)
		if beforeExists != afterExists || before != after {
			return true
		}
	}
	return false
}
