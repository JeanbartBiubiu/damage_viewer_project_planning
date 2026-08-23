package xyz.game.datamanage.controller.adminapi.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.character.CharacterAttributesRequest;
import xyz.game.datamanage.model.character.CharacterAttributesResponse;
import xyz.game.datamanage.model.character.CharacterCreateRequest;
import xyz.game.datamanage.model.character.CharacterListQuery;
import xyz.game.datamanage.model.character.CharacterListResponse;
import xyz.game.datamanage.model.character.CharacterResponse;
import xyz.game.datamanage.model.character.CharacterUpdateRequest;
import xyz.game.datamanage.model.character.LevelConfigResponse;
import xyz.game.datamanage.model.character.LevelConfigUpdateRequest;
import xyz.game.datamanage.service.character.CharacterService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}")
public class CharacterAdminController {

    private final CharacterService characterService;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public CharacterAdminController(
        CharacterService characterService,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.characterService = characterService;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/level-config")
    public LevelConfigResponse getLevelConfig(@PathVariable("gameId") String gameId) {
        return characterService.getLevelConfig(gameId);
    }

    @PutMapping("/level-config")
    public LevelConfigResponse updateLevelConfig(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody LevelConfigUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        LevelConfigResponse response = characterService.updateLevelConfig(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @GetMapping("/characters")
    public CharacterListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute CharacterListQuery query
    ) {
        return characterService.list(gameId, query);
    }

    @GetMapping("/characters/{characterKey}")
    public CharacterResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("characterKey") String characterKey
    ) {
        return characterService.get(gameId, characterKey);
    }

    @PostMapping("/characters")
    @ResponseStatus(HttpStatus.CREATED)
    public CharacterResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody CharacterCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        CharacterResponse response = characterService.create(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/characters/{characterKey}")
    public CharacterResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("characterKey") String characterKey,
        @Valid @RequestBody CharacterUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        CharacterResponse response = characterService.update(gameId, characterKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/characters/{characterKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("characterKey") String characterKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        characterService.delete(gameId, characterKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    @GetMapping("/characters/{characterKey}/attributes")
    public CharacterAttributesResponse getAttributes(
        @PathVariable("gameId") String gameId,
        @PathVariable("characterKey") String characterKey
    ) {
        return characterService.getAttributes(gameId, characterKey);
    }

    @PutMapping("/characters/{characterKey}/attributes")
    public CharacterAttributesResponse updateAttributes(
        @PathVariable("gameId") String gameId,
        @PathVariable("characterKey") String characterKey,
        @Valid @RequestBody CharacterAttributesRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        CharacterAttributesResponse response = characterService.updateAttributes(gameId, characterKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    private void log(
        AuthContext auth,
        HttpServletRequest request,
        JsonNode body,
        HttpStatus status
    ) {
        logHelper.log(auth, request, body, status.value());
    }
}
