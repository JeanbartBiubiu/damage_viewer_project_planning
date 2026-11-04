package xyz.game.datamanage.support.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.crypto.tink.InsecureSecretKeyAccess;
import com.google.crypto.tink.KeysetHandle;
import com.google.crypto.tink.TinkJsonProtoKeysetFormat;
import com.google.crypto.tink.aead.AeadConfig;
import com.google.crypto.tink.aead.PredefinedAeadParameters;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 显式运行的本机工具；不覆盖文件，标准输出只有路径和公钥元数据。 */
public final class AuthKeyTool {
    private AuthKeyTool() {}
    public static void main(String[] args) {
        try {
            if (args.length!=1) throw new IllegalArgumentException();
            Path directory=Path.of(args[0]).toAbsolutePath().normalize();
            create(directory);
            System.out.println("密钥目录："+directory);
            System.out.println("公钥元数据："+directory.resolve("grant-public.json"));
        } catch (Exception e) {
            System.err.println("密钥生成未完成；检查目录访问权限及是否已有文件。未输出密钥内容。");
            System.exit(1);
        }
    }
    public static void create(Path directory) throws Exception {
        Files.createDirectories(directory);
        restrict(directory,true);
        for (String file:List.of("aead-keyset.json","grant-private.pk8","grant-public.json","internal-token.txt")) {
            if (Files.exists(directory.resolve(file))) throw new IllegalStateException("拒绝覆盖");
        }
        AeadConfig.register();
        KeysetHandle keyset=KeysetHandle.generateNew(PredefinedAeadParameters.AES256_GCM);
        var pair=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        byte[] token=new byte[32]; new SecureRandom().nextBytes(token);
        write(directory.resolve("aead-keyset.json"),TinkJsonProtoKeysetFormat.serializeKeyset(keyset,InsecureSecretKeyAccess.get()).getBytes(StandardCharsets.UTF_8));
        write(directory.resolve("grant-private.pk8"),pair.getPrivate().getEncoded());
        write(directory.resolve("internal-token.txt"),AccountCrypto.b64(token).getBytes(StandardCharsets.US_ASCII));
        byte[] publicEncoded=pair.getPublic().getEncoded();
        byte[] raw=Arrays.copyOfRange(publicEncoded,publicEncoded.length-32,publicEncoded.length);
        write(directory.resolve("grant-public.json"),new ObjectMapper().writeValueAsBytes(Map.of("kid","wasm-1","algorithm","Ed25519","publicKeyBase64Url",AccountCrypto.b64(raw))));
    }
    private static void write(Path path,byte[] value) throws Exception {
        Files.createFile(path); restrict(path,false);
        Files.write(path,value,StandardOpenOption.WRITE);
    }
    private static void restrict(Path path,boolean directory) throws Exception {
        if (Files.getFileStore(path).supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(path,directory?Set.of(PosixFilePermission.OWNER_READ,PosixFilePermission.OWNER_WRITE,PosixFilePermission.OWNER_EXECUTE):Set.of(PosixFilePermission.OWNER_READ,PosixFilePermission.OWNER_WRITE));
        } else {
            AclFileAttributeView view=Files.getFileAttributeView(path,AclFileAttributeView.class);
            if (view==null) throw new IllegalStateException("无法限制密钥目录权限");
            view.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(Files.getOwner(path))
                .setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
        }
    }
}
