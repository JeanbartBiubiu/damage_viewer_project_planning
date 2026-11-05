package xyz.game.datamanage.support.account;

import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/** 校验密码输入并在当前调用线程执行数据库密码操作。 */
@Component
public class PasswordTasks {
    private final AccountDatabaseCrypto database;
    public PasswordTasks(AccountDatabaseCrypto database) { this.database=database; }
    public String encode(String password, String username) {
        validate(password, username);
        return database.encode(password);
    }
    public boolean matches(String password, String encoded) {
        validateInput(password);
        return database.matches(password,encoded);
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
}
