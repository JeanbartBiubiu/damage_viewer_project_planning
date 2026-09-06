package xyz.game.datamanage.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.character.CharacterMapper;
import xyz.game.datamanage.mapper.equipment.EquipmentMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.skill.SkillMapper;
import xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper;
import xyz.game.datamanage.mapper.skillformula.SkillFormulaMapper;
import xyz.game.datamanage.mapper.skillinternalstate.SkillInternalStateMapper;
import xyz.game.datamanage.mapper.skillparameter.SkillParameterMapper;
import xyz.game.datamanage.mapper.skillprocess.SkillProcessMapper;
import xyz.game.datamanage.mapper.skillrelation.SkillRelationMapper;
import xyz.game.datamanage.mapper.status.StatusMapper;
import xyz.game.datamanage.model.skill.SkillRow;
import xyz.game.datamanage.model.skilleffect.SkillEffectRow;
import xyz.game.datamanage.model.status.StatusResponse;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.service.equipment.EquipmentService;
import xyz.game.datamanage.service.skill.SkillService;
import xyz.game.datamanage.service.skilleffect.SkillEffectService;
import xyz.game.datamanage.service.skillparameter.SkillParameterLevelService;
import xyz.game.datamanage.service.skilltrigger.SkillTriggerRuleService;
import xyz.game.datamanage.service.status.StatusService;
import xyz.game.datamanage.support.error.ApiException;

class ImageSourceDeletionServiceTest {

    private static final String GAME = "lol";
    private static final String SKILL = "ezreal_q";
    private static final String SOURCE = "source_key";

    enum SourceKind { CHARACTER, EQUIPMENT, STATUS, SKILL, SKILL_EFFECT }

    @ParameterizedTest
    @EnumSource(SourceKind.class)
    void successfulSourceDeletionCleansTheCorrectImageScopeInOneTransaction(SourceKind kind) {
        Fixture fixture = fixture(kind, 1);

        fixture.delete().run();

        if (kind == SourceKind.SKILL) {
            verify(fixture.images()).deleteForSkill(GAME, SKILL);
        } else {
            verify(fixture.images()).deleteForSource(
                GAME, kind.name(), kind == SourceKind.SKILL_EFFECT ? SKILL : "", SOURCE
            );
        }
        assertEquals(1, fixture.transactions().commits);
        assertEquals(0, fixture.transactions().rollbacks);
    }

    @ParameterizedTest
    @EnumSource(SourceKind.class)
    void imageCleanupFailurePropagatesAndRollsBackSourceDeletion(SourceKind kind) {
        Fixture fixture = fixture(kind, 1);
        IllegalStateException failure = new IllegalStateException("image relation cleanup failed");
        if (kind == SourceKind.SKILL) {
            doThrow(failure).when(fixture.images()).deleteForSkill(GAME, SKILL);
        } else {
            doThrow(failure).when(fixture.images()).deleteForSource(
                GAME, kind.name(), kind == SourceKind.SKILL_EFFECT ? SKILL : "", SOURCE
            );
        }

        assertSame(failure, assertThrows(IllegalStateException.class, fixture.delete()::run));

        assertEquals(0, fixture.transactions().commits);
        assertEquals(1, fixture.transactions().rollbacks);
    }

    @ParameterizedTest
    @EnumSource(SourceKind.class)
    void missingSourceDoesNotCleanImagesAndRollsBack(SourceKind kind) {
        Fixture fixture = fixture(kind, 0);

        ApiException exception = assertThrows(ApiException.class, fixture.delete()::run);

        assertEquals("404." + kind.name() + "_NOT_FOUND", exception.getCode());
        verifyNoInteractions(fixture.images());
        assertEquals(0, fixture.transactions().commits);
        assertEquals(1, fixture.transactions().rollbacks);
    }

    private static Fixture fixture(SourceKind kind, int deletedRows) {
        GamesMapper games = mock(GamesMapper.class);
        ImageRelationMapper images = mock(ImageRelationMapper.class);
        SkillTriggerRuleService triggers = mock(SkillTriggerRuleService.class);
        SkillMapper skills = mock(SkillMapper.class);
        SkillRow existingSkill = mock(SkillRow.class);
        when(games.countGames(GAME)).thenReturn(1L);
        when(skills.findByIdForUpdate(GAME, SKILL)).thenReturn(existingSkill);
        RecordingTransactions transactions = new RecordingTransactions();
        ObjectMapper objectMapper = new ObjectMapper();
        Runnable delete = switch (kind) {
            case CHARACTER -> {
                CharacterMapper mapper = mock(CharacterMapper.class);
                when(mapper.deleteCharacter(GAME, SOURCE)).thenReturn(deletedRows);
                CharacterService service = transactional(new CharacterService(
                    games, mapper, mock(SkillParameterMapper.class),
                    new SkillParameterLevelService(objectMapper), objectMapper, images
                , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)), transactions);
                yield () -> service.delete(GAME, SOURCE);
            }
            case EQUIPMENT -> {
                EquipmentMapper mapper = mock(EquipmentMapper.class);
                when(mapper.deleteEquipment(GAME, SOURCE)).thenReturn(deletedRows);
                EquipmentService service = transactional(new EquipmentService(
                    games, mapper, objectMapper, images
                , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)), transactions);
                yield () -> service.delete(GAME, SOURCE);
            }
            case STATUS -> {
                StatusMapper mapper = mock(StatusMapper.class);
                StatusResponse existingStatus = mock(StatusResponse.class);
                when(mapper.findByIdForUpdate(GAME, SOURCE)).thenReturn(existingStatus);
                when(mapper.delete(GAME, SOURCE)).thenReturn(deletedRows);
                StatusService service = transactional(new StatusService(
                    games, mapper, triggers, images
                , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)), transactions);
                yield () -> service.delete(GAME, SOURCE);
            }
            case SKILL -> {
                when(skills.delete(GAME, SKILL)).thenReturn(deletedRows);
                SkillService service = transactional(new SkillService(
                    games, skills, mock(SkillParameterMapper.class), mock(SkillFormulaMapper.class),
                    mock(SkillEffectMapper.class), mock(SkillProcessMapper.class),
                    mock(SkillInternalStateMapper.class), new SkillParameterLevelService(objectMapper),
                    triggers, images, mock(SkillRelationMapper.class)
                , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)), transactions);
                yield () -> service.delete(GAME, SKILL);
            }
            case SKILL_EFFECT -> {
                SkillEffectMapper mapper = mock(SkillEffectMapper.class);
                SkillEffectRow existingEffect = mock(SkillEffectRow.class);
                when(mapper.findEffectForUpdate(GAME, SKILL, SOURCE)).thenReturn(existingEffect);
                when(mapper.deleteEffect(GAME, SKILL, SOURCE)).thenReturn(deletedRows);
                SkillEffectService service = transactional(new SkillEffectService(
                    games, skills, mapper, triggers, images
                , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class)), transactions);
                yield () -> service.delete(GAME, SKILL, SOURCE);
            }
        };
        return new Fixture(delete, images, transactions);
    }

    @SuppressWarnings("unchecked")
    private static <T> T transactional(T target, RecordingTransactions transactions) {
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        return (T) factory.getProxy();
    }

    private record Fixture(Runnable delete, ImageRelationMapper images, RecordingTransactions transactions) {}

    // 验证 Spring 的事务提交/回滚选择；数据库持久化结果仍由实库验收证明。
    private static class RecordingTransactions extends AbstractPlatformTransactionManager {
        private int commits;
        private int rollbacks;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {}

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            commits++;
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            rollbacks++;
        }
    }
}
