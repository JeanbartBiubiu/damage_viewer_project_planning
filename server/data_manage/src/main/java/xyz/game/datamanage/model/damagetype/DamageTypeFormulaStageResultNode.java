package xyz.game.datamanage.model.damagetype;

public record DamageTypeFormulaStageResultNode(
    DamageTypeFormulaNodeType nodeType,
    DamageTypeFormulaStage stageKey
) implements DamageTypeFormulaNode {

    public DamageTypeFormulaStageResultNode {
        if (nodeType == null) {
            nodeType = DamageTypeFormulaNodeType.STAGE_RESULT;
        }
    }

    public DamageTypeFormulaStageResultNode(DamageTypeFormulaStage stageKey) {
        this(DamageTypeFormulaNodeType.STAGE_RESULT, stageKey);
    }
}
