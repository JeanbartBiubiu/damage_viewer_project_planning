package formula

// ProcessStartStateView 同步借用本次使用已冻结的捕获值，不暴露底层切片。
type ProcessStartStateView struct{ values []ProcessStartStateValue }

func BorrowProcessStartState(values []ProcessStartStateValue) ProcessStartStateView {
	return ProcessStartStateView{values: values}
}
func (v ProcessStartStateView) Lookup(key string) (float64, bool) {
	for _, value := range v.values {
		if value.StateKey == key {
			return value.Value, true
		}
	}
	return 0, false
}
