package xyz.game.datamanage.config;

import io.lettuce.core.SocketOptions;
import java.time.Duration;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.data.redis.LettuceClientOptionsBuilderCustomizer;
import org.springframework.boot.autoconfigure.data.redis.RedisProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

@Configuration
public class RedisLettuceConfig {

    private static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(2);

    @Bean
    public LettuceClientOptionsBuilderCustomizer lettuceClientOptionsBuilderCustomizer(
        RedisProperties redisProperties,
        AppRedisProperties appRedisProperties
    ) {
        return clientOptionsBuilder -> {
            Duration connectTimeout = redisProperties.getConnectTimeout() != null
                ? redisProperties.getConnectTimeout()
                : DEFAULT_CONNECT_TIMEOUT;

            SocketOptions socketOptions = SocketOptions.builder()
                .connectTimeout(connectTimeout)
                .keepAlive(
                    SocketOptions.KeepAliveOptions.builder()
                        .enable()
                        .idle(appRedisProperties.getKeepAliveIdle())
                        .interval(appRedisProperties.getKeepAliveInterval())
                        .count(appRedisProperties.getKeepAliveProbeCount())
                        .build()
                )
                .tcpNoDelay(true)
                .build();

            clientOptionsBuilder
                .autoReconnect(true)
                .pingBeforeActivateConnection(true)
                .socketOptions(socketOptions);
        };
    }

    @Bean
    public BeanPostProcessor lettuceConnectionFactoryBeanPostProcessor() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessBeforeInitialization(Object bean, String beanName) {
                if (bean instanceof LettuceConnectionFactory lettuceConnectionFactory) {
                    // Shared native connections stay open for a long time in this service.
                    // Validate before reuse so the first request after idle can rebuild a dead socket.
                    lettuceConnectionFactory.setValidateConnection(true);
                }
                return bean;
            }
        };
    }
}
