package xyz.game.datamanage.controller.adminapi.imagerelation;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.SmartTransactionObject;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageRequest;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.imagerelation.ImageRelationService;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.error.ApiException;

/** 检查真实 Spring 代理的事务参与和缓存刷新，不替代数据库回滚验收。 */
class ImageRelationWriteTransactionTest {
    private AnnotationConfigApplicationContext context;
    private ImageRelationAdminController controller;
    private ImageRelationMapper mapper;
    private GameDataService gameData;
    private TestTransactionManager transactions;
    private Cache cache;
    private static final AuthContext AUTH = new AuthContext("author@example.com", true, true);

    @BeforeEach
    void setup() {
        context = new AnnotationConfigApplicationContext(Config.class);
        controller = context.getBean(ImageRelationAdminController.class);
        mapper = context.getBean(ImageRelationMapper.class);
        gameData = context.getBean(GameDataService.class);
        transactions = context.getBean(TestTransactionManager.class);
        cache = context.getBean(CacheManager.class).getCache("games");
        when(context.getBean(GamesMapper.class).countGames("lol")).thenReturn(1L);
        when(mapper.countSource(eq("lol"), anyString(), anyString(), anyString())).thenReturn(1L);
        when(mapper.findImage("lol", "icon")).thenReturn(new RepresentativeImageResponse.Image("icon", "图标", true));
    }

    @AfterEach
    void close() { context.close(); }

    @Test
    void gamePutAndDeleteEvictOnlyStage9KeyAndCommitEachRelationAndLogTogether() {
        Map<String, String> legacySummary = Map.of("gameImgUrl", "旧格式封面");
        cache.put("all", legacySummary);
        assertNull(cache.get("all:stage9"));
        cache.put("all:stage9", "旧封面");
        cache.put("other", "其他键");
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals(0, transactions.commits);
            return null;
        }).when(gameData).recordEditLog(anyString(), eq("PUT"), anyString(), any(), eq(200));

        controller.put(Map.of("gameId", "lol"), request(), AUTH, http("PUT"));

        assertNull(cache.get("all:stage9"));
        assertEquals(legacySummary, cache.get("all").get());
        assertEquals("其他键", cache.get("other", String.class));
        assertEquals(1, transactions.begins);
        assertEquals(1, transactions.commits);
        assertEquals(0, transactions.rollbacks);
        cache.put("all:stage9", "新封面");
        when(mapper.findImageKey("lol", "GAME", "", "lol")).thenReturn("icon");
        when(mapper.deleteForSource("lol", "GAME", "", "lol")).thenReturn(1);

        controller.delete(Map.of("gameId", "lol"), AUTH, http("DELETE"));

        assertNull(cache.get("all:stage9"));
        assertEquals(legacySummary, cache.get("all").get());
        assertEquals(2, transactions.commits);
        verify(gameData).recordEditLog(eq(AUTH.email()), eq("DELETE"), anyString(), any(), eq(204));
    }

    @Test
    void otherSourceWritesKeepGameCache() {
        cache.put("all:stage9", "游戏摘要");
        controller.put(Map.of("gameId", "lol", "characterKey", "ezreal"), request(), AUTH, http("PUT"));
        assertEquals("游戏摘要", cache.get("all:stage9", String.class));
        when(mapper.findImageKey("lol", "CHARACTER", "", "ezreal")).thenReturn("icon");
        when(mapper.deleteForSource("lol", "CHARACTER", "", "ezreal")).thenReturn(1);
        controller.delete(Map.of("gameId", "lol", "characterKey", "ezreal"), AUTH, http("DELETE"));
        assertEquals("游戏摘要", cache.get("all:stage9", String.class));
    }

    @Test
    void cacheConditionsWorkWithoutCompiledParameterNames() {
        var noParameterNames = new org.springframework.core.ParameterNameDiscoverer() {
            @Override public String[] getParameterNames(java.lang.reflect.Method method) { return null; }
            @Override public String[] getParameterNames(java.lang.reflect.Constructor<?> constructor) { return null; }
        };
        var parser = new org.springframework.expression.spel.standard.SpelExpressionParser();
        for (var method : ImageRelationService.class.getDeclaredMethods()) {
            var eviction = method.getAnnotation(org.springframework.cache.annotation.CacheEvict.class);
            if (eviction == null) continue;
            for (var source : xyz.game.datamanage.model.imagerelation.ImageRelationSource.values()) {
                Object[] arguments = method.getParameterCount() == 5
                    ? new Object[] {"lol", source, "", "sample", request()}
                    : new Object[] {"lol", source, "", "sample"};
                var evaluation = new org.springframework.context.expression.MethodBasedEvaluationContext(
                    new Object(), method, arguments, noParameterNames);
                assertEquals(source == xyz.game.datamanage.model.imagerelation.ImageRelationSource.GAME,
                    parser.parseExpression(eviction.condition()).getValue(evaluation, Boolean.class),
                    method.getName() + ":" + source);
            }
        }
    }

    @Test
    void rejectedGameWriteDoesNotEvictOrLog() {
        cache.put("all:stage9", "原摘要");
        assertThrows(ApiException.class, () -> controller.put(Map.of("gameId", "lol"),
            new RepresentativeImageRequest("", Set.of()), AUTH, http("PUT")));
        assertEquals("原摘要", cache.get("all:stage9", String.class));
        assertEquals(1, transactions.rollbacks);
        assertEquals(0, transactions.commits);
        verifyNoInteractions(gameData);
    }

    @Test
    void editLogFailureRollsBackTheTransactionContainingRelationWrite() {
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            return 1;
        }).when(mapper).put("lol", "GAME", "", "lol", "icon");
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            throw new IllegalStateException("编辑日志写入失败");
        }).when(gameData).recordEditLog(anyString(), anyString(), anyString(), any(), anyInt());

        assertThrows(IllegalStateException.class, () -> controller.put(Map.of("gameId", "lol"), request(), AUTH, http("PUT")));

        verify(mapper).put("lol", "GAME", "", "lol", "icon");
        assertEquals(1, transactions.begins);
        assertEquals(0, transactions.commits);
        assertEquals(1, transactions.rollbacks);
    }

    private static RepresentativeImageRequest request() { return new RepresentativeImageRequest("icon", Set.of()); }
    private static MockHttpServletRequest http(String method) {
        return new MockHttpServletRequest(method, "/api/admin/games/lol/representative-image");
    }

    @Configuration(proxyBeanMethods = false)
    @EnableCaching
    @EnableTransactionManagement(proxyTargetClass = true)
    @Import({ImageRelationService.class, ImageRelationAdminController.class})
    static class Config {
        @Bean xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites() { return mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class); }
        @Bean GamesMapper games() { return mock(GamesMapper.class); }
        @Bean ImageRelationMapper mapper() { return mock(ImageRelationMapper.class); }
        @Bean GameDataService gameData() { return mock(GameDataService.class); }
        @Bean ObjectMapper objectMapper() { return new ObjectMapper(); }
        @Bean CacheManager cacheManager() { return new ConcurrentMapCacheManager("games"); }
        @Bean TestTransactionManager transactionManager() { return new TestTransactionManager(); }
    }

    static class TestTransactionManager extends AbstractPlatformTransactionManager {
        int begins;
        int commits;
        int rollbacks;
        private final ThreadLocal<Tx> current = new ThreadLocal<>();

        @Override protected Object doGetTransaction() { return current.get() == null ? new Tx() : current.get(); }
        @Override protected boolean isExistingTransaction(Object transaction) { return ((Tx) transaction).active; }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) {
            Tx tx = (Tx) transaction;
            tx.active = true;
            current.set(tx);
            begins++;
        }
        @Override protected void doCommit(DefaultTransactionStatus status) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus status) { rollbacks++; }
        @Override protected void doSetRollbackOnly(DefaultTransactionStatus status) { ((Tx) status.getTransaction()).rollback = true; }
        @Override protected void doCleanupAfterCompletion(Object transaction) { current.remove(); }

        static class Tx implements SmartTransactionObject {
            boolean active;
            boolean rollback;
            @Override public boolean isRollbackOnly() { return rollback; }
            @Override public void flush() {}
        }
    }
}
