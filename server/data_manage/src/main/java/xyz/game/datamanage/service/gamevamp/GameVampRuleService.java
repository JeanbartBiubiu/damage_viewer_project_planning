package xyz.game.datamanage.service.gamevamp;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.model.gamevamp.GameVampRule;
import xyz.game.datamanage.model.gamevamp.GameVampRules;
import xyz.game.datamanage.support.authoring.AggregateJson;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.authoring.GameVampRuleSemantics;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class GameVampRuleService {
    private final JdbcTemplate jdbc;
    private final GamesMapper games;
    private final GameConfigurationWriteGuard writes;

    public GameVampRuleService(JdbcTemplate jdbc, GamesMapper games, GameConfigurationWriteGuard writes) {
        this.jdbc = jdbc; this.games = games; this.writes = writes;
    }

    @Transactional(readOnly = true)
    public GameVampRules get(String gameId) {
        requireGame(gameId);
        return new GameVampRules(GameVampRuleSemantics.readRules(jdbc, gameId));
    }

    @Transactional
    public GameVampRules replace(String gameId, GameVampRules request) {
        writes.begin(gameId);
        requireGame(gameId);
        List<Map<String, String>> issues = new ArrayList<>();
        GameVampRuleSemantics.validateRules(request == null ? null : request.rules(),
            GameVampRuleSemantics.attributeTypes(jdbc, gameId),
            new HashSet<>(jdbc.queryForList(GameVampRuleSemantics.CATEGORIES_SQL, String.class, gameId)), issues);
        if (!issues.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED",
            "游戏吸血规则不合法", Map.of("fieldIssues", issues));
        jdbc.update("DELETE FROM public.game_vamp_rules WHERE game_id = ?", gameId);
        for (GameVampRule rule : request.rules()) {
            jdbc.update(INSERT_SQL, gameId, rule.vampType().name(), rule.sourceAttributeKey(),
                rule.basisOutputKind().name(), rule.defaultEfficiency(), AggregateJson.write(rule.deliveryKinds()),
                AggregateJson.write(rule.originKinds()), AggregateJson.write(rule.skillCategoryKeys()));
        }
        return new GameVampRules(GameVampRuleSemantics.readRules(jdbc, gameId));
    }

    private void requireGame(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count == 0) throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND",
            "游戏不存在", Map.of("gameId", gameId == null ? "" : gameId));
    }

    static final String INSERT_SQL = """
        INSERT INTO public.game_vamp_rules (game_id, vamp_type, source_attribute_key, basis_output_kind,
            default_efficiency, delivery_kinds, origin_kinds, skill_category_keys)
        VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
        """;
}
