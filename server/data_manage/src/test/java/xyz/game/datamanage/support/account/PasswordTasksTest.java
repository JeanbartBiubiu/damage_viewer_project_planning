package xyz.game.datamanage.support.account;

import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PasswordTasksTest {
    @SuppressWarnings("unchecked") private <T> T work(PasswordTasks tasks,Supplier<T> work) {
        try {
            var method=PasswordTasks.class.getDeclaredMethod("task",Supplier.class);method.setAccessible(true);return (T)method.invoke(tasks,work);
        } catch (InvocationTargetException e) { throw (RuntimeException)e.getCause(); }
        catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    private ThreadPoolExecutor pool(PasswordTasks tasks) throws Exception {
        var field=PasswordTasks.class.getDeclaredField("pool");field.setAccessible(true);return (ThreadPoolExecutor)field.get(tasks);
    }
    private void await(CountDownLatch latch) { try { if(!latch.await(5,TimeUnit.SECONDS)) throw new AssertionError("测试等待超时"); } catch (InterruptedException e) { throw new AssertionError(e); } }
    @Test void onlyOnePasswordOperationAndFourWaitingOperationsAreAdmitted() throws Exception {
        PasswordTasks tasks=new PasswordTasks(mock(AccountDatabaseCrypto.class));var callers=Executors.newFixedThreadPool(6);
        CountDownLatch active=new CountDownLatch(1),release=new CountDownLatch(1);
        try {
            var first=callers.submit(()->work(tasks,()-> { active.countDown();await(release);return 1; }));await(active);
            var waiting=new ArrayList<java.util.concurrent.Future<Integer>>();for(int i=0;i<4;i++) waiting.add(callers.submit(()->work(tasks,()->2)));
            long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(500);
            while(pool(tasks).getQueue().size()<4 && System.nanoTime()<deadline) Thread.sleep(2);
            assertEquals(4,pool(tasks).getQueue().size());
            assertEquals(503,assertThrows(ApiException.class,()->work(tasks,()->3)).getStatus().value());
            release.countDown();assertEquals(1,first.get(3,TimeUnit.SECONDS));for(var result:waiting) assertEquals(2,result.get(3,TimeUnit.SECONDS));
        } finally { release.countDown();callers.shutdownNow();tasks.close(); }
    }
    @Test void waitingDeadlineCancelsWorkInsteadOfRunningItLater() throws Exception {
        PasswordTasks tasks=new PasswordTasks(mock(AccountDatabaseCrypto.class));var callers=Executors.newSingleThreadExecutor();
        CountDownLatch active=new CountDownLatch(1),release=new CountDownLatch(1);AtomicBoolean ran=new AtomicBoolean();
        try {
            var first=callers.submit(()->work(tasks,()->{active.countDown();await(release);return 1;}));await(active);
            assertEquals(503,assertThrows(ApiException.class,()->work(tasks,()->{ran.set(true);return 2;})).getStatus().value());
            release.countDown();first.get(3,TimeUnit.SECONDS);assertFalse(ran.get());
        } finally { release.countDown();callers.shutdownNow();tasks.close(); }
    }
    @Test void passwordsKeepWhitespaceAndRejectOversizedOrMalformedInputBeforeDatabaseAccess() {
        var database=mock(AccountDatabaseCrypto.class);PasswordTasks tasks=new PasswordTasks(database);
        try {
            when(database.encode("  fixture password  ")).thenReturn(AccountDatabaseCrypto.DUMMY_HASH);
            String encoded=tasks.encode("  fixture password  ","fixture_author");verify(database).encode("  fixture password  ");
            tasks.matches("  fixture password  ",encoded);verify(database).matches("  fixture password  ",encoded);
            assertThrows(ApiException.class,()->tasks.encode("password1234","fixture_author"));assertThrows(ApiException.class,()->tasks.encode("A".repeat(129),"fixture_author"));
            for(String invalid:java.util.List.of("a".repeat(73),"中".repeat(25),"x".repeat(12)+"\0","x".repeat(12)+"\uD800","x".repeat(12)+"\uDC00")) {
                assertThrows(ApiException.class,()->tasks.matches(invalid,encoded));assertThrows(ApiException.class,()->tasks.encode(invalid,"fixture_author"));
            }
            verifyNoMoreInteractions(database);
            assertDoesNotThrow(()->PasswordTasks.validateInput("a".repeat(72)));
            assertDoesNotThrow(()->PasswordTasks.validateInput("😀".repeat(18)));
            assertThrows(ApiException.class,()->PasswordTasks.validateInput("😀".repeat(19)));
        } finally { tasks.close(); }
    }
}
