package xyz.game.datamanage.service.authoring;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.model.authoring.ConfigurationReferenceAuditResponse;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditReader;
import xyz.game.datamanage.support.authoring.ConfigurationReferenceAuditor;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class ConfigurationReferenceAuditService {
    private final GamesMapper games;
    private final ConfigurationReferenceAuditReader reader;

    public ConfigurationReferenceAuditService(GamesMapper games, ConfigurationReferenceAuditReader reader) {
        this.games = games;
        this.reader = reader;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ConfigurationReferenceAuditResponse audit(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count == 0)
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在", Map.of("gameId", gameId));
        return ConfigurationReferenceAuditor.audit(reader.read(gameId));
    }
}
