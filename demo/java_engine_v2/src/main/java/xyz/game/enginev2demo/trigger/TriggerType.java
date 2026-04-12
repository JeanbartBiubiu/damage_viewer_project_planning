package xyz.game.enginev2demo.trigger;

/**
 * 触发事件类型——闭了引擎支持的所有触发点。
 */
public enum TriggerType {
    /** 动作成功施放后、伤害管线入入前。 */
    ON_ACTION_CAST,
    /** 伤害管线结算后——施放者角度。 */
    ON_DAMAGE_DEALT,
    /** 伤害管线结算后——承受者角度。 */
    ON_DAMAGE_TAKEN,
    /** 状态被挂载到角色时。 */
    ON_STATUS_APPLIED,
    /** 状态过期被移除时。 */
    ON_STATUS_EXPIRED,
    /** 计数器达到阈值时。 */
    ON_COUNTER_THRESHOLD,
    /** 标记被施加时。 */
    ON_MARK_APPLIED,
    /** 标记被消耗时。 */
    ON_MARK_CONSUMED
}
