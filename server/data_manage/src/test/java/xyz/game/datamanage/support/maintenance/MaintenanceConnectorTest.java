package xyz.game.datamanage.support.maintenance;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;

class MaintenanceConnectorTest {
    private final MaintenanceProperties properties = new MaintenanceProperties();
    @SuppressWarnings("unchecked")
    private final ObjectProvider<DataSource> provider = mock(ObjectProvider.class);
    private final MaintenanceConnector customizer = new MaintenanceConnector(properties, provider);

    @Test void disabledConfigurationAndInvalidDevelopmentPortNeverConnectToTheDatabase() throws Exception {
        var factory = new TomcatServletWebServerFactory(8080);
        customizer.customize(factory);
        assertTrue(factory.getAdditionalTomcatConnectors().isEmpty());
        properties.setDevPort(8081);
        assertThrows(IllegalStateException.class, () -> customizer.customize(factory));
        factory.setAddress(InetAddress.getByName("127.0.0.1"));
        properties.setDevPort(8080);
        assertThrows(IllegalStateException.class, () -> customizer.customize(factory));
        properties.setDevPort(0);
        assertThrows(IllegalStateException.class, () -> customizer.customize(factory));
        verifyNoInteractions(provider);
    }

    @Test void configuredDevelopmentPortFailsClosedIfTheActualDatabaseOrRoleDoesNotMatch() throws Exception {
        var source = mock(DataSource.class);
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        var result = mock(ResultSet.class);
        when(provider.getObject()).thenReturn(source);
        when(source.getConnection()).thenReturn(connection);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery(anyString())).thenReturn(result);
        when(result.next()).thenReturn(true);
        when(result.getBoolean(1)).thenReturn(false);
        var factory = new TomcatServletWebServerFactory(0);
        factory.setAddress(InetAddress.getByName("127.0.0.1"));
        properties.setDevPort(8081);
        assertThrows(IllegalStateException.class, () -> customizer.customize(factory));
        assertTrue(factory.getAdditionalTomcatConnectors().isEmpty());
        verify(connection).close();
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    @Timeout(value = 20, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
    void unixSocketHasRestrictedModeAndIsTheOnlyConnectorMarkedPrivate(@TempDir Path directory) throws Exception {
        Path parent = Files.createDirectory(directory.toRealPath().resolve("ingress"));
        Files.setAttribute(parent, "unix:mode", 02750);
        Path socket = parent.resolve("http.sock");
        properties.setSocketPath(socket.toString());
        var factory = new TomcatServletWebServerFactory(0);
        factory.setAddress(InetAddress.getByName("127.0.0.1"));
        customizer.customize(factory);
        var server = factory.getWebServer(context -> context.addServlet("ingress-probe", new HttpServlet() {
            @Override protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
                response.getWriter().write(Boolean.toString(MaintenanceIngress.isPrivate(request)));
            }
        }).addMapping("/probe"));
        try {
            server.start();
            assertEquals(0660, (int) Files.getAttribute(socket, "unix:mode") & 0777);
            assertEquals(Files.getAttribute(parent, "posix:group"), Files.getAttribute(socket, "posix:group"));
            var tcp = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.getPort() + "/probe"))
                .header("X-Forwarded-For", "127.0.0.1").header("Forwarded", "for=127.0.0.1").build();
            try (var http = HttpClient.newHttpClient()) {
                assertEquals("false", http.send(tcp, HttpResponse.BodyHandlers.ofString()).body());
            }
            try (var channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
                channel.connect(UnixDomainSocketAddress.of(socket));
                var request = ByteBuffer.wrap("GET /probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                while (request.hasRemaining()) channel.write(request);
                String response = new String(Channels.newInputStream(channel).readAllBytes(), StandardCharsets.US_ASCII);
                assertTrue(response.startsWith("HTTP/1.1 200 "));
                assertTrue(response.endsWith("\r\n\r\ntrue"));
            }
        } finally {
            server.stop();
        }
        assertFalse(Files.exists(socket));
        verifyNoInteractions(provider);
    }
}
