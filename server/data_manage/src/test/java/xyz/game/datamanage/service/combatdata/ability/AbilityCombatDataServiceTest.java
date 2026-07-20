package xyz.game.datamanage.service.combatdata.ability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCooldownsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityCostsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityDefinitionsMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityParametersMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityPhasesMapper;
import xyz.game.datamanage.mapper.combatdata.CombatAbilityStateFieldsMapper;
import xyz.game.datamanage.service.combatdata.revision.GameDataRevisionService;
import xyz.game.datamanage.service.combatdata.support.CombatDataSupport;

@ExtendWith(MockitoExtension.class)
class AbilityCombatDataServiceTest {

    private static final String GAME_ID = "lol";
    private static final String ABILITY_ID = "ability-1";

    @Mock private GamesMapper gamesMapper;
    @Mock private GameDataRevisionService revisionService;
    @Mock private CombatAbilityDefinitionsMapper abilitiesMapper;
    @Mock private CombatAbilityParametersMapper parametersMapper;
    @Mock private CombatAbilityStateFieldsMapper stateFieldsMapper;
    @Mock private CombatAbilityPhasesMapper phasesMapper;
    @Mock private CombatAbilityCostsMapper costsMapper;
    @Mock private CombatAbilityCooldownsMapper cooldownsMapper;

    private AbilityCombatDataService service;

    @BeforeEach
    void setUp() {
        CombatDataSupport support = new CombatDataSupport(new ObjectMapper(), gamesMapper, revisionService);
        service = new AbilityCombatDataService(
            support,
            revisionService,
            abilitiesMapper,
            parametersMapper,
            stateFieldsMapper,
            phasesMapper,
            costsMapper,
            cooldownsMapper
        );
        when(gamesMapper.countGames(GAME_ID)).thenReturn(1L);
    }

    @Test
    void putAbilityForwardsCastConditionFormulaKeyWhenPresent() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(21L);
        when(abilitiesMapper.findById(GAME_ID, ABILITY_ID)).thenReturn(abilityRow("cast-ok", null));

        ObjectNode body = baseAbilityBody();
        body.put("castConditionFormulaKey", "cast-ok");

        ObjectNode response = service.putAbility(GAME_ID, ABILITY_ID, body);

        assertEquals(21L, response.get("currentRevision").asLong());
        assertEquals("cast-ok", response.get("castConditionFormulaKey").asText());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(21L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            eq("cast-ok"),
            isNull()
        );
    }

    @Test
    void putAbilityForwardsNullCastConditionWhenAbsentOrNull() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(22L);
        when(abilitiesMapper.findById(GAME_ID, ABILITY_ID)).thenReturn(abilityRow(null, null));

        ObjectNode bodyAbsent = baseAbilityBody();
        ObjectNode responseAbsent = service.putAbility(GAME_ID, ABILITY_ID, bodyAbsent);
        assertTrue(responseAbsent.get("castConditionFormulaKey").isNull());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(22L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            isNull(),
            isNull()
        );

        when(revisionService.nextRevision(GAME_ID)).thenReturn(23L);
        ObjectNode bodyNull = baseAbilityBody();
        bodyNull.putNull("castConditionFormulaKey");
        ObjectNode responseNull = service.putAbility(GAME_ID, ABILITY_ID, bodyNull);
        assertTrue(responseNull.get("castConditionFormulaKey").isNull());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(23L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            isNull(),
            isNull()
        );
    }

    @Test
    void putAbilityForwardsCastOriginWhenPresent() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(24L);
        when(abilitiesMapper.findById(GAME_ID, ABILITY_ID)).thenReturn(abilityRow(null, "champion"));

        ObjectNode body = baseAbilityBody();
        body.put("castOrigin", "champion");

        ObjectNode response = service.putAbility(GAME_ID, ABILITY_ID, body);

        assertEquals(24L, response.get("currentRevision").asLong());
        assertEquals("champion", response.get("castOrigin").asText());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(24L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            isNull(),
            eq("champion")
        );
    }

    @Test
    void putAbilityForwardsNullCastOriginWhenAbsentOrNull() {
        when(revisionService.nextRevision(GAME_ID)).thenReturn(25L);
        when(abilitiesMapper.findById(GAME_ID, ABILITY_ID)).thenReturn(abilityRow(null, null));

        ObjectNode bodyAbsent = baseAbilityBody();
        ObjectNode responseAbsent = service.putAbility(GAME_ID, ABILITY_ID, bodyAbsent);
        assertTrue(responseAbsent.get("castOrigin").isNull());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(25L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            isNull(),
            isNull()
        );

        when(revisionService.nextRevision(GAME_ID)).thenReturn(26L);
        ObjectNode bodyNull = baseAbilityBody();
        bodyNull.putNull("castOrigin");
        ObjectNode responseNull = service.putAbility(GAME_ID, ABILITY_ID, bodyNull);
        assertTrue(responseNull.get("castOrigin").isNull());
        verify(abilitiesMapper).upsert(
            eq(GAME_ID),
            eq(26L),
            eq(ABILITY_ID),
            eq("provider-1"),
            eq("q"),
            eq(10),
            eq("Ability"),
            isNull(),
            isNull()
        );
    }

    private static ObjectNode baseAbilityBody() {
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("providerId", "provider-1");
        body.put("abilityKey", "q");
        body.put("abilityKindTypeId", 10);
        body.put("displayName", "Ability");
        return body;
    }

    private static Map<String, Object> abilityRow(String castConditionFormulaKey, String castOrigin) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("gameId", GAME_ID);
        row.put("abilityId", ABILITY_ID);
        row.put("providerId", "provider-1");
        row.put("abilityKey", "q");
        row.put("abilityKindTypeId", 10);
        row.put("displayName", "Ability");
        row.put("castConditionFormulaKey", castConditionFormulaKey);
        row.put("castOrigin", castOrigin);
        row.put("changeRevision", 1L);
        return row;
    }
}
