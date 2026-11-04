package xyz.game.datamanage.support.account;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor;
import org.springframework.dao.support.PersistenceExceptionTranslator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountStoreProxyTest {
    @Test void realRepositoryProxyDelegatesJdbcAccessToTheInitializedTarget() {
        try (var context=new AnnotationConfigApplicationContext(Config.class)) {
            AccountStore store=context.getBean(AccountStore.class);
            JdbcTemplate jdbc=context.getBean(JdbcTemplate.class);
            assertTrue(AopUtils.isCglibProxy(store));assertSame(jdbc,store.jdbc());
            when(jdbc.queryForObject(anyString(),eq(Long.class),any(Object[].class))).thenReturn(0L);
            assertDoesNotThrow(()->new AccountRateLimits(store).check("password_account","fixture_author"));
            verify(jdbc).queryForObject(anyString(),eq(Long.class),any(Object[].class));
        }
    }
    @Configuration static class Config {
        @Bean static PersistenceExceptionTranslationPostProcessor translation() {
            var processor=new PersistenceExceptionTranslationPostProcessor();processor.setProxyTargetClass(true);return processor;
        }
        @Bean PersistenceExceptionTranslator translator() { return exception->null; }
        @Bean JdbcTemplate jdbc() { return mock(JdbcTemplate.class); }
        @Bean PlatformTransactionManager manager() { return mock(PlatformTransactionManager.class); }
        @Bean AccountStore store(JdbcTemplate jdbc,PlatformTransactionManager manager) { return new AccountStore(jdbc,manager); }
    }
}
