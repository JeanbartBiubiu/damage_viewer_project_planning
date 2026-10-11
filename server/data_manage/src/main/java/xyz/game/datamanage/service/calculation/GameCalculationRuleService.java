package xyz.game.datamanage.service.calculation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.model.calculation.GameCalculationRulesResponse;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics;
import xyz.game.datamanage.support.authoring.GameCalculationRuleSemantics.Issue;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class GameCalculationRuleService {
    private final JdbcTemplate jdbc;
    private final GamesMapper games;
    private final GameConfigurationWriteGuard writes;
    private final ObjectMapper json;

    public GameCalculationRuleService(JdbcTemplate jdbc, GamesMapper games, GameConfigurationWriteGuard writes, ObjectMapper json) {
        this.jdbc = jdbc; this.games = games; this.writes = writes; this.json = json;
    }

    @Transactional(readOnly = true)
    public GameCalculationRulesResponse get(String gameId) {
        requireGame(gameId);
        return read(gameId);
    }

    @Transactional
    public GameCalculationRulesResponse replace(String gameId, JsonNode request) {
        writes.begin(gameId);
        requireGame(gameId);
        Issue issue = GameCalculationRuleSemantics.object(request, List.of("baseDigest", "configuration"), "");
        if (issue != null) throw invalid(issue);
        JsonNode requestedDigest = request.get("baseDigest");
        if (!requestedDigest.isTextual() || !requestedDigest.textValue().matches("[0-9a-f]{64}")) {
            throw invalid(new Issue("baseDigest", "FORMAT_INVALID", "必须提供读取时的完整配置摘要"));
        }
        GameCalculationRulesResponse baseline = read(gameId);
        if (!baseline.baseDigest().equals(requestedDigest.textValue())) {
            throw new ApiException(HttpStatus.CONFLICT, "409.GAME_CALCULATION_RULES_CHANGED", "游戏计算配置已变化，请重新读取",
                Map.of("baseDigest", baseline.baseDigest(), "fieldIssues", List.of(new Issue("baseDigest", "CONFLICT", "基线摘要与当前配置不一致").details())));
        }
        JsonNode configuration = request.get("configuration");
        issue = GameCalculationRuleSemantics.validate(configuration, GameCalculationRuleSemantics.attributes(jdbc, gameId),
            GameCalculationRuleSemantics.categories(jdbc, gameId));
        if (issue != null) throw invalid(issue);
        jdbc.update(UPSERT_SQL, gameId, AggregateJson.write(configuration));
        GameCalculationRulesResponse saved = read(gameId);
        if (!digest(gameId, configuration).equals(saved.baseDigest())) {
            throw new IllegalStateException("游戏计算配置写后读回与完整候选不一致");
        }
        return saved;
    }

    private GameCalculationRulesResponse read(String gameId) {
        JsonNode configuration = GameCalculationRuleSemantics.read(jdbc, gameId);
        return new GameCalculationRulesResponse(gameId, digest(gameId, configuration), configuration);
    }

    private String digest(String gameId, JsonNode configuration) {
        ObjectNode content = json.createObjectNode().put("gameId", gameId);
        content.set("configuration", configuration == null ? json.nullNode() : configuration);
        try {
            byte[] bytes = AggregateJson.write(canonical(content)).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("无法计算游戏计算配置摘要", exception);
        }
    }

    private JsonNode canonical(JsonNode value) {
        if (value.isObject()) {
            ObjectNode result = json.createObjectNode();
            value.properties().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> result.set(entry.getKey(), canonical(entry.getValue())));
            return result;
        }
        if (value.isArray()) {
            ArrayNode result = json.createArrayNode();
            value.forEach(item -> result.add(canonical(item)));
            return result;
        }
        if (value.isNumber()) return json.getNodeFactory().numberNode(value.decimalValue().stripTrailingZeros());
        return value;
    }

    private void requireGame(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count == 0) throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在", Map.of("gameId", gameId == null ? "" : gameId));
    }

    private static ApiException invalid(Issue issue) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "游戏计算配置不合法", Map.of("fieldIssues", List.of(issue.details())));
    }

    static final String UPSERT_SQL = """
        INSERT INTO public.game_calculation_rules (game_id, configuration, updated_at)
        VALUES (?, ?::jsonb, now())
        ON CONFLICT (game_id) DO UPDATE SET configuration = EXCLUDED.configuration, updated_at = now()
        """;
}
