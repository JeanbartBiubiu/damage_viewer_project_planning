package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

// The listener object is also present while its operations compile. Only its
// actual condition may consume the immutable per-packet settlement fact.
func validateKilledReads(dependencies []formula.GenericInstr, path string, ctx *genericCompileContext) {
	for _, read := range dependencies {
		if read.ReadKind != formula.ReadEventDamage || read.ReadKey != "killed" {
			continue
		}
		if ctx.compilingListenerCondition && ctx.currentListener != nil {
			for _, event := range ctx.currentListener.EventMatcher.All {
				if event == "event/damage_instance" || event == model.EventTypeDamageTaken {
					return
				}
			}
		}
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "killed requires a native per-instance settled-damage listener condition", "event.damage.killed")
		return
	}
}
