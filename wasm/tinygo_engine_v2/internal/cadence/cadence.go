// 本文件定义 action 节奏骨架，覆盖 cooldown、charge、recharge 和 auto-repeat 的基础状态。
package cadence

type State struct {
	ReadyAtMs        int64
	MaxCharges       uint8
	CurrentCharges   uint8
	RechargeEndTimes []int64
	AutoRepeat       bool
}

func (s State) Ready(nowMs int64) bool {
	if s.MaxCharges > 0 {
		return s.CurrentCharges > 0
	}
	return nowMs >= s.ReadyAtMs
}

func (s *State) Consume(nowMs int64, cooldownMs int64) bool {
	if !s.Ready(nowMs) {
		return false
	}
	if s.MaxCharges > 0 {
		s.CurrentCharges--
		s.RechargeEndTimes = append(s.RechargeEndTimes, nowMs+cooldownMs)
		return true
	}
	s.ReadyAtMs = nowMs + cooldownMs
	return true
}
