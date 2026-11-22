package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.controller.adminapi.attribute.AttributeAdminController;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AccountMvcAuthorizationTest {
    static class Registry extends InterceptorRegistry { List<Object> items() { return getInterceptors(); } }
    @Test void actualMappedAdminWriteRequiresMaintenancePrincipalEvenWhenAllFiltersAreAbsent() throws Exception {
        xyz.game.datamanage.support.maintenance.MaintenancePrincipals sessions=mock(xyz.game.datamanage.support.maintenance.MaintenancePrincipals.class);when(sessions.require(any(),eq(true))).thenThrow(xyz.game.datamanage.support.maintenance.MaintenanceJson.denied());
        var registry=new Registry();new AccountMvcAuthorization(sessions).addInterceptors(registry);
        AttributeService service=mock(AttributeService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new AttributeAdminController(service,mock(AdminEditLogHelper.class),new ObjectMapper()))
            .setControllerAdvice(new GlobalExceptionHandler()).addInterceptors((HandlerInterceptor)registry.items().getFirst()).build();
        for(String path:List.of("/api/admin;probe/games/lol/attributes","/api;probe/admin/games/lol/attributes","/%61pi/admin/games/lol/attributes","/api/%61dmin/games/lol/attributes")) {
            mvc.perform(post(URI.create(path)).contentType("application/json").header("Origin","https://localhost:5173").header("X-Damage-Client","web").content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("MAINTENANCE.DENIED"));
        }
        verifyNoInteractions(service);
    }
    @Test void actualMappedGameReadNeverCreatesAnAuthenticationContext() throws Exception {
        xyz.game.datamanage.support.maintenance.MaintenancePrincipals sessions=mock(xyz.game.datamanage.support.maintenance.MaintenancePrincipals.class);var registry=new Registry();new AccountMvcAuthorization(sessions).addInterceptors(registry);
        AttributeService service=mock(AttributeService.class);
        var mvc=MockMvcBuilders.standaloneSetup(new AttributeAdminController(service,mock(AdminEditLogHelper.class),new ObjectMapper()))
            .setControllerAdvice(new GlobalExceptionHandler()).addInterceptors((HandlerInterceptor)registry.items().getFirst()).build();
        mvc.perform(get(URI.create("/api/admin;probe/games/lol/attributes"))).andExpect(status().isOk());
        verifyNoInteractions(sessions);
    }
}
