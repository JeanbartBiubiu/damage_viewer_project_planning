package xyz.game.datamanage.service.image;

import com.fasterxml.jackson.databind.JsonNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.error.ApiException;

@Component
public class ImageContentValidator {

    static final int MAX_BYTE_SIZE = 262_144;
    static final int MAX_DIMENSION = 64;

    private static final String PNG_PREFIX = "data:image/png;base64,";
    private static final String JPEG_PREFIX = "data:image/jpeg;base64,";
    private static final int MAX_ENCODED_LENGTH = ((MAX_BYTE_SIZE + 2) / 3) * 4;

    public ValidatedImageContent validate(JsonNode value) {
        if (value == null || value.isNull() || !value.isTextual() || value.textValue().isEmpty()) {
            throw invalid("图片内容不能为空", "REQUIRED");
        }

        String dataUri = value.textValue();
        String declaredMimeType;
        String encoded;
        if (dataUri.startsWith(PNG_PREFIX)) {
            declaredMimeType = "image/png";
            encoded = dataUri.substring(PNG_PREFIX.length());
        } else if (dataUri.startsWith(JPEG_PREFIX)) {
            declaredMimeType = "image/jpeg";
            encoded = dataUri.substring(JPEG_PREFIX.length());
        } else {
            throw invalid("图片只允许 PNG 或 JPEG 数据地址", "FORMAT_INVALID");
        }

        if (encoded.isEmpty()) {
            throw invalid("图片内容不能为空", "REQUIRED");
        }
        if (encoded.length() > MAX_ENCODED_LENGTH) {
            throw invalid("图片文件不能超过262144字节", "SIZE_EXCEEDED");
        }

        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException ex) {
            throw invalid("图片 Base64 内容不合法", "BASE64_INVALID");
        }
        if (bytes.length == 0 || bytes.length > MAX_BYTE_SIZE) {
            throw invalid("图片文件必须大于0且不能超过262144字节", "SIZE_EXCEEDED");
        }

        ImageMetadata metadata = inspect(bytes);
        if (!declaredMimeType.equals(metadata.mimeType())) {
            throw invalid("图片声明格式与真实格式不一致", "MIME_MISMATCH");
        }
        if (metadata.width() < 1
            || metadata.height() < 1
            || metadata.width() > MAX_DIMENSION
            || metadata.height() > MAX_DIMENSION) {
            throw invalid("图片宽和高都必须在1到64像素之间", "DIMENSION_INVALID");
        }

        return new ValidatedImageContent(
            dataUri,
            metadata.mimeType(),
            bytes.length,
            metadata.width(),
            metadata.height()
        );
    }

    private static ImageMetadata inspect(byte[] bytes) {
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (input == null) {
                throw invalid("图片内容无法读取", "DECODE_FAILED");
            }

            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) {
                throw invalid("图片内容无法识别", "FORMAT_INVALID");
            }

            ImageReader reader = readers.next();
            try {
                reader.setInput(input, false, false);
                String mimeType = normalizeFormat(reader.getFormatName());
                if (mimeType == null) {
                    throw invalid("图片真实格式只允许 PNG 或 JPEG", "FORMAT_INVALID");
                }
                if ("image/png".equals(mimeType) && containsPngChunk(bytes, "acTL")) {
                    throw invalid("不允许动态图", "ANIMATION_NOT_ALLOWED");
                }

                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    return new ImageMetadata(mimeType, width, height);
                }

                BufferedImage decoded = reader.read(0);
                if (decoded == null || decoded.getWidth() != width || decoded.getHeight() != height) {
                    throw invalid("图片内容无法完整解码", "DECODE_FAILED");
                }
                return new ImageMetadata(mimeType, width, height);
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException ex) {
            if (ex instanceof ApiException apiException) {
                throw apiException;
            }
            throw invalid("图片内容无法完整解码", "DECODE_FAILED");
        }
    }

    private static String normalizeFormat(String formatName) {
        if (formatName == null) {
            return null;
        }
        return switch (formatName.toLowerCase(Locale.ROOT)) {
            case "png" -> "image/png";
            case "jpeg", "jpg" -> "image/jpeg";
            default -> null;
        };
    }

    private static boolean containsPngChunk(byte[] bytes, String chunkName) {
        byte[] marker = chunkName.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        int position = 8;
        while (position + 12 <= bytes.length) {
            long chunkLength = ((long) (bytes[position] & 0xff) << 24)
                | ((long) (bytes[position + 1] & 0xff) << 16)
                | ((long) (bytes[position + 2] & 0xff) << 8)
                | (bytes[position + 3] & 0xffL);
            long nextPosition = position + 12L + chunkLength;
            if (nextPosition > bytes.length) {
                return false;
            }
            boolean matches = true;
            for (int offset = 0; offset < marker.length; offset++) {
                if (bytes[position + 4 + offset] != marker[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return true;
            }
            position = (int) nextPosition;
        }
        return false;
    }

    private static ApiException invalid(String message, String issueCode) {
        return new ApiException(
            HttpStatus.BAD_REQUEST,
            "400.IMAGE_CONTENT_INVALID",
            message,
            Map.of(
                "fieldIssues",
                List.of(Map.of(
                    "field", "imageBase64",
                    "code", issueCode,
                    "message", message
                ))
            )
        );
    }

    private record ImageMetadata(String mimeType, int width, int height) {
    }
}
