package xyz.game.datamanage.model.character;

import java.math.BigDecimal;
import xyz.game.datamanage.model.attribute.AttributeValueType;

public record CharacterAttributeDefinition(
    String attributeKey,
    AttributeValueType valueType,
    BigDecimal minValue,
    BigDecimal maxValue
) {
}
