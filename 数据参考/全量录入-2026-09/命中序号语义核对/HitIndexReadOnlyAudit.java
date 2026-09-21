import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import org.springframework.core.env.StandardEnvironment;
import com.fasterxml.jackson.databind.ObjectMapper;

public class HitIndexReadOnlyAudit {
  static final ObjectMapper JSON = new ObjectMapper();
  static List<Map<String,Object>> query(Connection c, String sql) throws Exception {
    try (Statement s=c.createStatement()) { s.setQueryTimeout(30);
      try (ResultSet r=s.executeQuery(sql)) { var rows=new ArrayList<Map<String,Object>>(); var md=r.getMetaData();
        while(r.next()){var row=new LinkedHashMap<String,Object>();for(int i=1;i<=md.getColumnCount();i++){
          Object value=r.getObject(i);String type=md.getColumnTypeName(i);
          if(value!=null && (type.equals("json") || type.equals("jsonb"))) value=JSON.readTree(r.getString(i));
          else if(value!=null && !(value instanceof Number) && !(value instanceof Boolean)) value=r.getString(i);
          row.put(md.getColumnLabel(i),value);
        } rows.add(row);}return rows;
      }
    }
  }
  public static void main(String[] args) throws Exception {
    System.setOut(new java.io.PrintStream(System.out,true,java.nio.charset.StandardCharsets.UTF_8));
    System.setErr(new java.io.PrintStream(System.err,true,java.nio.charset.StandardCharsets.UTF_8));
    try {
      java.util.logging.Logger.getLogger("org.postgresql").setLevel(java.util.logging.Level.OFF);
      var env=new StandardEnvironment(); Map<?,?> root=new Yaml().load(Files.newInputStream(Path.of(args[0])));
      Map<?,?> spring=(Map<?,?>)root.get("spring"), ds=(Map<?,?>)spring.get("datasource");
      String url=env.resolveRequiredPlaceholders(env.getProperty("spring.datasource.url",String.valueOf(ds.get("url"))));
      String user=env.resolveRequiredPlaceholders(env.getProperty("spring.datasource.username",String.valueOf(ds.get("username"))));
      String pass=env.resolveRequiredPlaceholders(env.getProperty("spring.datasource.password",String.valueOf(ds.get("password"))));
      Class.forName("org.postgresql.Driver");
      try(Connection c=DriverManager.getConnection(url,user,pass)){
        c.setReadOnly(true);c.setAutoCommit(false);c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        var meta=query(c,"select current_database() as database, current_user as db_user, inet_server_addr()::text as host, inet_server_port() as port, current_setting('transaction_read_only') as transaction_read_only");
        if(!Objects.equals(meta.get(0).get("database"),args[1]) || !Objects.equals(meta.get(0).get("transaction_read_only"),"on"))throw new IllegalStateException("READ_ONLY_TARGET_MISMATCH");
        var columns=query(c,"select column_name,data_type from information_schema.columns where table_schema='public' and table_name='skill_trigger_rules' order by ordinal_position");
        String predicate="(jsonb_path_exists(condition_groups, '$.**.eventValueKey ? (@ == \"HIT_INDEX\")') or jsonb_path_exists(actions, '$.**.eventValueKey ? (@ == \"HIT_INDEX\")') or jsonb_path_exists(event_source, '$.**.eventValueKey ? (@ == \"HIT_INDEX\")') or jsonb_path_exists(limits, '$.**.eventValueKey ? (@ == \"HIT_INDEX\")'))";
        var counts=query(c,"select count(*) as all_lol_rules,count(*) filter(where "+predicate+") as hit_index_rules,count(*) filter(where (event_source::text || condition_groups::text || actions::text || limits::text) like '%HIT_INDEX%') as any_hit_index_text_rules from public.skill_trigger_rules where game_id='lol'");
        var rules=query(c,"select skill_key,rule_key,name,event_type,event_source,condition_groups,actions,limits,created_at::text,updated_at::text from public.skill_trigger_rules where game_id='lol' and "+predicate+" order by skill_key,rule_key");
        var anchor=query(c,"select skill_key,rule_key,name,event_type,updated_at::text from public.skill_trigger_rules where game_id='lol' and skill_key='neeko_e' and rule_key='on_used'");
        c.rollback();
        var out=new LinkedHashMap<String,Object>();out.put("status","PASS");out.put("at",java.time.Instant.now().toString());out.put("mode","READ_ONLY_REPEATABLE_READ");out.put("target",meta);out.put("actualColumns",columns);out.put("counts",counts);out.put("matchedRules",rules);out.put("recentWriteAnchor",anchor);out.put("selectStatements",5);out.put("businessWrites",0);out.put("ddlStatements",0);out.put("finishedWithRollback",true);out.put("scope","仅lol规则中的eventValueKey=HIT_INDEX；不读取凭据或无关业务表到输出");
        System.out.println(JSON.writeValueAsString(out));
      }
    }catch(Exception e){System.err.println("READ_ONLY_AUDIT_FAILED class="+e.getClass().getSimpleName()+(e instanceof SQLException ? " sqlState="+((SQLException)e).getSQLState():""));System.exit(1);}
  }
}
