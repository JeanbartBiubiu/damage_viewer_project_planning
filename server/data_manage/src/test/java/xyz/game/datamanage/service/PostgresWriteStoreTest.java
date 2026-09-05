package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.EditLogMapper;

@ExtendWith(MockitoExtension.class)
class PostgresWriteStoreTest {

    @Mock
    private EditLogMapper editLogMapper;

    private PostgresWriteStore store;

    @BeforeEach
    void setUp() {
        store = new PostgresWriteStore(editLogMapper, new ObjectMapper());
    }

    @Test
    void storeOnlyOwnsEditLogDependencies() {
        Set<String> types = Arrays.stream(PostgresWriteStore.class.getDeclaredFields())
            .map(Field::getType)
            .map(Class::getSimpleName)
            .collect(Collectors.toSet());
        assertEquals(Set.of("EditLogMapper", "ObjectMapper"), types);
    }

    @Test
    void recordEditLogPersistsSanitizedControllerBody() {
        store.recordEditLog(
            "author@example.com",
            "PUT",
            "/api/admin/games/lol/images/icon",
            JsonNodeFactory.instance.objectNode().put("imageReplaced", false),
            200
        );

        verify(editLogMapper).insertEditLog(
            eq("author@example.com"),
            contains("\"imageReplaced\":false")
        );
        verify(editLogMapper).deleteExpiredEditLogs();
    }
}
