package xyz.game.datamanage.service.skillparameter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import xyz.game.datamanage.model.skillparameter.SkillParameterValueType;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class SkillParameterLevelService {

    private static final Pattern LEVEL_KEY_PATTERN = Pattern.compile("[1-9][0-9]*");
    private static final TypeReference<LinkedHashMap<String, BigDecimal>> LEVEL_MAP_TYPE =
        new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    public SkillParameterLevelService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, BigDecimal> validateCompleteMap(
        Map<String, BigDecimal> levelValues,
        int minLevel,
        int maxLevel,
        SkillParameterValueType valueType,
        String fieldPrefix
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (levelValues == null) {
            issues.add(fieldIssue(fieldPrefix, "REQUIRED", "等级取值不能为空"));
            throwValidation(issues);
        }

        Map<String, BigDecimal> expected = expectedLevels(minLevel, maxLevel);
        for (Map.Entry<String, BigDecimal> entry : levelValues.entrySet()) {
            String key = entry.getKey();
            String path = fieldPrefix + "/" + key;
            if (key == null || !LEVEL_KEY_PATTERN.matcher(key).matches()) {
                issues.add(fieldIssue(path, "LEVEL_KEY_INVALID", "等级键格式不合法"));
                continue;
            }
            if (!expected.containsKey(key)) {
                issues.add(fieldIssue(path, "LEVEL_EXTRA", "存在超出当前等级范围的键"));
                continue;
            }
            if (entry.getValue() == null) {
                issues.add(fieldIssue(path, "NUMBER_REQUIRED", "等级值必须是数字"));
                continue;
            }
            if (valueType == SkillParameterValueType.INTEGER && !isInteger(entry.getValue())) {
                issues.add(fieldIssue(path, "INTEGER_REQUIRED", "该参数只允许整数"));
            }
        }
        for (String expectedKey : expected.keySet()) {
            if (!levelValues.containsKey(expectedKey)) {
                issues.add(fieldIssue(
                    fieldPrefix + "/" + expectedKey,
                    "LEVEL_MISSING",
                    "缺少当前等级范围内的键"
                ));
            }
        }
        throwValidation(issues);

        Map<String, BigDecimal> normalized = new LinkedHashMap<>();
        for (String key : expected.keySet()) {
            normalized.put(key, levelValues.get(key));
        }
        return normalized;
    }

    public void validateFixedValue(
        BigDecimal fixedValue,
        SkillParameterValueType valueType,
        String field
    ) {
        List<Map<String, String>> issues = new ArrayList<>();
        if (fixedValue == null) {
            issues.add(fieldIssue(field, "REQUIRED", "固定值不能为空"));
        } else if (valueType == SkillParameterValueType.INTEGER && !isInteger(fixedValue)) {
            issues.add(fieldIssue(field, "INTEGER_REQUIRED", "该参数只允许整数"));
        }
        throwValidation(issues);
    }

    public Map<String, BigDecimal> remap(
        Map<String, BigDecimal> previous,
        int minLevel,
        int maxLevel
    ) {
        Map<String, BigDecimal> result = new LinkedHashMap<>();
        for (int level = minLevel; level <= maxLevel; level++) {
            String key = Integer.toString(level);
            BigDecimal value = previous == null ? null : previous.get(key);
            result.put(key, value != null ? value : BigDecimal.ZERO);
        }
        return result;
    }

    public boolean isSameRange(Integer oldMin, Integer oldMax, int newMin, int newMax) {
        return oldMin != null
            && oldMax != null
            && oldMin == newMin
            && oldMax == newMax;
    }

    public Map<String, BigDecimal> parseLevelValuesJson(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            Map<String, BigDecimal> parsed = objectMapper.readValue(json, LEVEL_MAP_TYPE);
            return parsed == null ? Map.of() : parsed;
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Stored skill parameter levelValues are not valid JSON", ex);
        }
    }

    public String toLevelValuesJson(Map<String, BigDecimal> levelValues) {
        if (levelValues == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(levelValues);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialize skill parameter levelValues", ex);
        }
    }

    public static boolean isInteger(BigDecimal value) {
        return value != null && value.stripTrailingZeros().scale() <= 0;
    }

    public static Map<String, BigDecimal> expectedLevels(int minLevel, int maxLevel) {
        Map<String, BigDecimal> levels = new LinkedHashMap<>();
        for (int level = minLevel; level <= maxLevel; level++) {
            levels.put(Integer.toString(level), null);
        }
        return levels;
    }

    private static void throwValidation(List<Map<String, String>> issues) {
        if (!issues.isEmpty()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "技能参数不合法",
                Map.of("fieldIssues", List.copyOf(issues))
            );
        }
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
