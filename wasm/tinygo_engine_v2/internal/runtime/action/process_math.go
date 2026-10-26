package action

import (
	"math"
	"strings"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

const empoweredAttackStep = "EMPOWERED_BASIC_ATTACK"

func IsEmpoweredProcess(definition *planbundle.CompiledProcess) bool {
	return definition != nil && len(definition.Steps) == 1 && definition.Steps[0].StepType == empoweredAttackStep
}

func ProcessTimeAfter(now int64, value float64, allowZero bool) (int64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || (!allowZero && value == 0) || math.Trunc(value) != value || value >= 9223372036854775808.0 || now < 0 {
		return 0, false
	}
	duration := int64(value)
	if duration > math.MaxInt64-now {
		return 0, false
	}
	return now + duration, true
}

func ProcessMountKey(owner, provider, process string) string {
	return owner + "\x00" + provider + "\x00" + process
}

func MomentMatches(m model.ProcessMomentDefinition, kind, step, reason string) bool {
	if m.MomentType != kind {
		return false
	}
	if strings.HasPrefix(kind, "STEP_") && (m.StepKey == nil || *m.StepKey != step) {
		return false
	}
	return kind != "PROCESS_FAILURE" || m.FailureReason == nil || *m.FailureReason == reason
}

func ValidProcessWindowValue(value float64, positive bool) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && (!positive || value > 0) && math.Trunc(value) == value && value <= float64(maxJSONSafeInteger)
}

func ValidProcessChannelWindow(duration int64, repeat *model.ProcessRepeatSnapshot) bool {
	first, last := repeat.FirstExecutionOffsetMs, repeat.LastExecutionOffsetMs
	return duration > 0 && duration <= maxJSONSafeInteger && first >= 0 && first <= last && last <= duration && (repeat.ExecutionCount == 1 && first == last || repeat.ExecutionCount > 1 && last-first >= int64(repeat.ExecutionCount-1))
}
