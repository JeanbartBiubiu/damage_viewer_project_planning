package xyz.game.datamanage.model.equipment;

import java.math.BigDecimal;
import xyz.game.datamanage.model.attribute.AttributeValueType;

public record EquipmentAttributeDefinition(
    String attributeKey,
    AttributeValueType valueType,
    BigDecimal minValue,
    BigDecimal maxValue
) {
}
