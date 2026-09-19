import java.nio.file.*;
import java.net.URI;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import com.fasterxml.jackson.databind.ObjectMapper;

class InspectRootStatus {
 static final ObjectMapper JSON = new ObjectMapper();
 static String resolve(Object raw) { String v=String.valueOf(raw); if(!v.startsWith("${")||!v.endsWith("}")) return v; String in=v.substring(2,v.length()-1); int i=in.indexOf(':'); return System.getenv().getOrDefault(i<0?in:in.substring(0,i),i<0?"":in.substring(i+1)); }
 static List<Map<String,Object>> query(Connection c,String sql)throws Exception { var rows=new ArrayList<Map<String,Object>>();try(var s=c.createStatement();var r=s.executeQuery(sql)){var m=r.getMetaData();while(r.next()){var row=new LinkedHashMap<String,Object>();for(int i=1;i<=m.getColumnCount();i++)row.put(m.getColumnLabel(i),r.getString(i));rows.add(row);}}return rows; }
 static String sha(byte[] v)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(v));}
 public static void main(String[] args){try{run(args);}catch(Exception e){System.err.println("rootStatusPreflight=FAILED errorType="+e.getClass().getSimpleName()+" sqlState="+(e instanceof SQLException s?s.getSQLState():"none"));System.exit(1);}}
 static void run(String[] args)throws Exception{
  if(args.length!=1)throw new IllegalArgumentException();Path output=Path.of(args[0]);if(Files.exists(output))throw new IllegalStateException();
  Map<?,?> cfg;try(var in=Files.newInputStream(Path.of("server/data_manage/src/main/resources/application.yml"))){cfg=new Yaml().load(in);}var ds=(Map<?,?>)((Map<?,?>)cfg.get("spring")).get("datasource");String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url")));URI uri=URI.create(url.substring(5));if(!"192.168.5.6".equals(uri.getHost())||uri.getPort()!=5432||!"/test0221".equals(uri.getPath()))throw new IllegalStateException();var props=new Properties();props.setProperty("user",System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))));props.setProperty("password",System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password"))));props.setProperty("connectTimeout","10");props.setProperty("socketTimeout","45");var report=new LinkedHashMap<String,Object>();
  try(var c=DriverManager.getConnection(url,props)){c.setAutoCommit(false);c.setReadOnly(true);c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
   report.put("target",query(c,"SELECT current_database() AS database"));
   report.put("statusRows",query(c,"SELECT to_jsonb(s)::text AS body FROM public.statuses s ORDER BY game_id,status_key"));
   report.put("statusConstraints",query(c,"SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.statuses'::regclass ORDER BY conname"));
   report.put("statusColumns",query(c,"SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='statuses' ORDER BY ordinal_position"));
   report.put("logicalTables",query(c,"SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname"));
   for(String table:List.of("skill_effects","skill_object_references")){var rows=query(c,"SELECT to_jsonb(t)::text AS body FROM public."+table+" t ORDER BY to_jsonb(t)::text");report.put(table,Map.of("rows",rows.size(),"sha256",sha(JSON.writeValueAsBytes(rows))));}
   c.rollback();
  }
  report.put("at",java.time.Instant.now().toString());report.put("businessWrites",0);report.put("selects",7);report.put("rolledBack",true);report.put("scriptSHA256",sha(Files.readAllBytes(Path.of("output/root-status-preflight/InspectRootStatus.java"))));Files.createDirectories(output.getParent());Files.writeString(output,JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report)+"\n",StandardOpenOption.CREATE_NEW);System.out.println("rootStatusPreflight=PASS selects=7 businessWrites=0 report="+output);
 }
}
