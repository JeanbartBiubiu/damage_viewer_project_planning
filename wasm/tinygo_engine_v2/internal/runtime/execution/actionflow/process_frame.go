package actionflow

import (
	"math"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// ProcessCosts 借用一个付款前过程阶段；所有公式先于任何资源变更读取。
type ProcessCosts interface {
	// ProcessAmount 从当前过程能力及同一个付款前视图读取金额。
	ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError)
	// ProcessResource 返回资源当前金额及是否显式存在；缺失不解释为有效0。
	ProcessResource(owner, resource string) (float64, bool)
	// PayProcessResource 在该阶段原暂存中扣付已核定总额，返回实际支付量。
	PayProcessResource(owner, resource string, amount float64) (float64, *model.EngineError)
}

// ProcessMomentWork 只借用当前时点内的公式、数值暂存和实际操作交接。
// 不提供提交、队列或完整帧，也不保存到下一时点。
type ProcessMomentWork interface {
	// SetProcessMoment 标记当前时点和成本是否开放读取。
	SetProcessMoment(kind string, costsReadable bool)
	// ProcessAmount 在原时点暂存视图读取当前过程金额。
	ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError)
	// ProcessCooldownFactor 读取本过程真实冷却修正因子，不写冷却。
	ProcessCooldownFactor(process *actionpkg.ProcessView) (float64, *model.EngineError)
	// ProcessFormulaError 按原公式位置产生错误，不把非法数值当作0。
	ProcessFormulaError(program formula.GenericProgramID, message string) *model.EngineError
	// StageProcessCooldown 在所属冷却账暂存完整来源及原普攻等待，不发布状态。
	StageProcessCooldown(process *actionpkg.ProcessView, ready int64) *model.EngineError
	// RecordProcessMoment 在当前阶段暂存原时点证据。
	RecordProcessMoment(process *actionpkg.ProcessView, kind string)
	// ResetProcessOutputs 清理下一原操作组不可继承的私有输出。
	ResetProcessOutputs()
	// IsProcessAttackReset 核对跨过程操作是否正是该拥有者选中的普攻首次重置。
	IsProcessAttackReset(process *actionpkg.ProcessView, kind string, operation planbundle.CompiledOperation) bool
	// ExecuteProcessOperations 在同一原帧同步执行该时点的实际操作，不另建或提交子帧。
	ExecuteProcessOperations(ability planbundle.CompiledAbility, operations []planbundle.CompiledOperation) *model.EngineError
	// CaptureEmpoweredMoment 仅在原强化帧内冻结实际过程时点，不发布完成事实。
	CaptureEmpoweredMoment(process *actionpkg.ProcessView, kind string)
}

func (s ProcessExecutor) PrepareCosts(changes *actionpkg.ProcessChangeSet, costs ProcessCosts, pay bool) (bool, *model.EngineError) {
	process := changes.View()
	totals := map[string]float64{}
	keys := []string{}
	for _, cost := range process.Definition().Costs {
		amount, err := costs.ProcessAmount(cost.AmountProgram)
		if err != nil {
			return false, err
		}
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return false, s.error(cost.Path, "process cost must be finite and non-negative", cost.ResourceKey)
		}
		if _, exists := totals[cost.ResourceKey]; !exists {
			keys = append(keys, cost.ResourceKey)
		}
		totals[cost.ResourceKey] += amount
		if math.IsInf(totals[cost.ResourceKey], 0) {
			return false, s.error(cost.Path, "process cost sum is not finite", cost.ResourceKey)
		}
	}
	for _, key := range keys {
		current, present := costs.ProcessResource(process.Owner(), key)
		if !present || math.IsNaN(current) || math.IsInf(current, 0) || current < 0 {
			return false, s.error("combatants."+process.Owner()+".resources."+key, "process cost requires an explicit finite resource", key)
		}
		if current < totals[key] {
			return false, nil
		}
	}
	if !pay {
		return true, nil
	}
	for _, key := range keys {
		actual, err := costs.PayProcessResource(process.Owner(), key, totals[key])
		if err != nil {
			return false, err
		}
		changes.SetActualCost(key, actual)
	}
	return true, nil
}

func (s ProcessExecutor) ApplyMoment(changes *actionpkg.ProcessChangeSet, kind, reason string, now int64, alreadyCommitted bool, operations []planbundle.CompiledOperation, work ProcessMomentWork) (bool, *model.EngineError) {
	process := changes.View()
	work.SetProcessMoment(kind, kind == "PROCESS_COMPLETE" || kind == "PROCESS_FAILURE")
	timer := false
	if kind == "STEP_EXECUTION" {
		if !changes.ExecuteStep(now, alreadyCommitted) {
			return false, s.error(process.Definition().Path, "process step execution has already committed", process.UseKey())
		}
		if process.HasRepeat() {
			var err *model.EngineError
			timer, err = s.AdvanceRepeat(changes, now)
			if err != nil {
				return false, err
			}
		}
	}
	if kind == "STEP_COMPLETE" && !changes.CompleteStep(now) {
		return false, s.error(process.Definition().Path, "process step completion has already committed", process.UseKey())
	}
	if cooldown := process.Definition().Cooldown; cooldown != nil && !process.CooldownStarted() && actionpkg.MomentMatches(cooldown.StartMoment, kind, process.StepKey(), reason) {
		value, err := work.ProcessAmount(cooldown.DurationProgram)
		if err != nil {
			return false, err
		}
		factor, err := work.ProcessCooldownFactor(process)
		if err != nil {
			return false, err
		}
		if math.IsNaN(factor) || math.IsInf(factor, 0) || factor <= 0 {
			return false, s.error(cooldown.Path+".durationMs", "cooldown duration factor must remain finite and positive", process.UseKey())
		}
		value *= factor
		if cooldown.RoundPositiveMs || factor != 1 {
			if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
				return false, work.ProcessFormulaError(cooldown.DurationProgram, "process cooldown must be finite and positive before rounding")
			}
			value = math.Max(1, math.Round(value))
		}
		if action := s.actions.ActionForUse(process.UseKey()); action != nil && action.AutomaticRule() != nil && (math.IsNaN(value) || math.IsInf(value, 0) || value <= 0) {
			return false, work.ProcessFormulaError(cooldown.DurationProgram, "automatic cooldown must be finite and strictly positive")
		}
		ready, ok := actionpkg.ProcessTimeAfter(now, value, !cooldown.RoundPositiveMs)
		if !ok {
			return false, work.ProcessFormulaError(cooldown.DurationProgram, "invalid process cooldown duration or timestamp overflow")
		}
		if err := work.StageProcessCooldown(process, ready); err != nil {
			return false, err
		}
		changes.SetCooldownStarted()
	}
	work.RecordProcessMoment(process, kind)
	for _, moment := range process.Definition().MomentOperations {
		if !actionpkg.MomentMatches(moment.Moment, kind, process.StepKey(), reason) {
			continue
		}
		work.ResetProcessOutputs()
		start, end := int(moment.OperationStart), int(moment.OperationStart)+int(moment.OperationCount)
		if end > len(operations) {
			return false, s.error(process.Definition().Path, "process operation range is invalid", process.ProcessKey())
		}
		for _, operation := range operations[start:end] {
			if operation.Operation == "cooldown_change" && operation.ValuePolicy == "set_remaining" && NormalizeAbilityRef(operation.AbilityRefStr, process.Owner(), process.Target()) != process.AbilityRef() && !work.IsProcessAttackReset(process, kind, operation) {
				return false, s.error(moment.Path+".operations.abilityRef", "process set_remaining must address its original mounted initial ability", operation.AbilityRefStr)
			}
		}
		if err := work.ExecuteProcessOperations(process.Ability(), operations[start:end]); err != nil {
			return false, err
		}
	}
	work.CaptureEmpoweredMoment(process, kind)
	return timer, nil
}
