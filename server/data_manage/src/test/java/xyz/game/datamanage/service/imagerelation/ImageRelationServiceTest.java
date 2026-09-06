package xyz.game.datamanage.service.imagerelation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.model.imagerelation.*;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class ImageRelationServiceTest {
    @Mock GamesMapper games;
    @Mock ImageRelationMapper mapper;
    private ImageRelationService service;

    @BeforeEach
    void setUp() {
        service = new ImageRelationService(games, mapper);
    }

    @ParameterizedTest
    @EnumSource(ImageRelationSource.class)
    void allSevenSourcesCanReadEmptySetReplaceReadAndDelete(ImageRelationSource source) {
        String parent = source == ImageRelationSource.SKILL_EFFECT ? "q" : "";
        String key = source == ImageRelationSource.GAME ? "lol" : "object";
        existingSource(source, parent, key);
        assertNull(service.get("lol", source, parent, key).image());

        var first = image("one", true);
        var next = image("two", true);
        when(mapper.findImage("lol", "one")).thenReturn(first);
        when(mapper.findImage("lol", "two")).thenReturn(next);
        assertEquals(first, service.put("lol", source, parent, key, request("one")).image());
        when(mapper.findImageKey("lol", source.name(), parent, key)).thenReturn("one");
        assertEquals(first, service.get("lol", source, parent, key).image());
        assertEquals(next, service.put("lol", source, parent, key, request("two")).image());
        verify(mapper).put("lol", source.name(), parent, key, "two");
        when(mapper.deleteForSource("lol", source.name(), parent, key)).thenReturn(1);
        service.delete("lol", source, parent, key);
        verify(mapper).deleteForSource("lol", source.name(), parent, key);
    }

    @Test
    void disabledExistingImageRemainsReadableAndCanBeRetainedOrRemoved() {
        existingSource(ImageRelationSource.CHARACTER, "", "ezreal");
        when(mapper.findImageKey("lol", "CHARACTER", "", "ezreal")).thenReturn("icon");
        when(mapper.findImage("lol", "icon")).thenReturn(image("icon", false));
        assertFalse(service.get("lol", ImageRelationSource.CHARACTER, "", "ezreal").image().enabled());
        assertFalse(service.put("lol", ImageRelationSource.CHARACTER, "", "ezreal", request("icon")).image().enabled());
        when(mapper.deleteForSource("lol", "CHARACTER", "", "ezreal")).thenReturn(1);
        service.delete("lol", ImageRelationSource.CHARACTER, "", "ezreal");
    }

    @Test
    void disabledImageCannotBeNewlySelected() {
        existingSource(ImageRelationSource.GAME, "", "lol");
        when(mapper.findImage("lol", "disabled")).thenReturn(image("disabled", false));
        assertCode("409.REFERENCE_DISABLED", () -> service.put("lol", ImageRelationSource.GAME, "", "lol", request("disabled")));
        when(mapper.findImageKey("lol", "GAME", "", "lol")).thenReturn("old");
        when(mapper.findImage("lol", "old")).thenReturn(image("old", true));
        assertCode("409.REFERENCE_DISABLED", () -> service.put("lol", ImageRelationSource.GAME, "", "lol", request("disabled")));
        verify(mapper, never()).put(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void missingImageInCurrentGameCannotBeSelected() {
        existingSource(ImageRelationSource.STATUS, "", "burn");
        assertCode("404.IMAGE_NOT_FOUND", () -> service.put("lol", ImageRelationSource.STATUS, "", "burn", request("other_game_icon")));
        verify(mapper, never()).put(anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void missingSourceAndParentUseExistingNotFoundErrors() {
        when(games.countGames("lol")).thenReturn(1L);
        assertCode("404.CHARACTER_NOT_FOUND", () -> service.get("lol", ImageRelationSource.CHARACTER, "", "missing"));
        assertCode("404.SKILL_NOT_FOUND", () -> service.get("lol", ImageRelationSource.SKILL_EFFECT, "missing", "hit"));
        when(mapper.countSource("lol", "SKILL", "", "q")).thenReturn(1L);
        assertCode("404.SKILL_EFFECT_NOT_FOUND", () -> service.get("lol", ImageRelationSource.SKILL_EFFECT, "q", "missing"));
        assertCode("404.GAME_NOT_FOUND", () -> service.get("absent", ImageRelationSource.GAME, "", "absent"));
    }

    @Test
    void missingRelationDeleteHasNoWrite() {
        existingSource(ImageRelationSource.GAME, "", "lol");
        assertCode("404.RELATION_NOT_FOUND", () -> service.delete("lol", ImageRelationSource.GAME, "", "lol"));
        verify(mapper, never()).deleteForSource(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void danglingTargetStopsReadsAndWritesAndReportsFullLocator() {
        when(mapper.findImageKey("lol", "SKILL_EFFECT", "q", "hit")).thenReturn("missing");
        ApiException ex = assertCode("409.RELATION_DANGLING", () -> service.get("lol", ImageRelationSource.SKILL_EFFECT, "q", "hit"));
        assertEquals("q", ex.getDetails().get("sourceParentKey"));
        assertEquals("hit", ex.getDetails().get("sourceKey"));
        assertEquals("missing", ex.getDetails().get("imageKey"));
        assertCode("409.RELATION_DANGLING", () -> service.put("lol", ImageRelationSource.SKILL_EFFECT, "q", "hit", request("replacement")));
        assertCode("409.RELATION_DANGLING", () -> service.delete("lol", ImageRelationSource.SKILL_EFFECT, "q", "hit"));
        verify(mapper, never()).put(anyString(), anyString(), anyString(), anyString(), anyString());
        verify(mapper, never()).deleteForSource(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void danglingSourceIsNotConvertedIntoOrdinaryNotFound() {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findImageKey("lol", "CHARACTER", "", "missing")).thenReturn("icon");
        when(mapper.findImage("lol", "icon")).thenReturn(image("icon", true));
        assertCode("409.RELATION_DANGLING", () -> service.get("lol", ImageRelationSource.CHARACTER, "", "missing"));
    }

    @Test
    void usagesReturnAllTypedGroupsAndDisabledStates() {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findImage("lol", "icon")).thenReturn(image("icon", false));
        when(mapper.listUsages("lol", "icon")).thenReturn(List.of(
            row("GAME", "", "lol", "游戏", null, null),
            row("CHARACTER", "", "ezreal", "角色", null, null),
            row("ATTRIBUTE", "", "hp", "生命", "DISABLED", null),
            row("EQUIPMENT", "", "sword", "武器", null, null),
            row("SKILL", "", "q", "秘术射击", "DISABLED", null),
            row("SKILL_EFFECT", "q", "hit", "命中", null, "秘术射击"),
            row("STATUS", "", "burn", "灼烧", "DISABLED", null)
        ));
        var response = service.usages("lol", "icon");
        assertEquals("lol", response.games().getFirst().gameId());
        assertEquals("ezreal", response.characters().getFirst().characterKey());
        assertEquals("DISABLED", response.attributes().getFirst().attributeStatus());
        assertEquals("sword", response.equipment().getFirst().equipmentKey());
        assertEquals("DISABLED", response.skills().getFirst().skillStatus());
        assertEquals("q", response.skillEffects().getFirst().skillKey());
        assertEquals("hit", response.skillEffects().getFirst().effectKey());
        assertEquals("DISABLED", response.statuses().getFirst().statusStatus());
    }

    @Test
    void usagesDoNotHideDanglingSourceOrParentOrImage() {
        when(mapper.listUsages("lol", "icon")).thenReturn(List.of(row("CHARACTER", "", "missing", null, null, null)));
        assertCode("409.RELATION_DANGLING", () -> service.usages("lol", "icon"));
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findImage("lol", "icon")).thenReturn(image("icon", true));
        assertCode("409.RELATION_DANGLING", () -> service.usages("lol", "icon"));
        when(mapper.listUsages("lol", "icon")).thenReturn(List.of(row("SKILL_EFFECT", "q", "hit", "命中", null, null)));
        assertCode("409.RELATION_DANGLING", () -> service.usages("lol", "icon"));
    }

    @Test
    void emptyUsageGroupsAreArrays() {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findImage("lol", "icon")).thenReturn(image("icon", true));
        var response = service.usages("lol", "icon");
        assertTrue(response.games().isEmpty());
        assertTrue(response.characters().isEmpty());
        assertTrue(response.attributes().isEmpty());
        assertTrue(response.equipment().isEmpty());
        assertTrue(response.skills().isEmpty());
        assertTrue(response.skillEffects().isEmpty());
        assertTrue(response.statuses().isEmpty());
    }

    @Test
    void optionsRequireBoundedNonBlankKeywordAndReturnOnlyMetadata() {
        when(games.countGames("lol")).thenReturn(1L);
        for (String keyword : new String[]{null, "", "   ", "x".repeat(101)}) {
            assertCode("400.VALIDATION_FAILED", () -> service.options("lol", keyword));
        }
        when(mapper.listOptions("lol", "图标")).thenReturn(List.of(new ImageOptionResponse.Item("icon", "图标")));
        var result = service.options("lol", " 图标 ");
        assertEquals(1, result.total());
        assertEquals("icon", result.items().getFirst().imageKey());
        verify(mapper).listOptions("lol", "图标");
    }

    @Test
    void invalidBodiesHaveFieldIssuesAndNeverReachPersistence() {
        for (String key : new String[]{null, "", " ", "a/b", "x".repeat(129)}) {
            ApiException ex = assertCode("400.VALIDATION_FAILED", () -> service.put("lol", ImageRelationSource.GAME, "", "lol", request(key)));
            assertNotNull(ex.getDetails().get("fieldIssues"));
        }
        assertCode("400.INVALID_BODY", () -> service.put("lol", ImageRelationSource.GAME, "", "lol",
            new RepresentativeImageRequest("icon", Set.of("enabled"))));
        verifyNoInteractions(mapper, games);
    }

    private void existingSource(ImageRelationSource source, String parent, String key) {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.countSource("lol", source.name(), parent, key)).thenReturn(1L);
        if (source == ImageRelationSource.SKILL_EFFECT) when(mapper.countSource("lol", "SKILL", "", parent)).thenReturn(1L);
    }

    private static RepresentativeImageRequest request(String key) { return new RepresentativeImageRequest(key, Set.of()); }
    private static RepresentativeImageResponse.Image image(String key, boolean enabled) { return new RepresentativeImageResponse.Image(key, "图标", enabled); }
    private static ImageUsageRow row(String type, String parent, String key, String name, String status, String parentName) {
        return new ImageUsageRow(type, parent, key, name, status, parentName);
    }
    private static ApiException assertCode(String code, Runnable action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals(code, ex.getCode());
        return ex;
    }
}
