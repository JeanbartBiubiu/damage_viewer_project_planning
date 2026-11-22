package xyz.game.datamanage.support.auth;

public record AuthContext(java.util.UUID accountId, String username,
                          java.util.UUID sessionId, long authEpoch, java.time.Instant expiresAt) {
}
