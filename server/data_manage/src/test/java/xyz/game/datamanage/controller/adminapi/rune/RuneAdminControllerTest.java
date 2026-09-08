package xyz.game.datamanage.controller.adminapi.rune;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

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
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.controller.adminapi.skillrelation.RuneSkillRelationAdminController;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.RuneRelationMapper;
import xyz.game.datamanage.model.rune.RunePathRow;
import xyz.game.datamanage.model.rune.RuneResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.RuneSkillRelationResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.rune.RuneService;
import xyz.game.datamanage.service.skillrelation.RuneRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = {RuneAdminController.class, RunePathAdminController.class, RuneSkillRelationAdminController.class})
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class, RuneService.class, RuneRelationService.class,
    RuneAdminControllerTest.Transactions.class})
class RuneAdminControllerTest {
    private static final String ROOT = "/api/admin/games/lol";
    @Autowired MockMvc mvc;
    @Autowired RecordingTransactions transactions;
    @MockitoBean GamesMapper games;
    @MockitoBean RuneMapper runes;
    @MockitoBean ImageRelationMapper images;
    @MockitoBean SkillMapper skills;
    @MockitoBean RuneRelationMapper relations;
    @MockitoBean GameConfigurationWriteGuard writes;
    @MockitoBean GameDataService logs;
    @MockitoBean JwtVerifier jwt;

    @BeforeEach
    void setup() {
        when(jwt.isDisabled()).thenReturn(true);
        when(jwt.developmentAuthContext()).thenReturn(new AuthContext("author@example.com", true, true));
        when(games.countGames("lol")).thenReturn(1L);
        transactions.commits = 0;
        transactions.rollbacks = 0;
    }

    @Test
    void runeCrudReturnsCatalogFieldsAndLogsWritesInTheSameTransaction() throws Exception {
        var rune = new RuneResponse("lol", "focus", "专注", null, "MINOR", null, null);
        when(runes.listRunes("lol", "专注", "MINOR")).thenReturn(List.of(rune));
        mvc.perform(get(ROOT + "/runes").queryParam("keyword", "专注").queryParam("category", "MINOR"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].category").value("MINOR"))
            .andExpect(jsonPath("$.items[0].status").doesNotExist());
        when(runes.findRune("lol", "focus")).thenReturn(null, rune);
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            return 1;
        }).when(runes).insertRune(any(), any(), any(), any(), any());
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            return null;
        }).when(logs).recordEditLog(any(), any(), any(), any(), anyInt());
        mvc.perform(post(ROOT + "/runes").contentType(MediaType.APPLICATION_JSON)
            .content("{\"runeKey\":\"focus\",\"name\":\"专注\",\"category\":\"MINOR\"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.runeKey").value("focus"));
        when(runes.updateRune("lol", "focus", "专注", null, "MINOR")).thenReturn(1);
        mvc.perform(put(ROOT + "/runes/focus").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"专注\",\"description\":null,\"category\":\"MINOR\"}"))
            .andExpect(status().isOk());
        mvc.perform(get(ROOT + "/runes/focus")).andExpect(status().isOk()).andExpect(jsonPath("$.gameId").value("lol"));
        when(runes.deleteRune("lol", "focus")).thenReturn(1);
        mvc.perform(delete(ROOT + "/runes/focus")).andExpect(status().isNoContent());
        verify(images).deleteForSource("lol", "RUNE", "", "focus");
        verify(writes, times(3)).begin("lol");
        verify(logs, times(3)).recordEditLog(eq("author@example.com"), any(), any(), any(), anyInt());
        // 三次写事务；只读事务也正常提交，不把它们误计为新增写入。
        assertEquals(0, transactions.rollbacks);
    }

    @Test
    void shardLayoutIsReturnedAsAnOrderedArrayAndPathCrudKeepsIdentity() throws Exception {
        String slots = "[{\"name\":\"第一行\",\"category\":\"SHARD\",\"runeKeys\":[\"adaptive\"]},{\"name\":\"第二行\",\"category\":\"SHARD\",\"runeKeys\":[\"adaptive\"]}]";
        var path = new RunePathRow("lol", "shards", "碎片", null, "SHARD_GROUP", 2, slots, null, null);
        when(runes.findPath("lol", "shards")).thenReturn(null, path);
        when(runes.listRunes("lol", null, null)).thenReturn(List.of(
            new RuneResponse("lol", "adaptive", "适应之力", null, "SHARD", null, null)));
        String body = "{\"pathKey\":\"shards\",\"name\":\"碎片\",\"kind\":\"SHARD_GROUP\",\"sortOrder\":2,\"slots\":" + slots + "}";
        mvc.perform(post(ROOT + "/rune-paths").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.slots.length()").value(2))
            .andExpect(jsonPath("$.slots[0].runeKeys[0]").value("adaptive"))
            .andExpect(jsonPath("$.slots[1].runeKeys[0]").value("adaptive"));
        when(runes.listPaths("lol", "碎片")).thenReturn(List.of(path));
        mvc.perform(get(ROOT + "/rune-paths").queryParam("keyword", "碎片"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1));
        when(runes.updatePath(any(), any(), any(), any(), any(), anyInt(), any())).thenReturn(1);
        mvc.perform(put(ROOT + "/rune-paths/shards").contentType(MediaType.APPLICATION_JSON)
            .content(body.replace("\"pathKey\":\"shards\",", ""))).andExpect(status().isOk());
        mvc.perform(get(ROOT + "/rune-paths/shards")).andExpect(status().isOk()).andExpect(jsonPath("$.sortOrder").value(2));
        when(runes.deletePath("lol", "shards")).thenReturn(1);
        mvc.perform(delete(ROOT + "/rune-paths/shards")).andExpect(status().isNoContent());
        verify(images).deleteForSource("lol", "RUNE_PATH", "", "shards");
        verify(runes, never()).deleteRune(any(), any());
    }

    @Test
    void wrongBodyFieldAndDecimalSortKeepResourceSpecificErrorAndNoPartialWrite() throws Exception {
        mvc.perform(post(ROOT + "/runes").contentType(MediaType.APPLICATION_JSON)
            .content("{\"runeKey\":\"focus\",\"name\":\"专注\",\"category\":\"MINOR\",\"enabled\":false}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_RUNE_REQUEST"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("enabled"));
        mvc.perform(post(ROOT + "/rune-paths").contentType(MediaType.APPLICATION_JSON)
            .content("{\"pathKey\":\"shards\",\"name\":\"碎片\",\"kind\":\"SHARD_GROUP\",\"sortOrder\":1.0,\"slots\":[]}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("400.INVALID_RUNE_PATH_REQUEST"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("sortOrder"));
        verify(runes, never()).insertRune(any(), any(), any(), any(), any());
        verify(runes, never()).insertPath(any(), any(), any(), any(), any(), anyInt(), any());
        verifyNoInteractions(logs);
        assertEquals(2, transactions.rollbacks);
    }

    @Test
    void runeRelationsExposeBothFiltersAndFullResponse() throws Exception {
        var rune = new RuneResponse("lol", "focus", "专注", null, "MINOR", null, null);
        var skill = new SkillRow("lol", "fire", "火焰", null, 1, SkillStatus.ENABLED, 0, null, null);
        var relation = new RuneSkillRelationResponse("lol", "focus", "专注", "fire", "火焰", SkillStatus.ENABLED, 3);
        when(runes.findRune("lol", "focus")).thenReturn(rune);
        when(skills.findById("lol", "fire")).thenReturn(skill);
        when(skills.findByIdForUpdate("lol", "fire")).thenReturn(skill);
        when(relations.listRuneRelations("lol", "focus", "fire")).thenReturn(List.of(relation));
        mvc.perform(get(ROOT + "/rune-skill-relations").queryParam("runeKey", "focus").queryParam("skillKey", "fire"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].runeName").value("专注"))
            .andExpect(jsonPath("$.items[0].skillStatus").value("ENABLED"));
        when(relations.findRuneRelation("lol", "focus", "fire")).thenReturn(null, relation);
        when(relations.insertRuneRelation("lol", "focus", "fire", 3)).thenReturn(1);
        mvc.perform(post(ROOT + "/rune-skill-relations").contentType(MediaType.APPLICATION_JSON)
            .content("{\"runeKey\":\"focus\",\"skillKey\":\"fire\",\"sortOrder\":3}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.sortOrder").value(3));
        when(relations.updateRuneRelation("lol", "focus", "fire", 3)).thenReturn(1);
        mvc.perform(put(ROOT + "/rune-skill-relations/focus/fire").contentType(MediaType.APPLICATION_JSON)
            .content("{\"sortOrder\":3}")).andExpect(status().isOk());
        when(relations.deleteRuneRelation("lol", "focus", "fire")).thenReturn(1);
        mvc.perform(delete(ROOT + "/rune-skill-relations/focus/fire")).andExpect(status().isNoContent());
    }

    @Test
    void editLogFailureRollsBackWholeConfigurationWriteTransaction() throws Exception {
        var saved = new RuneResponse("lol", "focus", "专注", null, "MINOR", null, null);
        when(runes.findRune("lol", "focus")).thenReturn(null, saved);
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            throw new IllegalStateException("模拟日志失败");
        }).when(logs).recordEditLog(any(), any(), any(), any(), anyInt());
        mvc.perform(post(ROOT + "/runes").contentType(MediaType.APPLICATION_JSON)
            .content("{\"runeKey\":\"focus\",\"name\":\"专注\",\"category\":\"MINOR\"}"))
            .andExpect(status().isInternalServerError());
        assertEquals(0, transactions.commits);
        assertEquals(1, transactions.rollbacks);
    }

    @TestConfiguration
    @EnableTransactionManagement
    static class Transactions {
        @Bean RecordingTransactions transactionManager() { return new RecordingTransactions(); }
    }

    static class RecordingTransactions extends AbstractPlatformTransactionManager {
        private final ThreadLocal<Boolean> active = ThreadLocal.withInitial(() -> false);
        int commits;
        int rollbacks;
        @Override protected Object doGetTransaction() { return active.get(); }
        @Override protected boolean isExistingTransaction(Object transaction) { return Boolean.TRUE.equals(transaction); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) { active.set(true); }
        @Override protected void doCommit(DefaultTransactionStatus status) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus status) { rollbacks++; }
        @Override protected void doSetRollbackOnly(DefaultTransactionStatus status) {}
        @Override protected void doCleanupAfterCompletion(Object transaction) { active.remove(); }
    }
}
