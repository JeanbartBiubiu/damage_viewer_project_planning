package xyz.game.datamanage.support.auth;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.auth.jwt")
public class AdminJwtProperties {

    private String hs256Secret;
    private Duration expLeeway = Duration.ofSeconds(30);

    public String getHs256Secret() {
        return hs256Secret;
    }

    public void setHs256Secret(String hs256Secret) {
        this.hs256Secret = hs256Secret;
    }

    public Duration getExpLeeway() {
        return expLeeway;
    }

    public void setExpLeeway(Duration expLeeway) {
        this.expLeeway = expLeeway;
    }
}
