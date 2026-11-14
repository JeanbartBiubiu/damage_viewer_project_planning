package compile

import (
	"encoding/json"
	"testing"
)

func TestCumulativeRatioLimitRejectsInvalidBoundary(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"groupKey":"Bad-Key","maxRatio":0.39}`, `{"groupKey":"group","maxRatio":0}`, `{"groupKey":"group","maxRatio":1.1}`, `{"groupKey":"group","maxRatio":0.39,"extra":1}`, `{"groupKey":"group","maxRatio":"0.39"}`} {
		t.Run(raw, func(t *testing.T) {
			request := minimalValidCompileRequest()
			request.SharedProviders[0].Abilities[0].Operations[0].CumulativeLimit = json.RawMessage(raw)
			request.SharedProviders[0].Abilities[0].Operations[0].Operation = "cooldown_change"
			request.SharedProviders[0].Abilities[0].Operations[0].ValuePolicy = "reduce_total_ratio"
			result := CompileGeneric(request)
			if result.OK || !hasErrorPath(result.Result.Errors, "cumulativeLimit") {
				t.Fatalf("invalid limit accepted: %+v", result.Result)
			}
		})
	}
}

func TestCumulativeRatioLimitCannotLeakToOtherOperations(t *testing.T) {
	request := minimalValidCompileRequest()
	request.SharedProviders[0].Abilities[0].Operations[0].CumulativeLimit = json.RawMessage(`{"groupKey":"group","maxRatio":0.39}`)
	result := CompileGeneric(request)
	if result.OK || !hasErrorPath(result.Result.Errors, "cumulativeLimit") {
		t.Fatalf("foreign limit accepted: %+v", result.Result)
	}
}
