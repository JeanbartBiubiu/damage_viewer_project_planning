package formula

// BoolView 同步借用已准备的布尔事实；求值期间拥有者不得改写底层集合。
type BoolView struct{ values map[string]bool }

// StringView 同步借用只读类别集合，不公开可写切片。
type StringView struct{ values []string }

// OperationOutputView 只读取同帧已经结算的结果，不能登记或修改输出。
type OperationOutputView struct {
	values map[string]OperationOutputValues
}

// ProviderStateBeforeView 借用发动前已经冻结的状态，保留第一条匹配的原顺序。
type ProviderStateBeforeView struct{ values []ProviderStateBeforeValue }

// FactRequest 是编译后有限读取身份；关联盾按编号、伤前状态按键查找。
type FactRequest struct {
	Kind  GenericReadKind
	Index uint16
	Key   string
}

// PreparedFact 保存原读取位置准备的结果或延后错误；有效零由记录存在性区分。
type PreparedFact struct {
	Value float64
	Err   error
}

// FactView 只交付有限事实，不持有执行帧、效果袋、回调或发布能力。
// 前两项直接内嵌；请求借用编译后只读目录，超过两项时只借用本次求值的尾部。
type FactView struct {
	requests []FactRequest
	first    [2]PreparedFact
	rest     []PreparedFact
}

func BorrowBoolView(values map[string]bool) BoolView { return BoolView{values: values} }
func (v BoolView) At(key string) bool                { return v.values[key] }
func (v BoolView) Lookup(key string) (bool, bool) {
	value, exists := v.values[key]
	return value, exists
}

func BorrowStringView(values []string) StringView { return StringView{values: values} }
func (v StringView) Contains(key string) bool {
	for _, value := range v.values {
		if value == key {
			return true
		}
	}
	return false
}

func BorrowOperationOutputs(values map[string]OperationOutputValues) OperationOutputView {
	return OperationOutputView{values: values}
}
func (v OperationOutputView) Lookup(key string) (OperationOutputValues, bool) {
	value, exists := v.values[key]
	return value, exists
}

func BorrowProviderStateBefore(values []ProviderStateBeforeValue) ProviderStateBeforeView {
	return ProviderStateBeforeView{values: values}
}
func (v ProviderStateBeforeView) Len() int { return len(v.values) }
func (v ProviderStateBeforeView) Lookup(key string) (float64, bool) {
	for _, value := range v.values {
		if value.StateKey == key {
			return value.Value, true
		}
	}
	return 0, false
}

// PreparedFacts 交付已准备的有限请求和数值；同步求值结束前不得修改借用的目录和尾部。
// 错误不会在构造时返回，只有实际执行对应读指令时才会交给公式调用者。
func PreparedFacts(requests []FactRequest, first [2]PreparedFact, rest []PreparedFact) FactView {
	return FactView{requests: requests, first: first, rest: rest}
}

// FactRequestForRead 只将三类需外部准备的读取转换为有限身份；不执行读取。
func FactRequestForRead(in GenericInstr) (FactRequest, bool) {
	switch in.ReadKind {
	case ReadLinkedShieldPresent, ReadReceivedLinkedShieldAbsorbed:
		return FactRequest{Kind: in.ReadKind, Index: in.RefIndex}, true
	case ReadEventProviderTargetStateBefore:
		return FactRequest{Kind: in.ReadKind, Key: in.ReadKey}, true
	}
	return FactRequest{}, false
}

func (v FactView) Lookup(request FactRequest) (float64, error, bool) {
	for index, declared := range v.requests {
		if declared == request {
			if index < len(v.first) {
				return v.first[index].Value, v.first[index].Err, true
			}
			index -= len(v.first)
			if index < len(v.rest) {
				return v.rest[index].Value, v.rest[index].Err, true
			}
			return 0, nil, false
		}
	}
	return 0, nil, false
}
