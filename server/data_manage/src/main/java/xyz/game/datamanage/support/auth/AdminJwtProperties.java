package xyz.game.datamanage.support.auth;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.auth.jwt")
public class AdminJwtProperties {

    private String es256PublicKeyPem;
    private Duration expLeeway = Duration.ofSeconds(30);

    public String getEs256PublicKeyPem() {
        return es256PublicKeyPem;
    }

    public void setEs256PublicKeyPem(String es256PublicKeyPem) {
        this.es256PublicKeyPem = es256PublicKeyPem;
    }

    public Duration getExpLeeway() {
        return expLeeway;
    }

    public void setExpLeeway(Duration expLeeway) {
        this.expLeeway = expLeeway;
    }
}
