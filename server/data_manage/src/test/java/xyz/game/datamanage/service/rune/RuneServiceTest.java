package xyz.game.datamanage.service.rune;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.model.rune.RunePathRow;
import xyz.game.datamanage.model.rune.RuneResponse;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class RuneServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    @Mock GamesMapper games;
    @Mock RuneMapper mapper;
    @Mock ImageRelationMapper images;
    @Mock GameConfigurationWriteGuard writes;
    private RuneService service;

    @BeforeEach
    void setup() {
        service = new RuneService(games, mapper, images, json, writes);
        lenient().when(games.countGames("lol")).thenReturn(1L);
    }

    @Test
    void createNormalizesAndLocksBeforeEveryRead() {
        RuneResponse saved = rune("focus", "MINOR");
        when(mapper.findRune("lol", "focus")).thenReturn(null, saved);
        ObjectNode body = runeBody();
        body.put("runeKey", " focus ").put("name", " 专注 ").put("description", " ");
        assertEquals(saved, service.createRune("lol", body));
        var order = inOrder(writes, games, mapper);
        order.verify(writes).begin("lol");
        order.verify(games).countGames("lol");
        order.verify(mapper).findRune("lol", "focus");
        order.verify(mapper).countRuneName("lol", "专注", null);
        order.verify(mapper).insertRune("lol", "focus", "专注", null, "MINOR");
    }

    @ParameterizedTest
    @ValueSource(strings = {"status", "enabled", "sortOrder", "slots"})
    void identityRejectsUnknownFields(String field) {
        ObjectNode body = runeBody();
        body.put(field, 1);
        assertField(false, field, () -> service.createRune("lol", body));
        verify(mapper, never()).insertRune(any(), any(), any(), any(), any());
    }

    static Stream<String> invalidRuneBodies() {
        return Stream.of("[]", "null", "1", "{\"runeKey\":1,\"name\":\"x\",\"category\":\"MINOR\"}",
            "{\"runeKey\":\"valid\",\"name\":true,\"category\":\"MINOR\"}",
            "{\"runeKey\":\"Upper\",\"name\":\"x\",\"category\":\"MINOR\"}",
            "{\"runeKey\":\"valid\",\"name\":\" \",\"category\":\"MINOR\"}",
            "{\"runeKey\":\"valid\",\"name\":\"x\"}",
            "{\"runeKey\":\"valid\",\"name\":\"x\",\"category\":\"INVALID\"}");
    }

    @ParameterizedTest
    @MethodSource("invalidRuneBodies")
    void invalidIdentityIsNeverWritten(String body) throws Exception {
        JsonNode request = json.readTree(body);
        assertCode("400.INVALID_RUNE_REQUEST", () -> service.createRune("lol", request));
        verify(mapper, never()).insertRune(any(), any(), any(), any(), any());
    }

    @Test
    void changingKeyIsNotAcceptedByUpdate() {
        assertField(false, "runeKey", () -> service.updateRune("lol", "focus", runeBody()));
    }

    @Test
    void identityAndPathNameConflictsRemainDistinct() {
        when(mapper.countRuneName("lol", "专注", null)).thenReturn(1L);
        assertCode("409.RUNE_NAME_EXISTS", () -> service.createRune("lol", runeBody()));
        when(mapper.countPathName("lol", "分组", null)).thenReturn(1L);
        assertCode("409.RUNE_PATH_NAME_EXISTS", () -> service.createPath("lol", pathBody("[]", "RUNE_PATH")));
    }

    @Test
    void pathRetainsSlotAndOptionOrderAndReplacesItsOwnOldPositions() {
        RunePathRow old = path("precision", "[{\"name\":\"第一槽\",\"category\":\"MINOR\",\"runeKeys\":[\"focus\"]}]", "RUNE_PATH");
        RunePathRow saved = path("precision", "[{\"name\":\"第一槽\",\"category\":\"MINOR\",\"runeKeys\":[\"other\",\"focus\"]}]", "RUNE_PATH");
        when(mapper.findPath("lol", "precision")).thenReturn(old, saved);
        when(mapper.listPaths("lol", null)).thenReturn(List.of(old));
        when(mapper.listRunes("lol", null, null)).thenReturn(List.of(rune("focus", "MINOR"), rune("other", "MINOR")));
        when(mapper.updatePath(any(), any(), any(), any(), any(), anyInt(), any())).thenReturn(1);
        ObjectNode body = pathBody(saved.slotsJson(), "RUNE_PATH");
        body.remove("pathKey");
        var result = service.updatePath("lol", "precision", body);
        assertEquals(List.of("other", "focus"), result.slots().getFirst().runeKeys());
        verify(mapper).updatePath(eq("lol"), eq("precision"), eq("分组"), isNull(), eq("RUNE_PATH"), eq(0),
            argThat(raw -> raw.indexOf("other") < raw.indexOf("focus")));
    }

    @Test
    void ordinaryRuneCannotOccupyAnotherGroupOrAnotherSlot() {
        when(mapper.listRunes("lol", null, null)).thenReturn(List.of(rune("focus", "MINOR")));
        when(mapper.listPaths("lol", null)).thenReturn(List.of(path("old", minorSlots("focus"), "RUNE_PATH")));
        assertField(true, "slots[0].runeKeys[0]",
            () -> service.createPath("lol", pathBody(minorSlots("focus"), "RUNE_PATH")));
        when(mapper.listPaths("lol", null)).thenReturn(List.of());
        String duplicateSlots = "[{\"name\":\"1\",\"category\":\"MINOR\",\"runeKeys\":[\"focus\"]},{\"name\":\"2\",\"category\":\"MINOR\",\"runeKeys\":[\"focus\"]}]";
        assertField(true, "slots[1].runeKeys[0]",
            () -> service.createPath("lol", pathBody(duplicateSlots, "RUNE_PATH")));
        verify(mapper, never()).insertPath(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    void shardCanBeReusedAcrossRowsAndGroupsWithoutDuplicatingIdentity() {
        String slots = "[{\"name\":\"第一行\",\"category\":\"SHARD\",\"runeKeys\":[\"adaptive\"]},{\"name\":\"第二行\",\"category\":\"SHARD\",\"runeKeys\":[\"adaptive\"]}]";
        RunePathRow saved = path("precision", slots, "SHARD_GROUP");
        when(mapper.listRunes("lol", null, null)).thenReturn(List.of(rune("adaptive", "SHARD")));
        when(mapper.listPaths("lol", null)).thenReturn(List.of(path("another", slots, "SHARD_GROUP")));
        when(mapper.findPath("lol", "precision")).thenReturn(null, saved);
        var result = service.createPath("lol", pathBody(slots, "SHARD_GROUP"));
        assertEquals(2, result.slots().size());
        assertEquals(result.slots().get(0).runeKeys(), result.slots().get(1).runeKeys());
        verify(mapper, never()).insertRune(any(), any(), any(), any(), any());
    }

    @Test
    void neitherSameRowDuplicatesNorAnotherGamesSameKeyCanPass() {
        String duplicate = "[{\"name\":\"行\",\"category\":\"SHARD\",\"runeKeys\":[\"adaptive\",\"adaptive\"]}]";
        assertField(true, "slots[0].runeKeys[1]",
            () -> service.createPath("lol", pathBody(duplicate, "SHARD_GROUP")));
        lenient().when(mapper.listRunes("other_game", null, null)).thenReturn(List.of(rune("focus", "MINOR")));
        assertField(true, "slots[0].runeKeys[0]",
            () -> service.createPath("lol", pathBody(minorSlots("focus"), "RUNE_PATH")));
        verify(mapper, never()).listRunes(eq("other_game"), any(), any());
    }

    @Test
    void runeCategoryMustMatchSlot() {
        when(mapper.listRunes("lol", null, null)).thenReturn(List.of(rune("focus", "KEYSTONE")));
        assertField(true, "slots[0].runeKeys[0]",
            () -> service.createPath("lol", pathBody(minorSlots("focus"), "RUNE_PATH")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "1.5", "1.0", "\"1\"", "true", "null", "2147483648"})
    void pathSortingRequiresActualNonNegativeInteger(String raw) throws Exception {
        ObjectNode body = pathBody("[]", "RUNE_PATH");
        body.set("sortOrder", json.readTree(raw));
        assertField(true, "sortOrder", () -> service.createPath("lol", body));
        verify(mapper, never()).insertPath(any(), any(), any(), any(), any(), anyInt(), any());
    }

    static Stream<String> invalidSlots() {
        return Stream.of("null", "{}", "[null]", "[{\"name\":\"槽\",\"category\":\"MINOR\",\"runeKeys\":[],\"index\":0}]",
            "[{\"name\":\"槽\",\"category\":\"SHARD\",\"runeKeys\":[]}]",
            "[{\"name\":\"槽\",\"runeKeys\":[]}]",
            "[{\"name\":\"槽\",\"category\":\"MINOR\"}]",
            "[{\"name\":\"槽\",\"category\":\"MINOR\",\"runeKeys\":[3]}]");
    }

    @ParameterizedTest
    @MethodSource("invalidSlots")
    void malformedCompleteLayoutsAreRejectedBeforeAnyWrite(String slots) {
        assertCode("400.INVALID_RUNE_PATH_REQUEST", () -> service.createPath("lol", pathBody(slots, "RUNE_PATH")));
        verify(mapper, never()).insertPath(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    void emptyLayoutAndEmptySlotAreLegal() {
        String slots = "[{\"name\":\"空槽\",\"category\":\"MINOR\",\"runeKeys\":[]}]";
        when(mapper.findPath("lol", "precision")).thenReturn(null, path("precision", slots, "RUNE_PATH"));
        assertTrue(service.createPath("lol", pathBody(slots, "RUNE_PATH")).slots().getFirst().runeKeys().isEmpty());
        when(mapper.findPath("lol", "precision")).thenReturn(null, path("precision", "[]", "RUNE_PATH"));
        assertTrue(service.createPath("lol", pathBody("[]", "RUNE_PATH")).slots().isEmpty());
    }

    @Test
    void missingArrayAndUnknownTopFieldAreRejected() {
        ObjectNode body = pathBody("[]", "RUNE_PATH");
        body.remove("slots");
        assertField(true, "slots", () -> service.createPath("lol", body));
        ObjectNode invalid = pathBody("[]", "RUNE_PATH").put("enabled", true);
        assertField(true, "enabled", () -> service.createPath("lol", invalid));
    }

    @Test
    void changingPathKindRequiresPreviouslyEmptyLayoutEvenWhenNewLayoutIsEmpty() {
        when(mapper.findPath("lol", "precision"))
            .thenReturn(path("precision", "[{\"name\":\"空槽\",\"category\":\"MINOR\",\"runeKeys\":[]}]", "RUNE_PATH"));
        ObjectNode body = pathBody("[]", "SHARD_GROUP");
        body.remove("pathKey");
        assertCode("409.RUNE_PATH_IN_USE", () -> service.updatePath("lol", "precision", body));
        verify(mapper, never()).updatePath(any(), any(), any(), any(), any(), anyInt(), any());
        when(mapper.findPath("lol", "precision")).thenReturn(path("precision", "[]", "RUNE_PATH"));
        when(mapper.updatePath(any(), any(), any(), any(), any(), anyInt(), any())).thenReturn(1);
        service.updatePath("lol", "precision", body);
        verify(mapper).updatePath(eq("lol"), eq("precision"), any(), isNull(), eq("SHARD_GROUP"), eq(0), eq("[]"));
    }

    @Test
    void placedRuneDeletionAndCategoryChangeReportExactLocations() {
        when(mapper.findRune("lol", "focus")).thenReturn(rune("focus", "MINOR"));
        when(mapper.listPaths("lol", null)).thenReturn(List.of(path("precision", minorSlots("focus"), "RUNE_PATH")));
        ApiException ex = assertCode("409.RUNE_IN_USE", () -> service.deleteRune("lol", "focus"));
        assertEquals(List.of(Map.of("pathKey", "precision", "slotIndex", 0, "slotName", "槽位")), ex.getDetails().get("references"));
        ObjectNode body = runeBody();
        body.remove("runeKey");
        body.put("category", "KEYSTONE");
        assertCode("409.RUNE_IN_USE", () -> service.updateRune("lol", "focus", body));
        verify(mapper, never()).deleteRune(any(), any());
        verify(mapper, never()).updateRune(any(), any(), any(), any(), any());
        verifyNoInteractions(images);
    }

    @Test
    void unplacedRuneCanChangeCategoryAndDeletionOnlyTargetsItsRelations() {
        when(mapper.findRune("lol", "focus")).thenReturn(rune("focus", "MINOR"));
        when(mapper.updateRune(any(), any(), any(), any(), any())).thenReturn(1);
        ObjectNode body = runeBody();
        body.remove("runeKey");
        body.put("category", "SHARD");
        service.updateRune("lol", "focus", body);
        verify(mapper).updateRune("lol", "focus", "专注", null, "SHARD");
        when(mapper.deleteRune("lol", "focus")).thenReturn(1);
        service.deleteRune("lol", "focus");
        verify(images).deleteForSource("lol", "RUNE", "", "focus");
        verify(mapper, never()).deletePath(any(), any());
    }

    @Test
    void pathDeletionPreservesRunesAndClearsOnlyPathImage() {
        when(mapper.findPath("lol", "precision")).thenReturn(path("precision", minorSlots("focus"), "RUNE_PATH"));
        when(mapper.deletePath("lol", "precision")).thenReturn(1);
        service.deletePath("lol", "precision");
        verify(images).deleteForSource("lol", "RUNE_PATH", "", "precision");
        verify(mapper, never()).deleteRune(any(), any());
        verify(mapper, never()).listRunes(any(), any(), any());
    }

    @Test
    void malformedStoredLayoutCannotDisappearFromDeleteProtection() {
        when(mapper.findRune("lol", "focus")).thenReturn(rune("focus", "MINOR"));
        when(mapper.listPaths("lol", null)).thenReturn(List.of(path("broken", "{}", "RUNE_PATH")));
        assertCode("500.INTERNAL_ERROR", () -> service.deleteRune("lol", "focus"));
        verify(mapper, never()).deleteRune(any(), any());
    }

    @Test
    void listsFilterWithinGameAndMissingSubjectsUseDedicatedErrors() {
        service.listRunes("lol", " 专注 ", "MINOR");
        verify(mapper).listRunes("lol", "专注", "MINOR");
        service.listPaths("lol", " 精密 ");
        verify(mapper).listPaths("lol", "精密");
        assertCode("404.RUNE_NOT_FOUND", () -> service.getRune("lol", "missing"));
        assertCode("404.RUNE_PATH_NOT_FOUND", () -> service.getPath("lol", "missing"));
        assertCode("404.GAME_NOT_FOUND", () -> service.listRunes("absent", null, null));
    }

    private ObjectNode runeBody() {
        return json.createObjectNode().put("runeKey", "focus").put("name", "专注").put("category", "MINOR");
    }

    private ObjectNode pathBody(String slots, String kind) {
        try {
            ObjectNode body = json.createObjectNode().put("pathKey", "precision").put("name", "分组").put("kind", kind).put("sortOrder", 0);
            body.set("slots", json.readTree(slots));
            return body;
        } catch (Exception ex) {
            throw new IllegalArgumentException(ex);
        }
    }

    private static String minorSlots(String key) {
        return "[{\"name\":\"槽位\",\"category\":\"MINOR\",\"runeKeys\":[\"" + key + "\"]}]";
    }

    private static RuneResponse rune(String key, String category) {
        return new RuneResponse("lol", key, "专注", null, category, OffsetDateTime.now(), OffsetDateTime.now());
    }

    private static RunePathRow path(String key, String slots, String kind) {
        return new RunePathRow("lol", key, "分组", null, kind, 0, slots, OffsetDateTime.now(), OffsetDateTime.now());
    }

    private static ApiException assertCode(String code, Runnable action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals(code, ex.getCode());
        return ex;
    }

    private static void assertField(boolean path, String field, Runnable action) {
        ApiException ex = assertCode(path ? "400.INVALID_RUNE_PATH_REQUEST" : "400.INVALID_RUNE_REQUEST", action);
        var issues = (List<?>) ex.getDetails().get("fieldIssues");
        assertEquals(field, ((Map<?, ?>) issues.getFirst()).get("field"));
    }
}
