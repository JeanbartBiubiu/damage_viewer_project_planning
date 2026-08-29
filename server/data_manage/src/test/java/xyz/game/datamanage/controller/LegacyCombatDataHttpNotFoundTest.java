package xyz.game.datamanage.controller;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import xyz.game.datamanage.controller.publicapi.GamePublicController;
import xyz.game.datamanage.controller.publicapi.ImagePublicController;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;

@WebMvcTest(controllers = {GamePublicController.class, ImagePublicController.class})
class LegacyCombatDataHttpNotFoundTest {

    private static final List<String> DELETED_CLASSES = List.of(
        "xyz.game.datamanage.controller.adminapi.VersionAdminController",
        "xyz.game.datamanage.controller.publicapi.VersionPublicController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataEntityAdminController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataAbilityAdminController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataTypeAdminController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataEffectAdminController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataProviderAdminController",
        "xyz.game.datamanage.controller.adminapi.combatdata.CombatDataDirectDamageAbilitySetupAdminController",
        "xyz.game.datamanage.controller.publicapi.combatdata.CombatDataEntityPublicController",
        "xyz.game.datamanage.controller.publicapi.combatdata.CombatDataAbilityPublicController",
        "xyz.game.datamanage.controller.publicapi.combatdata.CombatDataTypePublicController",
        "xyz.game.datamanage.controller.publicapi.combatdata.CombatDataEffectPublicController",
        "xyz.game.datamanage.controller.publicapi.combatdata.CombatDataProviderPublicController",
        "xyz.game.datamanage.service.combatdata.revision.CombatDataPublishService",
        "xyz.game.datamanage.mapper.GameVersionsMapper",
        "xyz.game.datamanage.mapper.GameDataStateMapper"
    );

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GameDataService gameDataService;

    @MockitoBean
    private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("author@example.com", true, true));
    }

    @Test
    void deletedControllerClassesAreAbsentFromClasspath() {
        for (String className : DELETED_CLASSES) {
            assertThrows(ClassNotFoundException.class, () -> Class.forName(className), className);
        }
    }

    @Test
    void retiredHttpPathsReturnOrdinary404() throws Exception {
        mockMvc.perform(get("/api/games/lol/combat-data/state")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/games/lol/combat-data/entities")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/games/lol/combat-data/abilities")).andExpect(status().isNotFound());
        mockMvc.perform(
            put("/api/admin/games/lol/combat-data/entities/e1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
        ).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/games/lol/versions/current")).andExpect(status().isNotFound());
        mockMvc.perform(
            post("/api/admin/games/lol/versions:publish")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
        ).andExpect(status().isNotFound());
        mockMvc.perform(
            post("/api/admin/games/lol/versions/:publish")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
        ).andExpect(status().isNotFound());
        mockMvc.perform(
            post("/api/admin/games/lol/versions/publish")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
        ).andExpect(status().isNotFound());
    }

    @Test
    void remainingControllersStayOutsideCombatDataPackages() {
        Package controllerPackage = GamePublicController.class.getPackage();
        assertTrue(controllerPackage.getName().startsWith("xyz.game.datamanage.controller"));
        assertTrue(GamePublicController.class.getName().contains("publicapi.GamePublicController"));
    }
}
