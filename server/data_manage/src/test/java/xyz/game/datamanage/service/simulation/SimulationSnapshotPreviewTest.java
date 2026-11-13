package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.simulation.SimulationPreviewUpdate;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.SkillSetting;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Origin;
import xyz.game.datamanage.model.simulation.SimulationSnapshotResponse.Selection;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationSaveRequest;
import xyz.game.datamanage.model.skillconfiguration.SkillConfigurationResponse;
import xyz.game.datamanage.model.skill.SkillResponse;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotPreviewTest {
    private static final String SPELL = "candidate_source";

    @Test void projectedConfigurationRebuildsTrueRootsReferencesAndCatalogsWithoutChangingNormalRead() throws Exception {
        var fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, SPELL);
        var before = fixture.configuration(SPELL, 1, "{}");
        SkillConfigurationResponse originalCandidate = candidate(fixture);
        SkillResponse skill = originalCandidate.skill();
        SkillConfigurationResponse candidate = new SkillConfigurationResponse(new SkillResponse(skill.gameId(), skill.skillKey(),
            "候选名称", skill.description(), skill.maxLevel(), skill.status(), skill.sortOrder(), skill.skillCategoryKeys(), skill.createdAt(), skill.updatedAt()),
            originalCandidate.parameters(), originalCandidate.formulas(), originalCandidate.effects(), originalCandidate.processes(),
            originalCandidate.internalStates(), originalCandidate.triggerRules(), originalCandidate.baseDigest());
        when(fixture.configurations.get(GAME, SPELL)).thenReturn(before);
        var request = new SkillConfigurationSaveRequest(before.baseDigest(), null, List.of());
        when(fixture.configurations.previewUpdate(GAME, SPELL, request)).thenReturn(candidate);

        var original = fixture.service.get(GAME, fixture.choice());
        assertTrue(original.catalogs().modifierZones().isEmpty());
        var projected = fixture.service.preview(GAME, fixture.choice(), List.of(new SimulationPreviewUpdate(SPELL, request)));
        assertEquals(List.of("bonus_zone"), projected.catalogs().modifierZones().stream().map(zone -> zone.modifierZoneKey()).toList());
        assertTrue(projected.references().stream().anyMatch(reference -> reference.sourceSkillKey().equals(SPELL)
            && reference.targetType().equals("MODIFIER_ZONE") && reference.targetKey().equals("bonus_zone")));
        assertEquals(List.of("initialize"), projected.source().skillSources().stream().filter(source -> source.skillKey().equals(SPELL))
            .findFirst().orElseThrow().enabledRuleKeys());
        assertEquals("候选名称", projected.source().attachedSkills().stream().filter(relation -> relation.skillKey().equals(SPELL)).findFirst().orElseThrow().skillName());
        assertNotEquals(original.snapshotDigest(), projected.snapshotDigest());
        var after = fixture.service.get(GAME, fixture.choice());
        assertEquals(original.snapshotDigest(), after.snapshotDigest());
        assertEquals(before, after.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals(SPELL)).findFirst().orElseThrow());
        verify(fixture.configurations, never()).update(any(), any(), any());
        verify(fixture.configurations, never()).create(any(), any(), any());
    }

    @Test void absentAndDisabledCandidateSourcesCannotPassAsExecutedOverrides() throws Exception {
        for (boolean attached : List.of(false, true)) {
            var fixture = new SimulationSnapshotFixture();
            if (attached) fixture.attach("hero_a", ATTACK, SPELL);
            var candidate = candidate(fixture);
            var request = new SkillConfigurationSaveRequest("base", null, List.of());
            when(fixture.configurations.previewUpdate(GAME, SPELL, request)).thenReturn(candidate);
            Selection selection = fixture.choice();
            if (attached) selection = new Selection(selection.sourceCharacterKey(), selection.sourceLevel(), selection.targetCharacterKey(),
                selection.targetLevel(), selection.basicAttackSkillKey(), selection.basicAttackLevel(), selection.sourceEquipmentKeys(),
                selection.targetEquipmentKeys(), selection.sourceBuildConfigurations(), selection.targetBuildConfigurations(),
                List.of(new SkillSetting(Origin.character("hero_a"), SPELL, false, null)), selection.targetSkillSettings(), selection.plannedSkills());
            Selection chosen = selection;
            ApiException exception = assertThrows(ApiException.class, () -> fixture.service.preview(GAME, chosen,
                List.of(new SimulationPreviewUpdate(SPELL, request))));
            assertTrue(exception.getDetails().toString().contains("PREVIEW_UPDATE_NOT_CONSUMED"));
        }
    }

    @Test void duplicateOrEmptyUpdatesAreRejectedBeforeAnyConfigurationSave() throws Exception {
        var fixture = new SimulationSnapshotFixture();
        assertThrows(ApiException.class, () -> fixture.service.preview(GAME, fixture.choice(), List.of()));
        var candidate = candidate(fixture);
        var request = new SkillConfigurationSaveRequest("base", null, List.of());
        when(fixture.configurations.previewUpdate(GAME, SPELL, request)).thenReturn(candidate);
        var update = new SimulationPreviewUpdate(SPELL, request);
        assertThrows(ApiException.class, () -> fixture.service.preview(GAME, fixture.choice(), List.of(update, update)));
        verify(fixture.configurations, never()).update(any(), any(), any());
    }

    private SkillConfigurationResponse candidate(SimulationSnapshotFixture fixture) throws Exception {
        return fixture.configuration(SPELL, 1, """
            {"effects":[{"effectKey":"power","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
             "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
             "expiryMode":"EXPLICIT_ONLY"},"results":[
              {"resultKey":"attribute","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","sortOrder":0,
               "detail":{"attributeKey":"attack_speed","operation":"INCREASE","modifierZoneKey":"bonus_zone"},
               "valueRule":{"value":{"kind":"FIXED","value":0.2},"fixedMultiplier":1},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE"}}]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
              "actions":[{"actionKey":"mount","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"power"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
    }
}
