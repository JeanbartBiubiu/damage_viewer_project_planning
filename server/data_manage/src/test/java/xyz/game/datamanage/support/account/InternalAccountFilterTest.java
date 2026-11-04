package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class InternalAccountFilterTest {
    @TempDir Path directory;
    @Test void directTrustedAddressAndIndependentCredentialAreBothRequiredBeforeRouting() throws Exception {
        AccountProperties p=new AccountProperties();p.setInternalTokenPath(directory.resolve("internal"));
        String token="x".repeat(43);Files.writeString(p.getInternalTokenPath(),token);
        var filter=new InternalAccountFilter(new InternalAccountGuard(p),new ObjectMapper());FilterChain chain=mock(FilterChain.class);
        var request=new MockHttpServletRequest("POST","/internal/accounts/not-a-valid-id/enable-login");request.setContentType("application/json");
        request.setRemoteAddr("203.0.113.1");request.addHeader("X-Forwarded-For","127.0.0.1");request.addHeader("X-Damage-Internal-Token",token);
        var response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(401,response.getStatus());verifyNoInteractions(chain);
        request.setRemoteAddr("127.0.0.1");request.removeHeader("X-Damage-Internal-Token");
        response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(401,response.getStatus());verifyNoInteractions(chain);
        request.addHeader("X-Damage-Internal-Token",token);
        response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(200,response.getStatus());verify(chain).doFilter(request,response);
    }
    @Test void privateAddressStillNeedsEncryptedTransportAndMissingKeyDoesNotOpenAccess() throws Exception {
        AccountProperties p=new AccountProperties();p.setInternalTokenPath(directory.resolve("absent"));p.setInternalTrustedAddresses(java.util.List.of("10.1.2.3"));
        var filter=new InternalAccountFilter(new InternalAccountGuard(p),new ObjectMapper());var chain=mock(FilterChain.class);
        var request=new MockHttpServletRequest("POST","/internal/accounts/any/enable-login");request.setRemoteAddr("10.1.2.3");request.addHeader("X-Damage-Internal-Token","x".repeat(43));request.setContentType("application/json");
        var response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(401,response.getStatus());
        Files.writeString(p.getInternalTokenPath(),"x".repeat(43));
        response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(401,response.getStatus());verifyNoInteractions(chain);
        request.setSecure(true);response=new MockHttpServletResponse();filter.doFilter(request,response,chain);assertEquals(200,response.getStatus());
    }
}
