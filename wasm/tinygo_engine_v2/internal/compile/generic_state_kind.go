package compile

import (
	"sort"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

// 用途由作者明确声明；普通状态不能因名称或期限被推断为冷却。
func compileProviderStateKinds(schema map[string]interface{}, fields map[string]plan.CompiledProviderStateField, path string, ctx *genericCompileContext) {
	keys := make([]string, 0, len(schema))
	for key := range schema {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	ammo := map[string]interface{}{}
	for _, key := range keys {
		object, structured := schema[key].(map[string]interface{})
		if !structured {
			continue
		}
		kind, declared := object["stateKind"]
		_, hasRecovery := object["ammoRecovery"]
		if !declared && !hasRecovery {
			continue
		}
		fieldPath := path + "." + key
		switch kind {
		case model.ProviderStateKindAmmo:
			ammo[key] = object
		case model.ProviderStateKindCooldown:
			compileCooldownStateField(object, fields, key, fieldPath, ctx)
		default:
			ctx.collector.addError(model.GenericErrUnknownRef, fieldPath+".stateKind", "stateKind must explicitly be ammo or cooldown", key)
		}
	}
	// 弹药处理器只认领弹药字段，不再截走其它已声明用途。
	compileAmmoStateFields(ammo, fields, path, ctx)
}

func compileCooldownStateField(object map[string]interface{}, fields map[string]plan.CompiledProviderStateField, key, path string, ctx *genericCompileContext) {
	valid := true
	properties := make([]string, 0, len(object))
	for property := range object {
		properties = append(properties, property)
	}
	sort.Strings(properties)
	for _, property := range properties {
		switch property {
		case "stateKind", "valueType", "defaultValue", "maxValue", "durationMs", "refreshPolicy":
		default:
			ctx.collector.addError(model.GenericErrUnknownRef, path+"."+property, "unsupported cooldown state field", key)
			valid = false
		}
	}
	field, found := fields[key]
	if !found {
		// 普通定时校验可能先因刷新策略拒绝零期限；仍报告真正错误的用途字段。
		// 数值已经在freezeStateSchema按作者静态公式冻结，不在这里补值或再次求值。
		for _, constraint := range []struct {
			key   string
			value float64
		}{{"defaultValue", 0}, {"maxValue", 1}} {
			if raw, present := object[constraint.key]; present {
				value, numeric := asSchemaFloat64(raw)
				if numeric && value != constraint.value {
					ctx.collector.addError(model.GenericErrFormulaTypeError, path+"."+constraint.key, "internal cooldown requires zero default and capacity one", key)
				}
			}
		}
		if duration, numeric := asSchemaInt64(object["durationMs"]); numeric && duration <= 0 {
			ctx.collector.addError(model.GenericErrFormulaTypeError, path+".durationMs", "internal cooldown requires a positive authored duration", key)
		}
		if policy, present := object["refreshPolicy"]; !present || policy != model.ProviderStateRefreshStartOnFirstWrite {
			ctx.collector.addError(model.GenericErrUnknownRef, path+".refreshPolicy", "internal cooldown requires start_on_first_write", key)
		}
		return
	}
	if field.DefaultValue != 0 {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".defaultValue", "internal cooldown requires an explicit zero default", key)
		valid = false
	}
	if !field.HasCap || field.MaxValue != 1 {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".maxValue", "internal cooldown requires an explicit capacity of one", key)
		valid = false
	}
	if field.DurationMs <= 0 {
		ctx.collector.addError(model.GenericErrFormulaTypeError, path+".durationMs", "internal cooldown requires a positive authored duration", key)
		valid = false
	}
	if field.RefreshPolicy != model.ProviderStateRefreshStartOnFirstWrite {
		ctx.collector.addError(model.GenericErrUnknownRef, path+".refreshPolicy", "internal cooldown requires start_on_first_write", key)
		valid = false
	}
	if valid {
		field.StateKind = model.ProviderStateKindCooldown
		fields[key] = field
	}
}
