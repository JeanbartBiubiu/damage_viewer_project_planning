package xyz.game.datamanage.service.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import xyz.game.datamanage.mapper.GamesMapper;
import xyz.game.datamanage.mapper.image.ImageMapper;
import xyz.game.datamanage.model.image.ImageCreateRequest;
import xyz.game.datamanage.model.image.ImageListQuery;
import xyz.game.datamanage.model.image.ImagePublicItemResponse;
import xyz.game.datamanage.model.image.ImageResponse;
import xyz.game.datamanage.model.image.ImageUpdateRequest;
import xyz.game.datamanage.support.error.ApiException;

@ExtendWith(MockitoExtension.class)
class ImageServiceTest {

    @Mock
    private GamesMapper gamesMapper;
    @Mock
    private ImageMapper mapper;
    private ImageService service;

    @BeforeEach
    void setUp() {
        service = new ImageService(
            gamesMapper,
            mapper,
            new ImageContentValidator()
        , org.mockito.Mockito.mock(xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard.class));
        when(gamesMapper.countGames("lol")).thenReturn(1L);
    }

    @Test
    void createsSmallImageAndPreservesSubmittedBytes() throws IOException {
        String dataUri = imageDataUri(24, 12);
        ImageCreateRequest request = new ImageCreateRequest(
            " icon ",
            " 小图 ",
            " ",
            TextNode.valueOf(dataUri),
            Set.of()
        );
        ImageResponse stored = image("icon", "小图", dataUri, 24, 12, true);
        when(mapper.countByKey("lol", "icon")).thenReturn(0L);
        when(mapper.countByNormalizedName("lol", "小图", null)).thenReturn(0L);
        when(mapper.findById("lol", "icon")).thenReturn(stored);

        ImageResponse result = service.create("lol", request);

        assertEquals(24, result.width());
        assertEquals(12, result.height());
        assertEquals(dataUri, result.imageBase64());
        verify(mapper).insert(
            eq("lol"),
            eq("icon"),
            eq("小图"),
            isNull(),
            eq(dataUri),
            eq("image/png"),
            anyInt(),
            eq(24),
            eq(12)
        );
    }

    @Test
    void updateWithoutImageKeepsStoredContent() {
        ImageResponse stored = image(
            "icon",
            "旧名称",
            "data:image/png;base64,abc",
            32,
            32,
            true
        );
        ImageResponse updated = image(
            "icon",
            "新名称",
            "data:image/png;base64,abc",
            32,
            32,
            false
        );
        when(mapper.findByIdForUpdate("lol", "icon")).thenReturn(stored);
        when(mapper.countByNormalizedName("lol", "新名称", "icon")).thenReturn(0L);
        when(mapper.update(
            eq("lol"),
            eq("icon"),
            eq("新名称"),
            isNull(),
            eq(false),
            eq(false),
            isNull(),
            isNull(),
            isNull(),
            isNull(),
            isNull()
        )).thenReturn(1);
        when(mapper.findById("lol", "icon")).thenReturn(updated);

        ImageResponse result = service.update(
            "lol",
            "icon",
            new ImageUpdateRequest(" 新名称 ", null, false, null, Set.of())
        );

        assertFalse(result.enabled());
        assertEquals("data:image/png;base64,abc", result.imageBase64());
    }

    @Test
    void explicitNullReplacementIsRejectedWithoutWrite() {
        when(mapper.findByIdForUpdate("lol", "icon")).thenReturn(
            image("icon", "图标", "data:image/png;base64,abc", 32, 32, true)
        );
        when(mapper.countByNormalizedName("lol", "图标", "icon")).thenReturn(0L);

        ApiException error = assertThrows(
            ApiException.class,
            () -> service.update(
                "lol",
                "icon",
                new ImageUpdateRequest("图标", null, true, NullNode.instance, Set.of())
            )
        );

        assertEquals("400.IMAGE_CONTENT_INVALID", error.getCode());
        verify(mapper, never()).update(
            any(),
            any(),
            any(),
            any(),
            anyBoolean(),
            anyBoolean(),
            any(),
            any(),
            any(),
            any(),
            any()
        );
    }

    @Test
    void unknownTopLevelFieldIsInvalidBody() throws IOException {
        ImageCreateRequest request = new ImageCreateRequest(
            "icon",
            "图标",
            null,
            TextNode.valueOf(imageDataUri(16, 16)),
            Set.of("width")
        );

        ApiException error = assertThrows(
            ApiException.class,
            () -> service.create("lol", request)
        );

        assertEquals("400.INVALID_BODY", error.getCode());
        verify(mapper, never()).insert(
            any(),
            any(),
            any(),
            any(),
            any(),
            any(),
            anyInt(),
            anyInt(),
            anyInt()
        );
    }

    @Test
    void listAndPublicSyncKeepFrozenOrderingInputs() {
        ImageResponse image = image(
            "icon",
            "图标",
            "data:image/png;base64,abc",
            32,
            32,
            true
        );
        when(mapper.list("lol", "ico", true)).thenReturn(List.of(image));
        when(mapper.listPublic("lol", null)).thenReturn(List.of(
            new ImagePublicItemResponse(
                "icon",
                true,
                "data:image/png;base64,abc",
                OffsetDateTime.parse("2026-09-05T00:00:00Z")
            )
        ));

        assertEquals(
            1,
            service.list("lol", new ImageListQuery(" ico ", true)).total()
        );
        assertEquals(1, service.listPublic("lol", null).images().size());
    }

    @Test
    void invalidUpdatedAfterUsesStableValidationError() {
        ApiException error = assertThrows(
            ApiException.class,
            () -> service.listPublic("lol", "not-a-time")
        );
        assertEquals("400.VALIDATION_FAILED", error.getCode());
    }

    private static ImageResponse image(
        String key,
        String name,
        String dataUri,
        int width,
        int height,
        boolean enabled
    ) {
        OffsetDateTime now = OffsetDateTime.parse("2026-09-05T00:00:00Z");
        return new ImageResponse(
            "lol",
            key,
            name,
            null,
            dataUri,
            "image/png",
            100,
            width,
            height,
            enabled,
            now,
            now
        );
    }

    private static String imageDataUri(int width, int height) throws IOException {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, "png", output);
        return "data:image/png;base64,"
            + Base64.getEncoder().encodeToString(output.toByteArray());
    }
}
