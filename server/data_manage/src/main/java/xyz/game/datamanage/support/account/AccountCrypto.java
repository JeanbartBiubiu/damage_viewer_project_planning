package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.bastiaanjansen.otp.HOTPGenerator;
import com.google.crypto.tink.Aead;
import com.google.crypto.tink.CleartextKeysetHandle;
import com.google.crypto.tink.JsonKeysetReader;
import com.google.crypto.tink.aead.AeadConfig;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

@Component
public class AccountCrypto {
    private final AccountProperties properties;
    private final ObjectMapper json;
    private volatile Aead aead;
    public AccountCrypto(AccountProperties properties, ObjectMapper json) { this.properties = properties; this.json = json; }
    public static byte[] hash(String s) {
        try { return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)); }
        catch (Exception e) { throw new IllegalStateException("SHA-256不可用"); }
    }
    public static boolean same(String a, String b) { return a != null && b != null && MessageDigest.isEqual(hash(a), hash(b)); }
    public static String b64(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private Aead aead() {
        Aead current = aead;
        if (current != null) return current;
        synchronized (this) {
            if (aead == null) {
                try {
                    AeadConfig.register();
                    aead = CleartextKeysetHandle.read(JsonKeysetReader.withFile(properties.getAeadKeysetPath().toFile()))
                        .getPrimitive(com.google.crypto.tink.RegistryConfiguration.get(), Aead.class);
                } catch (Exception e) { throw AccountErrors.unavailable(); }
            }
            return aead;
        }
    }
    public byte[] encrypt(String value, String aad) {
        try { return aead().encrypt(value.getBytes(StandardCharsets.UTF_8), aad.getBytes(StandardCharsets.UTF_8)); }
        catch (xyz.game.datamanage.support.error.ApiException e) { throw e; }
        catch (Exception e) { throw AccountErrors.unavailable(); }
    }
    public String decrypt(byte[] value, String aad, String keyId) {
        if (!properties.getAeadKeyId().equals(keyId)) throw AccountErrors.unavailable();
        try { return new String(aead().decrypt(value, aad.getBytes(StandardCharsets.UTF_8)), StandardCharsets.UTF_8); }
        catch (xyz.game.datamanage.support.error.ApiException e) { throw e; }
        catch (Exception e) { throw AccountErrors.unavailable(); }
    }
    /** 返回实际匹配的步数，含前后各一步；反重放由持有账号锁的事务完成。 */
    public long matchingStep(String secret, String code, Instant now, long lastStep) {
        if (code == null || !code.matches("[0-9]{6}")) throw AccountErrors.invalid();
        HOTPGenerator hotp = new HOTPGenerator.Builder(secret).build();
        long step = now.getEpochSecond() / 30;
        // 优先匹配较大步，极少数窗口内码碰撞时也不会重复消费。
        for (long candidate = step + 1; candidate >= step - 1; candidate--) {
            if (candidate > lastStep && candidate >= 0 && same(hotp.generate(candidate), code)) return candidate;
        }
        throw AccountErrors.invalid();
    }
    public Map<String, String> setup(String username, String secret) {
        try {
            String uri = "otpauth://totp/DamageViewer:" + username + "?secret=" + secret + "&issuer=DamageViewer&algorithm=SHA1&digits=6&period=30";
            BitMatrix matrix = new MultiFormatWriter().encode(uri, BarcodeFormat.QR_CODE, 320, 320);
            BufferedImage image = new BufferedImage(320, 320, BufferedImage.TYPE_INT_RGB);
            for (int x = 0; x < 320; x++) for (int y = 0; y < 320; y++) image.setRGB(x, y, matrix.get(x, y) ? 0 : 0xffffff);
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            ImageIO.write(image, "png", png);
            return Map.of("otpauthUri", uri, "qrCodeDataUrl", "data:image/png;base64," + Base64.getEncoder().encodeToString(png.toByteArray()));
        } catch (Exception e) { throw AccountErrors.unavailable(); }
    }
    public Map<String, Object> grant(UUID account, Instant now) {
        try {
            long second = now.getEpochSecond();
            long expiresAt = second + 86_400;
            String header = b64(json.writeValueAsBytes(Map.of("alg", "Ed25519", "typ", "dv-wasm-grant+jwt", "kid", properties.getGrantKeyId())));
            String body = b64(json.writeValueAsBytes(Map.of("iss", "damage-viewer", "aud", "damage-viewer-wasm", "sub", account.toString(),
                "canLogin", 1, "scope", List.of("engine:compute"), "iat", second, "nbf", second, "exp", expiresAt,
                "authorizationVersion", 1, "jti", UUID.randomUUID().toString())));
            Signature signature = Signature.getInstance("Ed25519");
            signature.initSign(KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(properties.getGrantPrivateKeyPath()))));
            String input = header + "." + body;
            signature.update(input.getBytes(StandardCharsets.US_ASCII));
            return Map.of("grant", input + "." + b64(signature.sign()), "expiresAt", Instant.ofEpochSecond(expiresAt));
        } catch (Exception e) { throw AccountErrors.unavailable(); }
    }
}
