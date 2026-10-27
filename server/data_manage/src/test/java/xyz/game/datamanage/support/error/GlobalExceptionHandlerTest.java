package xyz.game.datamanage.support.error;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.http.HttpMethod;

class GlobalExceptionHandlerTest {
    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void genericMessagesAreChineseAndExistingCodesAndDetailsRemainAvailable() {
        var json = handler.handleBadJson(new HttpMessageNotReadableException("test malformed body", new MockHttpInputMessage(new byte[0])));
        assertEquals(HttpStatus.BAD_REQUEST, json.getStatusCode());
        assertEquals("400.INVALID_BODY", json.getBody().error().code());
        assertEquals("请求正文不是有效的JSON数据", json.getBody().error().message());
        assertEquals("test malformed body", json.getBody().error().details().get("reason"));

        var parameters = handler.handleBadRequest(new MissingServletRequestParameterException("gameId", "String"));
        assertEquals(HttpStatus.BAD_REQUEST, parameters.getStatusCode());
        assertEquals("400.INVALID_BODY", parameters.getBody().error().code());
        assertEquals("请求参数格式不正确", parameters.getBody().error().message());
        assertTrue(parameters.getBody().error().details().containsKey("reason"));

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/missing");
        var missing = handler.handleNotFound(new NoResourceFoundException(HttpMethod.GET, "/missing"), request);
        assertEquals(HttpStatus.NOT_FOUND, missing.getStatusCode());
        assertEquals("404.NOT_FOUND", missing.getBody().error().code());
        assertEquals("请求的资源不存在", missing.getBody().error().message());
        assertEquals("/missing", missing.getBody().error().details().get("path"));

        var internal = handler.handleUnexpected(new IllegalStateException("test failure"));
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, internal.getStatusCode());
        assertEquals("500.INTERNAL_ERROR", internal.getBody().error().code());
        assertEquals("服务器内部错误，请稍后重试", internal.getBody().error().message());
        assertEquals(Map.of("reason", "IllegalStateException"), internal.getBody().error().details());
    }

    @Test
    void genericValidationDoesNotMislabelEveryRequestAsAttributeData() {
        BindException exception = new BindException(new Object(), "request");
        exception.addError(new FieldError("request", "name", null, false, new String[]{"NotBlank"}, null, "名称不能为空"));
        var response = handler.handleBindingValidation(exception);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals("400.VALIDATION_FAILED", response.getBody().error().code());
        assertEquals("请求信息不合法", response.getBody().error().message());
        assertEquals(List.of(Map.of("field", "name", "code", "REQUIRED", "message", "名称不能为空")),
            response.getBody().error().details().get("fieldIssues"));
    }

    @Test
    void explicitBusinessMessagesAndFieldIssuesPassThroughUnchanged() {
        var details = Map.<String, Object>of("fieldIssues", List.of(Map.of("field", "name", "code", "NAME_EXISTS")));
        var response = handler.handleApiException(new ApiException(HttpStatus.CONFLICT, "409.NAME_EXISTS", "名称已存在", details));
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals("409.NAME_EXISTS", response.getBody().error().code());
        assertEquals("名称已存在", response.getBody().error().message());
        assertEquals(details, response.getBody().error().details());
    }
}
