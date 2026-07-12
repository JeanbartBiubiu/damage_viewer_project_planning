package xyz.game.datamanage.service.combatdata.revision;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GameDataStateMapper;
import xyz.game.datamanage.support.error.ApiException;

/**
 * Revision 状态读写边界：锁定/初始化 game_data_state，并在一次事务内递增一次 current_revision。
 * 不改动旧 publish / Admin / Public API。
 */
@Service
public class GameDataRevisionService {

    private final GameDataStateMapper gameDataStateMapper;

    public GameDataRevisionService(GameDataStateMapper gameDataStateMapper) {
        this.gameDataStateMapper = gameDataStateMapper;
    }

    @Transactional(readOnly = true)
    public GameDataStateView getState(String gameId) {
        Map<String, Object> row = gameDataStateMapper.findByGameId(requireGameId(gameId));
        if (row == null || row.isEmpty()) {
            throw notFound(gameId);
        }
        return toView(row);
    }

    @Transactional(readOnly = true)
    public long getCurrentRevision(String gameId) {
        return getState(gameId).currentRevision();
    }

    @Transactional(readOnly = true)
    public long getPublishedRevision(String gameId) {
        return getState(gameId).publishedRevision();
    }

    /**
     * 确保 state 行存在；已存在则不变。返回锁定后的状态快照。
     */
    @Transactional
    public GameDataStateView ensureInitialized(String gameId) {
        String id = requireGameId(gameId);
        gameDataStateMapper.insertInitialState(id);
        Map<String, Object> locked = gameDataStateMapper.lockByGameId(id);
        if (locked == null || locked.isEmpty()) {
            throw notFound(id);
        }
        return toView(locked);
    }

    /**
     * 锁定 state 行（SELECT ... FOR UPDATE）。调用方须已处于事务中。
     */
    @Transactional
    public GameDataStateView lockState(String gameId) {
        String id = requireGameId(gameId);
        Map<String, Object> locked = gameDataStateMapper.lockByGameId(id);
        if (locked == null || locked.isEmpty()) {
            gameDataStateMapper.insertInitialState(id);
            locked = gameDataStateMapper.lockByGameId(id);
        }
        if (locked == null || locked.isEmpty()) {
            throw notFound(id);
        }
        return toView(locked);
    }

    /**
     * 一次 PUT 事务契约：先锁定，再递增恰好一次 current_revision，并返回新 revision。
     */
    @Transactional
    public long nextRevision(String gameId) {
        lockState(gameId);
        Long revision = gameDataStateMapper.incrementCurrentRevision(
            requireGameId(gameId),
            Timestamp.from(Instant.now())
        );
        if (revision == null || revision <= 0) {
            throw new ApiException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "revision_increment_failed",
                "Failed to increment change_revision for gameId=" + gameId
            );
        }
        return revision;
    }

    /**
     * 发布链路辅助：在已锁定 state 的前提下写入 published_revision。
     * 本切片不接入旧 publish；仅提供基础写入能力。
     */
    @Transactional
    public void markPublished(String gameId, long publishedRevision) {
        String id = requireGameId(gameId);
        GameDataStateView locked = lockState(id);
        if (publishedRevision < 0 || publishedRevision > locked.currentRevision()) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_published_revision",
                "publishedRevision must be between 0 and currentRevision",
                Map.of(
                    "gameId", id,
                    "publishedRevision", publishedRevision,
                    "currentRevision", locked.currentRevision()
                )
            );
        }
        int updated = gameDataStateMapper.updatePublishedRevision(
            id,
            publishedRevision,
            Timestamp.from(Instant.now())
        );
        if (updated != 1) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "published_revision_update_conflict",
                "Unable to update published_revision for gameId=" + id
            );
        }
    }

    private static String requireGameId(String gameId) {
        if (gameId == null || gameId.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_game_id", "gameId is required");
        }
        return gameId;
    }

    private static ApiException notFound(String gameId) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "game_data_state_not_found",
            "game_data_state not found for gameId=" + gameId,
            Map.of("gameId", gameId)
        );
    }

    private static GameDataStateView toView(Map<String, Object> row) {
        return new GameDataStateView(
            Objects.toString(row.get("gameId"), null),
            toLong(row.get("currentRevision")),
            toLong(row.get("publishedRevision")),
            row.get("updatedAt")
        );
    }

    private static long toLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value == null) {
            return 0L;
        }
        return Long.parseLong(value.toString());
    }

    public record GameDataStateView(
        String gameId,
        long currentRevision,
        long publishedRevision,
        Object updatedAt
    ) {
    }
}
