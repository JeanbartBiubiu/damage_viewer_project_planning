import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import com.fasterxml.jackson.databind.ObjectMapper;

/** 击飞状态约束的独立只读快照；不接受SQL参数，不执行数据写入。 */
class InspectAirborneStatusKind {
  static final ObjectMapper JSON = new ObjectMapper();
  static String resolve(Object raw) {
    String value = String.valueOf(raw);
    if (!value.startsWith("${") || !value.endsWith("}")) return value;
    String inner = value.substring(2,value.length()-1); int colon = inner.indexOf(':');
    return System.getenv().getOrDefault(colon<0?inner:inner.substring(0,colon),colon<0?"":inner.substring(colon+1));
  }
  static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
  static List<Map<String,Object>> query(Connection c,String sql) throws Exception {
    var rows = new ArrayList<Map<String,Object>>();
    try(var s=c.createStatement();var r=s.executeQuery(sql)) {
      var meta=r.getMetaData(); while(r.next()) { var row=new LinkedHashMap<String,Object>();
        for(int i=1;i<=meta.getColumnCount();i++) row.put(meta.getColumnLabel(i),r.getString(i)); rows.add(row);
      }
    }
    return rows;
  }
  static Map<String,Object> snapshot(Connection c) throws Exception {
    var s = new LinkedHashMap<String,Object>();
    s.put("database",query(c,"SELECT current_database() AS name,current_user AS actor"));
    s.put("tables",query(c,"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname"));
    s.put("statuses",query(c,"SELECT to_jsonb(s)::text AS body FROM public.statuses s ORDER BY game_id,status_key"));
    s.put("columns",query(c,"SELECT column_name,data_type,character_maximum_length,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses' ORDER BY ordinal_position"));
    s.put("kindConstraint",query(c,"SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname='ck_statuses_kind'"));
    s.put("otherConstraints",query(c,"SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass AND conname<>'ck_statuses_kind' ORDER BY conname"));
    s.put("kindComment",query(c,"SELECT col_description('public.statuses'::regclass,attnum) AS comment FROM pg_attribute WHERE attrelid='public.statuses'::regclass AND attname='status_kind' AND NOT attisdropped"));
    s.put("statusReferences",query(c,"SELECT to_jsonb(r)::text AS body FROM public.skill_object_references r WHERE target_type='STATUS' ORDER BY game_id,source_skill_key,source_type,source_key,field_path"));
    for(String table:List.of("skill_effects","skill_object_references")) {
      var rows=query(c,"SELECT to_jsonb(t)::text AS body FROM public."+table+" t ORDER BY to_jsonb(t)::text");
      s.put(table,Map.of("rows",rows.size(),"sha256",sha(JSON.writeValueAsBytes(rows))));
    }
    return s;
  }
  public static void main(String[] args) {
    try { run(args); } catch(Exception e) {
      System.err.println("airborneStatusInspect=FAILED errorType="+e.getClass().getSimpleName()+" sqlState="+(e instanceof SQLException q?q.getSQLState():"none")); System.exit(1);
    }
  }
  static void run(String[] args) throws Exception {
    if(args.length!=1) throw new IllegalArgumentException();
    Path output=Path.of(args[0]).toAbsolutePath().normalize();
    Path allowed=Path.of("C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/击飞状态管理补齐").toAbsolutePath().normalize();
    if(!output.getParent().equals(allowed) || !Set.of("03-实库迁移前快照.json","08-实库独立读回.json").contains(output.getFileName().toString()) || Files.exists(output)) throw new IllegalArgumentException();
    Map<?,?> cfg; try(var in=Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))) {cfg=new Yaml().load(in);}
    var ds=(Map<?,?>)((Map<?,?>)cfg.get("spring")).get("datasource");
    String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url")));
    if(!url.startsWith("jdbc:postgresql://")) throw new IllegalStateException(); URI uri=URI.create(url.substring(5));
    if(!"192.168.5.6".equals(uri.getHost()) || uri.getPort()!=5432 || !"/test0221".equals(uri.getPath())) throw new IllegalStateException();
    var props=new Properties(); props.setProperty("user",System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))));
    props.setProperty("password",System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password"))));
    props.setProperty("connectTimeout","10");props.setProperty("socketTimeout","60");props.setProperty("options","-c timezone=UTC");
    Map<String,Object> result;
    try(Connection c=DriverManager.getConnection(url,props)) {
      c.setReadOnly(true);c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);c.setAutoCommit(false);
      result=snapshot(c);c.rollback();
    }
    if(!"test0221".equals(((Map<?,?>)((List<?>)result.get("database")).getFirst()).get("name"))) throw new IllegalStateException();
    var report=new LinkedHashMap<String,Object>();report.put("at",java.time.Instant.now().toString());report.put("host",uri.getHost());report.put("database","test0221");report.put("businessWrites",0);report.put("transaction","READ_ONLY REPEATABLE_READ ROLLBACK");report.put("snapshot",result);
    byte[] bytes=(JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report)+"\n").getBytes(StandardCharsets.UTF_8);
    Files.write(output,bytes,StandardOpenOption.CREATE_NEW);
    System.out.println("airborneStatusInspect=PASS tables="+((List<?>)result.get("tables")).size()+" statuses="+((List<?>)result.get("statuses")).size()+" snapshotSha256="+sha(bytes));
  }
}
