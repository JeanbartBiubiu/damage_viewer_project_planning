package xyz.game.datamanage.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.ConfigurableApplicationContext;

class StartupDependencyVerifierTest {

    @Test
    void defaultStartupRunsThePostgresCheckWithOnlyADataSource() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(true);

        try (ConfigurableApplicationContext context = start(dataSource)) {
            assertSame(dataSource, context.getBean(DataSource.class));
            assertEquals(1, context.getBeansOfType(StartupDependencyVerifier.class).size());
            verify(connection).isValid(2);
            verify(connection).close();
        }
    }

    @Test
    void explicitlyEnabledStartupStillChecksPostgres() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(true);

        try (ConfigurableApplicationContext context = start(dataSource, "--app.startup.fail-fast=true")) {
            assertEquals(1, context.getBeansOfType(StartupDependencyVerifier.class).size());
            verify(connection).isValid(2);
            verify(connection).close();
        }
    }

    @Test
    void disabledStartupDoesNotAcquireADatabaseConnection() {
        DataSource dataSource = mock(DataSource.class);

        try (ConfigurableApplicationContext context = start(dataSource, "--app.startup.fail-fast=false")) {
            assertFalse(context.containsBean("startupDependencyVerifier"));
            verifyNoInteractions(dataSource);
        }
    }

    @Test
    void invalidPostgresConnectionFailsStartupAndIsClosed() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(false);

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> start(dataSource));

        assertEquals("PostgreSQL validation failed during startup", failure.getMessage());
        verify(connection).close();
    }

    @Test
    void unavailablePostgresFailsStartupWithTheOriginalDatabaseCause() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        SQLException databaseFailure = new SQLException("isolated database failure");
        when(dataSource.getConnection()).thenThrow(databaseFailure);

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> start(dataSource));

        assertEquals("PostgreSQL is unavailable or configuration is invalid", failure.getMessage());
        assertSame(databaseFailure, failure.getCause());
    }

    @Test
    void postgresValidationErrorFailsStartupAndClosesTheConnection() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        SQLException databaseFailure = new SQLException("isolated validation failure");
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenThrow(databaseFailure);

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> start(dataSource));

        assertSame(databaseFailure, failure.getCause());
        verify(connection).close();
    }

    private static ConfigurableApplicationContext start(DataSource dataSource, String... properties) {
        SpringApplication application = new SpringApplication(StartupDependencyVerifier.class);
        application.setWebApplicationType(WebApplicationType.NONE);
        application.setBannerMode(Banner.Mode.OFF);
        application.setLogStartupInfo(false);
        application.setRegisterShutdownHook(false);
        application.addInitializers(context -> context.getBeanFactory().registerSingleton("dataSource", dataSource));
        String[] args = new String[properties.length + 1];
        args[0] = "--spring.config.location=optional:classpath:/redis-removal-isolated-test.yml";
        System.arraycopy(properties, 0, args, 1, properties.length);
        return application.run(args);
    }
}
