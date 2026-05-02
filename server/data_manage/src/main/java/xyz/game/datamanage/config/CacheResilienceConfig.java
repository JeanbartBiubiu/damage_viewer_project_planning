package xyz.game.datamanage.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class CacheResilienceConfig {

    private static final Logger LOG = LoggerFactory.getLogger(CacheResilienceConfig.class);

    @Bean
    public CacheErrorHandler cacheErrorHandler() {
        return new CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException exception, Cache cache, Object key) {
                log("GET", exception, cache, key);
            }

            @Override
            public void handleCachePutError(RuntimeException exception, Cache cache, Object key, Object value) {
                log("PUT", exception, cache, key);
            }

            @Override
            public void handleCacheEvictError(RuntimeException exception, Cache cache, Object key) {
                log("EVICT", exception, cache, key);
            }

            @Override
            public void handleCacheClearError(RuntimeException exception, Cache cache) {
                log("CLEAR", exception, cache, "<all>");
            }

            private void log(String op, RuntimeException exception, Cache cache, Object key) {
                String cacheName = cache == null ? "<null>" : cache.getName();
                LOG.warn("Cache {} failed. cache={}, key={}", op, cacheName, key, exception);
            }
        };
    }
}

