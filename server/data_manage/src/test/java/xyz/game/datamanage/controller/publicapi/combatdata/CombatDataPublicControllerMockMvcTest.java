package xyz.game.datamanage.controller.publicapi.combatdata;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.service.combatdata.ability.AbilityCombatDataService;
import xyz.game.datamanage.service.combatdata.effect.EffectCombatDataService;
import xyz.game.datamanage.service.combatdata.entity.EntityCombatDataService;
import xyz.game.datamanage.service.combatdata.provider.ProviderCombatDataService;
import xyz.game.datamanage.service.combatdata.type.CombatTypeService;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = {
    CombatDataTypePublicController.class,
    CombatDataEntityPublicController.class,
    CombatDataProviderPublicController.class,
    CombatDataAbilityPublicController.class,
    CombatDataEffectPublicController.class
})
class CombatDataPublicControllerMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CombatTypeService typeService;
    @MockitoBean
    private EntityCombatDataService entityService;
    @MockitoBean
    private ProviderCombatDataService providerService;
    @MockitoBean
    private AbilityCombatDataService abilityService;
    @MockitoBean
    private EffectCombatDataService effectService;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @Test
    void getStateReturnsEnvelope() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("currentRevision", 9);
        response.putObject("data").put("publishedRevision", 4);
        when(typeService.getState("lol")).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/combat-data/state"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.currentRevision").value(9))
            .andExpect(jsonPath("$.data.publishedRevision").value(4));
    }

    @Test
    void listEntitiesSupportsImmediateEnvelope() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("currentRevision", 5);
        response.putArray("data").addObject().put("entityId", "e1");
        when(entityService.listEntities("lol")).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/combat-data/entities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].entityId").value("e1"));
    }

    @Test
    void listEffectStepsPassesSequenceFilter() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("currentRevision", 1);
        response.putArray("data")
            .addObject()
            .put("stepId", "s1")
            .putObject("repeatDetail")
            .put("repeatTag", "on-hit");
        when(effectService.listSteps(eq("lol"), eq("seq-1"))).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/combat-data/effect-steps").param("sequenceId", "seq-1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].repeatDetail.repeatTag").value("on-hit"));
    }

    @Test
    void listProviderStateFieldsKeepsExistingRoute() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("currentRevision", 2);
        response.putArray("data")
            .addObject()
            .put("stateKey", "stacks")
            .putNull("maxValue")
            .put("durationMs", 1000)
            .putNull("refreshPolicyTypeId");
        when(providerService.listStateFields(eq("lol"), eq("p1"))).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/combat-data/provider-state-fields").param("providerId", "p1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].stateKey").value("stacks"))
            .andExpect(jsonPath("$.data[0].durationMs").value(1000));
    }

    @Test
    void listAbilitiesPassesProviderFilter() throws Exception {
        ObjectNode response = JsonNodeFactory.instance.objectNode();
        response.put("gameId", "lol");
        response.put("currentRevision", 1);
        response.putArray("data");
        when(abilityService.listAbilities(eq("lol"), eq("p1"))).thenReturn(response);

        mockMvc.perform(get("/api/games/lol/combat-data/abilities").param("providerId", "p1"))
            .andExpect(status().isOk());
    }
}
