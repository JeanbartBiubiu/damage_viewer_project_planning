package xyz.game.enginev2demo.event;

/**
 * 放入中央事件队列的 payload 类型。
 */
public sealed interface InternalEvent permits InternalEvent.ActionCast, InternalEvent.StatusExpire {

    record ActionCast(
            String sourceActorId,
            String targetActorId,
            String actionId,
            CastOrigin castOrigin) implements InternalEvent {

        public ActionCast(
                String sourceActorId,
                String targetActorId,
                String actionId) {
            this(sourceActorId, targetActorId, actionId, CastOrigin.MANUAL);
        }
    }

    record StatusExpire(
            String actorId,
            String statusId,
            long appliedAtMs) implements InternalEvent {
    }
}
