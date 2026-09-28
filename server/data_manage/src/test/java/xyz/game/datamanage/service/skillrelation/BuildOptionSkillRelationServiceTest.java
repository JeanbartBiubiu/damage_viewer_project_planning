package xyz.game.datamanage.service.skillrelation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.build.BuildSystemMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.BuildOptionSkillRelationMapper;
import xyz.game.datamanage.model.build.BuildOptionRow;
import xyz.game.datamanage.model.build.BuildSystemRow;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class BuildOptionSkillRelationServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    @Mock GamesMapper games;
    @Mock BuildSystemMapper builds;
    @Mock SkillMapper skills;
    @Mock BuildOptionSkillRelationMapper mapper;
    @Mock GameConfigurationWriteGuard writes;
    private BuildOptionSkillRelationService service;

    @BeforeEach
    void setup() {
        service = new BuildOptionSkillRelationService(games, builds, skills, mapper, writes);
        when(games.countGames("lol")).thenReturn(1L);
    }

    @Test
    void listRequiresASkillOrAnOptionPair() {
        assertCode("400.VALIDATION_FAILED", () -> service.list("lol", null, null, null));
        when(skills.findById("lol", "fire")).thenReturn(skill(3, SkillStatus.ENABLED));
        when(mapper.listRelations("lol", null, null, "fire")).thenReturn(List.of(relation("FIXED", 1)));
        assertEquals(1, service.list("lol", " ", null, "fire").total());
        verify(builds, never()).findOption(any(), any(), any());
    }

    @Test
    void fixedAndScaledGrantsFollowTheSystemModeAndSkillCeiling() throws Exception {
        ready("SLOT_SELECTION", 1);
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(3, SkillStatus.ENABLED));
        when(mapper.findRelation("lol", "runes", "focus", "fire")).thenReturn(null, relation("FIXED", 1));
        when(mapper.insertRelation("lol", "runes", "focus", "fire", 1, "FIXED", 1, 0)).thenReturn(1);
        assertEquals("FIXED", service.create("lol", tree(body("FIXED", "1", 1))).skillLevelMode());

        ApiException scaled = assertCode("400.VALIDATION_FAILED",
            () -> service.create("lol", tree(body("SAME_AS_OPTION", "null", 1))));
        assertEquals("skillLevelMode", issues(scaled).getFirst().get("field"));

        ApiException level = assertCode("400.VALIDATION_FAILED",
            () -> service.create("lol", tree(body("FIXED", "4", 1))));
        assertEquals("fixedSkillLevel", issues(level).stream().filter(item -> "fixedSkillLevel".equals(item.get("field"))).findFirst().orElseThrow().get("field"));

        ready("POINT_ALLOCATION", 4);
        ApiException ceiling = assertCode("400.VALIDATION_FAILED",
            () -> service.create("lol", tree(body("SAME_AS_OPTION", "null", 1))));
        assertTrue(issues(ceiling).stream().anyMatch(item -> "optionKey".equals(item.get("field"))));
        verify(mapper, times(1)).insertRelation(any(), any(), any(), any(), anyInt(), any(), any(), anyInt());
    }

    @Test
    void disabledSkillCanOnlyBeReorderedOrUnboundButNotNewlyOrSemanticallyGranted() throws Exception {
        ready("POINT_ALLOCATION", 2);
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(3, SkillStatus.DISABLED));
        assertCode("409.REFERENCE_DISABLED", () -> service.create("lol", tree(body("SAME_AS_OPTION", "null", 1))));
        when(mapper.findRelation("lol", "runes", "focus", "fire"))
            .thenReturn(relation(SkillStatus.DISABLED, "SAME_AS_OPTION", null));

        assertCode("409.REFERENCE_DISABLED", () -> service.update("lol", "runes", "focus", "fire", tree(
            "{\"activationRank\":2,\"skillLevelMode\":\"SAME_AS_OPTION\",\"fixedSkillLevel\":null,\"sortOrder\":4}")));

        when(mapper.updateRelation("lol", "runes", "focus", "fire", 1, "SAME_AS_OPTION", null, 4)).thenReturn(1);
        when(mapper.findRelation("lol", "runes", "focus", "fire"))
            .thenReturn(relation(SkillStatus.DISABLED, "SAME_AS_OPTION", null));
        assertEquals(4, service.update("lol", "runes", "focus", "fire", tree(
            "{\"activationRank\":1,\"skillLevelMode\":\"SAME_AS_OPTION\",\"fixedSkillLevel\":null,\"sortOrder\":4}")).sortOrder());
        verify(mapper, never()).insertRelation(any(), any(), any(), any(), anyInt(), any(), any(), anyInt());
    }

    private void ready(String mode, int maxRank) {
        when(builds.findSystem("lol", "runes")).thenReturn(
            new BuildSystemRow("lol", "runes", "符文", null, mode, 0, "{}", null, null));
        when(builds.findOption("lol", "runes", "focus")).thenReturn(
            new BuildOptionRow("lol", "runes", "focus", "专注", null, maxRank, "[0]", null, null));
    }

    private static SkillRow skill(int maxLevel, SkillStatus status) {
        return new SkillRow("lol", "fire", "火焰", null, maxLevel, status, 0, null, null);
    }

    private static BuildOptionSkillRelationResponse relation(String mode, Integer fixed) {
        return relation(SkillStatus.ENABLED, mode, fixed);
    }

    private static BuildOptionSkillRelationResponse relation(SkillStatus status, String mode, Integer fixed) {
        return new BuildOptionSkillRelationResponse(
            "lol", "runes", "focus", "专注", "fire", "火焰", status, 1, mode, fixed, 4);
    }

    private static String body(String mode, String fixed, int activation) {
        return "{\"systemKey\":\"runes\",\"optionKey\":\"focus\",\"skillKey\":\"fire\",\"activationRank\":" + activation
            + ",\"skillLevelMode\":\"" + mode + "\",\"fixedSkillLevel\":" + fixed + ",\"sortOrder\":0}";
    }

    private com.fasterxml.jackson.databind.JsonNode tree(String raw) {
        try {
            return json.readTree(raw);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException(ex);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> issues(ApiException ex) {
        return (List<Map<String, String>>) ex.getDetails().get("fieldIssues");
    }

    private static ApiException assertCode(String code, Runnable action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals(code, ex.getCode());
        return ex;
    }
}
