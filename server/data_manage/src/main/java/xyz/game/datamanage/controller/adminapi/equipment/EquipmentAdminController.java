package xyz.game.datamanage.controller.adminapi.equipment;

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
import xyz.game.datamanage.model.equipment.EquipmentAttributesRequest;
import xyz.game.datamanage.model.equipment.EquipmentAttributesResponse;
import xyz.game.datamanage.model.equipment.EquipmentCreateRequest;
import xyz.game.datamanage.model.equipment.EquipmentListQuery;
import xyz.game.datamanage.model.equipment.EquipmentListResponse;
import xyz.game.datamanage.model.equipment.EquipmentResponse;
import xyz.game.datamanage.model.equipment.EquipmentUpdateRequest;
import xyz.game.datamanage.service.equipment.EquipmentService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;

@RestController
@Validated
@RequestMapping("/api/admin/games/{gameId}/equipment")
public class EquipmentAdminController {

    private final EquipmentService equipmentService;
    private final AdminEditLogHelper logHelper;
    private final ObjectMapper objectMapper;

    public EquipmentAdminController(
        EquipmentService equipmentService,
        AdminEditLogHelper logHelper,
        ObjectMapper objectMapper
    ) {
        this.equipmentService = equipmentService;
        this.logHelper = logHelper;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public EquipmentListResponse list(
        @PathVariable("gameId") String gameId,
        @Valid @ModelAttribute EquipmentListQuery query
    ) {
        return equipmentService.list(gameId, query);
    }

    @GetMapping("/{equipmentKey}")
    public EquipmentResponse get(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey
    ) {
        return equipmentService.get(gameId, equipmentKey);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public EquipmentResponse create(
        @PathVariable("gameId") String gameId,
        @Valid @RequestBody EquipmentCreateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        EquipmentResponse response = equipmentService.create(gameId, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.CREATED);
        return response;
    }

    @PutMapping("/{equipmentKey}")
    public EquipmentResponse update(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey,
        @Valid @RequestBody EquipmentUpdateRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        EquipmentResponse response = equipmentService.update(gameId, equipmentKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    @DeleteMapping("/{equipmentKey}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        equipmentService.delete(gameId, equipmentKey);
        log(auth, request, objectMapper.createObjectNode(), HttpStatus.NO_CONTENT);
    }

    @GetMapping("/{equipmentKey}/attributes")
    public EquipmentAttributesResponse getAttributes(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey
    ) {
        return equipmentService.getAttributes(gameId, equipmentKey);
    }

    @PutMapping("/{equipmentKey}/attributes")
    public EquipmentAttributesResponse updateAttributes(
        @PathVariable("gameId") String gameId,
        @PathVariable("equipmentKey") String equipmentKey,
        @Valid @RequestBody EquipmentAttributesRequest body,
        @RequestAttribute(AdminAuthFilter.AUTH_CONTEXT_ATTR) AuthContext auth,
        HttpServletRequest request
    ) {
        EquipmentAttributesResponse response = equipmentService.updateAttributes(gameId, equipmentKey, body);
        log(auth, request, objectMapper.valueToTree(body), HttpStatus.OK);
        return response;
    }

    private void log(AuthContext auth, HttpServletRequest request, JsonNode body, HttpStatus status) {
        logHelper.log(auth, request, body, status.value());
    }
}
