package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
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

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidEditorIdentities")
    void invalidEditorIdentityDoesNotPersistOrCleanLogs(String scenario, UUID accountId, String username) {
        assertThrows(IllegalArgumentException.class, () -> store.recordEditLog(
            accountId, username, "PUT", "/api/admin/games/lol/images/icon", null, 200
        ));

        verifyNoInteractions(editLogMapper);
    }

    private static Stream<Arguments> invalidEditorIdentities() {
        UUID account = UUID.fromString("00000000-0000-4000-8000-000000000001");
        return Stream.of(
            Arguments.of("缺少账号编号", null, "fixture_author"),
            Arguments.of("缺少用户名", account, null),
            Arguments.of("用户名为空", account, ""),
            Arguments.of("用户名只有空白", account, "   ")
        );
    }

    @Test
    void recordEditLogPersistsSanitizedControllerBody() {
        store.recordEditLog(
            java.util.UUID.fromString("00000000-0000-4000-8000-000000000001"), "fixture_author",
            "PUT",
            "/api/admin/games/lol/images/icon",
            JsonNodeFactory.instance.objectNode().put("imageReplaced", false),
            200
        );

        verify(editLogMapper).insertEditLog(
            eq(java.util.UUID.fromString("00000000-0000-4000-8000-000000000001")), eq("fixture_author"),
            contains("\"imageReplaced\":false")
        );
        verify(editLogMapper).deleteExpiredEditLogs();
    }

    @Test
    void serializationFailureDoesNotWriteAnIncompleteLogOrRunCleanup() throws Exception {
        ObjectMapper json = spy(new ObjectMapper());
        JsonProcessingException failure = new JsonProcessingException("序列化失败") {};
        doThrow(failure).when(json).writeValueAsString(any());
        store = new PostgresWriteStore(editLogMapper, json);

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> store.recordEditLog(
            java.util.UUID.fromString("00000000-0000-4000-8000-000000000001"), "fixture_author",
            "PUT", "/api/admin/games/lol/images/icon", JsonNodeFactory.instance.objectNode(), 200
        ));

        assertSame(failure, error.getCause());
        verifyNoInteractions(editLogMapper);
    }

    @Test
    void persistedLogPreservesTheCompleteBodyAndEscapesText() throws Exception {
        String path = "/api/admin/games/lol/images/\"icon\\name";
        JsonNode body = JsonNodeFactory.instance.objectNode().put("name", "带\"引号\\和换行\n");
        store.recordEditLog(
            java.util.UUID.fromString("00000000-0000-4000-8000-000000000001"), "fixture_author",
            "PUT", path, body, 200
        );
        ArgumentCaptor<String> serialized = ArgumentCaptor.forClass(String.class);
        verify(editLogMapper).insertEditLog(any(), eq("fixture_author"), serialized.capture());

        JsonNode log = new ObjectMapper().readTree(serialized.getValue());
        assertEquals(4, log.size());
        assertEquals("PUT", log.path("method").textValue());
        assertEquals(path, log.path("path").textValue());
        assertEquals(200, log.path("responseCode").intValue());
        assertEquals(body, log.path("requestBody"));
    }
}
