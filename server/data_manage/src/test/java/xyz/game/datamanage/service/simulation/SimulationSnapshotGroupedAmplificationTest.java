package xyz.game.datamanage.service.simulation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static xyz.game.datamanage.service.simulation.SimulationSnapshotFixture.*;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.model.modifierzone.*;
import xyz.game.datamanage.model.skilleffect.SkillEffectAttributeChangeDetail;
import xyz.game.datamanage.model.skilleffect.SkillEffectDamageModifierDetail;
import xyz.game.datamanage.support.error.ApiException;

class SimulationSnapshotGroupedAmplificationTest {
    @Test void snapshotKeepsTheOriginalZoneKeysAndValueRulesForAllThreeGroups() throws Exception {
        var fixture = configured();
        var snapshot = fixture.service.get(GAME, fixture.choice());
        assertEquals(List.of("attr_group", "damage_post_group", "damage_pre_group"),
            snapshot.catalogs().modifierZones().stream().map(ModifierZoneResponse::modifierZoneKey).toList());
        assertTrue(snapshot.catalogs().modifierZones().stream().allMatch(zone -> zone.calculationMode() == ModifierZoneCalculationMode.RATIO_GROUP_ADD));
        var effect = snapshot.skillConfigurations().stream().filter(row -> row.skill().skillKey().equals("amplifier"))
            .findFirst().orElseThrow().effects().getFirst();
        assertEquals("attr_group", ((SkillEffectAttributeChangeDetail) effect.results().get(0).detail()).modifierZoneKey());
        assertEquals("damage_pre_group", ((SkillEffectDamageModifierDetail) effect.results().get(1).detail()).modifierZoneKey());
        assertEquals("damage_post_group", ((SkillEffectDamageModifierDetail) effect.results().get(2).detail()).modifierZoneKey());
        assertEquals(0, new BigDecimal("0.2").compareTo(effect.results().getFirst().valueRule().value().value()));
        assertEquals(3, snapshot.references().stream().filter(row -> row.sourceSkillKey().equals("amplifier")
            && row.fieldPath().endsWith("detail.modifierZoneKey")).count());
    }

    @Test void disabledOrForeignCatalogRowsStillRefuseTheSnapshot() throws Exception {
        for (String game : List.of(GAME, "other_game")) {
            var fixture = configured();
            when(fixture.zones.get(GAME, "attr_group")).thenReturn(new ModifierZoneResponse(game, "attr_group", "分组",
                ModifierZoneDomain.ATTRIBUTE, ModifierZoneCalculationMode.RATIO_GROUP_ADD, ModifierZoneApplicationStage.ATTRIBUTE_PERCENT,
                null, game.equals(GAME) ? ModifierZoneStatus.DISABLED : ModifierZoneStatus.ENABLED, 0, null, null));
            assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
        }
    }

    @Test void snapshotIndependentlyRejectsInvalidStoredRatiosAndActionOverrides() throws Exception {
        for (boolean actionOverride : List.of(false, true)) {
            var fixture = configured();
            var configuration = fixture.configurations.get(GAME, "amplifier");
            com.fasterxml.jackson.databind.node.ObjectNode payload = fixture.json.valueToTree(configuration);
            if (actionOverride) {
                var modifiers = ((com.fasterxml.jackson.databind.node.ObjectNode) payload.path("triggerRules").get(0).path("actions").get(0))
                    .putArray("resultModifiers");
                modifiers.addObject().put("resultKey", "attribute").put("fixedMultiplier", -1).put("fixedMinValue", 0);
            } else {
                ((com.fasterxml.jackson.databind.node.ObjectNode) payload.path("effects").get(0).path("results").get(0)
                    .path("valueRule").path("value")).put("value", new BigDecimal("-0.2"));
            }
            fixture.configuration("amplifier", 1, payload.toString());
            ApiException error = assertThrows(ApiException.class, () -> fixture.service.get(GAME, fixture.choice()));
            assertEquals("409.SIMULATION_SNAPSHOT_INVALID", error.getCode());
        }
    }

    private SimulationSnapshotFixture configured() throws Exception {
        var fixture = new SimulationSnapshotFixture();
        fixture.attach("hero_a", ATTACK, "amplifier");
        for (String key : List.of("attr_group", "damage_pre_group", "damage_post_group")) {
            when(fixture.zones.get(GAME, key)).thenReturn(new ModifierZoneResponse(GAME, key, "分组",
                key.equals("attr_group") ? ModifierZoneDomain.ATTRIBUTE : ModifierZoneDomain.DAMAGE,
                ModifierZoneCalculationMode.RATIO_GROUP_ADD, key.equals("attr_group") ? ModifierZoneApplicationStage.ATTRIBUTE_PERCENT
                    : key.equals("damage_pre_group") ? ModifierZoneApplicationStage.DAMAGE_PRE_DEFENSE : ModifierZoneApplicationStage.DAMAGE_POST_DEFENSE,
                null, ModifierZoneStatus.ENABLED, 0, null, null));
        }
        fixture.configuration("amplifier", 1, """
            {"effects":[{"effectKey":"power","lifecycle":{"durationValue":null,"maxStacksValue":{"kind":"FIXED","value":1},
             "applicationStacksValue":{"kind":"FIXED","value":1},"instanceScope":"SOURCE","reapplicationStackMode":"KEEP",
             "expiryMode":"EXPLICIT_ONLY"},"results":[
              {"resultKey":"attribute","resultType":"ATTRIBUTE_CHANGE","target":"SOURCE","sortOrder":0,
               "detail":{"attributeKey":"attack_speed","operation":"INCREASE","modifierZoneKey":"attr_group"},
               "valueRule":{"value":{"kind":"FIXED","value":0.2},"fixedMultiplier":1},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE"}},
              {"resultKey":"dealt","resultType":"DAMAGE_MODIFIER","target":"SOURCE","sortOrder":1,
               "detail":{"modifierZoneKey":"damage_pre_group","direction":"DEALT","operation":"INCREASE","damageTypeKey":null,"deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY"},
               "valueRule":{"value":{"kind":"FIXED","value":0.3},"fixedMultiplier":1},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE"}},
              {"resultKey":"taken","resultType":"DAMAGE_MODIFIER","target":"SOURCE","sortOrder":2,
               "detail":{"modifierZoneKey":"damage_post_group","direction":"TAKEN","operation":"INCREASE","damageTypeKey":null,"deliveryKind":"ANY","originKind":"ANY","criticalFilter":"ANY"},
               "valueRule":{"value":{"kind":"FIXED","value":0.1},"fixedMultiplier":1},
               "lifecycleBehavior":{"moment":"PERSISTENT","valueReadMode":"APPLICATION_SNAPSHOT","stackValueMode":"SHARED","reapplicationValueMode":"REPLACE"}}]}],
             "triggerRules":[{"ruleKey":"initialize","eventSource":{"eventType":"SOURCE_INITIALIZED","detail":{}},"conditionGroups":[],
              "actions":[{"actionKey":"mount","actionType":"EXECUTE_EFFECT","targetContext":"EVENT_SOURCE","detail":{"effectKey":"power"},"runtimeInputBindings":[],"resultModifiers":[]}]}]}
            """);
        return fixture;
    }
}
