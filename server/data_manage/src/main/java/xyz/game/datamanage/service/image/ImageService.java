package xyz.game.datamanage.service.image;

import jakarta.validation.Valid;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.image.ImageMapper;
import xyz.game.datamanage.model.image.ImageCreateRequest;
import xyz.game.datamanage.model.image.ImageListQuery;
import xyz.game.datamanage.model.image.ImageListResponse;
import xyz.game.datamanage.model.image.ImagePublicItemResponse;
import xyz.game.datamanage.model.image.ImagePublicListResponse;
import xyz.game.datamanage.model.image.ImageResponse;
import xyz.game.datamanage.model.image.ImageUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@Service
@Validated
public class ImageService {

    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;

    private static final Pattern KEY_PATTERN = Pattern.compile(
        "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
    );
    private static final String PRIMARY_KEY_CONSTRAINT = "pk_images";
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_images_name";

    private final GamesMapper gamesMapper;
    private final ImageMapper mapper;
    private final ImageContentValidator contentValidator;

    public ImageService(
        GamesMapper gamesMapper,
        ImageMapper mapper,
        ImageContentValidator contentValidator,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites
    ) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;
        this.contentValidator = contentValidator;

        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public ImageListResponse list(String gameId, @Valid ImageListQuery query) {
        requireGame(gameId);
        ImageListQuery normalized = query == null
            ? new ImageListQuery(null, null)
            : query;
        if (normalized.keyword() != null && normalized.keyword().length() > 100) {
            throw validationFailed(List.of(
                fieldIssue("keyword", "LENGTH_INVALID", "关键词不能超过100个字符")
            ));
        }
        List<ImageResponse> rows = mapper.list(gameId, normalized.keyword(), normalized.enabled());
        List<ImageResponse> items = rows == null ? List.of() : List.copyOf(rows);
        return new ImageListResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public ImageResponse get(String gameId, String imageKey) {
        requireGame(gameId);
        return requireImage(gameId, imageKey);
    }

    @Transactional(readOnly = true)
    public ImagePublicListResponse listPublic(String gameId, String updatedAfterRaw) {
        requireGame(gameId);
        Instant updatedAfter = parseOptionalInstant(updatedAfterRaw);
        List<ImagePublicItemResponse> rows = mapper.listPublic(
            gameId,
            updatedAfter == null ? null : Timestamp.from(updatedAfter)
        );
        return new ImagePublicListResponse(gameId, rows == null ? List.of() : List.copyOf(rows));
    }

    @Transactional
    public ImageResponse create(String gameId, ImageCreateRequest request) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateCreate(request);
        ValidatedImageContent content = contentValidator.validate(request.imageBase64());
        if (mapper.countByKey(gameId, request.imageKey()) > 0) {
            throw keyExists();
        }
        if (mapper.countByNormalizedName(gameId, request.name(), null) > 0) {
            throw nameExists();
        }

        try {
            mapper.insert(
                gameId,
                request.imageKey(),
                request.name(),
                request.description(),
                content.imageBase64(),
                content.mimeType(),
                content.byteSize(),
                content.width(),
                content.height()
            );
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireImage(gameId, request.imageKey());
    }

    @Transactional
    public ImageResponse update(String gameId, String imageKey, ImageUpdateRequest request) {
        configurationWrites.begin(gameId);
        requireGame(gameId);
        validateUpdate(request);
        if (mapper.findByIdForUpdate(gameId, imageKey) == null) {
            throw notFound(imageKey);
        }
        if (mapper.countByNormalizedName(gameId, request.name(), imageKey) > 0) {
            throw nameExists();
        }

        ValidatedImageContent replacement = request.replacesContent()
            ? contentValidator.validate(request.imageBase64())
            : null;
        try {
            int updated = mapper.update(
                gameId,
                imageKey,
                request.name(),
                request.description(),
                request.enabled(),
                replacement != null,
                replacement == null ? null : replacement.imageBase64(),
                replacement == null ? null : replacement.mimeType(),
                replacement == null ? null : replacement.byteSize(),
                replacement == null ? null : replacement.width(),
                replacement == null ? null : replacement.height()
            );
            if (updated == 0) {
                throw notFound(imageKey);
            }
        } catch (DataIntegrityViolationException ex) {
            throw mapWriteConstraint(ex);
        }
        return requireImage(gameId, imageKey);
    }

    private void requireGame(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        if (count == null || count <= 0) {
            throw new ApiException(
                HttpStatus.NOT_FOUND,
                "404.GAME_NOT_FOUND",
                "游戏不存在",
                Map.of("gameId", gameId == null ? "" : gameId)
            );
        }
    }

    private ImageResponse requireImage(String gameId, String imageKey) {
        ImageResponse response = mapper.findById(gameId, imageKey);
        if (response == null) {
            throw notFound(imageKey);
        }
        return response;
    }

    private static void validateCreate(ImageCreateRequest request) {
        if (request == null) {
            throw validationFailed(List.of(
                fieldIssue("request", "REQUIRED", "图片信息不能为空")
            ));
        }
        rejectUnknownFields(request.unknownFields());
        List<Map<String, String>> issues = new ArrayList<>();
        validateKey(request.imageKey(), issues);
        validateNameAndDescription(request.name(), request.description(), issues);
        if (!issues.isEmpty()) {
            throw validationFailed(issues);
        }
    }

    private static void validateUpdate(ImageUpdateRequest request) {
        if (request == null) {
            throw validationFailed(List.of(
                fieldIssue("request", "REQUIRED", "图片信息不能为空")
            ));
        }
        rejectUnknownFields(request.unknownFields());
        List<Map<String, String>> issues = new ArrayList<>();
        validateNameAndDescription(request.name(), request.description(), issues);
        if (request.enabled() == null) {
            issues.add(fieldIssue("enabled", "REQUIRED", "启用状态不能为空"));
        }
        if (!issues.isEmpty()) {
            throw validationFailed(issues);
        }
    }

    private static void validateKey(String imageKey, List<Map<String, String>> issues) {
        if (imageKey == null || imageKey.isBlank()) {
            issues.add(fieldIssue("imageKey", "REQUIRED", "图片标识不能为空"));
        } else if (!KEY_PATTERN.matcher(imageKey).matches()) {
            issues.add(fieldIssue("imageKey", "FORMAT_INVALID", "图片标识格式不合法"));
        }
    }

    private static void validateNameAndDescription(
        String name,
        String description,
        List<Map<String, String>> issues
    ) {
        if (name == null || name.isBlank()) {
            issues.add(fieldIssue("name", "REQUIRED", "图片名称不能为空"));
        } else if (name.length() > 100) {
            issues.add(fieldIssue("name", "LENGTH_INVALID", "图片名称不能超过100个字符"));
        }
        if (description != null && description.length() > 2000) {
            issues.add(fieldIssue("description", "LENGTH_INVALID", "图片说明不能超过2000个字符"));
        }
    }

    private static void rejectUnknownFields(Set<String> unknownFields) {
        if (unknownFields == null || unknownFields.isEmpty()) {
            return;
        }
        List<Map<String, String>> issues = unknownFields.stream()
            .sorted()
            .map(field -> fieldIssue(field, "UNKNOWN_FIELD", "不允许提交字段 " + field))
            .toList();
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.INVALID_BODY",
            "请求包含未知或只读字段",
            Map.of("fieldIssues", issues)
        );
    }

    private static Instant parseOptionalInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw.trim());
        } catch (DateTimeParseException ex) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "400.VALIDATION_FAILED",
                "更新时间参数不合法",
                Map.of(
                    "fieldIssues",
                    List.of(fieldIssue(
                        "updatedAfter",
                        "FORMAT_INVALID",
                        "更新时间必须是标准时间"
                    ))
                )
            );
        }
    }

    private static ApiException validationFailed(List<Map<String, String>> issues) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.VALIDATION_FAILED",
            "图片信息不合法",
            Map.of("fieldIssues", List.copyOf(issues))
        );
    }

    private static ApiException notFound(String imageKey) {
        return new ApiException(
            HttpStatus.NOT_FOUND,
            "404.IMAGE_NOT_FOUND",
            "图片不存在",
            Map.of("imageKey", imageKey == null ? "" : imageKey)
        );
    }

    private static ApiException keyExists() {
        return conflict("409.IMAGE_KEY_EXISTS", "图片标识已存在", "imageKey");
    }

    private static ApiException nameExists() {
        return conflict("409.IMAGE_NAME_EXISTS", "图片名称已存在", "name");
    }

    private static ApiException conflict(String code, String message, String field) {
        return new ApiException(
            HttpStatus.CONFLICT,
            code,
            message,
            Map.of(
                "fieldIssues",
                List.of(fieldIssue(field, "CONFLICT", message))
            )
        );
    }

    private static RuntimeException mapWriteConstraint(DataIntegrityViolationException ex) {
        String text = collectCauseMessages(ex).toLowerCase(Locale.ROOT);
        if (text.contains(PRIMARY_KEY_CONSTRAINT)) {
            return keyExists();
        }
        if (text.contains(NAME_UNIQUE_CONSTRAINT)) {
            return nameExists();
        }
        if (hasSqlState(ex, "23505")) {
            return nameExists();
        }
        return ex;
    }

    private static boolean hasSqlState(Throwable throwable, String state) {
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current instanceof SQLException sqlException && state.equals(sqlException.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static String collectCauseMessages(Throwable throwable) {
        StringBuilder result = new StringBuilder();
        for (Throwable current = throwable; current != null; current = current.getCause()) {
            if (current.getMessage() != null) {
                result.append(' ').append(current.getMessage());
            }
        }
        return result.toString();
    }

    private static Map<String, String> fieldIssue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
