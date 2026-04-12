package xyz.game.enginev2demo.api;

import java.util.List;
import java.util.Objects;

/**
 * 单次引擎模拟的运行输入。
 *
 * @param seed           随机种子（当前 demo 未使用，预留确定性回放）
 * @param stopCondition  停止条件
 * @param self           "自己" 一方的角色初始化参数
 * @param enemy          "敌方" 一方的角色初始化参数
 * @param initialActions 模拟开始时入队的动作请求列表
 */
public record EngineRunInput(
        long seed,
        StopCondition stopCondition,
        CombatantRunInit self,
        CombatantRunInit enemy,
        List<ActionRequest> initialActions) {

    public EngineRunInput {
        Objects.requireNonNull(stopCondition, "stopCondition");
        Objects.requireNonNull(self, "self");
        Objects.requireNonNull(enemy, "enemy");
        initialActions = List.copyOf(initialActions);
    }
}
