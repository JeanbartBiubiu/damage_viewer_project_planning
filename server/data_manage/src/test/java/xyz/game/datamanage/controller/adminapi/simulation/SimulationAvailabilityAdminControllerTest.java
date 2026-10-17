package xyz.game.datamanage.controller.adminapi.simulation;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import xyz.game.datamanage.model.simulation.SimulationAvailabilityResponse;
import xyz.game.datamanage.service.simulation.availability.SimulationAvailabilityService;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SimulationAvailabilityAdminControllerTest {
    @Test
    void getPassesRequestedBuildIdentityAndReturnsTheIndependentDirectoryContract() throws Exception {
        SimulationAvailabilityService service = mock(SimulationAvailabilityService.class);
        String sha = "a".repeat(64);
        when(service.get("lol", sha, "adapter-v1")).thenReturn(new SimulationAvailabilityResponse("lol", "combat-analysis-v1",
            "simulation-availability-v1", "b".repeat(64), "c".repeat(64), List.of(), List.of()));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new SimulationAvailabilityAdminController(service)).build();
        mvc.perform(get("/api/admin/games/lol/simulation-availability").param("wasmSha256", sha).param("adapterVersion", "adapter-v1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.gameId").value("lol"))
            .andExpect(jsonPath("$.profile").value("combat-analysis-v1"))
            .andExpect(jsonPath("$.digestVersion").value("simulation-availability-v1"))
            .andExpect(jsonPath("$.scopeDigest").value("b".repeat(64))).andExpect(jsonPath("$.characters").isArray());
        verify(service).get("lol", sha, "adapter-v1");
        mvc.perform(get("/api/admin/games/lol/simulation-availability")).andExpect(status().isBadRequest());
        verifyNoMoreInteractions(service);
    }
}
