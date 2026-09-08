package xyz.game.datamanage.model.imagerelation;

public enum ImageRelationSource {
    GAME("gameId", "游戏"),
    CHARACTER("characterKey", "角色"),
    ATTRIBUTE("attributeKey", "属性"),
    EQUIPMENT("equipmentKey", "装备"),
    RUNE("runeKey", "符文"),
    RUNE_PATH("pathKey", "符文分组"),
    SKILL("skillKey", "技能"),
    SKILL_EFFECT("effectKey", "技能效果"),
    STATUS("statusKey", "状态");

    private final String keyField;
    private final String label;

    ImageRelationSource(String keyField, String label) {
        this.keyField = keyField;
        this.label = label;
    }

    public String keyField() { return keyField; }
    public String label() { return label; }
}
