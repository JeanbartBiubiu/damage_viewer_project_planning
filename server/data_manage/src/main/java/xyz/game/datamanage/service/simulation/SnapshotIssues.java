package xyz.game.datamanage.service.simulation;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.error.ApiException;

final class SnapshotIssues {
    private SnapshotIssues() { }

    static ApiException request(String field, String code, String message) {
        return issue(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", field, code, message);
    }

    static ApiException invalid(String field, String code, String message) {
        return issue(HttpStatus.CONFLICT, "409.SIMULATION_SNAPSHOT_INVALID", field, code, message);
    }

    private static ApiException issue(HttpStatus status, String errorCode, String field, String code, String message) {
        return new ApiException(status, errorCode, message,
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", code, "message", message))));
    }
}
