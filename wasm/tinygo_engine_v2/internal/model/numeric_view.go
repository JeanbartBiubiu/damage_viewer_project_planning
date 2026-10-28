package model

// NumericView 借用只读数值集合；保留缺值与合法零值的区别。
// 所有者负责在冻结后写入时复制底层数据，求值本身不复制集合。
type NumericView struct{ values map[string]float64 }

// DeadlineView 是状态期限的只读借用；期限计算和写入由效果所有者处理。
type DeadlineView struct{ values map[string]int64 }

// Range 同步读取各项值，不保存调用方函数或公开映射。
func (v NumericView) Range(visit func(string, float64) bool) {
	for key, value := range v.values {
		if !visit(key, value) {
			return
		}
	}
}
func (v DeadlineView) Range(visit func(string, int64) bool) {
	for key, value := range v.values {
		if !visit(key, value) {
			return
		}
	}
}

func BorrowNumericView(values map[string]float64) NumericView { return NumericView{values: values} }
func (v NumericView) Lookup(key string) (float64, bool)       { value, ok := v.values[key]; return value, ok }
func (v NumericView) At(key string) float64                   { return v.values[key] }
func (v NumericView) Len() int                                { return len(v.values) }
func (v NumericView) Present() bool                           { return v.values != nil }
func (v NumericView) ToMap() map[string]float64 {
	if v.values == nil {
		return nil
	}
	out := make(map[string]float64, len(v.values))
	for key, value := range v.values {
		out[key] = value
	}
	return out
}

func BorrowDeadlineView(values map[string]int64) DeadlineView { return DeadlineView{values: values} }
func (v DeadlineView) Lookup(key string) (int64, bool)        { value, ok := v.values[key]; return value, ok }
func (v DeadlineView) At(key string) int64                    { return v.values[key] }
func (v DeadlineView) Len() int                               { return len(v.values) }
func (v DeadlineView) Present() bool                          { return v.values != nil }
func (v DeadlineView) ToMap() map[string]int64 {
	if v.values == nil {
		return nil
	}
	out := make(map[string]int64, len(v.values))
	for key, value := range v.values {
		out[key] = value
	}
	return out
}
