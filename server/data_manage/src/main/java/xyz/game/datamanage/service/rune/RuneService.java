package xyz.game.datamanage.service.rune;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.mapper.rune.RuneMapper;
import xyz.game.datamanage.model.rune.RuneListResponse;
import xyz.game.datamanage.model.rune.RunePathListResponse;
import xyz.game.datamanage.model.rune.RunePathResponse;
import xyz.game.datamanage.model.rune.RunePathRow;
import xyz.game.datamanage.model.rune.RuneResponse;
import xyz.game.datamanage.model.rune.RuneSlot;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class RuneService {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> CATEGORIES = Set.of("KEYSTONE", "MINOR", "SHARD");
    private static final Set<String> KINDS = Set.of("RUNE_PATH", "SHARD_GROUP");
    private final GamesMapper games;
    private final RuneMapper mapper;
    private final ImageRelationMapper images;
    private final ObjectMapper json;
    private final GameConfigurationWriteGuard writes;

    public RuneService(GamesMapper games, RuneMapper mapper, ImageRelationMapper images,
        ObjectMapper json, GameConfigurationWriteGuard writes) {
        this.games = games;
        this.mapper = mapper;
        this.images = images;
        this.json = json;
        this.writes = java.util.Objects.requireNonNull(writes);
    }

    @Transactional(readOnly = true)
    public RuneListResponse listRunes(String gameId, String keyword, String category) {
        requireGame(gameId);
        keyword = filter(keyword, false);
        category = category == null || category.isBlank() ? null : category.trim();
        if (category != null && !CATEGORIES.contains(category)) {
            throw invalid(false, "category", "ENUM_INVALID", "符文类别不合法");
        }
        List<RuneResponse> items = safe(mapper.listRunes(gameId, keyword, category));
        return new RuneListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public RuneResponse getRune(String gameId, String runeKey) {
        requireGame(gameId);
        return requireRune(gameId, runeKey);
    }

    @Transactional
    public RuneResponse createRune(String gameId, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        Basic value = validateRune(body, true);
        if (mapper.findRune(gameId, value.key()) != null) {
            throw conflict(false, "KEY_EXISTS");
        }
        if (mapper.countRuneName(gameId, value.name(), null) > 0) {
            throw conflict(false, "NAME_EXISTS");
        }
        try {
            mapper.insertRune(gameId, value.key(), value.name(), value.description(), value.type());
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, false);
        }
        return requireRune(gameId, value.key());
    }

    @Transactional
    public RuneResponse updateRune(String gameId, String runeKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(runeKey, "runeKey", false);
        Basic value = validateRune(body, false);
        RuneResponse current = requireRune(gameId, runeKey);
        if (!current.category().equals(value.type())) {
            requireUnplaced(gameId, runeKey);
        }
        if (mapper.countRuneName(gameId, value.name(), runeKey) > 0) {
            throw conflict(false, "NAME_EXISTS");
        }
        try {
            if (mapper.updateRune(gameId, runeKey, value.name(), value.description(), value.type()) == 0) {
                throw notFound(false, runeKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, false);
        }
        return requireRune(gameId, runeKey);
    }

    @Transactional
    public void deleteRune(String gameId, String runeKey) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(runeKey, "runeKey", false);
        requireRune(gameId, runeKey);
        requireUnplaced(gameId, runeKey);
        if (mapper.deleteRune(gameId, runeKey) == 0) {
            throw notFound(false, runeKey);
        }
        images.deleteForSource(gameId, "RUNE", "", runeKey);
    }

    @Transactional(readOnly = true)
    public RunePathListResponse listPaths(String gameId, String keyword) {
        requireGame(gameId);
        List<RunePathResponse> items = safe(mapper.listPaths(gameId, filter(keyword, true)))
            .stream().map(this::response).toList();
        return new RunePathListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public RunePathResponse getPath(String gameId, String pathKey) {
        requireGame(gameId);
        return response(requirePath(gameId, pathKey));
    }

    @Transactional
    public RunePathResponse createPath(String gameId, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        PathValue value = validatePath(body, true);
        if (mapper.findPath(gameId, value.basic().key()) != null) {
            throw conflict(true, "KEY_EXISTS");
        }
        if (mapper.countPathName(gameId, value.basic().name(), null) > 0) {
            throw conflict(true, "NAME_EXISTS");
        }
        validateLayout(gameId, null, value.slots());
        Basic basic = value.basic();
        try {
            mapper.insertPath(gameId, basic.key(), basic.name(), basic.description(), basic.type(),
                value.sortOrder(), slotsJson(value.slots()));
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, true);
        }
        return response(requirePath(gameId, basic.key()));
    }

    @Transactional
    public RunePathResponse updatePath(String gameId, String pathKey, JsonNode body) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(pathKey, "pathKey", true);
        PathValue value = validatePath(body, false);
        RunePathRow current = requirePath(gameId, pathKey);
        Basic basic = value.basic();
        // 以写前布局判断；清空布局和改变种类必须是两次明确保存。
        if (!current.kind().equals(basic.type()) && !readSlots(current).isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "409.RUNE_PATH_IN_USE",
                "分组已有槽位，请先清空布局再修改种类", Map.of("pathKey", pathKey));
        }
        if (mapper.countPathName(gameId, basic.name(), pathKey) > 0) {
            throw conflict(true, "NAME_EXISTS");
        }
        validateLayout(gameId, pathKey, value.slots());
        try {
            if (mapper.updatePath(gameId, pathKey, basic.name(), basic.description(), basic.type(),
                value.sortOrder(), slotsJson(value.slots())) == 0) {
                throw notFound(true, pathKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapConstraint(ex, true);
        }
        return response(requirePath(gameId, pathKey));
    }

    @Transactional
    public void deletePath(String gameId, String pathKey) {
        writes.begin(gameId);
        requireGame(gameId);
        validateKey(pathKey, "pathKey", true);
        requirePath(gameId, pathKey);
        if (mapper.deletePath(gameId, pathKey) == 0) {
            throw notFound(true, pathKey);
        }
        images.deleteForSource(gameId, "RUNE_PATH", "", pathKey);
    }

    private void validateLayout(String gameId, String replacingPathKey, List<RuneSlot> slots) {
        Map<String, RuneResponse> runes = new HashMap<>();
        safe(mapper.listRunes(gameId, null, null)).forEach(rune -> runes.put(rune.runeKey(), rune));
        Set<String> placedOrdinary = new HashSet<>();
        for (RunePathRow path : safe(mapper.listPaths(gameId, null))) {
            if (path.pathKey().equals(replacingPathKey)) {
                continue;
            }
            for (RuneSlot slot : readSlots(path)) {
                if (!"SHARD".equals(slot.category())) {
                    placedOrdinary.addAll(slot.runeKeys());
                }
            }
        }
        for (int i = 0; i < slots.size(); i++) {
            RuneSlot slot = slots.get(i);
            for (int j = 0; j < slot.runeKeys().size(); j++) {
                String key = slot.runeKeys().get(j);
                String field = "slots[" + i + "].runeKeys[" + j + "]";
                RuneResponse rune = runes.get(key);
                if (rune == null) {
                    throw invalid(true, field, "REFERENCE_NOT_FOUND", "符文不存在于当前游戏");
                }
                if (!slot.category().equals(rune.category())) {
                    throw invalid(true, field, "CATEGORY_MISMATCH", "符文类别与槽位不一致");
                }
                if (!"SHARD".equals(rune.category()) && !placedOrdinary.add(key)) {
                    throw invalid(true, field, "DUPLICATE_POSITION", "普通符文在当前游戏只能占一个位置");
                }
            }
        }
    }

    private void requireUnplaced(String gameId, String runeKey) {
        List<Map<String, Object>> references = new ArrayList<>();
        for (RunePathRow path : safe(mapper.listPaths(gameId, null))) {
            List<RuneSlot> slots = readSlots(path);
            for (int i = 0; i < slots.size(); i++) {
                RuneSlot slot = slots.get(i);
                if (slot.runeKeys().contains(runeKey)) {
                    references.add(Map.of("pathKey", path.pathKey(), "slotIndex", i, "slotName", slot.name()));
                }
            }
        }
        if (!references.isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "409.RUNE_IN_USE", "符文已放入槽位，请先解除位置",
                Map.of("runeKey", runeKey, "references", List.copyOf(references)));
        }
    }

    private Basic validateRune(JsonNode body, boolean create) {
        requireObject(body, false, "request");
        allowed(body, create ? Set.of("runeKey", "name", "description", "category")
            : Set.of("name", "description", "category"), false, "");
        String key = create ? text(body.get("runeKey"), "runeKey", false, 64, false) : null;
        if (create) {
            validateKey(key, "runeKey", false);
        }
        String category = text(body.get("category"), "category", false, 16, false);
        if (!CATEGORIES.contains(category)) {
            throw invalid(false, "category", "ENUM_INVALID", "符文类别不合法");
        }
        return new Basic(key, text(body.get("name"), "name", false, 100, false),
            text(body.get("description"), "description", false, 2000, true), category);
    }

    private PathValue validatePath(JsonNode body, boolean create) {
        requireObject(body, true, "request");
        allowed(body, create ? Set.of("pathKey", "name", "description", "kind", "sortOrder", "slots")
            : Set.of("name", "description", "kind", "sortOrder", "slots"), true, "");
        String key = create ? text(body.get("pathKey"), "pathKey", true, 64, false) : null;
        if (create) {
            validateKey(key, "pathKey", true);
        }
        String kind = text(body.get("kind"), "kind", true, 16, false);
        if (!KINDS.contains(kind)) {
            throw invalid(true, "kind", "ENUM_INVALID", "分组种类不合法");
        }
        JsonNode sort = body.get("sortOrder");
        if (sort == null || !sort.isIntegralNumber() || !sort.canConvertToInt() || sort.intValue() < 0) {
            throw invalid(true, "sortOrder", "RANGE_INVALID", "排序必须是 0 到 2147483647 的整数");
        }
        JsonNode rawSlots = body.get("slots");
        if (rawSlots == null || !rawSlots.isArray()) {
            throw invalid(true, "slots", "ARRAY_REQUIRED", "槽位必须显式提供数组");
        }
        List<RuneSlot> slots = new ArrayList<>();
        for (int i = 0; i < rawSlots.size(); i++) {
            JsonNode slot = rawSlots.get(i);
            String field = "slots[" + i + "]";
            requireObject(slot, true, field);
            allowed(slot, Set.of("name", "category", "runeKeys"), true, field + ".");
            String name = text(slot.get("name"), field + ".name", true, 100, false);
            String category = text(slot.get("category"), field + ".category", true, 16, false);
            if (!CATEGORIES.contains(category) || ("SHARD_GROUP".equals(kind) != "SHARD".equals(category))) {
                throw invalid(true, field + ".category", "CATEGORY_MISMATCH", "槽位类别与分组种类不一致");
            }
            JsonNode rawKeys = slot.get("runeKeys");
            if (rawKeys == null || !rawKeys.isArray()) {
                throw invalid(true, field + ".runeKeys", "ARRAY_REQUIRED", "符文选项必须显式提供数组");
            }
            List<String> keys = new ArrayList<>();
            Set<String> rowKeys = new HashSet<>();
            for (int j = 0; j < rawKeys.size(); j++) {
                String keyField = field + ".runeKeys[" + j + "]";
                String runeKey = text(rawKeys.get(j), keyField, true, 64, false);
                validateKey(runeKey, keyField, true);
                if (!rowKeys.add(runeKey)) {
                    throw invalid(true, keyField, "DUPLICATE_KEY", "同一槽位不能重复放入符文");
                }
                keys.add(runeKey);
            }
            slots.add(new RuneSlot(name, category, List.copyOf(keys)));
        }
        Basic basic = new Basic(key, text(body.get("name"), "name", true, 100, false),
            text(body.get("description"), "description", true, 2000, true), kind);
        return new PathValue(basic, sort.intValue(), List.copyOf(slots));
    }

    private RunePathResponse response(RunePathRow row) {
        return new RunePathResponse(row.gameId(), row.pathKey(), row.name(), row.description(), row.kind(),
            row.sortOrder(), readSlots(row), row.createdAt(), row.updatedAt());
    }

    private List<RuneSlot> readSlots(RunePathRow row) {
        try {
            JsonNode tree = json.readTree(row.slotsJson());
            if (tree == null || !tree.isArray()) {
                throw new IllegalArgumentException("槽位不是数组");
            }
            // 使用与请求一致的形状检查，数据库异常不能被当成空布局或漏掉删除保护。
            JsonNode body = json.createObjectNode().put("name", row.name()).put("kind", row.kind())
                .put("sortOrder", row.sortOrder()).set("slots", tree);
            return validatePath(body, false).slots();
        } catch (RuntimeException | JsonProcessingException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "500.INTERNAL_ERROR", "已存符文布局不合法",
                Map.of("pathKey", row.pathKey()));
        }
    }

    private String slotsJson(List<RuneSlot> slots) {
        try {
            return json.writeValueAsString(slots);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("无法保存符文布局", ex);
        }
    }

    private RuneResponse requireRune(String gameId, String key) {
        RuneResponse result = mapper.findRune(gameId, key);
        if (result == null) {
            throw notFound(false, key);
        }
        return result;
    }

    private RunePathRow requirePath(String gameId, String key) {
        RunePathRow result = mapper.findPath(gameId, key);
        if (result == null) {
            throw notFound(true, key);
        }
        return result;
    }

    private void requireGame(String gameId) {
        Long count = games.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.GAME_NOT_FOUND", "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId));
        }
    }

    private static void requireObject(JsonNode body, boolean path, String field) {
        if (body == null || !body.isObject()) {
            throw invalid(path, field, "OBJECT_REQUIRED", "必须提供完整对象");
        }
    }

    private static void allowed(JsonNode body, Set<String> allowed, boolean path, String prefix) {
        body.fieldNames().forEachRemaining(field -> {
            if (!allowed.contains(field)) {
                throw invalid(path, prefix + field, "UNKNOWN_FIELD", "请求不支持此字段");
            }
        });
    }

    private static String text(JsonNode value, String field, boolean path, int maximum, boolean optional) {
        if (optional && (value == null || value.isNull())) {
            return null;
        }
        if (value == null || !value.isTextual()) {
            throw invalid(path, field, "STRING_REQUIRED", "必须提供字符串");
        }
        String result = value.textValue().trim();
        if (result.isEmpty()) {
            if (optional) {
                return null;
            }
            throw invalid(path, field, "REQUIRED", "不能为空");
        }
        if (result.length() > maximum) {
            throw invalid(path, field, "LENGTH_INVALID", "内容不能超过 " + maximum + " 个字符");
        }
        return result;
    }

    private static void validateKey(String key, String field, boolean path) {
        if (key == null || !KEY.matcher(key).matches()) {
            throw invalid(path, field, "FORMAT_INVALID", "标识格式不合法");
        }
    }

    private static String filter(String value, boolean path) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String result = value.trim();
        if (result.length() > 100) {
            throw invalid(path, "keyword", "LENGTH_INVALID", "关键词不能超过100个字符");
        }
        return result;
    }

    private static ApiException invalid(boolean path, String field, String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST,
            path ? "400.INVALID_RUNE_PATH_REQUEST" : "400.INVALID_RUNE_REQUEST",
            path ? "符文分组信息不合法" : "符文信息不合法",
            Map.of("fieldIssues", List.of(Map.of("field", field, "code", code, "message", message))));
    }

    private static ApiException notFound(boolean path, String key) {
        return new ApiException(HttpStatus.NOT_FOUND, path ? "404.RUNE_PATH_NOT_FOUND" : "404.RUNE_NOT_FOUND",
            path ? "符文分组不存在" : "符文不存在", Map.of(path ? "pathKey" : "runeKey", key == null ? "" : key));
    }

    private static ApiException conflict(boolean path, String suffix) {
        return new ApiException(HttpStatus.CONFLICT, "409." + (path ? "RUNE_PATH_" : "RUNE_") + suffix,
            (path ? "符文分组" : "符文") + ("KEY_EXISTS".equals(suffix) ? "标识已存在" : "名称已存在"));
    }

    private static RuntimeException mapConstraint(DataIntegrityViolationException ex, boolean path) {
        String message = ex.getMostSpecificCause().getMessage();
        String table = path ? "rune_paths" : "runes";
        if (message != null && message.contains("pk_" + table)) {
            return conflict(path, "KEY_EXISTS");
        }
        if (message != null && message.contains("uq_" + table + "_name")) {
            return conflict(path, "NAME_EXISTS");
        }
        return ex;
    }

    private static <T> List<T> safe(List<T> values) {
        return values == null ? List.of() : List.copyOf(values);
    }

    private record Basic(String key, String name, String description, String type) {}
    private record PathValue(Basic basic, int sortOrder, List<RuneSlot> slots) {}
}
