package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.springframework.stereotype.Component;

@Component
public class MaintenanceIngress {
    public static final String PRIVATE_CONNECTOR_ATTRIBUTE = MaintenanceIngress.class.getName() + ".privateConnector";

    private final MaintenanceProperties properties;

    public MaintenanceIngress(MaintenanceProperties properties) {
        this.properties = properties;
    }

    public static boolean isPrivate(HttpServletRequest request) {
        return Boolean.TRUE.equals(request.getAttribute(PRIVATE_CONNECTOR_ATTRIBUTE));
    }

    public void require(HttpServletRequest request, boolean mutation) {
        if (!isPrivate(request)) throw MaintenanceJson.denied();

        String origin = singleHeader(request, "Origin");
        String site = singleHeader(request, "Sec-Fetch-Site");
        boolean browser = site != null || request.getHeader("Sec-Fetch-Mode") != null
            || request.getHeader("Sec-Fetch-Dest") != null || request.getHeader("Sec-Fetch-User") != null;
        if (browser && !"same-origin".equals(site)) throw MaintenanceJson.denied();
        if (origin != null && !properties.getAllowedOrigins().contains(origin)) throw MaintenanceJson.denied();
        if ((!browser || mutation) && (origin == null || !"web".equals(singleHeader(request, "X-Damage-Client")))) {
            throw MaintenanceJson.denied();
        }
    }

    static void verifyOrigins(MaintenanceProperties properties) {
        if (properties.getAllowedOrigins().isEmpty() || !properties.getAllowedOrigins().stream().allMatch(MaintenanceIngress::validOrigin)) {
            throw new IllegalStateException("私有维护来源必须配置为完整的 HTTP 或 HTTPS 来源");
        }
    }

    private static boolean validOrigin(String value) {
        try {
            URI origin = URI.create(value);
            return ("https".equals(origin.getScheme()) || "http".equals(origin.getScheme()))
                && origin.getHost() != null && origin.getRawUserInfo() == null && origin.getRawPath().isEmpty()
                && origin.getRawQuery() == null && origin.getRawFragment() == null
                && origin.getPort() != 0 && origin.getPort() <= 65535;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static String singleHeader(HttpServletRequest request, String name) {
        var values = request.getHeaders(name);
        String value = values.hasMoreElements() ? values.nextElement() : null;
        if (values.hasMoreElements()) throw MaintenanceJson.denied();
        return value;
    }
}
