package xyz.game.enginev2demo;

import xyz.game.enginev2demo.compile.CompiledSnapshot;
import xyz.game.enginev2demo.event.EventDispatcher;

/**
 * 引擎会话——{@code init()} 阶段的产物，持有编译快照和事件分发器。
 * 同一份 session 可复用于多次 run。
 */
public record EngineSession(
        CompiledSnapshot compiledSnapshot,
        EventDispatcher eventDispatcher) {
}
