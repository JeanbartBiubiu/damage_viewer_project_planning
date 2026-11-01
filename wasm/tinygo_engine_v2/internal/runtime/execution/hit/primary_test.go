package hit

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type primaryPreparationFixture struct {
	bindingReads, historyReads int
}

func (f *primaryPreparationFixture) EmpoweredOwnerLive(owner, provider string, definition uint16) bool {
	return true
}

func (f *primaryPreparationFixture) PrimaryNativeBinding(source string, definition uint16) PrimaryBinding {
	f.bindingReads++
	return PrimaryBinding{}
}

func (f *primaryPreparationFixture) PrimaryActivationHistory(use string) ActivationHistory {
	f.historyReads++
	return ActivationHistory{}
}

func primaryWaitForTest(use, status string) EmpoweredWait {
	expiry := int64(50)
	process := actionpkg.NewProcess(actionpkg.ProcessSeed{Snapshot: model.ProcessInstanceSnapshot{
		Owner: "source", ProviderRef: "empower", ProcessKey: "primary", SkillKey: "empower:q", UseKey: use,
		Target: "source", Status: status, ExpiresAtMs: &expiry, StepVersion: 4, StepExecutionIndex: 0,
	}})
	changes := actionpkg.StageProcess(process)
	changes.BindEmpowered(0, true, 0)
	changes.Publish(process)
	return EmpoweredWait{Instance: process, UseKey: use, Version: 4, Expires: expiry}
}

func TestPrimaryPreparationReadsBindingOnlyAfterUniqueLiveWait(t *testing.T) {
	for _, test := range []struct {
		name         string
		waits        []EmpoweredWait
		errorPath    string
		bindingReads int
	}{
		{name: "none"},
		{name: "expired", waits: []EmpoweredWait{primaryWaitForTest("old", "complete")}},
		{name: "ambiguous", waits: []EmpoweredWait{primaryWaitForTest("first", "active"), primaryWaitForTest("second", "active")}, errorPath: "skillActions"},
		{name: "invalid_native", waits: []EmpoweredWait{primaryWaitForTest("only", "active")}, errorPath: "driverPlan.basicAttack", bindingReads: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := &primaryPreparationFixture{}
			context := NewContext(ContextSeed{EmpoweredWaits: test.waits})
			prepared, err := PreparePrimaryReplacement(PrimaryReplacementInput{Context: context, Source: "source", Target: "target", NowMs: 10}, fixture, Identity{})
			if test.errorPath == "" && err != nil || test.errorPath != "" && (err == nil || err.Path != test.errorPath) {
				t.Fatal("wrong preparation boundary", err)
			}
			if prepared.Changes != nil || fixture.bindingReads != test.bindingReads || fixture.historyReads != 0 {
				t.Fatal("preparation read or staged beyond its actual qualification", prepared, fixture)
			}
		})
	}
}
