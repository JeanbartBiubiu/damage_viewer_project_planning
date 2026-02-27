package xyz.game.datamanage.config;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.boot.autoconfigure.cache.RedisCacheManagerBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext.SerializationPair;

@Configuration
public class CacheConfig {

    @Bean
    public RedisCacheConfiguration redisCacheConfiguration() {
        return RedisCacheConfiguration.defaultCacheConfig()
            .disableCachingNullValues()
            .serializeValuesWith(SerializationPair.fromSerializer(new Jackson2JsonRedisSerializer<>(JsonNode.class)));
    }

    @Bean
    public RedisCacheManagerBuilderCustomizer cacheManagerBuilderCustomizer(
        RedisCacheConfiguration redisCacheConfiguration,
        AppCacheProperties appCacheProperties
    ) {
        return builder -> builder.cacheDefaults(redisCacheConfiguration.entryTtl(appCacheProperties.getTtl()));
    }
}
