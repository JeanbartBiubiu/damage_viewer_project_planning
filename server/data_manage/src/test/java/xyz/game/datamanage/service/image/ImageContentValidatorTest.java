package xyz.game.datamanage.service.image;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.TextNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.support.error.ApiException;

class ImageContentValidatorTest {

    private final ImageContentValidator validator = new ImageContentValidator();

    @Test
    void acceptsSmallPngWithoutChangingSubmittedContent() throws IOException {
        String dataUri = imageDataUri(32, 20, "png");

        ValidatedImageContent result = validator.validate(TextNode.valueOf(dataUri));

        assertEquals(dataUri, result.imageBase64());
        assertEquals("image/png", result.mimeType());
        assertEquals(32, result.width());
        assertEquals(20, result.height());
    }

    @Test
    void rejectsImageWhoseDimensionExceeds64() throws IOException {
        ApiException error = assertThrows(
            ApiException.class,
            () -> validator.validate(TextNode.valueOf(imageDataUri(65, 32, "png")))
        );

        assertEquals("400.IMAGE_CONTENT_INVALID", error.getCode());
        assertEquals("DIMENSION_INVALID", firstIssueCode(error));
    }

    @Test
    void rejectsDeclaredMimeThatDoesNotMatchContent() throws IOException {
        String jpeg = imageDataUri(16, 16, "jpeg");
        String mismatched = "data:image/png;base64," + jpeg.substring(jpeg.indexOf(',') + 1);

        ApiException error = assertThrows(
            ApiException.class,
            () -> validator.validate(TextNode.valueOf(mismatched))
        );

        assertEquals("MIME_MISMATCH", firstIssueCode(error));
    }

    @Test
    void rejectsPayloadOverByteLimitBeforeImageRead() {
        String payload = Base64.getEncoder().encodeToString(
            new byte[ImageContentValidator.MAX_BYTE_SIZE + 1]
        );

        ApiException error = assertThrows(
            ApiException.class,
            () -> validator.validate(TextNode.valueOf("data:image/png;base64," + payload))
        );

        assertEquals("SIZE_EXCEEDED", firstIssueCode(error));
    }

    private static String imageDataUri(int width, int height, String format) throws IOException {
        int imageType = "jpeg".equals(format)
            ? BufferedImage.TYPE_INT_RGB
            : BufferedImage.TYPE_INT_ARGB;
        BufferedImage image = new BufferedImage(width, height, imageType);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(image, format, output);
        return "data:image/" + format + ";base64,"
            + Base64.getEncoder().encodeToString(output.toByteArray());
    }

    @SuppressWarnings("unchecked")
    private static String firstIssueCode(ApiException error) {
        var issues = (java.util.List<java.util.Map<String, String>>) error
            .getDetails()
            .get("fieldIssues");
        return issues.get(0).get("code");
    }
}
