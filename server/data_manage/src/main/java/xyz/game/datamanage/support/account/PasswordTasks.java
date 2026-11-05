package xyz.game.datamanage.support.account;

import jakarta.annotation.PreDestroy;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/** 数据库密码任务只允许1个活动任务和4个等待任务，准入后才取得连接。 */
@Component
public class PasswordTasks {
    private final AccountDatabaseCrypto database;
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4), r -> {
        Thread t = new Thread(r, "account-password"); t.setDaemon(true); return t;
    }, new ThreadPoolExecutor.AbortPolicy());
    public PasswordTasks(AccountDatabaseCrypto database) { this.database=database; }
    public String encode(String password, String username) {
        validate(password, username);
        return task(() -> database.encode(password));
    }
    public boolean matches(String password, String encoded) {
        validateInput(password);
        return task(() -> database.matches(password,encoded));
    }
    static void validateInput(String password) {
        if(password==null || password.indexOf('\0')>=0) throw AccountErrors.bad();
        for(int i=0;i<password.length();i++) {
            char c=password.charAt(i);
            if(Character.isHighSurrogate(c)) {if(i+1>=password.length() || !Character.isLowSurrogate(password.charAt(++i))) throw AccountErrors.bad();}
            else if(Character.isLowSurrogate(c)) throw AccountErrors.bad();
        }
        if(password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72) throw AccountErrors.bad();
    }
    static void validate(String password, String username) {
        validateInput(password);
        if (password.codePointCount(0,password.length()) < 12
            || password.isBlank() || password.codePoints().distinct().count() < 4
            || password.equalsIgnoreCase(username) || Set.of("password1234", "password123456", "123456789012", "qwertyuiop12")
                .contains(password.toLowerCase(Locale.ROOT))) throw AccountErrors.bad();
    }
    private <T> T task(Supplier<T> work) {
        CountDownLatch started = new CountDownLatch(1);
        Future<T> future;
        try { future = pool.submit(() -> { started.countDown(); return work.get(); }); }
        catch (java.util.concurrent.RejectedExecutionException e) { throw AccountErrors.unavailable(); }
        try {
            if (!started.await(1, TimeUnit.SECONDS)) { future.cancel(false); pool.purge(); throw AccountErrors.unavailable(); }
            return future.get();
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); future.cancel(false); throw AccountErrors.unavailable(); }
        catch (java.util.concurrent.ExecutionException e) { throw AccountErrors.unavailable(); }
    }
    @PreDestroy public void close() { pool.shutdownNow(); }
}
