package xyz.game.datamanage.model.value;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonMappingException;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.Set;

/** 从原始数值令牌读取十进制，避免 HTTP 树读取先经过 double。 */
public final class SkillNumericValueDeserializer extends JsonDeserializer<SkillNumericValue> {
    @Override public SkillNumericValue deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (!parser.isExpectedStartObjectToken()) throw invalid(parser);
        Set<String> fields = new HashSet<>();
        String kind = null, parameter = null, formula = null;
        BigDecimal value = null;
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            if (parser.currentToken() != JsonToken.FIELD_NAME) throw invalid(parser);
            String field = parser.currentName();
            if (!fields.add(field)) throw invalid(parser);
            JsonToken token = parser.nextToken();
            switch (field) {
                case "kind", "parameterKey", "formulaKey" -> {
                    if (token != JsonToken.VALUE_STRING) throw invalid(parser);
                    String text = parser.getText();
                    if (field.equals("kind")) kind = text;
                    if (field.equals("parameterKey")) parameter = text;
                    if (field.equals("formulaKey")) formula = text;
                }
                case "value" -> {
                    if (token != JsonToken.VALUE_NUMBER_INT && token != JsonToken.VALUE_NUMBER_FLOAT) throw invalid(parser);
                    value = parser.getDecimalValue();
                }
                default -> throw invalid(parser);
            }
        }
        if (fields.size() != 2 || !fields.contains("kind")) throw invalid(parser);
        try { return new SkillNumericValue(SkillNumericValue.Kind.valueOf(kind), value, parameter, formula); }
        catch (IllegalArgumentException | NullPointerException ex) { throw invalid(parser); }
    }
    private static JsonMappingException invalid(JsonParser parser) {
        return JsonMappingException.from(parser, "数值取值必须是字段严格互斥的固定值、参数或公式对象");
    }
}
