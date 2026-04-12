package xyz.game.enginev2demo.pipeline;

import xyz.game.enginev2demo.runtime.ActorRuntime;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 伤害管线执行上下文，捆绑当前全局状态和双方角色引用。
 */
public record PipelineContext(
        RuntimeState state,
        ActorRuntime source,
        ActorRuntime target) {
}
