package xyz.game.datamanage.support.account;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;

/** 与Spring路由相同：每段只解码一次并去掉矩阵参数，不按原始URI字符串授权。 */
public final class AccountRequestPath {
    private AccountRequestPath() {}
    public static String path(HttpServletRequest request) {
        StringBuilder path=new StringBuilder();
        for (PathContainer.Element element:RequestPath.parse(request.getRequestURI(),request.getContextPath()).pathWithinApplication().elements()) {
            if (element instanceof PathContainer.PathSegment segment) path.append(segment.valueToMatch());
            else path.append(element.value());
        }
        return path.toString();
    }
}
