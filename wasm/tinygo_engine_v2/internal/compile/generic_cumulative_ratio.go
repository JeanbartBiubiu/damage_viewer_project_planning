package compile

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"tinygo_engine_v2/internal/model"
)

func compileCumulativeRatioLimit(operation model.OperationDefinition, path string, ctx *genericCompileContext) *model.CumulativeRatioLimit {
	if len(operation.CumulativeLimit) == 0 {
		return nil
	}
	fail := func(message string) *model.CumulativeRatioLimit {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".cumulativeLimit", message, operation.AbilityRef)
		return nil
	}
	if operation.Operation != "cooldown_change" || operation.ValuePolicy != "reduce_total_ratio" {
		return fail("cumulative limit requires a committed-total cooldown ratio refund")
	}
	decoder := json.NewDecoder(bytes.NewReader(operation.CumulativeLimit))
	decoder.DisallowUnknownFields()
	var limit *model.CumulativeRatioLimit
	if err := decoder.Decode(&limit); err != nil || limit == nil {
		return fail("cumulative limit requires a strict non-null object")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fail("cumulative limit contains trailing data")
	}
	if !validOncePerUseGroupKey(limit.GroupKey) || math.IsNaN(limit.MaxRatio) || math.IsInf(limit.MaxRatio, 0) || limit.MaxRatio <= 0 || limit.MaxRatio > 1 {
		return fail("cumulative limit requires a stable group key and finite maximum ratio in (0,1]")
	}
	return limit
}
