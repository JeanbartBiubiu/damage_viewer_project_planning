package actionflow

import planbundle "tinygo_engine_v2/internal/plan"

// HasSimpleStepHits 判断绑定是否具有按原步骤执行的显式命中；恢复不得导入该运行事实。
func HasSimpleStepHits(definition *planbundle.CompiledProcess, binding planbundle.CompiledSkillActionBinding) bool {
	return HasSimpleProcessHitFacts(definition, binding) && binding.HitBindings[0].Moment.MomentType == "STEP_EXECUTION"
}

// HasSimpleProcessHitFacts 核对显式简单步骤或单段完成绑定，统一输出真实命中阶段。
func HasSimpleProcessHitFacts(definition *planbundle.CompiledProcess, binding planbundle.CompiledSkillActionBinding) bool {
	if len(binding.HitBindings) == 0 || binding.HitBindings[0].Moment.MomentType != "STEP_EXECUTION" && binding.HitBindings[0].Moment.MomentType != "PROCESS_COMPLETE" {
		return false
	}
	for _, step := range definition.Steps {
		if step.StepType != "IMMEDIATE" && step.StepType != "DELAY" && step.StepType != "RECAST" {
			return false
		}
	}
	return true
}
