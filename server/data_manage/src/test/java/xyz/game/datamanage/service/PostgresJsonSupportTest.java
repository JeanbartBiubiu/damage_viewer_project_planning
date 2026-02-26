package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;

class PostgresJsonSupportTest {

    private PostgresJsonSupport jsonSupport;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        jsonSupport = new PostgresJsonSupport(objectMapper);
    }

    @Test
    void validateAllowedTopLevelFieldsAllowsVersionCreationFields() {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.1");
        body.put("releaseDate", "2026-02-26");

        assertDoesNotThrow(() -> jsonSupport.validateAllowedTopLevelFields(body, Set.of("versionCode", "releaseDate")));
    }

    @Test
    void validateAllowedTopLevelFieldsRejectsUnsupportedField() {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.1");
        body.put("versionId", 123);

        ApiException ex = assertThrows(
            ApiException.class,
            () -> jsonSupport.validateAllowedTopLevelFields(body, Set.of("versionCode", "releaseDate"))
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
    }

    @Test
    void validateNoVersionFieldsStillRejectsVersionFieldsForUpsert() {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("versionCode", "14.1");

        ApiException ex = assertThrows(ApiException.class, () -> jsonSupport.validateNoVersionFields(body, ""));
        assertEquals("400.INVALID_BODY", ex.getCode());
    }
}
