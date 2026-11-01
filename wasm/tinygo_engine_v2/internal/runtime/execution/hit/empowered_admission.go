package hit

import (
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

// EmpoweredBinding 查找当前拥有者、原挂载和过程的完整编译强化绑定。
func EmpoweredBinding(bindings []planbundle.CompiledSkillActionBinding, owner, provider, process string) (planbundle.CompiledSkillActionBinding, bool) {
	for _, binding := range bindings {
		if binding.HasEmpoweredAttack && binding.Source == owner && binding.ProviderRef == provider && binding.Controls[0].ProcessKey == process {
			return binding, true
		}
	}
	return planbundle.CompiledSkillActionBinding{}, false
}

// EmpoweredStartDecision 保留自有原生普攻、完整绑定和同时窗口的原资格顺序。
func EmpoweredStartDecision(owner, target, nativeOwner, provider, use string, definition *planbundle.CompiledProcess, bindings []planbundle.CompiledSkillActionBinding, windows CountedWindowHost, identity Identity) (reject string, err *model.EngineError) {
	if target != owner || nativeOwner != owner {
		return "empowered_attack_requires_own_native_attack", nil
	}
	if _, found := EmpoweredBinding(bindings, owner, provider, definition.ProcessKey); !found {
		return "", hitError(identity, model.GenericErrRuntimeInvariantFailed, "empowered attack requires its complete compiled own result binding", definition.Path, use)
	}
	for index := 0; index < windows.EmpoweredWindowCount(); index++ {
		current := windows.EmpoweredWindowAt(index)
		if current.Owner() == owner && current.Status() == "active" && (definition.Steps[0].MaximumAttackCount > 0 || current.HasEmpoweredWindow()) {
			return "empowered_window_already_active", nil
		}
	}
	return "", nil
}

// EnterEmpoweredWindow 在原开始时点核对安全期限并暂存等待，不建立计时事件。
func EnterEmpoweredWindow(changes *actionpkg.ProcessChangeSet, step planbundle.CompiledProcessStep, value float64, nowMs, maxSafe int64, identity Identity) *model.EngineError {
	deadline, valid := actionpkg.ProcessTimeAfter(nowMs, value, false)
	if !valid || deadline > maxSafe {
		return hitError(identity, model.GenericErrRuntimeInvariantFailed, "empowered window requires a positive safe integer deadline", step.Path+".windowMs", changes.View().UseKey())
	}
	changes.EnterEmpowered(step, nowMs, deadline)
	return nil
}
