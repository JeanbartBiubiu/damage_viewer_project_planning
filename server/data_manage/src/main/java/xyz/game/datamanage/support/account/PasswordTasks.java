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
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

/** 64 MiB、3次迭代；只允许1个活动密码任务和4个等待任务。 */
@Component
public class PasswordTasks {
    private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 65536, 3);
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4), r -> {
        Thread t = new Thread(r, "account-password"); t.setDaemon(true); return t;
    }, new ThreadPoolExecutor.AbortPolicy());
    private final String dummy;
    public PasswordTasks() {
        // 启动时准备未知账号的等价验证值，避免首次未知账号额外执行一次哈希。
        dummy=task(()->encoder.encode(java.util.UUID.randomUUID().toString()));
    }
    public String encode(String password, String username) {
        validate(password, username);
        return task(() -> encoder.encode(password));
    }
    public boolean matches(String password, String encoded) {
        if (password == null || password.length() > 256 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512) throw AccountErrors.bad();
        return task(() -> {
            String actual = encoded;
            if (actual == null) {
                actual = dummy;
            }
            boolean valid = encoder.matches(password, actual);
            return encoded != null && valid;
        });
    }
    static void validate(String password, String username) {
        if (password == null || password.codePointCount(0,password.length()) < 12 || password.codePointCount(0,password.length()) > 128
            || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512
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
