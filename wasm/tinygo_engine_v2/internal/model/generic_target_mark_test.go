package model

import (
	"encoding/json"
	"strings"
	"testing"
)

const targetMarkJSON = `{"operation":"consume_target_mark","target":"target","ref":"consume","targetMark":{"stateKey":"mark","stateScope":"provider_target","triggerKind":"event/skill_hit","triggerAbilityRef":"source.provider[q].ability[hit]","damageBlockScope":"DAMAGE_INSTANCE","damage":{"operation":"damage","target":"target","ref":"w.damage","damageType":"magic","amount":{"op":"const","value":220},"types":["damage_trait/delivery_skill","damage_trait/origin_direct"],"vampQualification":"RESOLVED","vampOverrides":[],"critEligible":false},"restore":{"operation":"resource_change","target":"self","ref":"w.mana","resourceKey":"mana","amount":{"op":"const","value":60}}}}`

func TestTargetMarkStrictJSON(t *testing.T) {
	var op OperationDefinition
	if err := json.Unmarshal([]byte(targetMarkJSON), &op); err != nil {
		t.Fatal(err)
	}
	if op.TargetMark == nil || op.TargetMark.Damage == nil || op.TargetMark.Restore == nil {
		t.Fatal(op)
	}
	for name, raw := range map[string]string{
		"outer_extra":      strings.Replace(targetMarkJSON, `"targetMark":`, `"amount":{"op":"const","value":1},"targetMark":`, 1),
		"old_null":         `{"operation":"damage","target":"target","targetMark":null}`,
		"old_object":       strings.Replace(targetMarkJSON, `"operation":"consume_target_mark"`, `"operation":"damage"`, 1),
		"null_group":       `{"operation":"consume_target_mark","target":"target","ref":"consume","targetMark":null}`,
		"missing_group":    `{"operation":"consume_target_mark","target":"target","ref":"consume"}`,
		"bad_group":        strings.Replace(targetMarkJSON, `"stateScope":"provider_target"`, `"stateScope":0`, 1),
		"unknown_group":    strings.Replace(targetMarkJSON, `"stateKey":"mark"`, `"stateKey":"mark","callback":"other"`, 1),
		"null_restore":     strings.Replace(targetMarkJSON, `"restore":{"operation":"resource_change","target":"self","ref":"w.mana","resourceKey":"mana","amount":{"op":"const","value":60}}`, `"restore":null`, 1),
		"authored_field":   strings.Replace(targetMarkJSON, `"damageType":"magic"`, `"damageType":"magic","damageTypeKey":"magic"`, 1),
		"extra_restore":    strings.Replace(targetMarkJSON, `"resourceKey":"mana"`, `"resourceKey":"mana","valuePolicy":"CONSUME"`, 1),
		"null_types":       strings.Replace(targetMarkJSON, `"types":["damage_trait/delivery_skill","damage_trait/origin_direct"]`, `"types":null`, 1),
		"ignored_expr_key": strings.Replace(targetMarkJSON, `"op":"const","value":60`, `"op":"const","value":60,"args":[{"op":"read","path":"source.attr.hp.current"}]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(raw), &op); err == nil {
				t.Fatal("accepted malformed target mark", raw)
			}
		})
	}
}

func TestTargetMarkOldOperationAndOutputStayOmitted(t *testing.T) {
	bytes, err := json.Marshal(OperationDefinition{Operation: "damage", Target: "target"})
	if err != nil || strings.Contains(string(bytes), "targetMark") {
		t.Fatal(string(bytes), err)
	}
	bytes, err = json.Marshal(DoneResult{})
	if err != nil || strings.Contains(string(bytes), "targetMarkSummary") {
		t.Fatal(string(bytes), err)
	}
}
