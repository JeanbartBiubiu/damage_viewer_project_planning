package xyz.game.datamanage.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jsonCustomizer() {
        return builder -> builder.featuresToEnable(
            DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS,
            MapperFeature.SORT_PROPERTIES_ALPHABETICALLY,
            SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS
        );
    }
}
