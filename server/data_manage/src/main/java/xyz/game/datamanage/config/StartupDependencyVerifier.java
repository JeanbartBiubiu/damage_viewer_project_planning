package xyz.game.datamanage.config;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.startup.fail-fast", havingValue = "true", matchIfMissing = true)
public class StartupDependencyVerifier implements ApplicationRunner {

    private final DataSource dataSource;

    public StartupDependencyVerifier(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void run(ApplicationArguments args) {
        verifyPostgres();
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
}
