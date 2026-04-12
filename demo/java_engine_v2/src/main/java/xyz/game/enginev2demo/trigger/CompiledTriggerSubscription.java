package xyz.game.enginev2demo.trigger;

/**
 * 编译后的触发订阅——在 {@link TriggerIndex} 中索引，封装了所有者范围、
 * 所有者 ID 和订阅定义。
 *
 * @param ownerScope   订阅归属作用域
 * @param ownerId      归属对象 ID（templateId / actionId / itemId / statusId）
 * @param subscription 关联的订阅定义
 */
public record CompiledTriggerSubscription(
        TriggerOwnerScope ownerScope,
        String ownerId,
        TriggerSubscriptionDef subscription) {
}
