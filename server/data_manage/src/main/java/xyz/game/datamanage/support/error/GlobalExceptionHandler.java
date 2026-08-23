package xyz.game.datamanage.support.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.validation.method.ParameterErrors;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handleApiException(ApiException ex) {
        return ResponseEntity.status(ex.getStatus())
            .body(ErrorResponse.of(ex.getCode(), ex.getMessage(), ex.getDetails()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleBadJson(HttpMessageNotReadableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of(
                "400.INVALID_BODY",
                "Invalid JSON body",
                Map.of("reason", ex.getMostSpecificCause().getMessage())
            ));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    public ResponseEntity<ErrorResponse> handleBindingValidation(BindException ex) {
        List<Map<String, String>> fieldIssues = new ArrayList<>();
        for (FieldError error : ex.getBindingResult().getFieldErrors()) {
            fieldIssues.add(fieldIssue(error.getField(), error.getCode(), error.getDefaultMessage()));
        }
        for (ObjectError error : ex.getBindingResult().getGlobalErrors()) {
            fieldIssues.add(fieldIssue("request", error.getCode(), error.getDefaultMessage()));
        }
        return validationFailed(fieldIssues);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handleConstraintValidation(ConstraintViolationException ex) {
        List<Map<String, String>> fieldIssues = new ArrayList<>();
        for (ConstraintViolation<?> violation : ex.getConstraintViolations()) {
            String constraintName = violation.getConstraintDescriptor().getAnnotation().annotationType().getSimpleName();
            fieldIssues.add(fieldIssue(
                lastPathSegment(violation.getPropertyPath()),
                constraintName,
                violation.getMessage()
            ));
        }
        return validationFailed(fieldIssues);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ErrorResponse> handleHandlerMethodValidation(HandlerMethodValidationException ex) {
        List<Map<String, String>> fieldIssues = new ArrayList<>();
        for (ParameterValidationResult result : ex.getParameterValidationResults()) {
            if (result instanceof ParameterErrors parameterErrors) {
                for (FieldError error : parameterErrors.getFieldErrors()) {
                    fieldIssues.add(fieldIssue(error.getField(), error.getCode(), error.getDefaultMessage()));
                }
                for (ObjectError error : parameterErrors.getGlobalErrors()) {
                    fieldIssues.add(fieldIssue("request", error.getCode(), error.getDefaultMessage()));
                }
                continue;
            }

            String parameterName = result.getMethodParameter().getParameterName();
            String field = parameterName == null ? "request" : parameterName;
            for (MessageSourceResolvable error : result.getResolvableErrors()) {
                fieldIssues.add(fieldIssue(field, firstCode(error), error.getDefaultMessage()));
            }
        }
        for (MessageSourceResolvable error : ex.getCrossParameterValidationResults()) {
            fieldIssues.add(fieldIssue("request", firstCode(error), error.getDefaultMessage()));
        }
        return validationFailed(fieldIssues);
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class})
    public ResponseEntity<ErrorResponse> handleBadRequest(Exception ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of("400.INVALID_BODY", "Invalid request parameters", Map.of("reason", ex.getMessage())));
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ErrorResponse> handleNotFound(Exception ex, HttpServletRequest request) {
        String path = request == null ? "" : request.getRequestURI();
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse.of(
                "404.NOT_FOUND",
                "Resource not found",
                Map.of("path", path, "reason", ex.getClass().getSimpleName())
            ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ErrorResponse.of(
                "500.INTERNAL_ERROR",
                "Unexpected internal error",
                Map.of("reason", ex.getClass().getSimpleName())
            ));
    }

    private static ResponseEntity<ErrorResponse> validationFailed(List<Map<String, String>> fieldIssues) {
        List<Map<String, String>> safeIssues = fieldIssues.isEmpty()
            ? List.of(fieldIssue("request", "VALIDATION_ERROR", "请求参数不合法"))
            : List.copyOf(fieldIssues);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of(
                "400.VALIDATION_FAILED",
                "属性信息不合法",
                Map.of("fieldIssues", safeIssues)
            ));
    }

    private static Map<String, String> fieldIssue(String field, String sourceCode, String message) {
        return Map.of(
            "field", field == null || field.isBlank() ? "request" : field,
            "code", validationCode(sourceCode),
            "message", message == null || message.isBlank() ? "字段不合法" : message
        );
    }

    private static String validationCode(String sourceCode) {
        String normalized = sourceCode == null ? "" : sourceCode.toLowerCase(Locale.ROOT);
        if (normalized.contains("notnull") || normalized.contains("notblank") || normalized.contains("notempty")) {
            return "REQUIRED";
        }
        if (normalized.equals("null") || normalized.endsWith(".null")) {
            return "IMMUTABLE";
        }
        if (normalized.contains("positive") || normalized.contains("min") || normalized.contains("max")) {
            return "RANGE_INVALID";
        }
        if (normalized.contains("size") || normalized.contains("length")) {
            return "LENGTH_INVALID";
        }
        if (normalized.contains("pattern") || normalized.contains("typeMismatch".toLowerCase(Locale.ROOT))) {
            return "FORMAT_INVALID";
        }
        return "VALIDATION_ERROR";
    }

    private static String firstCode(MessageSourceResolvable error) {
        String[] codes = error.getCodes();
        return codes == null || codes.length == 0 ? null : codes[0];
    }

    private static String lastPathSegment(Path path) {
        String field = "request";
        if (path != null) {
            for (Path.Node node : path) {
                if (node.getName() != null && !node.getName().isBlank()) {
                    field = node.getName();
                }
            }
        }
        return field;
    }
}
