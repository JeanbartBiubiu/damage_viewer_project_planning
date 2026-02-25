package xyz.game.datamanage.config;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.startup.fail-fast", havingValue = "true", matchIfMissing = true)
public class StartupDependencyVerifier implements ApplicationRunner {

    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;

    public StartupDependencyVerifier(DataSource dataSource, StringRedisTemplate redisTemplate) {
        this.dataSource = dataSource;
        this.redisTemplate = redisTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        verifyPostgres();
        verifyRedis();
    }

    private void verifyPostgres() {
        try (Connection connection = dataSource.getConnection()) {
            if (!connection.isValid(2)) {
                throw new IllegalStateException("PostgreSQL validation failed during startup");
            }
        } catch (SQLException ex) {
            throw new IllegalStateException("PostgreSQL is unavailable or configuration is invalid", ex);
        }
    }

    private void verifyRedis() {
        try {
            String pong = redisTemplate.execute(RedisConnection::ping);
            if (pong == null || !"PONG".equalsIgnoreCase(pong)) {
                throw new IllegalStateException("Redis PING failed during startup");
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Redis is unavailable or configuration is invalid", ex);
        }
    }
}
