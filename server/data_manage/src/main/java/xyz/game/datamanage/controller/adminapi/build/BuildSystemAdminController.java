package xyz.game.datamanage.controller.adminapi.build;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.model.build.BuildDefinitionResponse;
import xyz.game.datamanage.model.build.BuildGroupListResponse;
import xyz.game.datamanage.model.build.BuildGroupResponse;
import xyz.game.datamanage.model.build.BuildOptionListResponse;
import xyz.game.datamanage.model.build.BuildOptionResponse;
import xyz.game.datamanage.model.build.BuildSystemListResponse;
import xyz.game.datamanage.model.build.BuildSystemResponse;
import xyz.game.datamanage.service.GameDataService;
import xyz.game.datamanage.service.build.BuildSystemService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@RequestMapping("/api/admin/games/{gameId}/build-systems")
public class BuildSystemAdminController {
    private final BuildSystemService service;
    private final GameDataService gameDataService;
    private final ObjectMapper objectMapper;

    public BuildSystemAdminController(
        BuildSystemService service, GameDataService gameDataService, ObjectMapper objectMapper
    ) {
        this.service = service;
        this.gameDataService = gameDataService;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public BuildSystemListResponse list(@PathVariable("gameId") String gameId,
        @RequestParam(value = "keyword", required = false) String keyword) {
        return service.listSystems(gameId, keyword);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public BuildSystemResponse create(@PathVariable("gameId") String gameId, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        BuildSystemResponse response = service.createSystem(gameId, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @GetMapping("/{systemKey}/definition")
    public BuildDefinitionResponse definition(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey) {
        return service.definition(gameId, systemKey);
    }

    @GetMapping("/{systemKey}")
    public BuildSystemResponse get(@PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey) {
        return service.getSystem(gameId, systemKey);
    }

    @PutMapping("/{systemKey}")
    @Transactional
    public BuildSystemResponse update(@PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @RequestBody JsonNode body, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        BuildSystemResponse response = service.updateSystem(gameId, systemKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{systemKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        service.deleteSystem(gameId, systemKey);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(),
            objectMapper.createObjectNode(), 204);
    }

    @GetMapping("/{systemKey}/groups")
    public BuildGroupListResponse listGroups(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @RequestParam(value = "keyword", required = false) String keyword) {
        return service.listGroups(gameId, systemKey, keyword);
    }

    @PostMapping("/{systemKey}/groups")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public BuildGroupResponse createGroup(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        BuildGroupResponse response = service.createGroup(gameId, systemKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @GetMapping("/{systemKey}/groups/{groupKey}")
    public BuildGroupResponse getGroup(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @PathVariable("groupKey") String groupKey) {
        return service.getGroup(gameId, systemKey, groupKey);
    }

    @PutMapping("/{systemKey}/groups/{groupKey}")
    @Transactional
    public BuildGroupResponse updateGroup(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @PathVariable("groupKey") String groupKey, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        BuildGroupResponse response = service.updateGroup(gameId, systemKey, groupKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{systemKey}/groups/{groupKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteGroup(@PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @PathVariable("groupKey") String groupKey, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        service.deleteGroup(gameId, systemKey, groupKey);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(),
            objectMapper.createObjectNode(), 204);
    }

    @GetMapping("/{systemKey}/options")
    public BuildOptionListResponse listOptions(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @RequestParam(value = "keyword", required = false) String keyword) {
        return service.listOptions(gameId, systemKey, keyword);
    }

    @PostMapping("/{systemKey}/options")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public BuildOptionResponse createOption(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @RequestBody JsonNode body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth, HttpServletRequest request) {
        BuildOptionResponse response = service.createOption(gameId, systemKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 201);
        return response;
    }

    @GetMapping("/{systemKey}/options/{optionKey}")
    public BuildOptionResponse getOption(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @PathVariable("optionKey") String optionKey) {
        return service.getOption(gameId, systemKey, optionKey);
    }

    @PutMapping("/{systemKey}/options/{optionKey}")
    @Transactional
    public BuildOptionResponse updateOption(@PathVariable("gameId") String gameId,
        @PathVariable("systemKey") String systemKey, @PathVariable("optionKey") String optionKey,
        @RequestBody JsonNode body, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        BuildOptionResponse response = service.updateOption(gameId, systemKey, optionKey, body);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(), body, 200);
        return response;
    }

    @DeleteMapping("/{systemKey}/options/{optionKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deleteOption(@PathVariable("gameId") String gameId, @PathVariable("systemKey") String systemKey,
        @PathVariable("optionKey") String optionKey, @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request) {
        service.deleteOption(gameId, systemKey, optionKey);
        gameDataService.recordEditLog(auth.email(), request.getMethod(), request.getRequestURI(),
            objectMapper.createObjectNode(), 204);
    }
}
