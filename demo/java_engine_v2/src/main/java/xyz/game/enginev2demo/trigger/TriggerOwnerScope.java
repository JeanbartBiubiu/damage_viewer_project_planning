package xyz.game.enginev2demo.trigger;

/**
 * 触发订阅归属作用域——决定订阅注册在哪个对象上。
 */
public enum TriggerOwnerScope {
    /** 角色模板级订阅。 */
    ACTOR,
    /** 装备级订阅，只有装备了该物品的角色才会匹配。 */
    ITEM,
    /** 动作级订阅，仅包含该动作的角色施放时匹配。 */
    ACTION,
    /** 状态级订阅，仅当角色持有该状态时匹配。 */
    STATUS
}
