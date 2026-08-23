package xyz.game.datamanage.controller.adminapi.attribute;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import xyz.game.datamanage.controller.adminapi.AdminEditLogHelper;
import xyz.game.datamanage.model.attribute.AttributeCreateRequest;
import xyz.game.datamanage.model.attribute.AttributeListQuery;
import xyz.game.datamanage.model.attribute.AttributeListResponse;
import xyz.game.datamanage.model.attribute.AttributeResponse;
import xyz.game.datamanage.model.attribute.AttributeStatus;
import xyz.game.datamanage.model.attribute.AttributeUpdateRequest;
import xyz.game.datamanage.model.attribute.AttributeValueType;
import xyz.game.datamanage.service.attribute.AttributeService;
import xyz.game.datamanage.support.auth.AdminAuthFilter;
import xyz.game.datamanage.support.auth.AuthContext;
import xyz.game.datamanage.support.auth.JwtVerifier;
import xyz.game.datamanage.support.error.ApiException;
import xyz.game.datamanage.support.error.GlobalExceptionHandler;

@WebMvcTest(controllers = AttributeAdminController.class)
@Import({AdminAuthFilter.class, GlobalExceptionHandler.class})
class AttributeAdminControllerTest {

    private static final String GAME_ID = "lol";
    private static final String ATTRIBUTE_KEY = "move_speed";
    private static final String BASE_PATH = "/api/admin/games/lol/attributes";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @MockitoBean private AttributeService service;
    @MockitoBean private AdminEditLogHelper adminEditLogHelper;
    @MockitoBean private JwtVerifier jwtVerifier;

    @BeforeEach
    void enableDevelopmentAdmin() {
        when(jwtVerifier.isDisabled()).thenReturn(true);
        when(jwtVerifier.developmentAuthContext())
            .thenReturn(new AuthContext("author@example.com", true, true));
    }

    @Test
    void listsAndGetsAttributesWithoutDisplayUnitAndNormalizesEmptyQuery() throws Exception {
        AttributeResponse response = enabledAttribute();
        when(service.list(eq(GAME_ID), any(AttributeListQuery.class)))
            .thenReturn(new AttributeListResponse(List.of(response), 1));
        when(service.get(GAME_ID, ATTRIBUTE_KEY)).thenReturn(response);

        mockMvc.perform(get(BASE_PATH).queryParam("keyword", "").queryParam("status", ""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.total").value(1))
            .andExpect(jsonPath("$.items[0].gameId").value(GAME_ID))
            .andExpect(jsonPath("$.items[0].attributeKey").value(ATTRIBUTE_KEY))
            .andExpect(jsonPath("$.items[0].displayUnit").doesNotExist());

        mockMvc.perform(get(BASE_PATH + "/" + ATTRIBUTE_KEY))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.attributeKey").value(ATTRIBUTE_KEY))
            .andExpect(jsonPath("$.displayUnit").doesNotExist());

        verify(service).list(eq(GAME_ID), any(AttributeListQuery.class));
        verify(service).get(GAME_ID, ATTRIBUTE_KEY);
        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void createsAttributeWith201AndWritesAdminEditLog() throws Exception {
        when(service.create(eq(GAME_ID), any(AttributeCreateRequest.class)))
            .thenReturn(enabledAttribute());

        mockMvc.perform(post(BASE_PATH).contentType(MediaType.APPLICATION_JSON).content(validCreateJson()))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.gameId").value(GAME_ID))
            .andExpect(jsonPath("$.attributeKey").value(ATTRIBUTE_KEY))
            .andExpect(jsonPath("$.status").value("ENABLED"))
            .andExpect(jsonPath("$.displayUnit").doesNotExist());

        verify(service).create(eq(GAME_ID), any(AttributeCreateRequest.class));
        verify(adminEditLogHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(201));
    }

    @Test
    void fullPutCanClearNullableFieldsDisableAttributeAndWritesAdminEditLog() throws Exception {
        AttributeResponse disabled = new AttributeResponse(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            null,
            null,
            null,
            AttributeStatus.DISABLED,
            20,
            OffsetDateTime.parse("2026-08-22T09:00:00Z"),
            OffsetDateTime.parse("2026-08-22T10:00:00Z")
        );
        when(service.update(eq(GAME_ID), eq(ATTRIBUTE_KEY), any(AttributeUpdateRequest.class)))
            .thenReturn(disabled);

        mockMvc.perform(
                put(BASE_PATH + "/" + ATTRIBUTE_KEY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                        {
                          "name":"移动速度",
                          "valueType":"DECIMAL",
                          "status":"DISABLED",
                          "sortOrder":20
                        }
                        """)
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DISABLED"))
            .andExpect(jsonPath("$.minValue").isEmpty())
            .andExpect(jsonPath("$.maxValue").isEmpty())
            .andExpect(jsonPath("$.description").isEmpty())
            .andExpect(jsonPath("$.displayUnit").doesNotExist());

        verify(service).update(eq(GAME_ID), eq(ATTRIBUTE_KEY), any(AttributeUpdateRequest.class));
        verify(adminEditLogHelper).log(any(AuthContext.class), any(), any(JsonNode.class), eq(200));
    }

    @Test
    void fullPutAcceptsExplicitJsonNullForEveryNullableField() throws Exception {
        AttributeResponse disabled = new AttributeResponse(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            null,
            null,
            null,
            AttributeStatus.DISABLED,
            20,
            OffsetDateTime.parse("2026-08-22T09:00:00Z"),
            OffsetDateTime.parse("2026-08-22T10:00:00Z")
        );
        when(service.update(eq(GAME_ID), eq(ATTRIBUTE_KEY), any(AttributeUpdateRequest.class)))
            .thenReturn(disabled);

        mockMvc.perform(
                putJson(
                    BASE_PATH + "/" + ATTRIBUTE_KEY,
                    """
                        {
                          "attributeKey":null,
                          "name":"移动速度",
                          "valueType":"DECIMAL",
                          "minValue":null,
                          "maxValue":null,
                          "description":null,
                          "status":"DISABLED",
                          "sortOrder":20
                        }
                        """
                )
            )
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DISABLED"));

        ArgumentCaptor<AttributeUpdateRequest> request = ArgumentCaptor.forClass(AttributeUpdateRequest.class);
        verify(service).update(eq(GAME_ID), eq(ATTRIBUTE_KEY), request.capture());
        assertNull(request.getValue().attributeKey());
        assertNull(request.getValue().minValue());
        assertNull(request.getValue().maxValue());
        assertNull(request.getValue().description());
    }

    @Test
    void rejectsEveryFrozenCreateFieldViolationWithFieldLocation() throws Exception {
        assertValidationField(
            postJson(BASE_PATH, validCreateJson().replace(ATTRIBUTE_KEY, "Move-Speed")),
            "attributeKey"
        );
        assertValidationField(
            postJson(BASE_PATH, validCreateJson().replace("移动速度", "   ")),
            "name"
        );
        assertValidationField(
            postJson(BASE_PATH, validCreateJson().replace("DECIMAL", "BOOLEAN")),
            "valueType"
        );
        assertValidationField(
            postJson(BASE_PATH, validCreateJson().replace("\"sortOrder\":100", "\"sortOrder\":-1")),
            "sortOrder"
        );
        verify(service, never()).create(any(), any());
        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void rejectsIllegalKeywordWithQueryFieldLocationBeforeCallingService() throws Exception {
        assertValidationField(
            get(BASE_PATH).queryParam("keyword", "x".repeat(101)),
            "keyword"
        );

        verify(service, never()).list(any(), any());
    }

    @Test
    void mapsServiceRangeAndQueryStatusValidationToFieldIssues() throws Exception {
        when(service.create(eq(GAME_ID), any(AttributeCreateRequest.class)))
            .thenThrow(validationFailure("maxValue", "RANGE_INVALID", "最大值不能小于最小值"));
        assertValidationField(
            postJson(BASE_PATH, validCreateJson().replace("\"maxValue\":1000", "\"maxValue\":-1")),
            "maxValue"
        );

        when(service.list(eq(GAME_ID), any(AttributeListQuery.class)))
            .thenThrow(validationFailure("status", "ENUM_INVALID", "状态只允许 ENABLED 或 DISABLED"));
        assertValidationField(
            get(BASE_PATH).queryParam("status", "ARCHIVED"),
            "status"
        );

        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void fullPutRejectsNonNullAttributeKeyAndMissingRequiredFields() throws Exception {
        assertValidationField(
            putJson(
                BASE_PATH + "/" + ATTRIBUTE_KEY,
                """
                    {
                      "attributeKey":"attack_speed",
                      "name":"移动速度",
                      "valueType":"DECIMAL",
                      "status":"ENABLED",
                      "sortOrder":100
                    }
                    """
            ),
            "attributeKey"
        );

        MvcResult result = mockMvc.perform(
                putJson(BASE_PATH + "/" + ATTRIBUTE_KEY, "{}")
            )
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andReturn();
        Set<String> fields = fieldIssueNames(result);
        assertTrue(
            fields.containsAll(Set.of("name", "valueType", "status", "sortOrder")),
            () -> "missing required PUT field locations: " + fields
        );

        verify(service, never()).update(any(), any(), any());
        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void mapsKeyAndNameConflictsWithoutLeakingDatabaseConstraintText() throws Exception {
        when(service.create(eq(GAME_ID), any(AttributeCreateRequest.class)))
            .thenThrow(conflict("409.ATTRIBUTE_KEY_EXISTS", "属性稳定标识已存在"))
            .thenThrow(conflict("409.ATTRIBUTE_NAME_EXISTS", "属性名称已存在"));

        mockMvc.perform(postJson(BASE_PATH, validCreateJson()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.ATTRIBUTE_KEY_EXISTS"))
            .andExpect(content().string(not(containsString("pk_attributes"))));

        mockMvc.perform(postJson(BASE_PATH, validCreateJson()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("409.ATTRIBUTE_NAME_EXISTS"))
            .andExpect(content().string(not(containsString("uq_attributes_name"))));

        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void nonexistentGameUsesOneStableErrorForListDetailCreateAndUpdate() throws Exception {
        ApiException missing = new ApiException(
            HttpStatus.NOT_FOUND,
            "404.GAME_NOT_FOUND",
            "游戏不存在",
            Map.of("gameId", "missing")
        );
        when(service.list(eq("missing"), any(AttributeListQuery.class))).thenThrow(missing);
        when(service.get("missing", ATTRIBUTE_KEY)).thenThrow(missing);
        when(service.create(eq("missing"), any(AttributeCreateRequest.class))).thenThrow(missing);
        when(service.update(eq("missing"), eq(ATTRIBUTE_KEY), any(AttributeUpdateRequest.class)))
            .thenThrow(missing);

        assertStableError(get("/api/admin/games/missing/attributes"), 404, "404.GAME_NOT_FOUND");
        assertStableError(
            get("/api/admin/games/missing/attributes/" + ATTRIBUTE_KEY),
            404,
            "404.GAME_NOT_FOUND"
        );
        assertStableError(
            postJson("/api/admin/games/missing/attributes", validCreateJson()),
            404,
            "404.GAME_NOT_FOUND"
        );
        assertStableError(
            putJson("/api/admin/games/missing/attributes/" + ATTRIBUTE_KEY, validUpdateJson()),
            404,
            "404.GAME_NOT_FOUND"
        );
    }

    @Test
    void updateOfMissingAttributeReturnsStableNotFound() throws Exception {
        when(service.update(eq(GAME_ID), eq("missing"), any(AttributeUpdateRequest.class)))
            .thenThrow(new ApiException(
                HttpStatus.NOT_FOUND,
                "404.ATTRIBUTE_NOT_FOUND",
                "属性不存在",
                Map.of("gameId", GAME_ID, "attributeKey", "missing")
            ));

        assertStableError(
            putJson(BASE_PATH + "/missing", validUpdateJson()),
            404,
            "404.ATTRIBUTE_NOT_FOUND"
        );
        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void getPostAndPutAllRequireAdminAuthentication() throws Exception {
        when(jwtVerifier.isDisabled()).thenReturn(false);

        mockMvc.perform(get(BASE_PATH)).andExpect(status().isUnauthorized());
        mockMvc.perform(postJson(BASE_PATH, validCreateJson())).andExpect(status().isUnauthorized());
        mockMvc.perform(putJson(BASE_PATH + "/" + ATTRIBUTE_KEY, validUpdateJson()))
            .andExpect(status().isUnauthorized());

        verifyNoInteractions(service);
        verifyNoInteractions(adminEditLogHelper);
    }

    @Test
    void deniesAuthenticatedCallerWithoutEditPermission() throws Exception {
        when(jwtVerifier.isDisabled()).thenReturn(false);
        when(jwtVerifier.verify("reader-token"))
            .thenReturn(new AuthContext("reader@example.com", false, true));

        mockMvc.perform(get(BASE_PATH).header("Authorization", "Bearer reader-token"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("403.FORBIDDEN"));

        verifyNoInteractions(service);
    }

    private void assertValidationField(MockHttpServletRequestBuilder request, String field) throws Exception {
        MvcResult result = mockMvc.perform(request)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("400.VALIDATION_FAILED"))
            .andReturn();
        assertTrue(
            fieldIssueNames(result).contains(field),
            () -> "expected field issue for " + field + ", body=" + responseBody(result)
        );
    }

    private void assertStableError(
        MockHttpServletRequestBuilder request, int statusCode, String code) throws Exception {
        mockMvc.perform(request)
            .andExpect(status().is(statusCode))
            .andExpect(jsonPath("$.error.code").value(code));
    }

    private Set<String> fieldIssueNames(MvcResult result) throws Exception {
        JsonNode issues = objectMapper.readTree(responseBody(result))
            .path("error")
            .path("details")
            .path("fieldIssues");
        assertTrue(issues.isArray(), () -> "fieldIssues must be an array: " + responseBody(result));
        return iterable(issues).stream()
            .map(issue -> issue.path("field").asText())
            .collect(Collectors.toSet());
    }

    private static List<JsonNode> iterable(JsonNode array) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false).toList();
    }

    private static String responseBody(MvcResult result) {
        try {
            return result.getResponse().getContentAsString();
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static MockHttpServletRequestBuilder postJson(String path, String json) {
        return post(path).contentType(MediaType.APPLICATION_JSON).content(json);
    }

    private static MockHttpServletRequestBuilder putJson(String path, String json) {
        return put(path).contentType(MediaType.APPLICATION_JSON).content(json);
    }

    private static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message, Map.of());
    }

    private static ApiException validationFailure(String field, String code, String message) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.VALIDATION_FAILED",
            "属性信息不合法",
            Map.of("fieldIssues", List.of(Map.of(
                "field", field,
                "code", code,
                "message", message
            )))
        );
    }

    private static AttributeResponse enabledAttribute() {
        return new AttributeResponse(
            GAME_ID,
            ATTRIBUTE_KEY,
            "移动速度",
            AttributeValueType.DECIMAL,
            BigDecimal.ZERO,
            new BigDecimal("1000"),
            "角色面板移动速度",
            AttributeStatus.ENABLED,
            100,
            OffsetDateTime.parse("2026-08-22T09:00:00Z"),
            OffsetDateTime.parse("2026-08-22T09:00:00Z")
        );
    }

    private static String validCreateJson() {
        return """
            {
              "attributeKey":"move_speed",
              "name":"移动速度",
              "valueType":"DECIMAL",
              "minValue":0,
              "maxValue":1000,
              "description":"角色面板移动速度",
              "status":"ENABLED",
              "sortOrder":100
            }
            """;
    }

    private static String validUpdateJson() {
        return """
            {
              "name":"移动速度",
              "valueType":"DECIMAL",
              "minValue":0,
              "maxValue":1000,
              "description":"角色面板移动速度",
              "status":"ENABLED",
              "sortOrder":100
            }
            """;
    }
}
