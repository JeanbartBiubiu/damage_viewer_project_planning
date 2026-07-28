// V2 公共契约层：frame kind、错误码与仍被 canonical 路径引用的共享 DTO。
//
// 不变量：字段语义变更必须先改本包，再同步 compile/runtime/前端；此处不含任何运行时逻辑。
// legacy EngineBundle / step-loop / SingleAttackerDPS DTO 已移除。
package model

type FrameKind uint16

const (
	SchemaVersion uint16 = 1
)

type ErrCode string

const (
	ErrOK            ErrCode = "OK"
	ErrQueueOverflow ErrCode = "E_QUEUE_OVERFLOW"
	ErrInvalidInput  ErrCode = "E_INVALID_INPUT"
)

type EventPhase string

type TypeListV2 []string

type TypeMatcherV2 struct {
	Any  TypeListV2 `json:"any,omitempty"`
	All  TypeListV2 `json:"all,omitempty"`
	None TypeListV2 `json:"none,omitempty"`
}

type NumericBoundEvidenceV2 struct {
	Key          string  `json:"key,omitempty"`
	Source       string  `json:"source,omitempty"`
	Mode         string  `json:"mode,omitempty"`
	RawValue     float64 `json:"rawValue,omitempty"`
	BoundedValue float64 `json:"boundedValue,omitempty"`
	Min          float64 `json:"min,omitempty"`
	HasMin       bool    `json:"hasMin,omitempty"`
	Max          float64 `json:"max,omitempty"`
	HasMax       bool    `json:"hasMax,omitempty"`
	WasClamped   bool    `json:"wasClamped,omitempty"`
}
