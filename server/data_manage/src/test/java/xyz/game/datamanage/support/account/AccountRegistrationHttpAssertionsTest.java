package xyz.game.datamanage.support.account;

import java.lang.reflect.InvocationTargetException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

class AccountRegistrationHttpAssertionsTest {
    @Test void firstRequestWithoutCookiesReachesServerAnd503StopsBeforeResponseParsing() throws Exception {
        var endpoint=new FailingRegistration();
        var fixture=new AccountRegistrationIT();
        ReflectionTestUtils.setField(fixture,"mvc",MockMvcBuilders.standaloneSetup(endpoint).build());
        var method=AccountRegistrationIT.class.getDeclaredMethod("response",MockHttpServletRequestBuilder.class);method.setAccessible(true);
        var failure=assertThrows(InvocationTargetException.class,()->method.invoke(fixture,post("/api/auth/register")));
        assertTrue(endpoint.called.get());assertTrue(failure.getCause() instanceof AssertionError);
        assertFalse(failure.getCause() instanceof IllegalArgumentException);
    }
    @RestController static class FailingRegistration {
        final AtomicBoolean called=new AtomicBoolean();
        @PostMapping("/api/auth/register") ResponseEntity<String> register() {
            called.set(true);return ResponseEntity.status(503).body("response must not be parsed");
        }
    }
}
