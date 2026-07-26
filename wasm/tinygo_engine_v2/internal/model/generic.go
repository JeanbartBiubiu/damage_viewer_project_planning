// 通用计算引擎 A1 契约：目标 frame kind、错误码与最小 ABI DTO。
package model

// 目标通用引擎 frame kind（200+ 段，与 legacy kind 区分）。
const (
	FrameKindGenericCompile        FrameKind = 200
	FrameKindGenericRun            FrameKind = 201
	FrameKindGenericReleaseSession FrameKind = 202
	FrameKindGenericCompileResult  FrameKind = 210
	FrameKindGenericDone           FrameKind = 211
	FrameKindGenericError          FrameKind = 212
	FrameKindGenericSnapshot       FrameKind = 213
	FrameKindGenericReleaseResult  FrameKind = 214
)

// GenericSchemaVersion 是 A1/B1 阶段 Wasm 接受的最小 canonical schema 版本。
const GenericSchemaVersion = "generic-p0"

// GenericErrCode 是目标 ABI 对外错误码（小写 snake_case，不使用旧 E_* 前缀）。
type GenericErrCode string

const (
	GenericErrSessionNotFound          GenericErrCode = "session_not_found"
	GenericErrHashMismatch             GenericErrCode = "hash_mismatch"
	GenericErrJSONParseError           GenericErrCode = "json_parse_error"
	GenericErrSchemaVersionUnsupported GenericErrCode = "schema_version_unsupported"
	GenericErrMissingRequiredField     GenericErrCode = "missing_required_field"
	GenericErrUnknownRef               GenericErrCode = "unknown_ref"
	GenericErrUnknownTypeKey           GenericErrCode = "unknown_type_key"
	GenericErrMatcherDomainError       GenericErrCode = "matcher_domain_error"
	GenericErrFormulaTypeError         GenericErrCode = "formula_type_error"
	GenericErrOperationTargetMissing   GenericErrCode = "operation_target_missing"
	GenericErrHPRawSetForbidden        GenericErrCode = "hp_raw_set_forbidden"
	GenericErrRuntimeInvariantFailed   GenericErrCode = "runtime_invariant_failed"
)

// GenericErrorPhase 标识错误发生的阶段。
type GenericErrorPhase string

const (
	GenericPhaseParse   GenericErrorPhase = "parse"
	GenericPhaseCompile GenericErrorPhase = "compile"
	GenericPhaseRun     GenericErrorPhase = "run"
	GenericPhaseABI     GenericErrorPhase = "abi"
)

// GenericErrorSeverity 标识错误严重级别。
type GenericErrorSeverity string

const (
	GenericSeverityError GenericErrorSeverity = "error"
	GenericSeverityFatal GenericErrorSeverity = "fatal"
)

// CompileResultMetadata 是 compile 成功时的调试计数。
type CompileResultMetadata struct {
	CombatantCount int `json:"combatantCount"`
	ProviderCount  int `json:"providerCount"`
	AbilityCount   int `json:"abilityCount"`
	TypeCount      int `json:"typeCount"`
	FormulaCount   int `json:"formulaCount"`
}

// WarningSeverity 标识 warning 严重级别（与 EngineError.severity 的 error/fatal 区分）。
type WarningSeverity string

const (
	WarningSeverityWarning WarningSeverity = "warning"
)

// WarningCode 是 compile/run warning 对外 code（小写 snake_case）。
type WarningCode string

const (
	WarningCodeCompileSettingCapped    WarningCode = "compile_setting_capped"
	WarningCodeEvidenceTruncated       WarningCode = "evidence_truncated"
	WarningCodeSeriesDownsampled       WarningCode = "series_downsampled"
	WarningCodeBudgetExceeded          WarningCode = "budget_exceeded"
	WarningCodePerCastThrottleOverflow WarningCode = "per_cast_throttle_overflow"
)

// WarningItem 是 compile/run 非阻塞 warning DTO（§16）。
type WarningItem struct {
	Code         string          `json:"code"`
	Message      string          `json:"message"`
	Severity     WarningSeverity `json:"severity"`
	Refs         []string        `json:"refs,omitempty"`
	EvidenceRefs []string        `json:"evidenceRefs,omitempty"`
	Count        int             `json:"count,omitempty"`
}

// CompileResult 是 compile 成功或 collect-all 失败时的结构化输出。
type CompileResult struct {
	OK            bool                   `json:"ok"`
	SessionID     string                 `json:"sessionId,omitempty"`
	SchemaVersion string                 `json:"schemaVersion,omitempty"`
	SchemaHash    string                 `json:"schemaHash,omitempty"`
	RulesHash     string                 `json:"rulesHash,omitempty"`
	Metadata      *CompileResultMetadata `json:"metadata,omitempty"`
	Warnings      []WarningItem          `json:"warnings,omitempty"`
	Errors        []EngineError          `json:"errors,omitempty"`
}

// EngineError 是目标 ABI 的统一错误 DTO。
type EngineError struct {
	OK          bool                   `json:"ok"`
	Phase       GenericErrorPhase      `json:"phase"`
	Code        GenericErrCode         `json:"code"`
	Message     string                 `json:"message"`
	Path        string                 `json:"path,omitempty"`
	Ref         string                 `json:"ref,omitempty"`
	Severity    GenericErrorSeverity   `json:"severity"`
	Recoverable bool                   `json:"recoverable"`
	Details     map[string]interface{} `json:"details,omitempty"`
	SchemaHash  string                 `json:"schemaHash,omitempty"`
	RulesHash   string                 `json:"rulesHash,omitempty"`
	SessionID   string                 `json:"sessionId,omitempty"`
}

// ReleaseSessionRequest 是 release session 的最小请求 DTO。
type ReleaseSessionRequest struct {
	SessionID         string `json:"sessionId"`
	ExpectedRulesHash string `json:"expectedRulesHash,omitempty"`
}

// GenericReleaseDonePayload 是 release 成功时的 done payload。
type GenericReleaseDonePayload struct {
	OK        bool   `json:"ok"`
	SessionID string `json:"sessionId"`
	Released  bool   `json:"released"`
}

// GenericRunRequest 是 A1 阶段解析 run frame 的最小字段子集。
type GenericRunRequest struct {
	SessionID         string `json:"sessionId"`
	ExpectedRulesHash string `json:"expectedRulesHash,omitempty"`
	SchemaVersion     string `json:"schemaVersion,omitempty"`
	SchemaHash        string `json:"schemaHash,omitempty"`
	RulesHash         string `json:"rulesHash,omitempty"`
}

func NewEngineError(phase GenericErrorPhase, code GenericErrCode, message string) EngineError {
	return EngineError{
		OK:          false,
		Phase:       phase,
		Code:        code,
		Message:     message,
		Severity:    GenericSeverityError,
		Recoverable: code == GenericErrSessionNotFound || code == GenericErrHashMismatch,
	}
}
