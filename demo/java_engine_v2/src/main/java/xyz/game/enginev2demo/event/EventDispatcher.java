package xyz.game.enginev2demo.event;

import xyz.game.enginev2demo.action.ActionExecutor;
import xyz.game.enginev2demo.command.EngineCommandExecutor;
import xyz.game.enginev2demo.runtime.RuntimeState;

/**
 * 中央事件分发器——从事件队列取出的 {@link ScheduledEvent}
 * 最终都由这里根据 payload 类型分派到对应的执行器。
 */
public final class EventDispatcher {

    private final ActionExecutor actionExecutor;
    private final EngineCommandExecutor engineCommandExecutor;

    public EventDispatcher(ActionExecutor actionExecutor, EngineCommandExecutor engineCommandExecutor) {
        this.actionExecutor = actionExecutor;
        this.engineCommandExecutor = engineCommandExecutor;
    }

    public void dispatch(RuntimeState state, ScheduledEvent scheduledEvent) {
        InternalEvent payload = scheduledEvent.payload();
        if (payload instanceof InternalEvent.ActionCast actionCast) {
            actionExecutor.execute(state, actionCast);
            return;
        }
        if (payload instanceof InternalEvent.StatusExpire statusExpire) {
            engineCommandExecutor.expireStatus(state, statusExpire.actorId(), statusExpire.statusId(), statusExpire.appliedAtMs());
            return;
        }
        throw new IllegalStateException("unsupported event payload: " + payload);
    }
}
