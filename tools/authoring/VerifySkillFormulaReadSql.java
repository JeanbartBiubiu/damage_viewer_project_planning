import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.yaml.snakeyaml.Yaml;

/** 实库只读执行正式输出读取SQL；用查询内样例，不建表、不改数据、不输出连接配置。 */
public final class VerifySkillFormulaReadSql {
    static String resolve(Object value) {
        String text=String.valueOf(value);
        if(!text.startsWith("${") || !text.endsWith("}")) return text;
        String inner=text.substring(2,text.length()-1); int split=inner.indexOf(':');
        return System.getenv().getOrDefault(split<0?inner:inner.substring(0,split),split<0?"":inner.substring(split+1));
    }
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]).toAbsolutePath();
        Configuration configuration=new Configuration();
        for(String resource:List.of("mapper/authoring/AuthoringReadModel.xml","mapper/skilleffect/SkillEffectMapper.xml")) {
            try(InputStream input=VerifySkillFormulaReadSql.class.getClassLoader().getResourceAsStream(resource)) {
                new XMLMapperBuilder(input,configuration,resource,configuration.getSqlFragments()).parse();
            }
        }
        String sql=configuration.getMappedStatement("xyz.game.datamanage.mapper.skilleffect.SkillEffectMapper.listRuntimeInputFormulaKeys")
            .getBoundSql(Map.of("gameId","lol","skillKey","probe","keys",List.of("unused","used","branch"))).getSql()
            .replace("public.skill_formulas","fixture_formulas").replace("public.skill_parameters","fixture_parameters");
        String binding="\"inputs\":[{\"key\":\"dynamic\",\"binding\":{\"kind\":\"parameter\",\"skillKey\":\"probe\",\"parameterKey\":\"runtime\"}}]";
        String read="{\"op\":\"read\",\"inputKey\":\"dynamic\"}",constant="{\"op\":\"const\",\"value\":\"1\"}";
        List<String> definitions=new ArrayList<>();
        for(String expression:List.of(constant,read,"{\"op\":\"if\",\"args\":["+constant+","+constant+","+read+"]}")) {
            definitions.add("{"+binding+",\"stages\":[{\"key\":\"output\",\"name\":\"输出\",\"expression\":"+expression+"}],\"outputStageKey\":\"output\"}");
        }
        sql="WITH fixture_formulas(game_id,skill_key,formula_key,expression) AS (VALUES ('lol','probe','unused',?::jsonb),('lol','probe','used',?::jsonb),('lol','probe','branch',?::jsonb)),"
            +"fixture_parameters(game_id,skill_key,parameter_key,value_mode) AS (VALUES ('lol','probe','runtime','RUNTIME_INPUT')) "+sql;
        Map<?,?> config;
        try(InputStream input=Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))) {config=new Yaml().load(input);}
        Map<?,?> ds=(Map<?,?>)((Map<?,?>)config.get("spring")).get("datasource");
        String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url")));
        String user=System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username")));
        String password=System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password")));
        try(Connection connection=DriverManager.getConnection(url,user,password)) {
            connection.setReadOnly(true); connection.setAutoCommit(false);
            try(var statement=connection.createStatement();var result=statement.executeQuery("SELECT current_database(),current_setting('transaction_read_only')")) {
                if(!result.next() || !"test0221".equals(result.getString(1)) || !"on".equals(result.getString(2))) throw new IllegalStateException("TARGET_MISMATCH");
            }
            List<String> found=new ArrayList<>();
            try(var statement=connection.prepareStatement(sql)) {
                int index=1;
                for(String definition:definitions) statement.setString(index++,definition);
                for(String value:List.of("lol","probe","unused","used","branch")) statement.setString(index++,value);
                try(var result=statement.executeQuery()) {while(result.next()) found.add(result.getString(1));}
            }
            if(!found.equals(List.of("branch","used"))) throw new IllegalStateException("REACHABILITY_MISMATCH");
            connection.rollback();
            System.out.println("{\"ok\":true,\"database\":\"test0221\",\"readOnly\":true,\"unusedDeclarationExcluded\":true,\"usedReadIncluded\":true,\"bothIfBranchesIncluded\":true}");
        } catch(Exception error) {
            System.out.println("{\"ok\":false,\"code\":\"SQL_PROOF_FAILED\",\"kind\":\""+error.getClass().getSimpleName()+"\"}"); System.exit(1);
        }
    }
}
