package runtime_test

import (
	"strconv"
	"strings"
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func passiveInlineAuthoringInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := passiveDelayMixedInput(t, 801)
	provider := &c.SharedProviders[2]
	provider.InitialStateSchema["marks"] = p6SchemaField(2, 3, 0, "")
	ability := &provider.Abilities[0]
	ability.ListenerSpec.Operations = ability.Operations
	ability.Operations = nil
	return c, r
}

func TestPassiveProcessProductionInlineOperations(t *testing.T) {
	c, r := passiveInlineAuthoringInput(t)
	done := timedShieldMustRun(t, c, r)
	processes := passiveProcessSnapshots(done)
	if done.Summary.SourceDamageDealt != 130 || len(processes) != 1 || processes[0].Status != "complete" || processes[0].FinishedAtMs == nil || *processes[0].FinishedAtMs != 800 {
		t.Fatal("production listener operations did not complete the original delayed behavior", done.Summary, processes)
	}
}

func TestPassiveProcessTailRetainsOriginalHitReference(t *testing.T) {
	c, r := passiveInlineAuthoringInput(t)
	done := timedShieldMustRun(t, c, r)
	processes := passiveProcessSnapshots(done)
	if len(processes) != 1 || processes[0].PassiveOrigin == nil {
		t.Fatal("missing real passive origin", processes)
	}
	origin := processes[0].PassiveOrigin
	count := 0
	for _, row := range done.DamageRecords {
		if row["operationRef"] != "delayed_damage" {
			continue
		}
		count++
		if row["timeMs"] != int64(800) || row["useRef"] != origin.UseKey || row["hitRef"] != "hit:"+strconv.FormatUint(origin.HitOccurrenceID, 10) {
			t.Fatal("delayed row lost the actual original use or hit identity", row, origin)
		}
	}
	if count != 1 {
		t.Fatal("expected one actual tail damage row", count, done.DamageRecords)
	}
}

func TestPassiveProcessInlineStillRequiresOwnedSkillHit(t *testing.T) {
	c, _ := passiveInlineAuthoringInput(t)
	c.SharedProviders[2].Abilities[0].ListenerSpec.EventMatcher.All = []string{model.EventTypeSkillHit}
	compiled := compilebundle.CompileGeneric(c)
	if compiled.OK {
		t.Fatal("inline passive start without the owner matcher compiled")
	}
	for _, problem := range compiled.Result.Errors {
		if strings.Contains(problem.Message, "only an owned inline SKILL_HIT passive listener") {
			return
		}
	}
	t.Fatal("missing the specific owned-listener rejection", compiled.Result.Errors)
}
