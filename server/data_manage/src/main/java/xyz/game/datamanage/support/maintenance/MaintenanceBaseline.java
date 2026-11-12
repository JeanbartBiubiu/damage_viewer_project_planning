package xyz.game.datamanage.support.maintenance;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 仅固定业务表参与摘要，账号、审计与维护状态不参与；不接受调用者提供表名。 */
@Component
public class MaintenanceBaseline {
    private static final List<String> TABLES=List.of("games","attributes","game_vamp_rules","game_calculation_rules","game_level_configs",
        "characters","character_attributes","equipment","equipment_attributes","skill_categories","skills","skill_category_relations",
        "skill_parameters","skill_formulas","damage_types","modifier_zones","statuses","skill_effects","skill_internal_states","skill_processes",
        "skill_trigger_rules","images","character_skill_relations","equipment_skill_relations","image_relations","skill_object_references",
        "build_systems","build_options","build_groups","build_option_skill_relations");
    private final JdbcTemplate jdbc;
    public MaintenanceBaseline(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public static void game(String gameId) { if(gameId==null || !gameId.matches("[a-z0-9_]{1,64}")) throw MaintenanceJson.invalid(); }
    public void lock(String gameId) {
        game(gameId);
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",(r,n)->Boolean.TRUE,"damage-maintenance:"+gameId);
        jdbc.query("SELECT game_id FROM public.games WHERE game_id=? FOR UPDATE",(r,n)->r.getString(1),gameId);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public String digest(String gameId) {
        game(gameId); StringBuilder value=new StringBuilder("maintenance-game-baseline-v1\n");
        for(String table:TABLES) {
            String hash=jdbc.queryForObject("SELECT encode(digest(COALESCE(string_agg(payload, E'\\n' ORDER BY payload COLLATE \"C\"), ''), 'sha256'), 'hex') FROM (SELECT (to_jsonb(t)-'created_at'-'updated_at')::text AS payload FROM public.\""+table+"\" t WHERE game_id=?) rows",String.class,gameId);
            value.append(table).append(':').append(hash).append('\n');
        }
        return MaintenanceJson.sha(value.toString().getBytes(StandardCharsets.UTF_8));
    }
}
