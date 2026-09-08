import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;

/** 已核对开发库的符文追加迁移；原有表逐表校验，任一差异回滚。 */
class VerifyRuneMigration {
    static final ObjectMapper JSON = new ObjectMapper();
    static String commitOutcome = "not_attempted";
    static boolean rollbackConfirmed;
    static boolean reportSaved;
    static final List<String> ADDED = List.of("rune_paths", "rune_skill_relations", "runes");
    static final String TABLES = "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        + "WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname";

    public static void main(String[] args) {
        try { run(args); }
        catch (Exception ex) {
            String state = "none";
            for (Throwable cause=ex;cause!=null;cause=cause.getCause())
                if (cause instanceof SQLException sql) state=sql.getSQLState();
            // 不输出配置、连接串、原始异常或业务内容。
            String committed=commitOutcome.equals("confirmed")?"true":commitOutcome.equals("unknown")?"unknown":"false";
            System.err.println("runeMigration=failed error="+ex.getClass().getSimpleName()+" sqlState="+state
                +" committed="+committed+" commitOutcome="+commitOutcome
                +" rollbackConfirmed="+rollbackConfirmed+" reportSaved="+reportSaved);
            if(commitOutcome.equals("unknown")) System.err.println("提交结果未知；先执行 --inspect 核对结构，不能重放迁移。");
            System.exit(1);
        }
    }

    static void run(String[] args) throws Exception {
        if (args.length<2 || args.length>3 || !List.of("--inspect","--apply").contains(args[1]))
            throw new IllegalArgumentException("参数为后端根目录 --inspect，或 --apply 加已审查SQL的SHA256");
        boolean apply=args[1].equals("--apply");
        if (apply && (args.length!=3 || !args[2].matches("[a-f0-9]{64}"))) throw new IllegalArgumentException();
        Path root=Path.of(args[0]).toAbsolutePath().normalize();
        Map<?,?> cfg;
        try(var input=Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))) {
            cfg=new Yaml().load(input);
        }
        Map<?,?> ds=(Map<?,?>)((Map<?,?>)cfg.get("spring")).get("datasource");
        String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url")));
        URI uri=URI.create(url.substring(5));
        if (!"192.168.5.6".equals(uri.getHost()) || uri.getPort()!=5432 || !"/test0221".equals(uri.getPath()))
            throw new IllegalStateException("目标不是已授权开发库");
        byte[] sql=Files.readAllBytes(root.resolve("db/game_manage/migrations/rune_management.sql"));
        String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(sql));
        if(apply && !digest.equals(args[2])) throw new IllegalStateException("SQL与已审查版本不符");
        Properties props=new Properties();
        props.setProperty("user",System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))));
        props.setProperty("password",System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password"))));
        props.setProperty("connectTimeout","10"); props.setProperty("socketTimeout","60");
        Map<String,Object> report=new LinkedHashMap<>();
        report.put("at",java.time.Instant.now().toString()); report.put("mode",args[1]);
        report.put("host",uri.getHost()); report.put("database","test0221"); report.put("migrationSha256",digest);
        Path output=root.resolve("output/rune-management"); Files.createDirectories(output);
        Path target=output.resolve((apply?"apply-":"inspect-")+System.currentTimeMillis()+".json");
        try(Connection c=DriverManager.getConnection(url,props)) {
            c.setAutoCommit(false); c.setReadOnly(!apply);
            c.setTransactionIsolation(apply?Connection.TRANSACTION_READ_COMMITTED:Connection.TRANSACTION_REPEATABLE_READ);
            try {
                execute(c,"SET LOCAL statement_timeout = '45s'"); execute(c,"SET LOCAL lock_timeout = '10s'");
                execute(c,"SET LOCAL timezone = 'UTC'");
                if(!query(c,"SELECT current_database() AS name").getFirst().get("name").equals("test0221")) throw new IllegalStateException();
                List<String> beforeTables=tables(c);
                report.put("tablesBefore",beforeTables);
                report.put("imageConstraintBefore",imageConstraint(c));
                report.put("structureBefore",structure(c));
                if(apply) {
                    if(beforeTables.size()!=24 || beforeTables.stream().anyMatch(ADDED::contains)) throw new IllegalStateException("前置不是24表");
                    query(c,"SELECT game_id FROM public.games ORDER BY game_id FOR UPDATE");
                    for(String table:beforeTables) execute(c,"LOCK TABLE public."+quote(table)+" IN SHARE MODE");
                }
                Map<String,Object> before=fingerprints(c,beforeTables); report.put("dataBefore",before);
                if(apply) {
                    execute(c,new String(sql,java.nio.charset.StandardCharsets.UTF_8));
                    List<String> expected=new ArrayList<>(beforeTables); expected.addAll(ADDED); Collections.sort(expected);
                    if(!tables(c).equals(expected)) throw new IllegalStateException("追加表集合不符");
                    Map<String,Object> after=fingerprints(c,beforeTables);
                    if(!before.equals(after)) throw new IllegalStateException("原有数据摘要变化");
                    for(String table:ADDED) if(((Number)query(c,"SELECT count(*) AS n FROM public."+quote(table)).getFirst().get("n")).longValue()!=0) throw new IllegalStateException("新表非空");
                    String constraint=imageConstraint(c);
                    for(String source:List.of("GAME","CHARACTER","ATTRIBUTE","EQUIPMENT","SKILL","SKILL_EFFECT","STATUS","RUNE","RUNE_PATH"))
                        if(!constraint.contains("'"+source+"'")) throw new IllegalStateException("图片来源缺失");
                    report.put("tablesAfter",expected); report.put("structureAfter",structure(c));
                    report.put("imageConstraintAfter",constraint); report.put("originalDataUnchanged",true);
                    report.put("newTablesEmpty",true);
                    // 证据持久化失败时仍可回滚；提交后再把提交结果写回同一文件。
                    report.put("committed",null); report.put("commitOutcome","unknown");
                    Files.writeString(target,JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report)+"\n");
                    commitOutcome="unknown";
                    c.commit(); commitOutcome="confirmed";
                    report.put("committed",true); report.put("commitOutcome",commitOutcome);
                } else { c.rollback(); rollbackConfirmed=true; }
            } catch(Exception ex) {
                try { c.rollback(); rollbackConfirmed=true; } catch(SQLException rollbackError) { ex.addSuppressed(rollbackError); }
                throw ex;
            }
        }
        Files.writeString(target,JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report)+"\n");
        reportSaved=true;
        System.out.println(JSON.writeValueAsString(Map.of("mode",args[1],"database","test0221","report",target.toString(),"passed",true,"committed",apply)));
    }

    static List<String> tables(Connection c) throws Exception {
        return query(c,TABLES).stream().map(row->(String)row.get("relname")).toList();
    }
    static Map<String,Object> fingerprints(Connection c,List<String> tables) throws Exception {
        Map<String,Object> result=new LinkedHashMap<>();
        for(String table:tables) result.put(table,query(c,"SELECT count(*) AS rows, md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS content_hash FROM (SELECT md5(to_jsonb(t)::text) AS h FROM public."+quote(table)+" t) s").getFirst());
        return result;
    }
    static String imageConstraint(Connection c) throws Exception {
        return (String)query(c,"SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.image_relations'::regclass AND conname='ck_image_relations_source_type'").getFirst().get("definition");
    }
    static Map<String,Object> structure(Connection c) throws Exception {
        return Map.of("columns",query(c,"SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('games','skills','image_relations','runes','rune_paths','rune_skill_relations') ORDER BY table_name,ordinal_position"),
            "constraints",query(c,"SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('games','skills','image_relations','runes','rune_paths','rune_skill_relations') ORDER BY c.relname,k.conname"),
            "partitions",query(c,"SELECT p.relname AS parent,ch.relname AS child FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent JOIN pg_class ch ON ch.oid=i.inhrelid JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname='public' ORDER BY p.relname,ch.relname"));
    }
    static List<Map<String,Object>> query(Connection c,String sql) throws Exception {
        List<Map<String,Object>> rows=new ArrayList<>();
        try(Statement s=c.createStatement();ResultSet rs=s.executeQuery(sql)) {
            ResultSetMetaData m=rs.getMetaData();
            while(rs.next()) { Map<String,Object> row=new LinkedHashMap<>(); for(int i=1;i<=m.getColumnCount();i++) row.put(m.getColumnLabel(i),rs.getObject(i)); rows.add(row); }
        }
        return rows;
    }
    static void execute(Connection c,String sql) throws Exception { try(Statement s=c.createStatement()) {s.execute(sql);} }
    static String quote(String name) { if(!name.matches("[a-z][a-z0-9_]*")) throw new IllegalArgumentException(); return "\""+name+"\""; }
    static String resolve(Object raw) {
        String value=String.valueOf(raw); if(!value.startsWith("${")||!value.endsWith("}")) return value;
        String inner=value.substring(2,value.length()-1); int split=inner.indexOf(':');
        return System.getenv().getOrDefault(split<0?inner:inner.substring(0,split),split<0?"":inner.substring(split+1));
    }
}
