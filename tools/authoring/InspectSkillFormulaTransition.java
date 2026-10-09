import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;

/** 技能共同公式切换只读盘点；不输出连接配置或凭据。 */
public final class InspectSkillFormulaTransition {
    static final ObjectMapper JSON=new ObjectMapper();
    static final Map<String,Integer> nodes=new TreeMap<>(),operations=new TreeMap<>(),bindings=new TreeMap<>(),modes=new TreeMap<>();
    static int maximumNodes,maximumDepth,maximumInputs,oversizedInputs,missingParameters,missingAttributes,disabledAttributes,formulas;
    static final List<String> blockers=new ArrayList<>();
    static void count(Map<String,Integer> totals,String key) { totals.merge(key,1,Integer::sum); }
    static int[] inspect(JsonNode node,int depth,Set<String> inputs,String game,String skill,Map<String,String> parameters,Map<String,String> attributes) {
        count(nodes,node.path("nodeType").asText("UNKNOWN")); int total=1,maxDepth=depth;
        switch(node.path("nodeType").asText()) {
            case "OPERATION" -> { count(operations,node.path("operation").asText("UNKNOWN")); for(JsonNode child:node.path("operands")) { int[] result=inspect(child,depth+1,inputs,game,skill,parameters,attributes); total+=result[0];maxDepth=Math.max(maxDepth,result[1]); } }
            case "PARAMETER" -> { String key=node.path("parameterKey").asText(); inputs.add("parameter:"+skill+":"+key);String mode=parameters.get(game+"/"+skill+"/"+key); if(mode==null)missingParameters++; else count(modes,mode); }
            case "ATTRIBUTE" -> { String key=node.path("attributeKey").asText();String binding=node.path("attributeOwner").asText()+"/"+node.path("attributeValueKind").asText();count(bindings,binding); inputs.add("attribute:"+binding+":"+key);String status=attributes.get(game+"/"+key);if(status==null)missingAttributes++;else if(!status.equals("ENABLED"))disabledAttributes++; }
            default -> { if(blockers.size()<10)blockers.add("UNKNOWN_NODE:"+game+"/"+skill); }
        }
        return new int[]{total,maxDepth};
    }
    static String resolve(Object value) { String text=String.valueOf(value);if(!text.startsWith("${")||!text.endsWith("}"))return text;String inner=text.substring(2,text.length()-1);int split=inner.indexOf(':');return System.getenv().getOrDefault(split<0?inner:inner.substring(0,split),split<0?"":inner.substring(split+1)); }
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args.length==0?".":args[0]);Map<?,?> config;try(var input=Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))){config=new Yaml().load(input);}
        Map<?,?> ds=(Map<?,?>)((Map<?,?>)config.get("spring")).get("datasource");
        String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url"))),user=System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))),password=System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password")));
        ObjectNode report=JSON.createObjectNode();
        try(Connection connection=DriverManager.getConnection(url,user,password)){
            connection.setReadOnly(true);connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);connection.setAutoCommit(false);
            try(var statement=connection.createStatement();var rows=statement.executeQuery("select current_database(),current_setting('transaction_read_only')")){rows.next();report.put("database",rows.getString(1)).put("readOnly",rows.getString(2));}
            Map<String,String> parameters=new HashMap<>(),attributes=new HashMap<>();
            try(var statement=connection.createStatement();var rows=statement.executeQuery("select game_id,skill_key,parameter_key,value_mode from public.skill_parameters")){while(rows.next())parameters.put(rows.getString(1)+"/"+rows.getString(2)+"/"+rows.getString(3),rows.getString(4));}
            try(var statement=connection.createStatement();var rows=statement.executeQuery("select game_id,attribute_key,status from public.attributes")){while(rows.next())attributes.put(rows.getString(1)+"/"+rows.getString(2),rows.getString(3));}
            try(var statement=connection.createStatement();var rows=statement.executeQuery("select game_id,skill_key,formula_key,expression::text from public.skill_formulas order by game_id,skill_key,formula_key")){
                while(rows.next()){
                    formulas++;String game=rows.getString(1),skill=rows.getString(2);Set<String> inputs=new HashSet<>();JsonNode tree=JSON.readTree(rows.getString(4));
                    if(tree.has("inputs")){if(blockers.size()<10)blockers.add("ALREADY_COMMON:"+game+"/"+skill+"/"+rows.getString(3));continue;}
                    int[] counts=inspect(tree,1,inputs,game,skill,parameters,attributes);maximumNodes=Math.max(maximumNodes,counts[0]);maximumDepth=Math.max(maximumDepth,counts[1]);maximumInputs=Math.max(maximumInputs,inputs.size());if(inputs.size()>64){oversizedInputs++;if(blockers.size()<10)blockers.add("INPUT_BUDGET:"+game+"/"+skill+"/"+rows.getString(3));}
                }
            }
            report.put("formulaRows",formulas).put("maximumNodes",maximumNodes).put("maximumDepth",maximumDepth).put("maximumUniqueInputs",maximumInputs).put("over64Inputs",oversizedInputs).put("missingParameters",missingParameters).put("missingAttributes",missingAttributes).put("disabledAttributeLeaves",disabledAttributes);
            report.set("nodeKinds",JSON.valueToTree(nodes));report.set("operations",JSON.valueToTree(operations));report.set("attributeBindings",JSON.valueToTree(bindings));report.set("parameterModes",JSON.valueToTree(modes));report.set("blockerExamples",JSON.valueToTree(blockers));
            try(var statement=connection.createStatement();var rows=statement.executeQuery("select count(*),count(*) filter(where source_type='FORMULA') from public.skill_object_references")){rows.next();report.put("allReferenceRows",rows.getLong(1)).put("formulaSourceReferences",rows.getLong(2));}
            ArrayNode constraints=report.putArray("formulaConstraints");try(var statement=connection.createStatement();var rows=statement.executeQuery("select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.skill_formulas'::regclass order by conname")){while(rows.next())constraints.addObject().put("name",rows.getString(1)).put("definition",rows.getString(2));}
            connection.rollback();
        }catch(SQLException error){System.out.println("{\"ok\":false,\"sqlState\":\""+error.getSQLState()+"\"}");System.exit(1);}
        System.out.println(JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report));
    }
}
