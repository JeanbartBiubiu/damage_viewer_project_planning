package xyz.game.datamanage.controller.adminapi.rune;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import xyz.game.datamanage.model.rune.RunePathListResponse;
import xyz.game.datamanage.model.rune.RunePathResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.rune.RuneService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/rune-paths")
public class RunePathAdminController {
    private final RuneService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public RunePathAdminController(RuneService service, GameDataService gameDataService, ObjectMapper objectMapper) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public RunePathListResponse list(@PathVariable("gameId") String gameId,
        @RequestParam(value = "keyword", required = false) String keyword) {
        return service.listPaths(gameId, keyword);
    }

    @GetMapping("/{pathKey}")
    public RunePathResponse get(@PathVariable("gameId") String gameId, @PathVariable("pathKey") String key) {
        return service.getPath(gameId, key);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public RunePathResponse create(@PathVariable("gameId") String gameId, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        RunePathResponse response = service.createPath(gameId, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @PutMapping("/{pathKey}")
    @Transactional
    public RunePathResponse update(@PathVariable("gameId") String gameId, @PathVariable("pathKey") String key,
        @RequestBody JsonNode body, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        RunePathResponse response = service.updatePath(gameId, key, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{pathKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable("gameId") String gameId, @PathVariable("pathKey") String key,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        service.deletePath(gameId, key);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.createObjectNode(), 204);
    }
}
