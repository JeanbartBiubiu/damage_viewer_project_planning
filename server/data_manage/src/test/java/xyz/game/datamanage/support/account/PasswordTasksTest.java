package xyz.game.datamanage.support.account;

import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PasswordTasksTest {
    @Test void databaseWorkRunsInTheCallerThreadWithoutAnotherExecutor() {
        var database=mock(AccountDatabaseCrypto.class);var tasks=new PasswordTasks(database);Thread caller=Thread.currentThread();
        when(database.encode(anyString())).thenAnswer(i->{assertSame(caller,Thread.currentThread());return AccountDatabaseCrypto.DUMMY_HASH;});
        when(database.matches(anyString(),any())).thenAnswer(i->{assertSame(caller,Thread.currentThread());return true;});
        assertTrue(tasks.encode("fixture password","fixture_author").startsWith("$2a$10$"));assertTrue(tasks.matches("fixture password",null));
    }
    @Test void eightDifferentCallersCanEnterEncodeAndMatchesAtTheSameTime() throws Exception {
        for(boolean encode:List.of(true,false)) {
            var database=mock(AccountDatabaseCrypto.class);var tasks=new PasswordTasks(database);var callers=Executors.newFixedThreadPool(8);
            var allEntered=new CountDownLatch(8);AtomicInteger active=new AtomicInteger(),maximum=new AtomicInteger();
            org.mockito.stubbing.Answer<Object> work=i->{int count=active.incrementAndGet();maximum.accumulateAndGet(count,Math::max);allEntered.countDown();
                try {assertTrue(allEntered.await(5,TimeUnit.SECONDS));return encode?AccountDatabaseCrypto.DUMMY_HASH:true;}
                finally {active.decrementAndGet();}};
            if(encode) when(database.encode(anyString())).thenAnswer(work);else when(database.matches(anyString(),any())).thenAnswer(work);
            try {var futures=new java.util.ArrayList<Future<?>>();for(int i=0;i<8;i++) futures.add(callers.submit(()->{if(encode) tasks.encode("fixture password","fixture_author");else tasks.matches("fixture password",null);}));
                for(var result:futures) result.get(8,TimeUnit.SECONDS);assertEquals(8,maximum.get());
            } finally {callers.shutdownNow();}
        }
    }
    @Test void inputsRemainUnmodifiedAndInvalidUtf8NeverReachesDatabase() {
        var database=mock(AccountDatabaseCrypto.class);var tasks=new PasswordTasks(database);
        tasks.encode("  fixture password  ","fixture_author");tasks.matches("  fixture password  ",null);
        verify(database).encode("  fixture password  ");verify(database).matches("  fixture password  ",null);
        for(String value:List.of("a".repeat(73),"中".repeat(25),"x".repeat(12)+"\0","x".repeat(12)+"\uD800","x".repeat(12)+"\uDC00")) {
            assertEquals(400,assertThrows(ApiException.class,()->tasks.encode(value,"fixture_author")).getStatus().value());assertEquals(400,assertThrows(ApiException.class,()->tasks.matches(value,null)).getStatus().value());
        }
        assertThrows(ApiException.class,()->tasks.encode("password1234","fixture_author"));verifyNoMoreInteractions(database);
    }
    @Test void technicalFailuresRemain503WithoutPoolSpecificWrapping() {
        var database=mock(AccountDatabaseCrypto.class);var tasks=new PasswordTasks(database);var failure=AccountErrors.unavailable();
        when(database.matches(anyString(),any())).thenThrow(failure);assertSame(failure,assertThrows(ApiException.class,()->tasks.matches("fixture password",null)));
    }
}
