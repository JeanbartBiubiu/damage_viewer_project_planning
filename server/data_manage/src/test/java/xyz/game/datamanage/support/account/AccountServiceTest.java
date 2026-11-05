package xyz.game.datamanage.support.account;

import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import xyz.game.datamanage.support.account.AccountStore.Account;
import xyz.game.datamanage.support.account.AccountStore.Flow;
import xyz.game.datamanage.support.error.ApiException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class AccountServiceTest {
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    private AccountStore store;
    private final AccountCrypto crypto=mock(AccountCrypto.class);
    private final PasswordTasks passwords=mock(PasswordTasks.class);
    private final AccountDatabaseCrypto database=mock(AccountDatabaseCrypto.class);
    private final AccountRateLimits limits=mock(AccountRateLimits.class);
    private final AccountRateLimits.PasswordAttempt attempt=mock(AccountRateLimits.PasswordAttempt.class);
    private final AccountProperties properties=new AccountProperties();
    private AccountService service;
    private final UUID id=UUID.randomUUID(), flowId=UUID.randomUUID(), codeId=UUID.randomUUID(), batch=UUID.randomUUID();
    private final Instant now=Instant.parse("2026-11-04T00:00:00Z");
    private Account account(String status,long epoch) { return new Account(id,"fixture_author","password-hash",status,1,false,epoch,batch,now,"ref"); }
    private Flow flow(String purpose,String phase,long epoch) {
        return new Flow(flowId,id,epoch,purpose,phase,null,"reset_password".equals(purpose)?codeId:null,
            null,null,null,null,null,AccountCrypto.hash("c".repeat(43)),now.plusSeconds(600));
    }
    @BeforeEach void setup() {
        when(manager.getTransaction(any())).thenAnswer(i->mock(TransactionStatus.class));
        store=spy(new AccountStore(jdbc,manager)); doReturn(now).when(store).now();
        doReturn(account("active",1)).when(store).account(eq(id),anyBoolean());
        when(database.tokens()).thenReturn(new AccountDatabaseCrypto.Tokens("t".repeat(43),"c".repeat(43)));
        when(limits.reservePasswordAttempt(anyString(),anyString())).thenReturn(attempt);
        service=new AccountService(store,crypto,passwords,limits,properties,new AccountBrowser(properties),database);
    }
    private MockHttpServletRequest flowRequest(String method) {
        var request=new MockHttpServletRequest(method,"/api/auth/flow/complete");
        request.setCookies(new Cookie(AccountBrowser.FLOW,"f".repeat(43)),new Cookie(AccountBrowser.FLOW_CSRF,"c".repeat(43)));
        request.addHeader("X-CSRF-Token","c".repeat(43)); return request;
    }
    private void currentFlow(Flow flow) { doReturn(flow).when(store).flow(any(byte[].class),anyBoolean()); }
    @Test void pendingLoginRevokesOldRegistrationAndPreservesAccountCreationAndEnablement() {
        Account pending=account("pending",1);doReturn(pending).when(store).byUsername("fixture_author");doReturn(pending).when(store).account(id,true);
        when(passwords.matches("correct-password",pending.passwordHash())).thenReturn(true);currentFlow(flow("register","started",1));
        AccountService.Issued issued=service.login("FIXTURE_AUTHOR","correct-password","127.0.0.1");
        assertFalse(issued.session());assertEquals("register",((Map<?,?>)issued.view()).get("purpose"));
        verify(store).revokeChanges(id);
        verify(jdbc,never()).update(startsWith("UPDATE auth.accounts"),any(Object[].class));
        verify(jdbc).update(contains("INSERT INTO auth.flows"),any(Object[].class));
        var finish=inOrder(manager,attempt);finish.verify(manager).commit(any());finish.verify(attempt).close();verify(attempt,never()).retainFailure();
    }
    @Test void completedStatusSurvivesEpochAndSourceRevocationButCannotReadMaterialsOrExecuteAgain() {
        doReturn(account("disabled",8)).when(store).account(id,true);currentFlow(flow("change_totp","completed",1));
        assertEquals(Map.of("phase","completed"),service.status(flowRequest("GET")));
        assertEquals("AUTH.FLOW_CONFLICT",assertThrows(ApiException.class,()->service.recoveryCodes(flowRequest("GET"))).getCode());
        assertEquals("AUTH.FLOW_CONFLICT",assertThrows(ApiException.class,()->service.setup(flowRequest("POST"))).getCode());
        verifyNoInteractions(crypto);verify(jdbc,never()).update(anyString(),any(Object[].class));
    }
    @Test void expiredAndVersionChangedFlowsCannotReturnMaterials() {
        Flow active=flow("register","recovery_codes_ready",1);
        currentFlow(active);doReturn(now.plusSeconds(600)).when(store).now();
        assertEquals(HttpStatus.GONE,assertThrows(ApiException.class,()->service.recoveryCodes(flowRequest("GET"))).getStatus());
        doReturn(now).when(store).now();doReturn(account("active",2)).when(store).account(id,true);
        assertEquals("AUTH.FLOW_CONFLICT",assertThrows(ApiException.class,()->service.recoveryCodes(flowRequest("GET"))).getCode());
        verifyNoInteractions(crypto);
    }
    @Test void missingSourceSessionCannotBecomeAnUnrestrictedSecurityFlow() {
        currentFlow(flow("change_password","started",1));
        assertEquals("AUTH.FLOW_CONFLICT",assertThrows(ApiException.class,()->service.completePassword(flowRequest("POST"),"new-password-123")).getCode());
        verifyNoInteractions(passwords);
    }
    @Test void passwordRecoveryConsumptionRollsBackIfAccountUpdateFails() {
        currentFlow(flow("reset_password","started",1));
        doReturn(codeId).when(store).first(startsWith("SELECT id FROM auth.recovery_codes"),any(),any(Object[].class));
        when(passwords.encode("new-password-123","fixture_author")).thenReturn("new-hash");
        when(jdbc.update(startsWith("UPDATE auth.recovery_codes"),any(Object[].class))).thenReturn(1);
        when(jdbc.update(startsWith("UPDATE auth.accounts"),any(Object[].class))).thenThrow(new IllegalStateException("fixture transaction failure"));
        assertThrows(IllegalStateException.class,()->service.completePassword(flowRequest("POST"),"new-password-123"));
        var ordered=inOrder(jdbc,manager);
        ordered.verify(jdbc).update(startsWith("UPDATE auth.recovery_codes"),any(Object[].class));
        ordered.verify(jdbc).update(startsWith("UPDATE auth.accounts"),any(Object[].class));
        ordered.verify(manager).rollback(any());
        verify(store,never()).finish(any());verify(store,never()).revokeSessions(any(),any());
    }
    @Test void concurrentRecoveryConsumptionFailureCannotAdvancePasswordOrEpoch() {
        currentFlow(flow("reset_password","started",1));
        doReturn(codeId).when(store).first(startsWith("SELECT id FROM auth.recovery_codes"),any(),any(Object[].class));
        when(passwords.encode("new-password-123","fixture_author")).thenReturn("new-hash");
        when(jdbc.update(startsWith("UPDATE auth.recovery_codes"),any(Object[].class))).thenReturn(0);
        assertEquals("AUTH.FLOW_CONFLICT",assertThrows(ApiException.class,()->service.completePassword(flowRequest("POST"),"new-password-123")).getCode());
        verify(jdbc,never()).update(startsWith("UPDATE auth.accounts"),any(Object[].class));
        verify(store,never()).finish(any());verify(manager).rollback(any());
    }
    @Test void incorrectPasswordCountsBothAccountAndAddressWithoutCreatingFlow() {
        doReturn(account("active",1)).when(store).byUsername("fixture_author");when(passwords.matches(anyString(),anyString())).thenReturn(false);
        assertEquals(HttpStatus.UNAUTHORIZED,assertThrows(ApiException.class,()->service.login("fixture_author","incorrect-password","127.0.0.1")).getStatus());
        verify(limits).reservePasswordAttempt("fixture_author","127.0.0.1");verify(attempt).retainFailure();verify(attempt).close();
        verify(limits,never()).fail(anyString(),anyString());
        verify(jdbc,never()).update(anyString(),any(Object[].class));
    }
    @Test void capacityOrDatabaseFailureRefundsTheReservedPasswordAttempt() {
        doReturn(account("active",1)).when(store).byUsername("fixture_author");when(passwords.matches(anyString(),anyString())).thenThrow(AccountErrors.unavailable());
        assertEquals(503,assertThrows(ApiException.class,()->service.login("fixture_author","fixture password","127.0.0.1")).getStatus().value());
        verify(attempt).close();verify(attempt,never()).retainFailure();verify(limits,never()).fail(anyString(),anyString());
    }
    @Test void successfulPasswordButDisabledLoginRefundsItsOriginalReservation() {
        var disabled=account("disabled",1);doReturn(disabled).when(store).byUsername("fixture_author");doReturn(disabled).when(store).account(id,true);when(passwords.matches(anyString(),anyString())).thenReturn(true);
        assertEquals(403,assertThrows(ApiException.class,()->service.login("fixture_author","fixture password","127.0.0.1")).getStatus().value());
        verify(attempt).close();verify(attempt,never()).retainFailure();
    }
    @Test void recoveryCodeFailureKeepsOneExistingReservationWithoutRefundOrDoubleCounting() {
        doReturn(account("active",1)).when(store).byUsername("fixture_author");when(passwords.matches(anyString(),anyString())).thenReturn(true);
        assertEquals(401,assertThrows(ApiException.class,()->service.recoverTotp("fixture_author","fixture password","x".repeat(22),"127.0.0.1")).getStatus().value());
        verify(limits).reservePasswordAttempt("fixture_author","127.0.0.1");verify(attempt).retainFailure();verify(attempt).close();verify(limits,never()).fail(anyString(),anyString());
    }
    @Test void downstreamTotpFailureInSecurityRefundsPasswordButKeepsTotpReservation() {
        UUID session=UUID.randomUUID();var auth=new xyz.game.datamanage.support.auth.AuthContext(id,"fixture_author",false,session,1,now.plusSeconds(600));
        doReturn(account("active",1)).when(store).byUsername("fixture_author");when(passwords.matches(anyString(),anyString())).thenReturn(true);
        doReturn(new AccountStore.Session(session,id,1,new byte[32],now.plusSeconds(600),null)).when(store).session(session);
        doReturn(new AccountStore.Credential(new byte[]{1},"auth-aead-1",1,4)).when(store).credential(id);
        when(crypto.decrypt(any(),anyString(),anyString())).thenReturn("fixture-secret");when(crypto.matchingStep(anyString(),anyString(),any(),anyLong())).thenThrow(AccountErrors.invalid());
        assertEquals(401,assertThrows(ApiException.class,()->service.security(auth,"fixture password","012345","change_password","127.0.0.1")).getStatus().value());
        verify(limits).reserveTotp("totp_account",id.toString());verify(attempt,never()).retainFailure();
        var order=inOrder(manager,attempt);order.verify(manager).rollback(any());order.verify(attempt).close();
    }
    @Test void flowCreationFailureRefundsOnlyAfterTheBusinessTransactionRollsBack() {
        doReturn(account("active",1)).when(store).byUsername("fixture_author");when(passwords.matches(anyString(),anyString())).thenReturn(true);when(database.tokens()).thenThrow(AccountErrors.unavailable());
        assertEquals(503,assertThrows(ApiException.class,()->service.login("fixture_author","fixture password","127.0.0.1")).getStatus().value());
        var order=inOrder(manager,attempt);order.verify(manager).rollback(any());order.verify(attempt).close();verify(attempt,never()).retainFailure();
    }
    @Test void totpAttemptsAreReservedBeforeVerificationAndRemainCountedAfterRollback() {
        currentFlow(flow("login","started",1));
        doReturn(new AccountStore.Credential(new byte[]{1},"auth-aead-1",1,4)).when(store).credential(id);
        when(crypto.decrypt(any(),anyString(),anyString())).thenReturn("fixture-secret");
        when(crypto.matchingStep(anyString(),anyString(),any(),anyLong())).thenThrow(AccountErrors.invalid());
        assertThrows(ApiException.class,()->service.loginTotp(flowRequest("POST"),"012345"));
        var ordered=inOrder(manager,limits);ordered.verify(limits).reserveTotp("totp_flow",flowId.toString());
        ordered.verify(limits).reserveTotp("totp_account",id.toString());ordered.verify(manager).rollback(any());
        verify(jdbc,never()).update(startsWith("INSERT INTO auth.sessions"),any(Object[].class));
    }
    @Test void oldTabCsrfCannotReadOrConfirmMaterialsFromANewerFlowCookie() {
        currentFlow(flow("regenerate_recovery_codes","completed",1));
        var stale=flowRequest("GET");stale.removeHeader("X-CSRF-Token");stale.addHeader("X-CSRF-Token","d".repeat(43));
        assertEquals("AUTH.CSRF_REJECTED",assertThrows(ApiException.class,()->service.status(stale)).getCode());
        stale.setMethod("POST");assertEquals("AUTH.CSRF_REJECTED",assertThrows(ApiException.class,()->service.confirmRecoveryCodes(stale)).getCode());
        verifyNoInteractions(crypto);verify(jdbc,never()).update(anyString(),any(Object[].class));
        var current=flowRequest("GET");assertEquals(Map.of("phase","completed"),service.status(current));
        assertTrue("c".repeat(43).equals(current.getAttribute(AccountBrowser.FLOW_CSRF_RESPONSE_ATTR)));
    }
    @Test void successfulTotpPersistsActualMatchedStepInSameTransactionAsSessionAndCompletion() {
        currentFlow(flow("login","started",1));
        doReturn(new AccountStore.Credential(new byte[]{1},"auth-aead-1",1,4)).when(store).credential(id);
        doReturn(new AccountStore.Session(UUID.randomUUID(),id,1,new byte[32],now.plusSeconds(604800),null)).when(store).session(any(UUID.class));
        when(crypto.decrypt(any(),anyString(),anyString())).thenReturn("fixture-secret");
        when(crypto.matchingStep(anyString(),eq("012345"),eq(now),eq(4L))).thenReturn(10L);
        var result=service.loginTotp(flowRequest("POST"),"012345");assertTrue(result.session());
        var ordered=inOrder(jdbc,store,manager);
        ordered.verify(jdbc).update(startsWith("UPDATE auth.totp_credentials"),eq(10L),eq(id),eq(10L));
        ordered.verify(jdbc).update(startsWith("INSERT INTO auth.sessions"),any(Object[].class));
        ordered.verify(store).finish(flowId);ordered.verify(manager).commit(any());
        verify(manager,never()).rollback(any());
    }
}
