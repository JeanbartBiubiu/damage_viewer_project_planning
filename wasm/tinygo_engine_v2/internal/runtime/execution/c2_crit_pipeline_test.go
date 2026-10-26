package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func c2Float(v float64) *float64 { return &v }

func c2PipelineMod(key, command, channel, stage, policy string, value float64, priority int) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: key,
		Kind:        "pipeline",
		Command:     command,
		Channel:     channel,
		Stage:       stage,
		Bucket:      "all_instances",
		Priority:    priority,
		ValuePolicy: policy,
		Value:       model.GenericFormulaExpr{Op: "const", Value: c2Float(value)},
	}
}
