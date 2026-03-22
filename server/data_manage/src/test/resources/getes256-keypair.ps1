$ErrorActionPreference = 'Stop'

$javaSource = @'
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

public class GenerateEs256KeyPair {
    public static void main(String[] args) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair keyPair = generator.generateKeyPair();

        String publicPem = toPem("PUBLIC KEY", keyPair.getPublic().getEncoded());
        String privatePem = toPem("PRIVATE KEY", keyPair.getPrivate().getEncoded());

        System.out.println("# ES256 key pair for admin JWT");
        System.out.println("# Use PUBLIC_KEY_PEM for IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM");
        System.out.println("# Keep PRIVATE_KEY_PEM for signing ES256 JWT tokens");
        System.out.println();
        System.out.println("PUBLIC_KEY_PEM:");
        System.out.println(publicPem);
        System.out.println();
        System.out.println("PRIVATE_KEY_PEM:");
        System.out.println(privatePem);
        System.out.println();
        System.out.println("POWERSHELL_PUBLIC_KEY_SNIPPET:");
        System.out.println("$env:IT_ADMIN_JWT_ES256_PUBLIC_KEY_PEM = @\"");
        System.out.println(publicPem);
        System.out.println("\"@");
    }

    private static String toPem(String label, byte[] der) {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(der);
        return "-----BEGIN " + label + "-----\n" + base64 + "\n-----END " + label + "-----";
    }
}
'@

$tempDir = Join-Path $env:TEMP ("codex-es256-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$javaFile = Join-Path $tempDir "GenerateEs256KeyPair.java"
Set-Content -Path $javaFile -Value $javaSource -Encoding ascii

try {
    & java $javaFile
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
