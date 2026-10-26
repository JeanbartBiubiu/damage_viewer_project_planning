package execution

import actionpkg "tinygo_engine_v2/internal/runtime/action"

// 同步过程执行上下文属于执行层；行动过程只保留稳定使用身份。
// 栈只在同步启动期间有效，后续计时事件不会继承原执行收集器。
type processExecutionContext struct {
	useKey    string
	depth     int
	collector *eventCopyableCollector
}

// 常见同步层次内联保存，避免每场仅为转移收集器分配切片。
type processExecutionStack struct {
	inline [2]processExecutionContext
	extra  []processExecutionContext
	count  int
}

func (s *processExecutionStack) push(context processExecutionContext) {
	if s.count < len(s.inline) {
		s.inline[s.count] = context
	} else {
		s.extra = append(s.extra, context)
	}
	s.count++
}

func (s *processExecutionStack) pop() {
	s.count--
	if s.count < len(s.inline) {
		s.inline[s.count] = processExecutionContext{}
	} else {
		last := len(s.extra) - 1
		s.extra[last] = processExecutionContext{}
		s.extra = s.extra[:last]
	}
}

func (s *Engine) processExecution(useKey string) (int, *eventCopyableCollector) {
	for index := s.processExecutions.count - 1; index >= 0; index-- {
		var context processExecutionContext
		if index < len(s.processExecutions.inline) {
			context = s.processExecutions.inline[index]
		} else {
			context = s.processExecutions.extra[index-len(s.processExecutions.inline)]
		}
		if context.useKey == useKey {
			return context.depth, context.collector
		}
	}
	return 0, nil
}

func (s *Engine) processForUse(use *skillUseRuntime) *actionpkg.ProcessView {
	if use == nil {
		return nil
	}
	return s.actions.Process(use.identity.ProcessReference())
}
