package xyz.game.datamanage.service.imagerelation;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.imagerelation.ImageRelationMapper;
import xyz.game.datamanage.model.imagerelation.ImageOptionResponse;
import xyz.game.datamanage.model.imagerelation.ImageRelationSource;
import xyz.game.datamanage.model.imagerelation.ImageUsageResponse;
import xyz.game.datamanage.model.imagerelation.ImageUsageRow;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageRequest;
import xyz.game.datamanage.model.imagerelation.RepresentativeImageResponse;
import xyz.game.datamanage.support.error.ApiException;

@Service
public class ImageRelationService {
    private final xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites;
    private static final Pattern IMAGE_KEY = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
    private final GamesMapper gamesMapper;
    private final ImageRelationMapper mapper;

    public ImageRelationService(GamesMapper gamesMapper, ImageRelationMapper mapper,
        xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard configurationWrites) {
        this.gamesMapper = gamesMapper;
        this.mapper = mapper;
        this.configurationWrites = java.util.Objects.requireNonNull(configurationWrites);
    }

    @Transactional(readOnly = true)
    public RepresentativeImageResponse get(
        String gameId, ImageRelationSource sourceType, String sourceParentKey, String sourceKey
    ) {
        return new RepresentativeImageResponse(readCurrent(gameId, sourceType, sourceParentKey, sourceKey));
    }

    @Transactional
    @CacheEvict(cacheNames = "games", key = "'all:stage9'", condition = "#sourceType.name() == 'GAME'")
    public RepresentativeImageResponse put(
        String gameId, ImageRelationSource sourceType, String sourceParentKey, String sourceKey,
        RepresentativeImageRequest request
    ) {
        configurationWrites.begin(gameId);
        validateRequest(request);
        RepresentativeImageResponse.Image current = readCurrent(gameId, sourceType, sourceParentKey, sourceKey);
        RepresentativeImageResponse.Image selected = mapper.findImage(gameId, request.imageKey());
        if (selected == null) {
            throw notFound("IMAGE", "图片", "imageKey", request.imageKey());
        }
        if (!Boolean.TRUE.equals(selected.enabled()) && (current == null || !current.imageKey().equals(selected.imageKey()))) {
            throw new ApiException(HttpStatus.CONFLICT, "409.REFERENCE_DISABLED", "不能改选或新增停用图片", Map.of(
                "imageKey", selected.imageKey(),
                "fieldIssues", List.of(issue("imageKey", "REFERENCE_DISABLED", "请选择已启用图片"))
            ));
        }
        mapper.put(gameId, sourceType.name(), sourceParentKey, sourceKey, selected.imageKey());
        return new RepresentativeImageResponse(selected);
    }

    @Transactional
    @CacheEvict(cacheNames = "games", key = "'all:stage9'", condition = "#sourceType.name() == 'GAME'")
    public void delete(String gameId, ImageRelationSource sourceType, String sourceParentKey, String sourceKey) {
        configurationWrites.begin(gameId);
        RepresentativeImageResponse.Image current = readCurrent(gameId, sourceType, sourceParentKey, sourceKey);
        if (current == null || mapper.deleteForSource(gameId, sourceType.name(), sourceParentKey, sourceKey) == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "404.RELATION_NOT_FOUND", "代表图片关系不存在",
                location(gameId, sourceType.name(), sourceParentKey, sourceKey));
        }
    }

    @Transactional(readOnly = true)
    public ImageOptionResponse options(String gameId, String keyword) {
        requireGame(gameId);
        String normalized = keyword == null ? "" : keyword.trim();
        if (normalized.isEmpty()) {
            throw validationFailed("keyword", "REQUIRED", "请输入图片关键词");
        }
        if (normalized.length() > 100) {
            throw validationFailed("keyword", "LENGTH_INVALID", "图片关键词不能超过100个字符");
        }
        List<ImageOptionResponse.Item> rows = mapper.listOptions(gameId, normalized);
        List<ImageOptionResponse.Item> items = rows == null ? List.of() : List.copyOf(rows);
        return new ImageOptionResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public ImageUsageResponse usages(String gameId, String imageKey) {
        List<ImageUsageRow> rows = mapper.listUsages(gameId, imageKey);
        rows = rows == null ? List.of() : rows;
        RepresentativeImageResponse.Image image = mapper.findImage(gameId, imageKey);
        if (!rows.isEmpty() && (image == null || !gameExists(gameId))) {
            throw dangling(gameId, rows.getFirst(), imageKey);
        }
        requireGame(gameId);
        if (image == null) {
            throw notFound("IMAGE", "图片", "imageKey", imageKey);
        }
        List<ImageUsageResponse.Game> games = new ArrayList<>();
        List<ImageUsageResponse.Character> characters = new ArrayList<>();
        List<ImageUsageResponse.Attribute> attributes = new ArrayList<>();
        List<ImageUsageResponse.Equipment> equipment = new ArrayList<>();
        List<ImageUsageResponse.Skill> skills = new ArrayList<>();
        List<ImageUsageResponse.SkillEffect> effects = new ArrayList<>();
        List<ImageUsageResponse.Status> statuses = new ArrayList<>();
        for (ImageUsageRow row : rows) {
            if (row.sourceName() == null || ("SKILL_EFFECT".equals(row.sourceType()) && row.parentName() == null)) {
                throw dangling(gameId, row, imageKey);
            }
            switch (row.sourceType()) {
                case "GAME" -> games.add(new ImageUsageResponse.Game(row.sourceKey(), row.sourceName()));
                case "CHARACTER" -> characters.add(new ImageUsageResponse.Character(row.sourceKey(), row.sourceName()));
                case "ATTRIBUTE" -> attributes.add(new ImageUsageResponse.Attribute(row.sourceKey(), row.sourceName(), row.sourceStatus()));
                case "EQUIPMENT" -> equipment.add(new ImageUsageResponse.Equipment(row.sourceKey(), row.sourceName()));
                case "SKILL" -> skills.add(new ImageUsageResponse.Skill(row.sourceKey(), row.sourceName(), row.sourceStatus()));
                case "SKILL_EFFECT" -> effects.add(new ImageUsageResponse.SkillEffect(row.sourceParentKey(), row.parentName(), row.sourceKey(), row.sourceName()));
                case "STATUS" -> statuses.add(new ImageUsageResponse.Status(row.sourceKey(), row.sourceName(), row.sourceStatus()));
                default -> throw dangling(gameId, row, imageKey);
            }
        }
        return new ImageUsageResponse(imageKey, List.copyOf(games), List.copyOf(characters), List.copyOf(attributes),
            List.copyOf(equipment), List.copyOf(skills), List.copyOf(effects), List.copyOf(statuses));
    }

    private RepresentativeImageResponse.Image readCurrent(
        String gameId, ImageRelationSource sourceType, String sourceParentKey, String sourceKey
    ) {
        String imageKey = mapper.findImageKey(gameId, sourceType.name(), sourceParentKey, sourceKey);
        if (imageKey != null) {
            RepresentativeImageResponse.Image image = mapper.findImage(gameId, imageKey);
            if (image == null || !gameExists(gameId)
                || mapper.countSource(gameId, sourceType.name(), sourceParentKey, sourceKey) == 0) {
                throw dangling(gameId, new ImageUsageRow(sourceType.name(), sourceParentKey, sourceKey, null, null, null), imageKey);
            }
            return image;
        }
        requireGame(gameId);
        if (sourceType == ImageRelationSource.SKILL_EFFECT
            && mapper.countSource(gameId, "SKILL", "", sourceParentKey) == 0) {
            throw notFound("SKILL", "技能", "skillKey", sourceParentKey);
        }
        if (mapper.countSource(gameId, sourceType.name(), sourceParentKey, sourceKey) == 0) {
            throw notFound(sourceType.name(), sourceType.label(), sourceType.keyField(), sourceKey);
        }
        return null;
    }

    private boolean gameExists(String gameId) {
        Long count = gamesMapper.countGames(gameId);
        return count != null && count > 0;
    }

    private void requireGame(String gameId) {
        if (!gameExists(gameId)) {
            throw notFound("GAME", "游戏", "gameId", gameId);
        }
    }

    private static void validateRequest(RepresentativeImageRequest request) {
        if (request == null) {
            throw validationFailed("request", "REQUIRED", "代表图片信息不能为空");
        }
        if (!request.unknownFields().isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "400.INVALID_BODY", "请求包含未知或只读字段", Map.of(
                "fieldIssues", request.unknownFields().stream().sorted()
                    .map(field -> issue(field, "UNKNOWN_FIELD", "不允许提交字段 " + field)).toList()
            ));
        }
        if (request.imageKey() == null || request.imageKey().isBlank()) {
            throw validationFailed("imageKey", "REQUIRED", "图片标识不能为空");
        }
        if (!IMAGE_KEY.matcher(request.imageKey()).matches()) {
            throw validationFailed("imageKey", "FORMAT_INVALID", "图片标识格式不合法");
        }
    }

    private static ApiException dangling(String gameId, ImageUsageRow row, String imageKey) {
        return new ApiException(HttpStatus.CONFLICT, "409.RELATION_DANGLING", "图片关系指向不存在的来源或图片", Map.of(
            "gameId", gameId, "sourceType", row.sourceType(), "sourceParentKey", row.sourceParentKey(),
            "sourceKey", row.sourceKey(), "imageKey", imageKey
        ));
    }

    private static Map<String, Object> location(String gameId, String type, String parent, String key) {
        return Map.of("gameId", gameId, "sourceType", type, "sourceParentKey", parent, "sourceKey", key);
    }

    private static ApiException notFound(String type, String label, String field, String key) {
        return new ApiException(HttpStatus.NOT_FOUND, "404." + type + "_NOT_FOUND", label + "不存在",
            Map.of(field, key == null ? "" : key));
    }

    private static ApiException validationFailed(String field, String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "400.VALIDATION_FAILED", "图片关系参数不合法",
            Map.of("fieldIssues", List.of(issue(field, code, message))));
    }

    private static Map<String, String> issue(String field, String code, String message) {
        return Map.of("field", field, "code", code, "message", message);
    }
}
