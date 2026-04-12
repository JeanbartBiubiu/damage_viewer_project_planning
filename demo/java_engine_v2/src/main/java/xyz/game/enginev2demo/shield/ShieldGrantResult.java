package xyz.game.enginev2demo.shield;

/**
 * 护盾授予结果——用于记录并输出护盾变刻。
 *
 * @param requestedAmount 请求护盾量
 * @param shieldBefore    授予前的护盾量
 * @param shieldAfter     授予后的护盾量
 */
public record ShieldGrantResult(
        double requestedAmount,
        double shieldBefore,
        double shieldAfter) {
}
