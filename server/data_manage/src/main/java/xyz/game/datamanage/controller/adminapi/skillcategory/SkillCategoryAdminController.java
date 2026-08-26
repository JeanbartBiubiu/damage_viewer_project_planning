package xyz.game.datamanage.controller.adminapi.skillcategory;

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
import xyz.game.datamanage.model.skillcategory.SkillCategoryCreateRequest;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListQuery;
import xyz.game.datamanage.model.skillcategory.SkillCategoryListResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryResponse;
import xyz.game.datamanage.model.skillcategory.SkillCategoryUpdateRequest;
import xyz.game.datamanage.service.skillcategory.SkillCategoryService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skill-categories")
public class SkillCategoryAdminController {

    private final SkillCategoryService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillCategoryAdminController(
        SkillCategoryService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public SkillCategoryListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute SkillCategoryListQuery query
    ) {
        return service.list(gameId, query);
    }

    @GetMapping("/{skillCategoryKey}")
    public SkillCategoryResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillCategoryKey") String skillCategoryKey
    ) {
        return service.get(gameId, skillCategoryKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillCategoryResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody SkillCategoryCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillCategoryResponse response = service.create(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{skillCategoryKey}")
    public SkillCategoryResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillCategoryKey") String skillCategoryKey,
        @Valid @RequestBody SkillCategoryUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillCategoryResponse response = service.update(gameId, skillCategoryKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{skillCategoryKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillCategoryKey") String skillCategoryKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillCategoryKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
