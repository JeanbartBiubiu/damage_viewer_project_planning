package xyz.game.datamanage.controller.adminapi.build;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import xyz.game.datamanage.controller.adminapi.skillrelation.BuildOptionSkillRelationAdminController;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
import xyz.game.datamanage.model.build.BuildSystemResponse;
import xyz.game.datamanage.model.skillrelation.BuildOptionSkillRelationResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.build.BuildSystemService;
import xyz.game.datamanage.service.skillrelation.BuildOptionSkillRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = {BuildSystemAdminController.class, BuildOptionSkillRelationAdminController.class})
@Import({xyz.game.datamanage.support.auth.AccountControllerTestConfig.class, AdminAuthFilter.class, GlobalExceptionHandler.class, BuildSystemAdminControllerTest.Transactions.class})
class BuildSystemAdminControllerTest {
    private static final String ROOT = "/api/admin/games/lol";
    @Autowired MockMvc mvc;
    @MockitoBean BuildSystemService systems;
    @MockitoBean BuildOptionSkillRelationService relations;
    @MockitoBean GameDataService logs;

    @Test
    void writesForwardAndLogWhileDefinitionStaysReadOnly() throws Exception {
        var rules = new BuildSystemResponse.SelectionRules(List.of(), null, List.of(), List.of());
        var system = new BuildSystemResponse("lol", "runes", "符文", null, "SLOT_SELECTION", 0, rules, null, null);
        when(systems.createSystem(eq("lol"), any())).thenReturn(system);
        mvc.perform(post(ROOT + "/build-systems").contentType(MediaType.APPLICATION_JSON).content("{\"systemKey\":\"runes\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.systemKey").value("runes"));
        verify(logs).recordEditLog(org.mockito.ArgumentMatchers.any(java.util.UUID.class), eq("fixture_author"), eq("POST"), eq(ROOT + "/build-systems"), any(JsonNode.class), eq(201));

        when(systems.definition("lol", "runes")).thenReturn(new BuildDefinitionResponse(system, List.of(), List.of(), List.of()));
        mvc.perform(get(ROOT + "/build-systems/runes/definition"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.system.systemKey").value("runes"))
            .andExpect(jsonPath("$.groups").isArray())
            .andExpect(jsonPath("$.options").isArray())
            .andExpect(jsonPath("$.skillRelations").isArray());
        verify(logs, never()).recordEditLog(org.mockito.ArgumentMatchers.any(java.util.UUID.class), any(), eq("GET"), any(), any(), anyInt());
    }

    @Test
    void skillGrantRoutesUseTheCollectionAndTheStablePath() throws Exception {
        var relation = new BuildOptionSkillRelationResponse(
            "lol", "runes", "focus", "专注", "fire", "火焰", null, 1, "FIXED", 1, 0);
        when(relations.create(eq("lol"), any())).thenReturn(relation);
        mvc.perform(post(ROOT + "/build-option-skill-relations").contentType(MediaType.APPLICATION_JSON)
                .content("{\"systemKey\":\"runes\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.optionKey").value("focus"));
        mvc.perform(delete(ROOT + "/build-option-skill-relations/runes/focus/fire")).andExpect(status().isNoContent());
        verify(relations).delete("lol", "runes", "focus", "fire");
    }

    @Test
    void oldRuneRoutesAreAbsent() throws Exception {
        mvc.perform(get(ROOT + "/runes")).andExpect(status().isNotFound());
        mvc.perform(get(ROOT + "/rune-paths")).andExpect(status().isNotFound());
        mvc.perform(get(ROOT + "/rune-skill-relations")).andExpect(status().isNotFound());
    }

    @TestConfiguration
    @EnableTransactionManagement
    static class Transactions {
        @Bean PlatformTransactionManager transactionManager() { return new AbstractPlatformTransactionManager() {
            @Override protected Object doGetTransaction() { return new Object(); }
            @Override protected void doBegin(Object transaction, TransactionDefinition definition) {}
            @Override protected void doCommit(DefaultTransactionStatus status) {}
            @Override protected void doRollback(DefaultTransactionStatus status) {}
        }; }
    }
}
