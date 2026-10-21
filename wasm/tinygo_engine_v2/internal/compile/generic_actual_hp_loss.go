package compile

import (
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func validateActualHPLossReads(dependencies []formula.GenericInstr, path string, ctx *genericCompileContext) {
	for _, read := range dependencies {
		if read.ReadKind != formula.ReadEventDamage || read.ReadKey != "actualHpLoss" {
			continue
		}
		if ctx.currentListener != nil {
			for _, event := range ctx.currentListener.EventMatcher.All {
				if event == model.EventTypeDamageTaken {
					return
				}
			}
		}
		ctx.collector.addError(model.GenericErrFormulaTypeError, path, "actual HP loss requires a native damage_taken listener", "event.damage.actualHpLoss")
		return
	}
}
