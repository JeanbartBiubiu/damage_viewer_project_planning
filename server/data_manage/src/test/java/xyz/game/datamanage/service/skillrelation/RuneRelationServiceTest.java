package xyz.game.datamanage.service.skillrelation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.IntNode;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.RuneRelationMapper;
import xyz.game.datamanage.model.rune.RuneResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationCreateRequest;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.SkillRelationUpdateRequest;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class RuneRelationServiceTest {
    @Mock GamesMapper games;
    @Mock RuneMapper runes;
    @Mock SkillMapper skills;
    @Mock RuneRelationMapper mapper;
    @Mock GameConfigurationWriteGuard writes;
    RuneRelationService service;

    @BeforeEach
    void setup() {
        service = new RuneRelationService(games, runes, skills, mapper, writes);
        when(games.countGames("lol")).thenReturn(1L);
    }

    @Test
    void atLeastOneFilterRequiredAndSubjectsMustBeInSameGame() {
        assertCode("400.VALIDATION_FAILED", () -> service.listRuneRelations("lol", " ", null));
        assertCode("404.RUNE_NOT_FOUND", () -> service.listRuneRelations("lol", "focus", null));
        assertCode("404.SKILL_NOT_FOUND", () -> service.listRuneRelations("lol", null, "fire"));
        verify(mapper, never()).listRuneRelations(any(), any(), any());
    }

    @Test
    void bothDirectionsReturnDisabledSkillsWithoutOmittingTheRelation() {
        source();
        when(skills.findById("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        when(mapper.listRuneRelations("lol", "focus", "fire")).thenReturn(List.of(relation(SkillStatus.DISABLED)));
        var result = service.listRuneRelations("lol", " focus ", " fire ");
        assertEquals(1, result.total());
        assertEquals(SkillStatus.DISABLED, result.items().getFirst().skillStatus());
        service.listRuneRelations("lol", null, "fire");
        verify(mapper).listRuneRelations("lol", null, "fire");
    }

    @Test
    void creationLocksFirstAndOnlyAcceptsEnabledSkill() {
        source();
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        assertCode("409.REFERENCE_DISABLED", () -> service.createRuneRelation("lol", request()));
        verify(mapper, never()).insertRuneRelation(any(), any(), any(), anyInt());
        var order = inOrder(writes, games, runes);
        order.verify(writes).begin("lol");
        order.verify(games).countGames("lol");
        order.verify(runes).findRune("lol", "focus");
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.ENABLED));
        when(mapper.findRuneRelation("lol", "focus", "fire")).thenReturn(null, relation(SkillStatus.ENABLED));
        when(mapper.insertRuneRelation("lol", "focus", "fire", 3)).thenReturn(1);
        assertEquals(SkillStatus.ENABLED, service.createRuneRelation("lol", request()).skillStatus());
    }

    @Test
    void disabledExistingSkillCanBeReorderedAndUnlinked() {
        source();
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        when(mapper.updateRuneRelation("lol", "focus", "fire", 3)).thenReturn(1);
        when(mapper.findRuneRelation("lol", "focus", "fire")).thenReturn(relation(SkillStatus.DISABLED));
        assertEquals(3, service.updateRuneRelation("lol", "focus", "fire",
            new SkillRelationUpdateRequest(IntNode.valueOf(3), Set.of())).sortOrder());
        when(mapper.deleteRuneRelation("lol", "focus", "fire")).thenReturn(1);
        service.deleteRuneRelation("lol", "focus", "fire");
        verify(mapper).deleteRuneRelation("lol", "focus", "fire");
    }

    @Test
    void duplicateAndMissingRelationsDoNotBecomeUpserts() {
        source();
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill(SkillStatus.DISABLED));
        when(mapper.findRuneRelation("lol", "focus", "fire")).thenReturn(relation(SkillStatus.DISABLED));
        assertCode("409.RELATION_EXISTS", () -> service.createRuneRelation("lol", request()));
        assertCode("404.RELATION_NOT_FOUND", () -> service.deleteRuneRelation("lol", "focus", "fire"));
        verify(mapper, never()).insertRuneRelation(any(), any(), any(), anyInt());
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "1.0", "1.1", "\"3\"", "null", "true", "2147483648"})
    void sortingRejectsCoercionAndOverflow(String raw) throws Exception {
        var request = new RuneSkillRelationCreateRequest("focus", "fire", new ObjectMapper().readTree(raw), Set.of());
        assertCode("400.VALIDATION_FAILED", () -> service.createRuneRelation("lol", request));
        verifyNoInteractions(runes, skills, mapper);
    }

    @Test
    void fullBodyRejectsUnknownFieldsOnCreateAndUpdate() throws Exception {
        var json = new ObjectMapper();
        var request = json.readValue("{\"runeKey\":\"focus\",\"skillKey\":\"fire\",\"sortOrder\":0,\"enabled\":true}",
            RuneSkillRelationCreateRequest.class);
        assertCode("400.VALIDATION_FAILED", () -> service.createRuneRelation("lol", request));
        var update = json.readValue("{\"sortOrder\":0,\"runeKey\":\"other\"}", SkillRelationUpdateRequest.class);
        assertCode("400.VALIDATION_FAILED", () -> service.updateRuneRelation("lol", "focus", "fire", update));
        verifyNoInteractions(runes, skills, mapper);
    }

    private void source() {
        when(runes.findRune("lol", "focus")).thenReturn(new RuneResponse("lol", "focus", "专注", null, "MINOR", null, null));
    }

    private static RuneSkillRelationCreateRequest request() {
        return new RuneSkillRelationCreateRequest("focus", "fire", IntNode.valueOf(3), Set.of());
    }

    private static RuneSkillRelationResponse relation(SkillStatus status) {
        return new RuneSkillRelationResponse("lol", "focus", "专注", "fire", "火焰", status, 3);
    }

    private static SkillRow skill(SkillStatus status) {
        return new SkillRow("lol", "fire", "火焰", null, 1, status, 0, null, null);
    }

    private static void assertCode(String code, Runnable action) {
        assertEquals(code, assertThrows(ApiException.class, action::run).getCode());
    }
}
