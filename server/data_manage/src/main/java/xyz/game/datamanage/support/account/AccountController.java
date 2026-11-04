package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.HashSet;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/auth")
public class AccountController {
    private final AccountService service;
    private final AccountBrowser browser;
    public AccountController(AccountService service,AccountBrowser browser) { this.service=service; this.browser=browser; }
    static void fields(JsonNode body,String... names) {
        if (body==null || !body.isObject()) throw AccountErrors.bad();
        Set<String> actual=new HashSet<>(); body.fieldNames().forEachRemaining(actual::add);
        if (!actual.equals(Set.of(names))) throw AccountErrors.bad();
    }
    static String string(JsonNode body,String name) {
        JsonNode value=body.get(name);
        if (value==null || !value.isTextual()) throw AccountErrors.bad();
        return value.textValue();
    }
    private AuthContext auth(HttpServletRequest request) {
        if (!(request.getAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) instanceof AuthContext context)) throw AccountErrors.invalid();
        return context;
    }
    private Object issued(AccountService.Issued result,HttpServletResponse response) {
        if (!result.session()) response.setHeader(AccountBrowser.FLOW_CSRF_HEADER,result.csrf());
        browser.issue(response,!result.session(),result.token(),result.csrf(),result.createdAt(),result.expiresAt()); return result.view();
    }
    private Object flowResponse(HttpServletRequest request,HttpServletResponse response,java.util.function.Supplier<Object> action) {
        try { return action.get(); }
        finally {
            Object csrf=request.getAttribute(AccountBrowser.FLOW_CSRF_RESPONSE_ATTR);
            if (csrf instanceof String value) response.setHeader(AccountBrowser.FLOW_CSRF_HEADER,value);
        }
    }
    @PostMapping("/register") public Object register(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"username","password");
        return issued(service.register(string(body,"username"),string(body,"password"),request.getRemoteAddr()),response);
    }
    @PostMapping("/login") public Object login(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"username","password");
        return issued(service.login(string(body,"username"),string(body,"password"),request.getRemoteAddr()),response);
    }
    @PostMapping("/login/totp") public Object loginTotp(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"totpCode"); return flowResponse(request,response,()->issued(service.loginTotp(request,string(body,"totpCode")),response));
    }
    @GetMapping("/me") public Object me(HttpServletRequest request) { return AccountSessions.view(auth(request)); }
    @GetMapping("/flow/status") public Object status(HttpServletRequest request,HttpServletResponse response) { return flowResponse(request,response,()->service.status(request)); }
    @PostMapping("/flow/totp/setup") public Object setup(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) { fields(body); return flowResponse(request,response,()->service.setup(request)); }
    @PostMapping("/flow/totp/verify") public Object verify(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) { fields(body,"totpCode"); return flowResponse(request,response,()->service.verifyCandidate(request,string(body,"totpCode"))); }
    @GetMapping("/flow/recovery-codes") public Object codes(HttpServletRequest request,HttpServletResponse response) { return flowResponse(request,response,()->service.recoveryCodes(request)); }
    @PostMapping("/flow/recovery-codes/confirm") public Object confirm(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body); return flowResponse(request,response,()-> { Object result=service.confirmRecoveryCodes(request); browser.clear(response,false); return result; });
    }
    @PostMapping("/flow/complete") public Object complete(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"newPassword"); return flowResponse(request,response,()-> { Object result=service.completePassword(request,string(body,"newPassword")); browser.clear(response,false); return result; });
    }
    @PostMapping("/recovery/password") public Object recoverPassword(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"username","totpCode","recoveryCode");
        return issued(service.recoverPassword(string(body,"username"),string(body,"totpCode"),string(body,"recoveryCode"),request.getRemoteAddr()),response);
    }
    @PostMapping("/recovery/totp") public Object recoverTotp(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"username","password","recoveryCode");
        return issued(service.recoverTotp(string(body,"username"),string(body,"password"),string(body,"recoveryCode"),request.getRemoteAddr()),response);
    }
    @PostMapping("/security/{operation}") public Object security(@PathVariable String operation,@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body,"currentPassword","totpCode");
        String purpose=switch(operation) { case "password"->"change_password";case "totp"->"change_totp";case "recovery-codes"->"regenerate_recovery_codes";default->throw AccountErrors.bad(); };
        return issued(service.security(auth(request),string(body,"currentPassword"),string(body,"totpCode"),purpose,request.getRemoteAddr()),response);
    }
    @PostMapping({"/logout","/logout-all"}) @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response) {
        fields(body); service.logout(request,AccountRequestPath.path(request).endsWith("logout-all")); browser.clear(response,false); browser.clear(response,true);
    }
    @PostMapping("/wasm-grant") public Object grant(@RequestBody JsonNode body,HttpServletRequest request) { fields(body); return service.grant(auth(request)); }
}
