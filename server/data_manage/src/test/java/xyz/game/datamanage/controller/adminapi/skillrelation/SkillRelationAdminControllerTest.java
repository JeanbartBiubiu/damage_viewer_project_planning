package xyz.game.datamanage.controller.adminapi.skillrelation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skillrelation.SkillRelationMapper;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skill.SkillStatus;
import xyz.game.datamanage.model.skillrelation.CharacterSkillRelationResponse;
import xyz.game.datamanage.model.skillrelation.EquipmentSkillRelationResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.skillrelation.SkillRelationService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = {CharacterSkillRelationAdminController.class, EquipmentSkillRelationAdminController.class})
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class, SkillRelationService.class, SkillRelationAdminControllerTest.Transactions.class})
class SkillRelationAdminControllerTest {
    @MockitoBean private xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    @Autowired private MockMvc mockMvc;
    @Autowired private RecordingTransactionManager transactions;
    @MockitoBean private GamesMapper gamesMapper;
    @MockitoBean private CharacterMapper characterMapper;
    @MockitoBean private EquipmentMapper equipmentMapper;
    @MockitoBean private SkillMapper skillMapper;
    @MockitoBean private SkillRelationMapper mapper;
    @MockitoBean private GameDataService gameDataService;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void setUp() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext()).thenReturn(new AuthContext("admin@example.com", true, true));
        when(gamesMapper.countGames("lol")).thenReturn(1L);
        transactions.commits = 0;
        transactions.rollbacks = 0;
    }

    @ParameterizedTest
    @ValueSource(strings = {"character", "equipment"})
    void exposesFullResponsesAndLogsAllWrites(String source) throws Exception {
        stubSources();
        if (source.equals("character")) {
            var row = new CharacterSkillRelationResponse("lol", "source", "角色", "fire", "火焰", SkillStatus.ENABLED, 2);
            when(mapper.listCharacterRelations("lol", "source", "fire")).thenReturn(List.of(row));
            when(mapper.findCharacterRelation("lol", "source", "fire")).thenReturn(null, row);
            when(mapper.insertCharacterRelation("lol", "source", "fire", 2)).thenReturn(1);
            when(mapper.updateCharacterRelation("lol", "source", "fire", 2)).thenReturn(1);
            when(mapper.deleteCharacterRelation("lol", "source", "fire")).thenReturn(1);
        } else {
            var row = new EquipmentSkillRelationResponse("lol", "source", "装备", "fire", "火焰", SkillStatus.ENABLED, 2);
            when(mapper.listEquipmentRelations("lol", "source", "fire")).thenReturn(List.of(row));
            when(mapper.findEquipmentRelation("lol", "source", "fire")).thenReturn(null, row);
            when(mapper.insertEquipmentRelation("lol", "source", "fire", 2)).thenReturn(1);
            when(mapper.updateEquipmentRelation("lol", "source", "fire", 2)).thenReturn(1);
            when(mapper.deleteEquipmentRelation("lol", "source", "fire")).thenReturn(1);
        }
        String base = "/api/admin/games/lol/" + source + "-skill-relations";
        mockMvc.perform(get(base).queryParam(source + "Key", "source").queryParam("skillKey", "fire"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0]." + source + "Key").value("source"))
            .andExpect(jsonPath("$.items[0]." + source + "Name").isString())
            .andExpect(jsonPath("$.items[0].gameId").value("lol"))
            .andExpect(jsonPath("$.items[0].skillName").value("火焰"))
            .andExpect(jsonPath("$.items[0].skillStatus").value("ENABLED"));

        mockMvc.perform(post(base).contentType(MediaType.APPLICATION_JSON)
                .content("{\"" + source + "Key\":\"source\",\"skillKey\":\"fire\",\"sortOrder\":2}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$." + source + "Name").isString())
            .andExpect(jsonPath("$.skillStatus").value("ENABLED"))
            .andExpect(jsonPath("$.sortOrder").value(2));

        mockMvc.perform(put(base + "/source/fire").contentType(MediaType.APPLICATION_JSON)
                .content("{\"sortOrder\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.skillKey").value("fire"));
        mockMvc.perform(delete(base + "/source/fire")).andExpect(status().isNoContent());

        verify(gameDataService).recordEditLog(eq("admin@example.com"), eq("POST"), eq(base), any(), eq(201));
        verify(gameDataService).recordEditLog(eq("admin@example.com"), eq("PUT"), eq(base + "/source/fire"), any(), eq(200));
        verify(gameDataService).recordEditLog(eq("admin@example.com"), eq("DELETE"), eq(base + "/source/fire"), any(), eq(204));
    }

    @ParameterizedTest
    @ValueSource(strings = {"-1", "2147483648", "1.5", "1.0", "\"1\"", "null", "true"})
    void refusesNonIntegerOrOutOfRangeSortOrder(String sortOrder) throws Exception {
        mockMvc.perform(post("/api/admin/games/lol/character-skill-relations").contentType(MediaType.APPLICATION_JSON)
                .content("{\"characterKey\":\"source\",\"skillKey\":\"fire\",\"sortOrder\":" + sortOrder + "}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("sortOrder"));
        verify(mapper, never()).insertCharacterRelation(any(), any(), any(), anyInt());
        verify(gameDataService, never()).recordEditLog(any(), any(), any(), any(), anyInt());
    }

    @ParameterizedTest
    @ValueSource(strings = {"character", "equipment"})
    void refusesUnknownFieldsAndImmutablePutKeys(String source) throws Exception {
        String base = "/api/admin/games/lol/" + source + "-skill-relations";
        mockMvc.perform(post(base).contentType(MediaType.APPLICATION_JSON)
                .content("{\"" + source + "Key\":\"source\",\"skillKey\":\"fire\",\"sortOrder\":0,\"extra\":true}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("extra"));

        mockMvc.perform(put(base + "/source/fire").contentType(MediaType.APPLICATION_JSON)
                .content("{\"sortOrder\":0,\"skillKey\":\"other\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("skillKey"));
        mockMvc.perform(put(base + "/source/fire").contentType(MediaType.APPLICATION_JSON)
                .content("{\"sortOrder\":0,\"unknownFields\":[]}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("unknownFields"));
        verify(gameDataService, never()).recordEditLog(any(), any(), any(), any(), anyInt());
    }

    @Test
    void refusesEmptyFilterAndMissingSortOrder() throws Exception {
        mockMvc.perform(get("/api/admin/games/lol/character-skill-relations"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"));
        mockMvc.perform(put("/api/admin/games/lol/equipment-skill-relations/source/fire")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.details.fieldIssues[0].field").value("sortOrder"));
    }

    @Test
    void existingAdminPermissionsProtectWrites() throws Exception {
        when(jwtVerifier.isDisabled()).thenReturn(false);
        when(jwtVerifier.verify("test-token")).thenReturn(new AuthContext("viewer@example.com", false, false));
        mockMvc.perform(post("/api/admin/games/lol/character-skill-relations")
                .header("Authorization", "Bearer test-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"characterKey\":\"source\",\"skillKey\":\"fire\",\"sortOrder\":0}"))
            .andExpect(status().isForbidden());
        verify(mapper, never()).insertCharacterRelation(any(), any(), any(), anyInt());
    }

    @Test
    void logFailureRollsBackSameTransactionAsRelationWrite() throws Exception {
        stubSources();
        var row = new CharacterSkillRelationResponse("lol", "source", "角色", "fire", "火焰", SkillStatus.ENABLED, 0);
        when(mapper.findCharacterRelation("lol", "source", "fire")).thenReturn(null, row);
        when(mapper.insertCharacterRelation("lol", "source", "fire", 0)).thenAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals(0, transactions.commits);
            return 1;
        });
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals(0, transactions.commits);
            throw new IllegalStateException("测试日志写入失败");
        }).when(gameDataService).recordEditLog(any(), any(), any(), any(), anyInt());

        mockMvc.perform(post("/api/admin/games/lol/character-skill-relations")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"characterKey\":\"source\",\"skillKey\":\"fire\",\"sortOrder\":0}"))
            .andExpect(status().isInternalServerError());
        assertEquals(0, transactions.commits);
        assertEquals(1, transactions.rollbacks);
    }

    private void stubSources() {
        var character = new CharacterResponse("lol", "source", "角色", null, null, null);
        var equipment = new EquipmentResponse("lol", "source", "装备", null, null, null);
        var skill = new SkillRow("lol", "fire", "火焰", null, 1, SkillStatus.ENABLED, 0, null, null);
        when(characterMapper.findById("lol", "source")).thenReturn(character);
        when(characterMapper.findByIdForUpdate("lol", "source")).thenReturn(character);
        when(equipmentMapper.findById("lol", "source")).thenReturn(equipment);
        when(equipmentMapper.findByIdForUpdate("lol", "source")).thenReturn(equipment);
        when(skillMapper.findById("lol", "fire")).thenReturn(skill);
        when(skillMapper.findByIdForUpdate("lol", "fire")).thenReturn(skill);
    }

    @TestConfiguration
    @EnableTransactionManagement
    static class Transactions {
        @Bean
        RecordingTransactionManager transactionManager() {
            return new RecordingTransactionManager();
        }
    }

    static class RecordingTransactionManager extends AbstractPlatformTransactionManager {
        private final ThreadLocal<Boolean> active = ThreadLocal.withInitial(() -> false);
        int commits;
        int rollbacks;

        @Override
        protected Object doGetTransaction() {
            return active.get();
        }

        @Override
        protected boolean isExistingTransaction(Object transaction) {
            return Boolean.TRUE.equals(transaction);
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            active.set(true);
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            commits++;
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            rollbacks++;
        }

        @Override
        protected void doSetRollbackOnly(DefaultTransactionStatus status) {
        }

        @Override
        protected void doCleanupAfterCompletion(Object transaction) {
            active.remove();
        }
    }
}
