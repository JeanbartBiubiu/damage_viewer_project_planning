package xyz.game.datamanage.support.authoring;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.util.List;

/** 技能组成的业务 JSON 编解码；数值保持十进制精度。 */
public final class AggregateJson {
    private static final ObjectMapper MAPPER = JsonMapper.builder()
        .findAndAddModules()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .build();

    private AggregateJson() {}

    public static String write(Object value) {
        if (value == null) return null;
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("技能组成无法保存为结构化数据", ex);
        }
    }

    public static <T> T read(String value, Class<T> type) {
        if (value == null) return null;
        try {
            return MAPPER.readValue(value, type);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("技能组成的结构化数据损坏", ex);
        }
    }

    public static <T> List<T> readList(String value, Class<T> type) {
        if (value == null) throw new IllegalStateException("技能组成缺少数组字段");
        try {
            return MAPPER.readValue(value, MAPPER.getTypeFactory().constructCollectionType(List.class, type));
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("技能组成的数组数据损坏", ex);
        }
    }

    public static JsonNode tree(String value) {
        if (value == null) return MAPPER.nullNode();
        try {
            return MAPPER.readTree(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("技能组成的结构化数据损坏", ex);
        }
    }
}
