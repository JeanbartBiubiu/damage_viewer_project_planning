package xyz.game.datamanage.support.maintenance;

import jakarta.servlet.ServletException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.apache.catalina.connector.Connector;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ValveBase;
import org.apache.coyote.http11.Http11NioProtocol;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** 额外连接器与公开连接器共享应用。入口标记只由容器按实际连接器写入。 */
@Component
@Order(1)
public class MaintenanceConnector implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {
    private final MaintenanceProperties properties;
    private final ObjectProvider<DataSource> dataSource;

    public MaintenanceConnector(MaintenanceProperties properties, ObjectProvider<DataSource> dataSource) {
        this.properties = properties;
        this.dataSource = dataSource;
    }

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        String socket = properties.getSocketPath();
        boolean socketConfigured = socket != null && !socket.isEmpty();
        Integer devPort = properties.getDevPort();
        if (!socketConfigured && devPort == null) return;
        if (socketConfigured && devPort != null) throw new IllegalStateException("私有套接字与开发端口只能配置一项");
        MaintenanceIngress.verifyOrigins(properties);

        Connector connector = new Connector(Http11NioProtocol.class.getName());
        if (socketConfigured) {
            Path path = checkedSocketPath(socket);
            if (!connector.setProperty("unixDomainSocketPath", path.toString())
                || !connector.setProperty("unixDomainSocketPathPermissions", "rw-rw----")) {
                throw new IllegalStateException("Tomcat 无法配置私有套接字及其访问权限");
            }
        } else {
            if (devPort < 1 || devPort > 65535 || devPort == factory.getPort()
                || factory.getAddress() == null || !factory.getAddress().isLoopbackAddress()) {
                throw new IllegalStateException("开发维护端口必须与公开端口独立，且两个连接器都必须监听回环地址");
            }
            verifyTestDatabase(dataSource.getObject());
            connector.setPort(devPort);
            if (!connector.setProperty("address", "127.0.0.1")) {
                throw new IllegalStateException("Tomcat 无法配置开发维护回环地址");
            }
        }
        factory.addAdditionalTomcatConnectors(connector);
        factory.addEngineValves(new ValveBase(true) {
            @Override
            public void invoke(Request request, Response response) throws IOException, ServletException {
                if (request.getConnector() == connector) {
                    request.setAttribute(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE, Boolean.TRUE);
                } else {
                    request.removeAttribute(MaintenanceIngress.PRIVATE_CONNECTOR_ATTRIBUTE);
                }
                getNext().invoke(request, response);
            }
        });
    }

    private static Path checkedSocketPath(String configured) {
        Path path = Path.of(configured);
        if (!path.isAbsolute() || path.getParent() == null || !path.equals(path.normalize())) {
            throw new IllegalStateException("私有套接字必须使用规范化的绝对路径");
        }
        Path parent = path.getParent();
        try {
            if (!Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS) || !parent.equals(parent.toRealPath())
                || ((int) Files.getAttribute(parent, "unix:mode", LinkOption.NOFOLLOW_LINKS) & 07777) != 02750) {
                throw new IllegalStateException("私有套接字父目录必须为真实目录且权限为 2750");
            }
            if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
                throw new IllegalStateException("私有套接字路径已有对象，须核对占用");
            }
            return path;
        } catch (IOException | UnsupportedOperationException | IllegalArgumentException e) {
            throw new IllegalStateException("无法核对私有套接字目录的 Unix 权限");
        }
    }

    private static void verifyTestDatabase(DataSource dataSource) {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
            statement.setQueryTimeout(5);
            try (var result = statement.executeQuery("""
                SELECT pg_catalog.current_database() = 'test0221'
                    AND session_user = 'damage_viewer_test_app'
                    AND current_user = 'damage_viewer_test_app'
                """)) {
                if (result.next() && result.getBoolean(1)) return;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("开发维护入口无法核对实际数据库身份");
        }
        throw new IllegalStateException("开发维护入口要求测试数据库 test0221 及测试角色 damage_viewer_test_app");
    }
}
