package listener

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

type recoveryFixture struct {
	hp    float64
	reads int
}

func (f *recoveryFixture) ListenerRecoveryHP(owner string) float64 {
	f.reads++
	return f.hp
}

func (f *recoveryFixture) ListenerRecoveryError(message, path, target string) *model.EngineError {
	err := model.NewEngineError(model.GenericPhaseRun, model.GenericErrUnknownRef, message)
	err.Path, err.Ref = path, target
	return &err
}

func TestRecoveryChecksActualOwnerBeforeReadingStagedLife(t *testing.T) {
	fixture := &recoveryFixture{hp: 10}
	skip, err := CheckRecoveryRecipient(RecoveryRecipient{Mounted: true, Owner: "source", Target: "target", Path: "heal"}, fixture)
	if skip || err == nil || err.Path != "heal.target" || fixture.reads != 0 {
		t.Fatal("wrong owner entered staged reads", skip, err, fixture.reads)
	}
	skip, err = CheckRecoveryRecipient(RecoveryRecipient{Mounted: false, Owner: "source", Target: "target"}, fixture)
	if skip || err != nil || fixture.reads != 0 {
		t.Fatal("active restoration gained listener restriction", skip, err, fixture.reads)
	}
	fixture.hp = 0
	skip, err = CheckRecoveryRecipient(RecoveryRecipient{Mounted: true, Owner: "source", Target: "source"}, fixture)
	if !skip || err != nil || fixture.reads != 1 {
		t.Fatal("dead listener owner restored after same-frame loss", skip, err, fixture.reads)
	}
}
