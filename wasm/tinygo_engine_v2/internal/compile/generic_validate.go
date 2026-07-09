package compile

import "tinygo_engine_v2/internal/model"

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
