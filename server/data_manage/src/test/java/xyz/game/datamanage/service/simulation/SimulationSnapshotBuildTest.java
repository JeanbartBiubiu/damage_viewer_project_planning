package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.build.*;
import xyz.game.datamanage.model.build.BuildConfiguration.*;
import xyz.game.datamanage.model.build.BuildSystemResponse.*;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.*;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotBuildTest {
    private SimulationSnapshotFixture fixture;

    @BeforeEach
    void setup() throws Exception {
        fixture = new SimulationSnapshotFixture();
    }

    @Test
    void actualGrantsFollowActivationRankAndBothSkillLevelModes() throws Exception {
        var definition = pointDefinition("FIXED", 20, List.of(), List.of());
        install(definition);
        fixture.configuration("fixed_skill", 5, constant());
        fixture.configuration("scaled_skill", 3, constant());
        var configuration = pointSelection(2, Map.of());
        var result = fixture.service.get(GAME, select(configuration, List.of()));
        assertEquals(definition, result.source().selectedBuilds().getFirst().definition());
        assertEquals(configuration, result.source().selectedBuilds().getFirst().configuration());
        assertEquals(3, source(result.source(), "fixed_skill").skillLevel());
        assertEquals(2, source(result.source(), "scaled_skill").skillLevel());
        assertEquals("BUILD_OPTION", source(result.source(), "fixed_skill").origin().kind());
        assertEquals(List.of("initialize"), source(result.source(), "scaled_skill").enabledRuleKeys());
        assertTrue(result.target().selectedBuilds().isEmpty());
        var belowActivation = fixture.service.get(GAME, select(pointSelection(1, Map.of()), List.of()));
        assertFalse(belowActivation.source().skillSources().stream().anyMatch(source -> source.origin().kind().equals("BUILD_OPTION")));
    }

    @Test
    void sameOptionAtDifferentSlotsRemainsTwoInstancesWithIndependentSwitches() throws Exception {
        var definition = slotDefinition();
        install(definition);
        fixture.configuration("fixed_skill", 5, constant());
        BuildConfiguration configuration = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")),
            List.of(new OptionSelection("main", "tree", "two", "power", 1),
                new OptionSelection("main", "tree", "one", "power", 1)), Map.of());
        Origin closed = Origin.build("build", configuration.selections().getFirst());
        var result = fixture.service.get(GAME, select(configuration, List.of(new SkillSetting(closed, "fixed_skill", false, null))));
        var sources = result.source().skillSources().stream().filter(source -> source.skillKey().equals("fixed_skill")).toList();
        assertEquals(2, sources.size());
        assertEquals(1, sources.stream().filter(source -> source.inactiveReason() == InactiveReason.SCENE_DISABLED).count());
        assertEquals(1, sources.stream().filter(source -> source.inactiveReason() == null).count());
        assertEquals(2, result.source().selectedBuilds().getFirst().configuration().selections().size());
        assertEquals(1, result.skillConfigurations().stream().filter(skill -> skill.skill().skillKey().equals("fixed_skill")).count());
        verify(fixture.configurations).get(GAME, "fixed_skill");
        var reopened = fixture.service.get(GAME, select(configuration, List.of()));
        assertNotEquals(result.snapshotDigest(), reopened.snapshotDigest());
        assertEquals(result.source().selectedBuilds(), reopened.source().selectedBuilds());
    }

    @Test
    void skillSwitchesCannotRefundCumulativeRankCosts() throws Exception {
        install(pointDefinition("FIXED", 4, List.of(), List.of()));
        var configuration = pointSelection(2, Map.of());
        Origin origin = Origin.build("build", configuration.selections().getFirst());
        assertIssue(select(configuration, List.of(new SkillSetting(origin, "fixed_skill", false, null))), "BUDGET_EXCEEDED", ".budgets");
        verifyNoInteractions(fixture.configurations);
    }

    @Test
    void exactCumulativeBudgetIsAcceptedAndFixedBudgetMustNotBeResubmitted() throws Exception {
        install(pointDefinition("FIXED", 5, List.of(), List.of()));
        fixture.configuration("fixed_skill", 5, constant());
        fixture.configuration("scaled_skill", 3, constant());
        fixture.service.get(GAME, select(pointSelection(2, Map.of()), List.of()));
        assertIssue(select(pointSelection(2, Map.of("points", 5)), List.of()), "REFERENCE_OUT_OF_SCOPE", ".budgets");
    }

    @Test
    void scenarioBudgetIsExplicitAndUnknownBudgetKeysAreNotAccepted() throws Exception {
        install(pointDefinition("SCENARIO_INPUT", null, List.of(), List.of()));
        fixture.configuration("fixed_skill", 5, constant());
        fixture.configuration("scaled_skill", 3, constant());
        assertIssue(select(pointSelection(2, Map.of()), List.of()), "BUDGET_REQUIRED", ".budgets.points");
        assertIssue(select(pointSelection(2, Map.of("wrong", 5)), List.of()), "BUDGET_REQUIRED", ".budgets.points");
        assertIssue(select(pointSelection(2, Map.of("points", 4)), List.of()), "BUDGET_EXCEEDED", ".budgets.points");
        fixture.service.get(GAME, select(pointSelection(2, Map.of("points", 5)), List.of()));
    }

    @Test
    void emptyGroupRolesDoNotGainACompatibilityRoleForAnyNonemptySelection() {
        var definition = pointDefinition("FIXED", 20, List.of(), List.of());
        var system = definition.system();
        definition = new BuildDefinitionResponse(new BuildSystemResponse(GAME, "build", system.name(), null,
            system.configurationMode(), 0, new SelectionRules(List.of(), system.selectionRules().budget(), List.of(), List.of()),
            null, null), definition.groups(), definition.options(), definition.skillRelations());
        install(definition);
        assertIssue(select(pointSelection(2, Map.of()), List.of()), "REFERENCE_OUT_OF_SCOPE", ".groupAssignments[0]");
        var invalid = new BuildConfiguration("build", List.of(), pointSelection(2, Map.of()).selections(), Map.of());
        assertIssue(select(invalid, List.of()), "REFERENCE_OUT_OF_SCOPE", ".selections[0]");
        var empty = fixture.service.get(GAME, select(new BuildConfiguration("build", List.of(), List.of(), Map.of()), List.of()));
        assertTrue(empty.source().skillSources().stream().noneMatch(source -> source.origin().kind().equals("BUILD_OPTION")));
    }

    @Test
    void prerequisitesAndExclusionsValidateTheWholeSelectionBeforeSkillOverrides() {
        install(pointDefinition("FIXED", 30, List.of(new Prerequisite("power", 3, "other", 2)), List.of()));
        assertIssue(select(pointSelection(3, Map.of()), List.of()), "PREREQUISITE_UNMET", ".selections");
        var both = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")),
            List.of(new OptionSelection("main", "tree", "one", "power", 2),
                new OptionSelection("main", "tree", "one", "other", 1)), Map.of());
        install(pointDefinition("FIXED", 30, List.of(), List.of(new Exclusion(List.of("power", "other"), 1))));
        assertIssue(select(both, List.of()), "EXCLUSION_VIOLATED", ".selections");
    }

    @Test
    void unknownRolesSlotsOptionsAndInvalidRanksAreRejectedWithSelectionPaths() {
        install(pointDefinition("FIXED", 20, List.of(), List.of()));
        for (OptionSelection option : List.of(new OptionSelection("main", "tree", "unlisted", "power", 1),
            new OptionSelection("main", "tree", "one", "missing", 1),
            new OptionSelection("other_role", "tree", "one", "power", 1))) {
            assertIssue(select(new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")), List.of(option), Map.of()),
                List.of()), "REFERENCE_OUT_OF_SCOPE", ".selections[0]");
        }
        assertIssue(select(pointSelection(0, Map.of()), List.of()), "LEVEL_OUT_OF_RANGE", ".rank");
        assertIssue(select(pointSelection(4, Map.of()), List.of()), "LEVEL_OUT_OF_RANGE", ".rank");
        assertIssue(select(new BuildConfiguration("build", List.of(), List.of(), Map.of()), List.of()),
            "SELECTION_COUNT_INVALID", ".groupAssignments");
    }

    @Test
    void slotCountsAndDistinctRoleConstraintsAreNeverInferredFromNames() {
        install(slotDefinition());
        var tooFew = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")),
            List.of(new OptionSelection("main", "tree", "one", "power", 1)), Map.of());
        assertIssue(select(tooFew, List.of()), "SELECTION_COUNT_INVALID", ".selections");
        var main = new GroupRole("main", "主组", List.of("tree"), 1, 1, 0, 0, List.of("secondary"), List.of());
        var secondary = new GroupRole("secondary", "副组", List.of("tree"), 1, 1, 0, 0, List.of(), List.of());
        var definition = new BuildDefinitionResponse(new BuildSystemResponse(GAME, "build", "构筑", null, "SLOT_SELECTION", 0,
            new SelectionRules(List.of(secondary, main), null, List.of(), List.of()), null, null),
            List.of(new BuildGroupResponse(GAME, "build", "tree", "分组", null, 0, List.of(), null, null)), List.of(), List.of());
        install(definition);
        var both = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree"), new GroupAssignment("secondary", "tree")), List.of(), Map.of());
        assertIssue(select(both, List.of()), "GROUPS_NOT_DISTINCT", ".groupAssignments");
    }

    @Test
    void buildLevelsCannotBeOverriddenAndGrantDoesNotExistBelowActivation() throws Exception {
        install(pointDefinition("FIXED", 20, List.of(), List.of()));
        fixture.configuration("fixed_skill", 5, constant());
        fixture.configuration("scaled_skill", 3, constant());
        var configuration = pointSelection(2, Map.of());
        Origin origin = Origin.build("build", configuration.selections().getFirst());
        assertIssue(select(configuration, List.of(new SkillSetting(origin, "fixed_skill", true, 3))),
            "LEVEL_OVERRIDE_FORBIDDEN", ".skillLevel");
        assertIssue(select(pointSelection(1, Map.of()), List.of(new SkillSetting(origin, "fixed_skill", false, null))),
            "SOURCE_NOT_SELECTED", ".origin");
    }

    @Test
    void normalizedSelectionOrderDoesNotChangeDigestOrCollapseInstances() throws Exception {
        install(slotDefinition());
        fixture.configuration("fixed_skill", 5, constant());
        var options = List.of(new OptionSelection("main", "tree", "one", "power", 1), new OptionSelection("main", "tree", "two", "power", 1));
        var first = fixture.service.get(GAME, select(new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")), options, Map.of()), List.of()));
        var second = fixture.service.get(GAME, select(new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")), options.reversed(), Map.of()), List.of()));
        assertEquals(first.snapshotDigest(), second.snapshotDigest());
        assertEquals(first.selection(), second.selection());
        assertEquals(2, second.source().skillSources().stream().filter(source -> source.skillKey().equals("fixed_skill")).count());
    }

    private void install(BuildDefinitionResponse definition) {
        when(fixture.builds.definition(GAME, "build")).thenReturn(definition);
    }

    @Test
    void rankIssueUsesTheOriginalSelectionIndexBeforeSorting() {
        install(pointDefinition("FIXED", 20, List.of(), List.of()));
        var configuration = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")),
            List.of(new OptionSelection("main", "tree", "one", "power", 0), new OptionSelection("main", "tree", "one", "other", 1)), Map.of());
        assertIssue(select(configuration, List.of()), "LEVEL_OUT_OF_RANGE", ".selections[0].rank");
    }

    @Test
    void pointAllocationDoesNotAllowTheSameOptionViaTwoLegalRoles() {
        var definition = pointDefinition("FIXED", 20, List.of(), List.of());
        var roles = new java.util.ArrayList<>(definition.system().selectionRules().groupRoles());
        roles.add(new GroupRole("secondary", "副组", List.of("tree"), 1, 1, 0, 1, List.of(),
            List.of(new SlotRule("tree", "one", 0, 2))));
        var rules = new SelectionRules(roles, definition.system().selectionRules().budget(), List.of(), List.of());
        install(new BuildDefinitionResponse(new BuildSystemResponse(GAME, "build", "构筑", null, "POINT_ALLOCATION", 0, rules, null, null),
            definition.groups(), definition.options(), definition.skillRelations()));
        var configuration = new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree"), new GroupAssignment("secondary", "tree")),
            List.of(new OptionSelection("main", "tree", "one", "power", 1), new OptionSelection("secondary", "tree", "one", "power", 1)), Map.of());
        assertIssue(select(configuration, List.of()), "DUPLICATE_OPTION", ".selections[1].optionKey");
    }

    private Selection select(BuildConfiguration configuration, List<SkillSetting> settings) {
        Selection base = fixture.choice();
        return new Selection(base.sourceCharacterKey(), base.sourceLevel(), base.targetCharacterKey(), base.targetLevel(),
            base.basicAttackSkillKey(), base.basicAttackLevel(), List.of(), List.of(), List.of(configuration), List.of(), settings, List.of(), List.of());
    }

    private void assertIssue(Selection selection, String code, String path) {
        ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, selection));
        assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        assertTrue(error.getDetails().toString().contains(code), error.getDetails().toString());
        assertTrue(error.getDetails().toString().contains(path), error.getDetails().toString());
    }

    private static SkillSource source(Combatant combatant, String key) {
        return combatant.skillSources().stream().filter(source -> source.skillKey().equals(key)).findFirst().orElseThrow();
    }

    private static BuildConfiguration pointSelection(int rank, Map<String, Integer> budgets) {
        return new BuildConfiguration("build", List.of(new GroupAssignment("main", "tree")),
            List.of(new OptionSelection("main", "tree", "one", "power", rank)), budgets);
    }

    private static BuildDefinitionResponse pointDefinition(String maximumSource, Integer fixedMaximum,
                                                           List<Prerequisite> prerequisites, List<Exclusion> exclusions) {
        var role = new GroupRole("main", "主组", List.of("tree"), 1, 1, 0, 1, List.of(),
            List.of(new SlotRule("tree", "one", 0, 2)));
        var rules = new SelectionRules(List.of(role), new Budget("points", "点数", maximumSource, fixedMaximum), prerequisites, exclusions);
        return new BuildDefinitionResponse(new BuildSystemResponse(GAME, "build", "构筑", null, "POINT_ALLOCATION", 0, rules, null, null),
            List.of(new BuildGroupResponse(GAME, "build", "tree", "分组", null, 0,
                List.of(new BuildSlot("one", "位置", 0, 2, List.of("power", "other"))), null, null)),
            List.of(new BuildOptionResponse(GAME, "build", "power", "投入", null, 3, List.of(2, 3, 5), null, null),
                new BuildOptionResponse(GAME, "build", "other", "前置", null, 3, List.of(1, 1, 1), null, null)),
            List.of(grant("fixed_skill", 2, "FIXED", 3), grant("scaled_skill", 2, "SAME_AS_OPTION", null)));
    }

    private static BuildDefinitionResponse slotDefinition() {
        var role = new GroupRole("main", "主组", List.of("tree"), 1, 1, 2, 2, List.of(),
            List.of(new SlotRule("tree", "one", 1, 1), new SlotRule("tree", "two", 1, 1)));
        return new BuildDefinitionResponse(new BuildSystemResponse(GAME, "build", "构筑", null, "SLOT_SELECTION", 0,
            new SelectionRules(List.of(role), null, List.of(), List.of()), null, null),
            List.of(new BuildGroupResponse(GAME, "build", "tree", "分组", null, 0,
                List.of(new BuildSlot("one", "位置一", 1, 1, List.of("power")), new BuildSlot("two", "位置二", 1, 1, List.of("power"))), null, null)),
            List.of(new BuildOptionResponse(GAME, "build", "power", "投入", null, 1, List.of(0), null, null)),
            List.of(grant("fixed_skill", 1, "FIXED", 3)));
    }

    private static BuildOptionSkillRelationResponse grant(String skill, int activation, String mode, Integer level) {
        return new BuildOptionSkillRelationResponse(GAME, "build", "power", "投入", skill, skill, SkillStatus.ENABLED, activation, mode, level, 0);
    }

    private static String constant() {
        return """
            {"effects":[%s],"triggerRules":[%s]}
            """.formatted(heal("heal", "{\"kind\":\"FIXED\",\"value\":1}"), initialization("initialize", "heal"));
    }
}
