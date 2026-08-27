package xyz.game.datamanage.controller.adminapi.skillformula;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.skillformula.SkillFormulaCreateRequest;
import xyz.game.datamanage.model.skillformula.SkillFormulaDetailResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaSummaryResponse;
import xyz.game.datamanage.model.skillformula.SkillFormulaUpdateRequest;
import xyz.game.datamanage.service.skillformula.SkillFormulaService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/skills/{skillKey}/formulas")
public class SkillFormulaAdminController {

    private final SkillFormulaService service;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public SkillFormulaAdminController(
        SkillFormulaService service,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.service = service;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public List<SkillFormulaSummaryResponse> list(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey
    ) {
        return service.list(gameId, skillKey);
    }

    @GetMapping("/{formulaKey}")
    public SkillFormulaDetailResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("formulaKey") String formulaKey
    ) {
        return service.get(gameId, skillKey, formulaKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SkillFormulaDetailResponse create(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @Valid @RequestBody SkillFormulaCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillFormulaDetailResponse response = service.create(gameId, skillKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{formulaKey}")
    public SkillFormulaDetailResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("formulaKey") String formulaKey,
        @Valid @RequestBody SkillFormulaUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        SkillFormulaDetailResponse response = service.update(gameId, skillKey, formulaKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{formulaKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("skillKey") String skillKey,
        @PathVariable("formulaKey") String formulaKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        service.delete(gameId, skillKey, formulaKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
