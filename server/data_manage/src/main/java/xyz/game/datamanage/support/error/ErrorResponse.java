package xyz.game.datamanage.support.error;

import java.util.Map;

public record ErrorResponse(ErrorBody error) {

    public static ErrorResponse of(String code, String message, Map<String, Object> details) {
        return new ErrorResponse(new ErrorBody(code, message, details == null ? Map.of() : details));
    }

    public record ErrorBody(String code, String message, Map<String, Object> details) {
    }
}

