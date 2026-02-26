package xyz.game.datamanage.config;

import org.springframework.boot.autoconfigure.cache.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;

@Configuration
public class CacheConfig {

    @Bean
    public RedisCacheConfiguration redisCacheConfiguration() {
        return RedisCacheConfiguration.defaultCacheConfig()
            .disableCachingNullValues()
            .serializeValuesWith(SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer()));
    }

    @Bean
    public RedisCacheManagerBuilderCustomizer cacheManagerBuilderCustomizer(
        RedisCacheConfiguration redisCacheConfiguration,
        AppCacheProperties appCacheProperties
    ) {
        return builder ->
            builder
                .withCacheConfiguration(
                    "currentVersion",
                    redisCacheConfiguration.entryTtl(appCacheProperties.getPublishedTtl())
                )
                .withCacheConfiguration(
                    "bundle",
                    redisCacheConfiguration.entryTtl(appCacheProperties.getPublishedTtl())
                );
    }
}
