package xyz.game.datamanage.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Map;
import org.apache.catalina.startup.Tomcat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationPropertiesBinding;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.embedded.tomcat.TomcatWebServer;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import xyz.game.datamanage.support.account.AccountProperties;

/** 初始化真实容器资源根目录即可复现路径绑定问题，无需监听端口或连接数据库。 */
class AccountPropertiesBindingTest {
    @TempDir Path directory;

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner(
            AnnotationConfigServletWebServerApplicationContext::new)
        .withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class))
        .withBean(TomcatServletWebServerFactory.class, AccountPropertiesBindingTest::containerWithoutConnectors)
        .withUserConfiguration(BindingConfiguration.class);

    @ParameterizedTest
    @ValueSource(strings = {"../../config/auth", "../config/auth"})
    void relativeKeyPathsBindDuringServletStartup(String parent) {
        assertPaths(contextRunner, parent + "/aead-keyset.json", parent + "/grant-private.pk8",
            parent + "/internal-token.txt", Path.of(parent));
    }

    @Test
    void absoluteKeyPathsBindWithoutRequiringFilesToExist() {
        Path parent = directory.resolve("missing private keys");
        assertThat(parent).doesNotExist();
        assertPaths(contextRunner, parent.resolve("aead-keyset.json").toString(),
            parent.resolve("grant-private.pk8").toString(), parent.resolve("internal-token.txt").toString(), parent);
    }

    @Test
    void explicitFileLocationsStillBind() {
        Path parent = directory.resolve("private keys");
        assertPaths(contextRunner, parent.resolve("aead-keyset.json").toUri().toString(),
            parent.resolve("grant-private.pk8").toUri().toString(), parent.resolve("internal-token.txt").toUri().toString(), parent);
    }

    @Test
    void environmentVariablesOverrideDefaultKeyPaths() {
        Path parent = directory.resolve("cloud keys");
        var environment = new SystemEnvironmentPropertySource("cloud-auth-paths", Map.of(
            "APP_AUTH_AEAD_KEYSET_PATH", parent.resolve("aead-keyset.json").toString(),
            "APP_AUTH_GRANT_PRIVATE_KEY_PATH", parent.resolve("grant-private.pk8").toString(),
            "APP_AUTH_INTERNAL_TOKEN_PATH", parent.resolve("internal-token.txt").toString()));
        var runner = contextRunner.withInitializer(context ->
            context.getEnvironment().getPropertySources().addFirst(environment));
        assertPaths(runner, "${APP_AUTH_AEAD_KEYSET_PATH:../../config/auth/aead-keyset.json}",
            "${APP_AUTH_GRANT_PRIVATE_KEY_PATH:../../config/auth/grant-private.pk8}",
            "${APP_AUTH_INTERNAL_TOKEN_PATH:../../config/auth/internal-token.txt}", parent);
    }

    @Test
    void invalidFilesystemPathsFailStartup() {
        contextRunner.withPropertyValues("app.auth.aead-keyset-path=invalid\0path").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseInstanceOf(InvalidPathException.class);
        });
    }

    private void assertPaths(ApplicationContextRunner runner, String aead, String grant, String token, Path parent) {
        runner.withPropertyValues("app.auth.aead-keyset-path=" + aead,
            "app.auth.grant-private-key-path=" + grant, "app.auth.internal-token-path=" + token).run(context -> {
                assertThat(context).hasNotFailed();
                var properties = context.getBean(AccountProperties.class);
                assertThat(properties.getAeadKeysetPath()).isEqualTo(parent.resolve("aead-keyset.json").normalize());
                assertThat(properties.getGrantPrivateKeyPath()).isEqualTo(parent.resolve("grant-private.pk8").normalize());
                assertThat(properties.getInternalTokenPath()).isEqualTo(parent.resolve("internal-token.txt").normalize());
            });
    }

    private static TomcatServletWebServerFactory containerWithoutConnectors() {
        return new TomcatServletWebServerFactory(-1) {
            @Override
            protected TomcatWebServer getTomcatWebServer(Tomcat tomcat) {
                return new TomcatWebServer(tomcat, false) {
                    // 属性绑定发生在容器初始化阶段，后续无需启动网络连接器。
                    @Override public void start() {}
                };
            }
        };
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AccountProperties.class)
    @ComponentScan(basePackageClasses = WebCorsConfig.class, useDefaultFilters = false,
        includeFilters = @ComponentScan.Filter(ConfigurationPropertiesBinding.class))
    static class BindingConfiguration {}
}
