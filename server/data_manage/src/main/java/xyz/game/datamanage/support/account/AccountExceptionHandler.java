package xyz.game.datamanage.support.account;

import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.ErrorResponse;

/** 账号解析及数据库错误不得把请求值、密文或凭据拼入公共错误或日志。 */
@RestControllerAdvice(assignableTypes={AccountController.class,InternalAccountController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AccountExceptionHandler {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> api(ApiException ex) {
        var response=ResponseEntity.status(ex.getStatus()).header("Cache-Control","no-store");
        if (ex.getStatus()==HttpStatus.TOO_MANY_REQUESTS) response.header("Retry-After",String.valueOf(ex.getDetails().getOrDefault("retryAfter",60)));
        return response.body(ErrorResponse.of(ex.getCode(),ex.getMessage(),ex.getDetails()));
    }
    @ExceptionHandler({HttpMessageNotReadableException.class,org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorResponse> malformed(Exception ex) { return api(AccountErrors.bad()); }
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> unexpected(Exception ex) {
        org.slf4j.LoggerFactory.getLogger(AccountExceptionHandler.class).error("Account operation failed: category={}",ex.getClass().getSimpleName());
        return ResponseEntity.status(500).header("Cache-Control","no-store").body(ErrorResponse.of("AUTH.INTERNAL_ERROR","账号操作失败，请稍后重试",Map.of()));
    }
}
