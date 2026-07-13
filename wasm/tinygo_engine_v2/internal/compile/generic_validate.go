package compile

import (
	"math"

	"tinygo_engine_v2/internal/model"
)

type genericCollector struct {
	errors     []model.EngineError
	warnings   []model.WarningItem
	schemaHash string
	rulesHash  string
}

func newGenericCollector(schemaHash, rulesHash string) *genericCollector {
	return &genericCollector{schemaHash: schemaHash, rulesHash: rulesHash}
}

func (c *genericCollector) addError(code model.GenericErrCode, path, message, ref string) {
	c.errors = append(c.errors, model.EngineError{
		OK:          false,
		Phase:       model.GenericPhaseCompile,
		Code:        code,
		Message:     message,
		Path:        path,
		Ref:         ref,
		Severity:    model.GenericSeverityError,
		Recoverable: false,
		SchemaHash:  c.schemaHash,
		RulesHash:   c.rulesHash,
	})
}

func (c *genericCollector) addWarning(code model.WarningCode, path, message string, refs ...string) {
	item := model.WarningItem{
		Code:     string(code),
		Message:  message,
		Severity: model.WarningSeverityWarning,
		Count:    1,
	}
	if path != "" {
		item.Refs = append(item.Refs, path)
	}
	item.Refs = append(item.Refs, refs...)
	c.warnings = append(c.warnings, item)
}

// ValidateAbilityRefFormat 校验 abilityRef 字符串格式（不含解析）。
func ValidateAbilityRefFormat(ref string) bool {
	_, ok := ParseAbilityRef(ref)
	return ok
}

// RejectBareAbilityRef 检测禁止的裸 abilityKey 或 :: 形态。
func RejectBareAbilityRef(ref string) model.GenericErrCode {
	if ref == "" {
		return model.GenericErrMissingRequiredField
	}
	if _, ok := ParseAbilityRef(ref); ok {
		return ""
	}
	if stringsContains(ref, "::") {
		return model.GenericErrUnknownRef
	}
	if !stringsContains(ref, ".provider[") {
		return model.GenericErrUnknownRef
	}
	return model.GenericErrUnknownRef
}

func stringsContains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexString(s, sub) >= 0)
}

func indexString(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// compileInitialStateSchema 规范化 initialStateSchema：旧数字默认值兼容，结构化对象 collect-all 校验。
func compileInitialStateSchema(schema map[string]interface{}, path string, collector *genericCollector) map[string]CompiledProviderStateField {
	if len(schema) == 0 {
		return nil
	}
	out := make(map[string]CompiledProviderStateField, len(schema))
	for key, raw := range schema {
		fieldPath := path + "." + key
		if key == "" {
			collector.addError(model.GenericErrMissingRequiredField, fieldPath, "initialStateSchema field key is required", "")
			continue
		}
		if n, ok := asSchemaFloat64(raw); ok {
			if !isFiniteFloat(n) {
				collector.addError(model.GenericErrFormulaTypeError, fieldPath, "initialStateSchema default value must be finite", key)
				continue
			}
			out[key] = CompiledProviderStateField{DefaultValue: n}
			continue
		}
		obj, ok := raw.(map[string]interface{})
		if !ok {
			collector.addError(model.GenericErrMissingRequiredField, fieldPath, "initialStateSchema field must be number or object", key)
			continue
		}
		field, ok := compileStructuredStateField(obj, fieldPath, key, collector)
		if ok {
			out[key] = field
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func compileStructuredStateField(obj map[string]interface{}, path, key string, collector *genericCollector) (CompiledProviderStateField, bool) {
	var field CompiledProviderStateField
	ok := true

	defaultRaw, hasDefault := obj["defaultValue"]
	if !hasDefault {
		collector.addError(model.GenericErrMissingRequiredField, path+".defaultValue", "structured state field requires defaultValue", key)
		ok = false
	} else if n, nOK := asSchemaFloat64(defaultRaw); !nOK || !isFiniteFloat(n) {
		collector.addError(model.GenericErrFormulaTypeError, path+".defaultValue", "defaultValue must be finite", key)
		ok = false
	} else {
		field.DefaultValue = n
	}

	maxRaw, hasMax := obj["maxValue"]
	if !hasMax {
		collector.addError(model.GenericErrMissingRequiredField, path+".maxValue", "structured state field requires maxValue", key)
		ok = false
	} else if n, nOK := asSchemaFloat64(maxRaw); !nOK || !isFiniteFloat(n) {
		collector.addError(model.GenericErrFormulaTypeError, path+".maxValue", "maxValue must be finite", key)
		ok = false
	} else {
		field.MaxValue = n
		field.HasCap = true
	}

	if hasDefault && hasMax && isFiniteFloat(field.DefaultValue) && isFiniteFloat(field.MaxValue) && field.MaxValue < field.DefaultValue {
		collector.addError(model.GenericErrMissingRequiredField, path+".maxValue", "maxValue must be >= defaultValue", key)
		ok = false
	}

	durRaw, hasDur := obj["durationMs"]
	var dur int64
	var durOK bool
	if !hasDur {
		collector.addError(model.GenericErrMissingRequiredField, path+".durationMs", "structured state field requires durationMs", key)
		ok = false
	} else {
		dur, durOK = asSchemaInt64(durRaw)
		if !durOK {
			collector.addError(model.GenericErrFormulaTypeError, path+".durationMs", "durationMs must be an integer", key)
			ok = false
		} else if dur < 0 {
			collector.addError(model.GenericErrMissingRequiredField, path+".durationMs", "durationMs must be >= 0", key)
			ok = false
		} else {
			field.DurationMs = dur
		}
	}

	if policyRaw, hasPolicy := obj["refreshPolicy"]; hasPolicy {
		policy, policyOK := policyRaw.(string)
		if !policyOK {
			collector.addError(model.GenericErrMissingRequiredField, path+".refreshPolicy", "refreshPolicy must be a string", key)
			ok = false
		} else if policy != "" && policy != model.ProviderStateRefreshOnWrite {
			collector.addError(model.GenericErrUnknownRef, path+".refreshPolicy", "refreshPolicy must be empty or refresh_on_write", policy)
			ok = false
		} else if policy == model.ProviderStateRefreshOnWrite && (!durOK || dur <= 0) {
			collector.addError(model.GenericErrMissingRequiredField, path+".refreshPolicy", "refresh_on_write requires durationMs > 0", key)
			ok = false
		} else {
			field.RefreshPolicy = policy
		}
	}

	if !ok {
		return CompiledProviderStateField{}, false
	}
	return field, true
}

func asSchemaFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	default:
		return 0, false
	}
}

func asSchemaInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case float64:
		if n != math.Trunc(n) || !isFiniteFloat(n) {
			return 0, false
		}
		return int64(n), true
	case float32:
		f := float64(n)
		if f != math.Trunc(f) || !isFiniteFloat(f) {
			return 0, false
		}
		return int64(f), true
	case int:
		return int64(n), true
	case int64:
		return n, true
	case int32:
		return int64(n), true
	default:
		return 0, false
	}
}

func isFiniteFloat(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// validateRepeatOperation 校验 Gate K deferred repeat compile 合同（collect-all）。
func validateRepeatOperation(op model.OperationDefinition, path string, ownerProviderIndex int, ctx *genericCompileContext) {
	collector := ctx.collector
	if ownerProviderIndex < 0 || ownerProviderIndex >= len(ctx.session.Providers) {
		collector.addError(model.GenericErrMissingRequiredField, path+".operation", "repeat requires owning provider context", op.Operation)
	}
	if op.RepeatScope != model.RepeatScopeCopyableOnHit {
		collector.addError(model.GenericErrMissingRequiredField, path+".repeatScope", "repeat requires repeatScope="+model.RepeatScopeCopyableOnHit, op.RepeatScope)
	}
	if op.RepeatCount != 1 {
		collector.addError(model.GenericErrMissingRequiredField, path+".repeatCount", "repeat requires repeatCount=1", itoa(op.RepeatCount))
	}
	if op.RepeatTag == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".repeatTag", "repeat requires repeatTag", "")
	}
	if op.TriggerStateKey == "" {
		collector.addError(model.GenericErrMissingRequiredField, path+".triggerStateKey", "repeat requires triggerStateKey", "")
	} else if ownerProviderIndex >= 0 && ownerProviderIndex < len(ctx.session.Providers) {
		fields := ctx.session.Providers[ownerProviderIndex].StateFields
		if _, ok := fields[op.TriggerStateKey]; !ok {
			collector.addError(model.GenericErrUnknownRef, path+".triggerStateKey", "unknown triggerStateKey in provider state", op.TriggerStateKey)
		}
	}
	if !(op.Threshold > 0) || !isFiniteFloat(op.Threshold) {
		collector.addError(model.GenericErrMissingRequiredField, path+".threshold", "repeat requires threshold > 0", "")
	}
}
