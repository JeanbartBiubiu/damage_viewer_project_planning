package xyz.game.datamanage.support.account;

import org.springframework.http.HttpStatus;
import xyz.game.datamanage.support.error.ApiException;

public final class AccountErrors {
    private AccountErrors() {}
    public static ApiException invalid() { return new ApiException(HttpStatus.UNAUTHORIZED, "AUTH.INVALID_CREDENTIALS", "凭据无效，请核对后重试"); }
    public static ApiException flow() { return new ApiException(HttpStatus.CONFLICT, "AUTH.FLOW_CONFLICT", "流程已失效或当前阶段不允许此操作"); }
    public static ApiException expired() { return new ApiException(HttpStatus.GONE, "AUTH.FLOW_EXPIRED", "流程已过期，请重新开始"); }
    public static ApiException bad() { return new ApiException(HttpStatus.BAD_REQUEST, "AUTH.INVALID_REQUEST", "请求字段或格式不正确"); }
    public static ApiException unavailable() { return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "AUTH.UNAVAILABLE", "账号服务暂时不可用，请稍后重试"); }
    public static void enabled(AccountStore.Account a) {
        if ("disabled".equals(a.status())) throw new ApiException(HttpStatus.FORBIDDEN, "AUTH.ACCOUNT_DISABLED", "账号已禁用");
        if (a.canLogin() != 1) throw new ApiException(HttpStatus.FORBIDDEN, "AUTH.LOGIN_NOT_ENABLED", "账号尚未开通");
        if (!"active".equals(a.status())) throw flow();
    }
}
