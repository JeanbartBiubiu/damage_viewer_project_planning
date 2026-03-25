package xyz.game.datamanage.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.lettuce.core.ClientOptions;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.data.redis.LettuceClientOptionsBuilderCustomizer;
import org.springframework.boot.autoconfigure.data.redis.RedisProperties;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

class RedisLettuceConfigTest {

    @Test
    void clientOptionsCustomizerEnablesReconnectAndKeepAlive() {
        RedisProperties redisProperties = new RedisProperties();
        redisProperties.setConnectTimeout(Duration.ofSeconds(2));

        AppRedisProperties appRedisProperties = new AppRedisProperties();
        RedisLettuceConfig config = new RedisLettuceConfig();

        LettuceClientOptionsBuilderCustomizer customizer =
            config.lettuceClientOptionsBuilderCustomizer(redisProperties, appRedisProperties);

        ClientOptions.Builder builder = ClientOptions.builder();
        customizer.customize(builder);
        ClientOptions clientOptions = builder.build();

        assertThat(clientOptions.isAutoReconnect()).isTrue();
        assertThat(clientOptions.isPingBeforeActivateConnection()).isTrue();
        assertThat(clientOptions.getSocketOptions().getConnectTimeout()).isEqualTo(Duration.ofSeconds(2));
        assertThat(clientOptions.getSocketOptions().isTcpNoDelay()).isTrue();
        assertThat(clientOptions.getSocketOptions().getKeepAlive().isEnabled()).isTrue();
        assertThat(clientOptions.getSocketOptions().getKeepAlive().getIdle()).isEqualTo(appRedisProperties.getKeepAliveIdle());
        assertThat(clientOptions.getSocketOptions().getKeepAlive().getInterval()).isEqualTo(appRedisProperties.getKeepAliveInterval());
        assertThat(clientOptions.getSocketOptions().getKeepAlive().getCount()).isEqualTo(appRedisProperties.getKeepAliveProbeCount());
    }

    @Test
    void beanPostProcessorEnablesSharedConnectionValidation() {
        RedisLettuceConfig config = new RedisLettuceConfig();
        BeanPostProcessor beanPostProcessor = config.lettuceConnectionFactoryBeanPostProcessor();
        LettuceConnectionFactory connectionFactory = new LettuceConnectionFactory("localhost", 6379);

        assertThat(connectionFactory.getValidateConnection()).isFalse();

        beanPostProcessor.postProcessBeforeInitialization(connectionFactory, "redisConnectionFactory");

        assertThat(connectionFactory.getValidateConnection()).isTrue();
    }
}
