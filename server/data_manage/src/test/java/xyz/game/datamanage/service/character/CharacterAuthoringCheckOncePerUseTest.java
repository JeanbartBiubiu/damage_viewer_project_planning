package xyz.game.datamanage.service.character;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterAuthoringCheckMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.model.character.AuthoringCheckLocation.AuthoringCheckLocationSegment.Field;
import xyz.game.datamanage.model.character.CharacterAttributeDefinition;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckResponse;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.AttachedSkill;
import xyz.game.datamanage.model.character.CharacterAuthoringCheckRows.ObjectRow;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.LevelConfigResponse;

class CharacterAuthoringCheckOncePerUseTest {

    private final GamesMapper games = mock(GamesMapper.class);
    private final CharacterMapper characters = mock(CharacterMapper.class);
    private final CharacterAuthoringCheckMapper checks = mock(CharacterAuthoringCheckMapper.class);
    private CharacterAuthoringCheckService service;

    @BeforeEach
    void setup() {
        service = new CharacterAuthoringCheckService(games, characters, checks, new ObjectMapper());
        when(games.countGames("lol")).thenReturn(1L);
        when(characters.findById("lol", "hero")).thenReturn(new CharacterResponse("lol", "hero", "测试角色", null, null, null));
        when(characters.findLevelConfig("lol")).thenReturn(new LevelConfigResponse("lol", 1, 2));
        when(characters.findLevelValuesJson("lol", "hero")).thenReturn("{\"1\":{},\"2\":{}}");
        when(characters.listAttributeDefinitions("lol")).thenReturn(List.of(
            new CharacterAttributeDefinition("hp", AttributeValueType.DECIMAL, BigDecimal.ZERO, BigDecimal.valueOf(100))));
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of(
            new AttachedSkill("skill", "技能", "ENABLED", 5, 0, true, 0, 0, 0)));
        when(checks.listReferences("lol", "hero")).thenReturn(List.of());
    }

    @Test
    void allowedOncePerUseHasNoStructureError() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(
            trigger("skill", "hit", "SKILL_HIT", "{\"groupKey\":\"eclipse\",\"scope\":\"SKILL\"}")));
        CharacterAuthoringCheckResponse response = service.check("lol", "hero");
        assertTrue(response.issues().stream().noneMatch(issue -> issue.code().contains("ONCE_PER_USE")
            || "UNKNOWN_FIELD".equals(issue.code()) && issue.fieldPath().contains("oncePerUse")));
    }

    @Test
    void illegalEventUsesReadableUiLocation() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(
            trigger("skill", "used", "SKILL_USED", "{\"groupKey\":\"eclipse\",\"scope\":\"TARGET\"}")));
        var issue = service.check("lol", "hero").issues().stream()
            .filter(row -> "ONCE_PER_USE_EVENT_INVALID".equals(row.code()))
            .findFirst()
            .orElseThrow();
        assertEquals("limits.oncePerUse", issue.fieldPath());
        assertEquals("ERROR", issue.severity());
        assertEquals(new Field("oncePerUse"), issue.location().segments().getFirst());
        assertEquals("TRIGGER_RULE", issue.location().editor());
    }

    @Test
    void groupScopeConflictKeepsTheOtherRuleKeyAndUiField() {
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(
            trigger("skill", "first", "BASIC_ATTACK_HIT", "{\"groupKey\":\"eclipse\",\"scope\":\"SKILL\"}"),
            trigger("skill", "second", "BASIC_ATTACK_START", "{\"groupKey\":\"eclipse\",\"scope\":\"TARGET\"}")));
        var issue = service.check("lol", "hero").issues().stream()
            .filter(row -> "ONCE_PER_USE_SCOPE_CONFLICT".equals(row.code()))
            .findFirst()
            .orElseThrow();
        assertEquals("second", issue.objectKey());
        assertEquals("limits.oncePerUse.scope", issue.fieldPath());
        assertTrue(issue.message().contains("first"));
        assertEquals(new Field("oncePerUse"), issue.location().segments().getFirst());
        assertEquals("FIELD", issue.location().precision());
    }

    @Test
    void sameGroupNameOnAnotherSkillIsNotMixed() {
        when(checks.listAttachedSkills("lol", "hero")).thenReturn(List.of(
            new AttachedSkill("alpha", "甲", "ENABLED", 5, 0, true, 0, 0, 0),
            new AttachedSkill("beta", "乙", "ENABLED", 5, 0, true, 0, 0, 0)));
        when(checks.listObjects("lol", "hero")).thenReturn(List.of(
            trigger("alpha", "rule", "BASIC_ATTACK_HIT", "{\"groupKey\":\"eclipse\",\"scope\":\"SKILL\"}"),
            trigger("beta", "rule", "SKILL_HIT", "{\"groupKey\":\"eclipse\",\"scope\":\"TARGET\"}")));
        assertTrue(service.check("lol", "hero").issues().stream()
            .noneMatch(issue -> "ONCE_PER_USE_SCOPE_CONFLICT".equals(issue.code())));
    }

    private static ObjectRow trigger(String skill, String key, String eventType, String oncePerUse) {
        String detail = eventType.equals("SKILL_USED") || eventType.equals("SKILL_HIT")
            ? "{\"sourceSkillKey\":\"" + skill + "\",\"useKind\":\"ANY\"}" : "{}";
        return new ObjectRow(skill, "TRIGGER", key, "规则", 0,
            "{\"eventSource\":{\"eventType\":\"" + eventType + "\",\"detail\":" + detail + "},"
                + "\"limits\":{\"perTargetCooldown\":null,\"maxTriggersPerProcess\":null,\"oncePerUse\":" + oncePerUse + "},"
                + "\"conditionGroups\":[],\"actions\":[{\"actionKey\":\"deal\",\"name\":\"执行\",\"sortOrder\":0,"
                + "\"actionType\":\"EXECUTE_EFFECT\",\"targetContext\":\"CURRENT_TARGET\","
                + "\"detail\":{\"effectKey\":\"burst\"},\"runtimeInputBindings\":[],\"resultModifiers\":[]}]}");
    }
}
