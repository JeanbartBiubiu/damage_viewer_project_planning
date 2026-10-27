package xyz.game.datamanage.service.image;

import static org.junit.jupiter.api.Assertions.*;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import xyz.game.datamanage.mapper.image.ImageMapper;
import xyz.game.datamanage.model.image.ImageListItemResponse;
import xyz.game.datamanage.model.image.ImageResponse;

class ImageMapperContractTest {
    private static final String NS = ImageMapper.class.getName() + ".";
    private static Configuration configuration;

    @BeforeAll
    static void parse() throws Exception {
        configuration = new Configuration();
        String resource = "mapper/image/ImageMapper.xml";
        try (InputStream stream = ImageMapperContractTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(stream);
            new XMLMapperBuilder(stream, configuration, resource, configuration.getSqlFragments()).parse();
        }
    }

    @Test
    void adminListNeverReadsContentAndKeepsFiltersAndOrdering() {
        Map<String, Object> params = new HashMap<>(Map.of("gameId", "lol", "keyword", "icon", "enabled", true));
        var statement = configuration.getMappedStatement(NS + "list");
        String sql = statement.getBoundSql(params).getSql();
        assertEquals(ImageListItemResponse.class, statement.getResultMaps().getFirst().getType());
        assertFalse(sql.contains("image_base64"));
        assertTrue(sql.contains("WHERE game_id = ?"));
        assertTrue(sql.contains("strpos(lower(image_key), lower(?))"));
        assertTrue(sql.contains("strpos(lower(name), lower(?))"));
        assertTrue(sql.contains("AND enabled = ?"));
        assertTrue(sql.contains("ORDER BY image_key ASC"));
        params.put("keyword", null);
        params.put("enabled", null);
        sql = statement.getBoundSql(params).getSql();
        assertFalse(sql.contains("strpos"));
        assertFalse(sql.contains("AND enabled"));
    }

    @Test
    void detailAndPublicSyncStillReadContent() {
        Map<String, Object> params = new HashMap<>(Map.of("gameId", "lol", "imageKey", "icon"));
        for (String id : new String[]{"findById", "findByIdForUpdate"}) {
            var statement = configuration.getMappedStatement(NS + id);
            assertEquals(ImageResponse.class, statement.getResultMaps().getFirst().getType());
            assertTrue(statement.getBoundSql(params).getSql().contains("image_base64"));
        }
        params.put("updatedAfter", null);
        String sql = configuration.getMappedStatement(NS + "listPublic").getBoundSql(params).getSql();
        assertTrue(sql.contains("CASE WHEN enabled THEN image_base64 ELSE NULL END AS image_base64"));
        assertTrue(sql.contains("WHERE game_id = ?"));
        assertTrue(sql.contains("ORDER BY image_key ASC"));
    }
}
