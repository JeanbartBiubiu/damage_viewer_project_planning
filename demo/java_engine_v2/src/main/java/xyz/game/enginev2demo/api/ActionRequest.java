package xyz.game.enginev2demo.api;

import java.util.Objects;

/**
 * 一条初始动作请求，在模拟开始时加入事件队列。
 *
 * @param triggerAtMs    动作触发的模拟时间（毫秒）
 * @param sourceActorId  施放者 actorId
 * @param targetActorId  目标 actorId
 * @param actionId       引用的动作模板 ID
 */
public record ActionRequest(
        long triggerAtMs,
        String sourceActorId,
        String targetActorId,
        String actionId) {

    public ActionRequest {
        if (triggerAtMs < 0) {
            throw new IllegalArgumentException("triggerAtMs must be >= 0");
        }
        Objects.requireNonNull(sourceActorId, "sourceActorId");
        Objects.requireNonNull(targetActorId, "targetActorId");
        Objects.requireNonNull(actionId, "actionId");
    }
}
