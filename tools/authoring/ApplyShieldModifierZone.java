import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 单次执行已独立批准的收到护盾乘区约束迁移；原始尝试日志禁止重放。 */
class ApplyShieldModifierZone {
    static final String APPROVED_SHA="81c994da52706530fdf75f648921a6f88376ca4e001362c69f268d883d4a05e4";
    static final Path SQL=Path.of("db/game_manage/migrations/add_shield_modifier_zone.sql");
    static final Path JOURNAL=Path.of("output/shield-modifier-migration/attempt.jsonl");
    static final ObjectMapper JSON=new ObjectMapper();
    static String resolve(Object raw){
        String value=String.valueOf(raw);if(!value.startsWith("${")||!value.endsWith("}"))return value;
        String inner=value.substring(2,value.length()-1);int index=inner.indexOf(':');
        return System.getenv().getOrDefault(index<0?inner:inner.substring(0,index),index<0?"":inner.substring(index+1));
    }
    static void record(String stage,Object detail)throws Exception{
        byte[] bytes=(JSON.writeValueAsString(Map.of("at",java.time.Instant.now().toString(),"stage",stage,"detail",detail))+"\n").getBytes(StandardCharsets.UTF_8);
        try(var f=FileChannel.open(JOURNAL,StandardOpenOption.WRITE,StandardOpenOption.APPEND)){var b=ByteBuffer.wrap(bytes);while(b.hasRemaining())f.write(b);f.force(true);}
    }
    static List<Map<String,Object>> query(Connection c,String sql)throws Exception{
        var rows=new ArrayList<Map<String,Object>>();try(var s=c.createStatement();var r=s.executeQuery(sql)){var m=r.getMetaData();while(r.next()){var row=new LinkedHashMap<String,Object>();for(int i=1;i<=m.getColumnCount();i++)row.put(m.getColumnLabel(i),r.getObject(i));rows.add(row);}}return rows;
    }
    static Map<String,Object> snapshot(Connection c)throws Exception{
        var result=new LinkedHashMap<String,Object>();
        result.put("tables",query(c,"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname"));
        result.put("constraints",query(c,"SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.modifier_zones'::regclass AND conname IN ('ck_modifier_zones_domain','ck_modifier_zones_application_stage','ck_modifier_zones_combination') ORDER BY conname"));
        for(String table:List.of("modifier_zones","skill_effects","skill_object_references"))result.put(table,query(c,"SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public."+table+" t"));
        return result;
    }
    public static void main(String[] args){try{run(args);}catch(Exception e){System.err.println("shieldModifierMigration=FAILED errorType="+e.getClass().getSimpleName()+" sqlState="+(e instanceof SQLException x?x.getSQLState():"none")+"; inspect journal and actual database before recovery");System.exit(1);}}
    static void run(String[] args)throws Exception{
        if(!Arrays.equals(args,new String[]{"--apply"}))throw new IllegalArgumentException();
        byte[] sql=Files.readAllBytes(SQL);String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(sql));if(!APPROVED_SHA.equals(digest))throw new IllegalStateException("SQL hash mismatch");
        Map<?,?> cfg;try(var in=Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))){cfg=new Yaml().load(in);}
        var ds=(Map<?,?>)((Map<?,?>)cfg.get("spring")).get("datasource");String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url")));URI uri=URI.create(url.substring(5));
        if(!"192.168.5.6".equals(uri.getHost())||uri.getPort()!=5432||!"/test0221".equals(uri.getPath()))throw new IllegalStateException("Target mismatch");
        var props=new Properties();props.setProperty("user",System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))));props.setProperty("password",System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password"))));props.setProperty("connectTimeout","10");props.setProperty("socketTimeout","60");
        Files.createDirectories(JOURNAL.getParent());Files.createFile(JOURNAL);
        record("STARTED",Map.of("sqlSha256",digest,"host",uri.getHost(),"database","test0221"));boolean submitted=false;
        try(var c=DriverManager.getConnection(url,props)){
            c.setReadOnly(true);var before=snapshot(c);if(((List<?>)before.get("tables")).size()!=27)throw new IllegalStateException("table count drift");record("READ_ONLY_BEFORE",before);
            c.setReadOnly(false);record("SQL_SUBMITTED",Map.of("sqlSha256",digest));submitted=true;
            try(var s=c.createStatement()){boolean more=s.execute(new String(sql,StandardCharsets.UTF_8));while(more||s.getUpdateCount()!=-1)more=s.getMoreResults();}
            record("COMMIT_RETURNED",Map.of("scriptExecutions",1));c.setReadOnly(true);var after=snapshot(c);
            for(String key:List.of("tables","modifier_zones","skill_effects","skill_object_references"))if(!Objects.equals(before.get(key),after.get(key)))throw new IllegalStateException("data drift after migration");
            var constraints=(List<?>)after.get("constraints");if(constraints.size()!=3)throw new IllegalStateException("constraint count mismatch");
            for(Object value:constraints){var row=(Map<?,?>)value;if(!Boolean.TRUE.equals(row.get("convalidated"))||!String.valueOf(row.get("definition")).contains("SHIELD"))throw new IllegalStateException("shield constraint missing");}
            record("IMMEDIATE_READBACK_PASS",after);
        }catch(Exception e){record(submitted?"ATTEMPT_REQUIRES_INDEPENDENT_RECOVERY":"PREWRITE_FAILED",Map.of("errorType",e.getClass().getSimpleName(),"sqlState",e instanceof SQLException s?s.getSQLState():"none"));throw e;}
        System.out.println("shieldModifierMigration=PASS scriptExecutions=1 dataDigestsUnchanged=true independentReadback=pending");
    }
}
