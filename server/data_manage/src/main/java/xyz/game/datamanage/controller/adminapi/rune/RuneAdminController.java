package xyz.game.datamanage.controller.adminapi.rune;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import xyz.game.datamanage.model.rune.RuneListResponse;
import xyz.game.datamanage.model.rune.RuneResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.rune.RuneService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/runes")
public class RuneAdminController {
    private final RuneService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public RuneAdminController(RuneService service, GameDataService gameDataService, ObjectMapper objectMapper) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public RuneListResponse list(@PathVariable("gameId") String gameId,
        @RequestParam(value = "keyword", required = false) String keyword,
        @RequestParam(value = "category", required = false) String category) {
        return service.listRunes(gameId, keyword, category);
    }

    @GetMapping("/{runeKey}")
    public RuneResponse get(@PathVariable("gameId") String gameId, @PathVariable("runeKey") String key) {
        return service.getRune(gameId, key);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public RuneResponse create(@PathVariable("gameId") String gameId, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        RuneResponse response = service.createRune(gameId, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @PutMapping("/{runeKey}")
    @Transactional
    public RuneResponse update(@PathVariable("gameId") String gameId, @PathVariable("runeKey") String key,
        @RequestBody JsonNode body, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        RuneResponse response = service.updateRune(gameId, key, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{runeKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable("gameId") String gameId, @PathVariable("runeKey") String key,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        service.deleteRune(gameId, key);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), objectMapper.createObjectNode(), 204);
    }
}
