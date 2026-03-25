package xyz.game.datamanage.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.redis")
public class AppRedisProperties {

    private Duration keepAliveIdle = Duration.ofSeconds(60);

    private Duration keepAliveInterval = Duration.ofSeconds(15);

    private int keepAliveProbeCount = 3;

    public Duration getKeepAliveIdle() {
        return keepAliveIdle;
    }

    public void setKeepAliveIdle(Duration keepAliveIdle) {
        this.keepAliveIdle = keepAliveIdle;
    }

    public Duration getKeepAliveInterval() {
        return keepAliveInterval;
    }

    public void setKeepAliveInterval(Duration keepAliveInterval) {
        this.keepAliveInterval = keepAliveInterval;
    }

    public int getKeepAliveProbeCount() {
        return keepAliveProbeCount;
    }

    public void setKeepAliveProbeCount(int keepAliveProbeCount) {
        this.keepAliveProbeCount = keepAliveProbeCount;
    }
}
