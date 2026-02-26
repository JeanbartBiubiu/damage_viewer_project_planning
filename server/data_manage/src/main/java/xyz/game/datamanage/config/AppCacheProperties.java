package xyz.game.datamanage.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.cache")
public class AppCacheProperties {

    private Duration publishedTtl = Duration.ofHours(24);

    public Duration getPublishedTtl() {
        return publishedTtl;
    }

    public void setPublishedTtl(Duration publishedTtl) {
        this.publishedTtl = publishedTtl;
    }
}
