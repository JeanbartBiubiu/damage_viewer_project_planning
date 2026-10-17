package compile

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func TestProcessExplicitSelfTargetOnlyInitialTrue(t *testing.T) {
	req := processCompileRequest()
	req.SharedProviders[0].Abilities[0].ProcessControl.RequireExplicitSelfTarget = model.BoolPtr(true)
	result := CompileGeneric(req)
	if !result.OK || result.Session.Abilities[0].ProcessControl.RequireExplicitSelfTarget == nil || !*result.Session.Abilities[0].ProcessControl.RequireExplicitSelfTarget {
		t.Fatalf("INITIAL explicit self gate lost: %+v", result.Result.Errors)
	}
	for _, tc := range []struct {
		index int
		value bool
	}{{0, false}, {1, true}, {2, true}} {
		req := processCompileRequest()
		req.SharedProviders[0].Abilities[tc.index].ProcessControl.RequireExplicitSelfTarget = model.BoolPtr(tc.value)
		requireProcessCompileError(t, req, "sharedProviders[0].abilities["+itoa(tc.index)+"].processControl.requireExplicitSelfTarget")
	}
}
