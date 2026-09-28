package xyz.game.datamanage.service.build;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.build.BuildSystemMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.BuildOptionSkillRelationMapper;
import xyz.game.datamanage.model.build.BuildGroupRow;
import xyz.game.datamanage.model.build.BuildOptionRow;
import xyz.game.datamanage.model.build.BuildSystemRow;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class BuildSystemServiceTest {
    private static final String EMPTY_RULES =
        "{\"groupRoles\":[],\"budget\":null,\"prerequisites\":[],\"exclusions\":[]}";

    private final ObjectMapper json = new ObjectMapper();
    @Mock GamesMapper games;
    @Mock BuildSystemMapper mapper;
    @Mock BuildOptionSkillRelationMapper relations;
    @Mock SkillMapper skills;
    @Mock ImageRelationMapper images;
    @Mock GameConfigurationWriteGuard writes;
    private BuildSystemService service;

    @BeforeEach
    void setup() {
        service = new BuildSystemService(games, mapper, relations, skills, images, json, writes);
    }

    @Test
    void definitionSnapshotUsesRepeatableReadAndDoesNotTakeTheWriteLock() throws Exception {
        Transactional transactional = BuildSystemService.class.getMethod("definition", String.class, String.class)
            .getAnnotation(Transactional.class);
        assertTrue(transactional.readOnly());
        assertEquals(Isolation.REPEATABLE_READ, transactional.isolation());
        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(), List.of(
            option("focus", "专注", 1, "[0]"), option("triumph", "凯旋", 1, "[0]")));
        var snapshot = service.definition("lol", "runes");
        assertEquals("runes", snapshot.system().systemKey());
        assertEquals(List.of("focus", "triumph"), snapshot.options().stream().map(item -> item.optionKey()).toList());
        assertTrue(snapshot.groups().isEmpty());
        assertTrue(snapshot.skillRelations().isEmpty());
        verify(writes, never()).begin(any());
    }

    @Test
    void definitionSnapshotKeepsDisabledSkillGrantVisibleForSelectionValidation() {
        var grant = new BuildOptionSkillRelationResponse(
            "lol", "runes", "focus", "专注", "fire", "火焰", SkillStatus.DISABLED, 1, "FIXED", 1, 0);
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findSystem("lol", "runes")).thenReturn(system("SLOT_SELECTION", EMPTY_RULES));
        when(mapper.listGroups("lol", "runes", null)).thenReturn(List.of());
        when(mapper.listOptions("lol", "runes", null)).thenReturn(List.of(option("focus", "专注", 1, "[0]")));
        when(relations.listRelations("lol", "runes", null, null)).thenReturn(List.of(grant));
        when(skills.findById("lol", "fire")).thenReturn(
            new SkillRow("lol", "fire", "火焰", null, 1, SkillStatus.DISABLED, 0, null, null));

        var snapshot = service.definition("lol", "runes");

        assertEquals(List.of(grant), snapshot.skillRelations());
    }

    @Test
    void unknownRuleFieldsAndNonIntegralCostsAreRejected() throws Exception {
        when(games.countGames("lol")).thenReturn(1L);
        ObjectNode body = systemBody(EMPTY_RULES);
        body.put("enabled", false);
        assertCode("400.INVALID_BUILD_SYSTEM_REQUEST", () -> service.createSystem("lol", body));
        verify(mapper, never()).insertSystem(any(), any(), any(), any(), any(), anyInt(), any());

        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(), List.of());
        ObjectNode option = optionBody(1, "[0]");
        option.set("rankCosts", json.readTree("[1.5]"));
        ApiException cost = assertCode("400.INVALID_BUILD_OPTION_REQUEST", () -> service.createOption("lol", "runes", option));
        assertEquals("RANGE_INVALID", issues(cost).getFirst().get("code"));
        ObjectNode rules = (ObjectNode) json.readTree(EMPTY_RULES);
        rules.put("script", "return 1");
        ApiException shape = assertCode("400.INVALID_BUILD_SYSTEM_REQUEST",
            () -> service.updateSystem("lol", "runes", updateBody(rules.toString())));
        assertEquals("selectionRules.script", issues(shape).getFirst().get("field"));
        assertEquals("UNKNOWN_FIELD", issues(shape).getFirst().get("code"));
    }

    @Test
    void sameGroupCanUseDifferentRoleSlotRules() throws Exception {
        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(group("precision", slots("focus"))), List.of(option("focus", "专注", 1, "[0]")));
        when(mapper.countSystemName("lol", "符文", "runes")).thenReturn(0L);
        when(mapper.updateSystem(any(), any(), any(), any(), any(), anyInt(), any())).thenReturn(1);
        service.updateSystem("lol", "runes", updateBody(primaryAndSecondary()));
        verify(mapper).updateSystem(eq("lol"), eq("runes"), eq("符文"), isNull(), eq("SLOT_SELECTION"), eq(0), contains("secondary"));
    }

    @Test
    void roleSlotBoundsMustStayInsideTheGroupSlot() throws Exception {
        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(group("precision", slots("focus"))), List.of(option("focus", "专注", 1, "[0]")));
        String rules = primaryAndSecondary().replace("\"minimumSelections\":1,\"maximumSelections\":1",
            "\"minimumSelections\":2,\"maximumSelections\":2");
        ApiException ex = assertCode("400.INVALID_BUILD_SYSTEM_REQUEST",
            () -> service.updateSystem("lol", "runes", updateBody(rules)));
        assertEquals("RANGE_INVALID", issues(ex).getFirst().get("code"));
        assertTrue(issues(ex).getFirst().get("field").contains("slotRules"));
    }

    @Test
    void prerequisiteCycleIsRejectedAtTheClosingRule() throws Exception {
        stubCatalog(system("POINT_ALLOCATION", budgetRules()), List.of(), List.of(
            option("a", "甲", 3, "[1,1,1]"), option("b", "乙", 3, "[1,1,1]")));
        String rules = """
            {"groupRoles":[],"budget":{"budgetKey":"points","name":"点数","maximumSource":"FIXED","fixedMaximum":9},
             "prerequisites":[
               {"optionKey":"a","minimumRank":2,"requiredOptionKey":"b","requiredMinimumRank":1},
               {"optionKey":"b","minimumRank":1,"requiredOptionKey":"a","requiredMinimumRank":1}
             ],"exclusions":[]}
            """;
        ApiException ex = assertCode("400.INVALID_BUILD_SYSTEM_REQUEST",
            () -> service.updateSystem("lol", "runes", updateBody(rules)));
        assertEquals("selectionRules.prerequisites[1].requiredOptionKey", issues(ex).getFirst().get("field"));
        assertEquals("CYCLE", issues(ex).getFirst().get("code"));
    }

    @Test
    void reverseDistinctDeclarationIsRejected() throws Exception {
        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(group("precision", slots("focus"))), List.of(option("focus", "专注", 1, "[0]")));
        String rules = primaryAndSecondary().replace("\"distinctFromRoleKeys\":[]", "\"distinctFromRoleKeys\":[\"primary\"]");
        ApiException ex = assertCode("400.INVALID_BUILD_SYSTEM_REQUEST",
            () -> service.updateSystem("lol", "runes", updateBody(rules)));
        assertEquals("DUPLICATE_KEY", issues(ex).getFirst().get("code"));
    }

    @Test
    void pointAllocationOptionAppearsOnceWhileSlotSelectionCanReuseIt() throws Exception {
        stubCatalog(system("POINT_ALLOCATION", budgetRules()), List.of(group("tree", slots("focus"))),
            List.of(option("focus", "专注", 3, "[1,0,0]")));
        ApiException duplicate = assertCode("400.INVALID_BUILD_GROUP_REQUEST",
            () -> service.createGroup("lol", "runes", groupBody("branch", slots("focus"), true)));
        assertEquals("DUPLICATE_KEY", issues(duplicate).getFirst().get("code"));
        verify(mapper, never()).insertGroup(any(), any(), any(), any(), any(), anyInt(), any());

        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(), List.of(option("focus", "专注", 1, "[0]")));
        when(mapper.findGroup("lol", "runes", "shards")).thenReturn(null, group("shards", twoSlots("focus")));
        service.createGroup("lol", "runes", groupBody("shards", twoSlots("focus"), true));
        verify(mapper).insertGroup(eq("lol"), eq("runes"), eq("shards"), eq("shards"), isNull(), eq(0), contains("focus"));
    }

    @Test
    void deletingAReferencedOptionOrGroupReportsOccupancy() throws Exception {
        stubCatalog(system("SLOT_SELECTION", EMPTY_RULES), List.of(group("precision", slots("focus"))),
            List.of(option("focus", "专注", 1, "[0]")));
        ApiException option = assertCode("409.BUILD_OPTION_IN_USE", () -> service.deleteOption("lol", "runes", "focus"));
        assertEquals("keystone", references(option).getFirst().get("slotKey"));
        verify(mapper, never()).deleteOption(any(), any(), any());

        stubCatalog(system("SLOT_SELECTION", primaryAndSecondary()), List.of(group("precision", slots("focus"))),
            List.of(option("focus", "专注", 1, "[0]")));
        ApiException group = assertCode("409.BUILD_GROUP_IN_USE", () -> service.deleteGroup("lol", "runes", "precision"));
        assertTrue(references(group).getFirst().get("path").toString().contains("groupKeys"));
        verify(images, never()).deleteForSource(any(), any(), any(), any());
    }

    @Test
    void tighteningASlotStillReferencedByARoleIsOccupancy() throws Exception {
        stubCatalog(system("SLOT_SELECTION", primaryAndSecondary()), List.of(group("precision", slots("focus"))),
            List.of(option("focus", "专注", 1, "[0]")));
        String tighter = slots("focus").replace("\"maximumSelections\":1", "\"maximumSelections\":0");
        ApiException ex = assertCode("409.BUILD_GROUP_IN_USE",
            () -> service.updateGroup("lol", "runes", "precision", groupBody("precision", tighter, false)));
        assertTrue(references(ex).getFirst().get("path").toString().contains("slotRules"));
        verify(mapper, never()).updateGroup(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test
    void modeChangeIsBlockedWhileGroupsOrConflictingGrantsRemain() throws Exception {
        stubCatalog(system("POINT_ALLOCATION", budgetRules()), List.of(group("tree", "[]")), List.of());
        ApiException grouped = assertCode("409.BUILD_SYSTEM_IN_USE",
            () -> service.updateSystem("lol", "runes", updateBody(EMPTY_RULES, "SLOT_SELECTION")));
        assertEquals("runes", grouped.getDetails().get("systemKey"));

        var grant = new BuildOptionSkillRelationResponse(
            "lol", "runes", "focus", "专注", "fire", "火焰", SkillStatus.ENABLED, 1, "SAME_AS_OPTION", null, 0);
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findSystem("lol", "runes")).thenReturn(system("POINT_ALLOCATION", EMPTY_RULES));
        when(mapper.listGroups("lol", "runes", null)).thenReturn(List.of());
        when(mapper.listOptions("lol", "runes", null)).thenReturn(List.of(option("focus", "专注", 1, "[0]")));
        when(relations.listRelations("lol", "runes", null, null)).thenReturn(List.of(grant));
        assertCode("409.BUILD_SYSTEM_IN_USE",
            () -> service.updateSystem("lol", "runes", updateBody(EMPTY_RULES, "SLOT_SELECTION")));
    }

    @Test
    void illegalStoredDefinitionReturnsOnlyTheDiagnostic() {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findSystem("lol", "runes")).thenReturn(system("SLOT_SELECTION", EMPTY_RULES));
        when(mapper.listGroups("lol", "runes", null)).thenReturn(List.of());
        when(mapper.listOptions("lol", "runes", null)).thenReturn(List.of(option("focus", "专注", 2, "[0,0]")));
        when(relations.listRelations("lol", "runes", null, null)).thenReturn(List.of());
        ApiException rank = assertCode("500.INVALID_STORED_BUILD_DEFINITION", () -> service.definition("lol", "runes"));
        assertEquals(Set.of("systemKey", "field", "message"), rank.getDetails().keySet());
        assertEquals("maxRank", rank.getDetails().get("field"));

        var grant = new BuildOptionSkillRelationResponse(
            "lol", "runes", "focus", "专注", "missing", "缺失", SkillStatus.ENABLED, 1, "FIXED", 1, 0);
        when(mapper.listOptions("lol", "runes", null)).thenReturn(List.of(option("focus", "专注", 1, "[0]")));
        when(relations.listRelations("lol", "runes", null, null)).thenReturn(List.of(grant));
        when(skills.findById("lol", "missing")).thenReturn(null);
        ApiException skill = assertCode("500.INVALID_STORED_BUILD_DEFINITION", () -> service.definition("lol", "runes"));
        assertEquals("skillRelations.missing", skill.getDetails().get("field"));
        assertFalse(skill.getDetails().containsKey("skillRelations"));

    }

    @Test
    void deletingTheSystemRemovesImageRelationsBeforeTheAggregate() {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findSystem("lol", "runes")).thenReturn(system("SLOT_SELECTION", EMPTY_RULES));
        when(mapper.deleteSystem("lol", "runes")).thenReturn(1);
        service.deleteSystem("lol", "runes");
        var order = inOrder(images, mapper);
        order.verify(images).deleteForBuildSystem("lol", "runes");
        order.verify(mapper).deleteSystem("lol", "runes");
    }

    private void stubCatalog(BuildSystemRow system, List<BuildGroupRow> groups, List<BuildOptionRow> options) {
        when(games.countGames("lol")).thenReturn(1L);
        when(mapper.findSystem("lol", "runes")).thenReturn(system);
        when(mapper.listGroups("lol", "runes", null)).thenReturn(groups);
        when(mapper.listOptions("lol", "runes", null)).thenReturn(options);
        when(relations.listRelations("lol", "runes", null, null)).thenReturn(List.of());
    }

    private JsonNode updateBody(String rules) {
        ObjectNode body = systemBody(rules);
        body.remove("systemKey");
        return body;
    }

    private JsonNode updateBody(String rules, String mode) {
        ObjectNode body = systemBody(rules, mode);
        body.remove("systemKey");
        return body;
    }

    private ObjectNode systemBody(String rules) {
        return systemBody(rules, rules.contains("\"budget\":null") ? "SLOT_SELECTION" : "POINT_ALLOCATION");
    }

    private ObjectNode systemBody(String rules, String mode) {
        ObjectNode body = json.createObjectNode();
        body.put("systemKey", "runes");
        body.put("name", "符文");
        body.putNull("description");
        body.put("configurationMode", mode);
        body.put("sortOrder", 0);
        body.set("selectionRules", tree(rules));
        return body;
    }

    private ObjectNode optionBody(int maxRank, String costs) {
        ObjectNode body = json.createObjectNode();
        body.put("optionKey", "focus");
        body.put("name", "专注");
        body.putNull("description");
        body.put("maxRank", maxRank);
        body.set("rankCosts", tree(costs));
        return body;
    }

    private ObjectNode groupBody(String key, String slots, boolean create) {
        ObjectNode body = json.createObjectNode();
        if (create) {
            body.put("groupKey", key);
        }
        body.put("name", key);
        body.putNull("description");
        body.put("sortOrder", 0);
        body.set("slots", tree(slots));
        return body;
    }

    private JsonNode tree(String raw) {
        try {
            return json.readTree(raw);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String primaryAndSecondary() {
        return """
            {"groupRoles":[
              {"roleKey":"primary","name":"主系","groupKeys":["precision"],"minimumGroups":1,"maximumGroups":1,
               "minimumSelectedSlots":1,"maximumSelectedSlots":1,"distinctFromRoleKeys":["secondary"],
               "slotRules":[{"groupKey":"precision","slotKey":"keystone","minimumSelections":1,"maximumSelections":1}]},
              {"roleKey":"secondary","name":"副系","groupKeys":["precision"],"minimumGroups":1,"maximumGroups":1,
               "minimumSelectedSlots":0,"maximumSelectedSlots":1,"distinctFromRoleKeys":[],
               "slotRules":[{"groupKey":"precision","slotKey":"keystone","minimumSelections":0,"maximumSelections":0}]}
            ],"budget":null,"prerequisites":[],"exclusions":[]}
            """;
    }

    private static String budgetRules() {
        return """
            {"groupRoles":[],"budget":{"budgetKey":"points","name":"点数","maximumSource":"FIXED","fixedMaximum":9},
             "prerequisites":[],"exclusions":[]}
            """;
    }

    private static String slots(String optionKey) {
        return "[{\"slotKey\":\"keystone\",\"name\":\"基石\",\"minimumSelections\":0,\"maximumSelections\":1,\"optionKeys\":[\""
            + optionKey + "\"]}]";
    }

    private static String twoSlots(String optionKey) {
        return "[{\"slotKey\":\"offense\",\"name\":\"进攻\",\"minimumSelections\":0,\"maximumSelections\":1,\"optionKeys\":[\""
            + optionKey + "\"]},{\"slotKey\":\"flex\",\"name\":\"灵活\",\"minimumSelections\":0,\"maximumSelections\":1,\"optionKeys\":[\""
            + optionKey + "\"]}]";
    }

    private BuildSystemRow system(String mode, String rules) {
        return new BuildSystemRow("lol", "runes", "符文", null, mode, 0, rules, null, null);
    }

    private BuildOptionRow option(String key, String name, int maxRank, String costs) {
        return new BuildOptionRow("lol", "runes", key, name, null, maxRank, costs, null, null);
    }

    private BuildGroupRow group(String key, String slots) {
        return new BuildGroupRow("lol", "runes", key, key, null, 0, slots, null, null);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> issues(ApiException ex) {
        return (List<Map<String, String>>) ex.getDetails().get("fieldIssues");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> references(ApiException ex) {
        return (List<Map<String, Object>>) ex.getDetails().get("references");
    }

    private static ApiException assertCode(String code, Runnable action) {
        ApiException ex = assertThrows(ApiException.class, action::run);
        assertEquals(code, ex.getCode());
        return ex;
    }
}
