package xyz.game.datamanage.config;

import java.net.URI;
import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationPropertiesBinding;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/** 文件路径配置直接按文件系统解析，不经过 Web 资源根目录。 */
@Component
@ConfigurationPropertiesBinding
public class FileSystemPathConverter implements Converter<String, Path> {
    @Override
    public Path convert(String source) {
        return (source.startsWith("file:") ? Path.of(URI.create(source)) : Path.of(source)).normalize();
    }
}
