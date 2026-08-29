package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import xyz.game.datamanage.mapper.ImagesMapper;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class PostgresWriteStoreTest {

    @Mock private ImagesMapper imagesMapper;
    @Mock private EditLogMapper editLogMapper;
    @Mock private PostgresReadStore readStore;

    private PostgresWriteStore store;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        store = new PostgresWriteStore(
            imagesMapper,
            editLogMapper,
            readStore,
            objectMapper,
            new PostgresJsonSupport(objectMapper)
        );
    }

    @Test
    void mapperFieldsStayLimitedToImagesAndEditLog() {
        Set<String> types = Arrays.stream(PostgresWriteStore.class.getDeclaredFields())
            .map(Field::getType)
            .map(Class::getSimpleName)
            .collect(Collectors.toSet());
        assertEquals(
            Set.of("ImagesMapper", "EditLogMapper", "PostgresReadStore", "ObjectMapper", "PostgresJsonSupport"),
            types
        );
    }

    @Test
    void upsertImagePersistsAndReloads() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("imageBase64", "data:image/png;base64,abc");
        ObjectNode stored = JsonNodeFactory.instance.objectNode();
        stored.put("uri", "icon");
        stored.put("imageBase64", "data:image/png;base64,abc");
        when(readStore.loadImage("lol", "icon")).thenReturn(stored);

        ObjectNode result = store.upsertImage("lol", "icon", body);

        verify(imagesMapper).upsertImage("lol", "icon", "data:image/png;base64,abc");
        assertEquals("icon", result.get("uri").asText());
    }

    @Test
    void upsertImageRejectsEmptyBody() {
        ApiException ex = assertThrows(
            ApiException.class,
            () -> store.upsertImage("lol", "icon", JsonNodeFactory.instance.objectNode())
        );
        assertEquals("400.INVALID_BODY", ex.getCode());
        verify(imagesMapper, org.mockito.Mockito.never()).upsertImage(any(), any(), any());
    }
}
