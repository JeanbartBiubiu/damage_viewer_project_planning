package xyz.game.enginev2demo.cadence;

/**
 * 节奏修改操作类型。
 */
public enum CadenceOp {
    /** 固定毫秒数减少剩余 CD。 */
    REDUCE_REMAINING_CD_FLAT_MS,
    /** 按百分比减少剩余 CD（value 为 0-1 之间的比例）。 */
    REDUCE_REMAINING_CD_PERCENT,
    /** 重置 CD（非充能设为立即可用，充能补满并清空回充队列）。 */
    RESET_CD,
    /** 补充一层充能（仅充能动作生效）。 */
    GRANT_CHARGE,
    /** 固定毫秒数缩短所有正在恢复的回充进度。 */
    REDUCE_RECHARGE_FLAT_MS,
    /** 按百分比缩短所有正在恢复的回充进度。 */
    REDUCE_RECHARGE_PERCENT
}
