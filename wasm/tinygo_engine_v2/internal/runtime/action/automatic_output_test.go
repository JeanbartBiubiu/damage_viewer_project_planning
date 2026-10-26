package action

import (
	"encoding/json"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestAutomaticWaitingSummaryKeepsEmptyCollectionAndCopyIsolation(t *testing.T) {
	var state State
	state.InitAutomatic()
	state.AddAutomaticRule(AutomaticRuleSeed{Plan: model.AutomaticSkillRule{RuleKey: "skill"}})
	rule := state.AutomaticAt(0)
	if rule.Summary().Waiting != nil {
		t.Fatal("absent waiting gained a value")
	}
	state.AutomaticWaiting(rule, model.AutomaticWaitOwnCooldown, nil, 1000, 0)
	summary, _ := state.AutomaticSummary()
	waiting := summary.Rules[0].Waiting
	if waiting == nil || waiting.RelatedRuleKeys == nil || len(waiting.RelatedRuleKeys) != 0 {
		t.Fatal("explicit empty related rules must remain an array", waiting)
	}
	encoded, err := json.Marshal(summary)
	if err != nil || !strings.Contains(string(encoded), `"relatedRuleKeys":[]`) {
		t.Fatal("waiting JSON lost its explicit empty collection", string(encoded), err)
	}
	state.AutomaticWaiting(rule, model.AutomaticWaitRelatedCooldown, []string{"predecessor"}, 1000, 0)
	exported := rule.Summary()
	exported.Waiting.RelatedRuleKeys[0] = "changed"
	*exported.Waiting.NextCheckAtMs = 2000
	internal := rule.Summary().Waiting
	if internal.RelatedRuleKeys[0] != "predecessor" || *internal.NextCheckAtMs != 1000 {
		t.Fatal("exported waiting changed private state", internal)
	}
	if _, changed := state.AutomaticWaiting(rule, model.AutomaticWaitRelatedCooldown, []string{"predecessor"}, 1000, 0); changed {
		t.Fatal("export mutation changed waiting transition detection")
	}
	state.AutomaticWaiting(rule, "", nil, 0, 0)
	if rule.Summary().Waiting != nil || waiting.RelatedRuleKeys == nil || len(waiting.RelatedRuleKeys) != 0 || *waiting.NextCheckAtMs != 1000 {
		t.Fatal("later transitions changed an old waiting snapshot")
	}
}
