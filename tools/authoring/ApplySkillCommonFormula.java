import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import org.yaml.snakeyaml.Yaml;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.DefaultTransactionDefinition;
import xyz.game.datamanage.service.skillformula.SkillFormulaParser;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;
import xyz.game.datamanage.support.authoring.SkillObjectReferences;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.Aggregate;
import xyz.game.datamanage.support.authoring.SkillObjectReferences.SourceType;
import xyz.game.datamanage.support.formula.SkillFormulaBindings;
import xyz.game.datamanage.support.error.ApiException;

/** 第三B唯一旧树入口；离线转换与只读档案，独立批准后单次同事务写入。 */
public final class ApplySkillCommonFormula {
    static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));
    static final String DATABASE = "test0221", GAME = "lol", FORMAT = "skill-common-formula-transition-v1";
    static final Path TOOL = Path.of("tools/authoring/ApplySkillCommonFormula.java");
    static final List<String> TABLES = List.of("games", "skill_formulas", "skill_parameters", "attributes", "skill_object_references",
        "damage_types", "skills", "skill_effects", "skill_internal_states", "skill_processes", "skill_trigger_rules",
        "skill_categories", "modifier_zones", "statuses", "skill_category_relations", "game_vamp_rules", "game_level_configs");
    static final Set<String> LEGACY_KINDS = Set.of("BASE", "BONUS", "TOTAL", "CURRENT", "MISSING", "CURRENT_RATIO", "MISSING_RATIO");
    static final Map<String,String> OPS = Map.of("ADD","add","SUBTRACT","sub","MULTIPLY","mul","DIVIDE","div","MIN","min","MAX","max");
    static final List<String> CAS_FIELDS = List.of("identity", "tables", "constraints", "statistics", "nonFormulaSha256", "damageTypeReferences");

    public static void main(String[] args) {
        try {
            require(args.length >= 2, "ARGUMENTS_REQUIRED");
            Path root = Path.of(args[0]).toAbsolutePath().normalize();
            String mode = args[1];
            if (mode.equals("selftest")) { require(args.length == 2, "SELFTEST_ARGUMENTS"); selftest(); return; }
            Map<String,String> options = options(args);
            Path archive = Path.of(required(options,"--archive"));
            require(archive.isAbsolute(), "ARCHIVE_MUST_BE_ABSOLUTE"); archive = archive.normalize();
            require(archive.startsWith(root.resolve("output/formula-phase3b")), "ARCHIVE_OUTSIDE_PHASE3B");
            Set<String> permitted = switch(mode) {
                case "preview" -> Set.of("--archive");
                case "apply", "verify-candidate" -> Set.of("--archive","--archive-sha256","--tool-sha256","--database");
                case "readback" -> Set.of("--archive","--archive-sha256");
                default -> throw new SafeFailure("UNKNOWN_MODE");
            };
            require(permitted.containsAll(options.keySet()), "UNKNOWN_ARGUMENT");
            switch(mode) {
                case "preview" -> preview(root,archive);
                case "apply" -> apply(root,archive,options,false);
                case "verify-candidate" -> apply(root,archive,options,true);
                case "readback" -> readback(root,archive,options);
            }
        } catch (SafeFailure error) { failure(error.code); }
        catch (ApiException error) {
            ObjectNode safe=JSON.createObjectNode().put("ok",false).put("code",error.getCode());
            ArrayNode issues=safe.putArray("fieldIssues");
            if(error.getDetails().get("fieldIssues") instanceof List<?> entries) for(Object entry:entries) {
                if(!(entry instanceof Map<?,?> fields)) continue;
                ObjectNode issue=issues.addObject();
                for(String name:List.of("field","code","sourceSkillKey","sourceType","sourceKey")) {
                    Object value=fields.get(name);
                    if(value instanceof String text && text.length()<=1024 && text.matches("[A-Za-z0-9_./~\\[\\]:-]*"))issue.put(name,text);
                }
                if(issues.size()>=10)break;
            }
            emit(safe);System.exit(1);
        }
        catch (SQLException error) { emit(JSON.createObjectNode().put("ok",false).put("code","DATABASE_FAILURE").put("sqlState",String.valueOf(error.getSQLState()))); System.exit(1); }
        catch (Throwable error) { emit(JSON.createObjectNode().put("ok",false).put("code","LOCAL_FAILURE").put("kind",error.getClass().getSimpleName())); System.exit(1); }
    }

    static void preview(Path root, Path archive) throws Exception {
        require(!Files.exists(archive),"ARCHIVE_EXISTS");
        ObjectNode baseline;
        try (Connection c = connect(root,true)) {
            baseline = baseline(c); checkOriginal(baseline);
            ObjectNode converted = convertAll(baseline);
            baseline.set("converted",converted);
            baseline.set("newFormulaReferences",newReferences(converted));
            baseline.set("arithmetic",compareAll(baseline,converted));
            baseline.set("legacyInventory",legacyInventory(baseline));
            baseline.put("format",FORMAT).put("toolSha256",sha(Files.readAllBytes(root.resolve(TOOL))));
            baseline.set("backendClasses",classHashes(root)); c.rollback();
        }
        Files.createDirectories(archive.getParent());
        byte[] bytes = JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(baseline);
        Files.write(archive,bytes,StandardOpenOption.CREATE_NEW);
        emit(summary(baseline,"preview").put("archive",archive.toString()).put("archiveSha256",sha(bytes))
            .put("toolSha256",baseline.path("toolSha256").asText()));
    }

    static void apply(Path root, Path archive, Map<String,String> options, boolean candidateOnly) throws Exception {
        require(DATABASE.equals(required(options,"--database")),"EXACT_DATABASE_REQUIRED");
        ObjectNode frozen = readArchive(root,archive,options,true);
        require(frozen.path("toolSha256").asText().equals(required(options,"--tool-sha256")),"TOOL_APPROVAL_MISMATCH");
        Path attempt = archive.resolveSibling(archive.getFileName()+(candidateOnly?".candidate-attempt.jsonl":".attempt.jsonl")), receipt=archive.resolveSibling(archive.getFileName()+".committed.json");
        require(!Files.exists(attempt) && !Files.exists(receipt),"ATTEMPT_EXISTS_USE_READBACK");
        Files.writeString(attempt,JSON.createObjectNode().put("state","started").put("archiveSha256",required(options,"--archive-sha256")).toString()+"\n",StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);
        ObjectNode committed;
        try (Connection c = connect(root,false)) {
            SingleConnectionDataSource data = new SingleConnectionDataSource(c,true);
            DataSourceTransactionManager manager = new DataSourceTransactionManager(data);
            DefaultTransactionDefinition definition = new DefaultTransactionDefinition();
            definition.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            var transaction = manager.getTransaction(definition);
            try {
                JdbcTemplate jdbc = new JdbcTemplate(data);
                GameConfigurationWriteGuard guard = new GameConfigurationWriteGuard(jdbc); guard.begin(GAME);
                jdbc.execute("LOCK TABLE "+String.join(", ",TABLES.stream().map(t->"public."+t).toList())+" IN SHARE ROW EXCLUSIVE MODE");
                ObjectNode now = baseline(c); checkOriginal(now);
                for (String field:CAS_FIELDS) require(now.path(field).equals(frozen.path(field)),"BASELINE_CHANGED_"+field);
                ObjectNode recalculated = convertAll(now);
                require(recalculated.equals(frozen.path("converted")),"CONVERSION_CHANGED");
                require(compareAll(now,recalculated).equals(frozen.path("arithmetic")),"ARITHMETIC_CHANGED");
                require(newReferences(recalculated).equals(frozen.path("newFormulaReferences")),"REFERENCES_CHANGED");
                for (JsonNode row : now.path("tables").path("skill_formulas")) {
                    try (var update = c.prepareStatement("UPDATE public.skill_formulas t SET expression=?::jsonb,updated_at=now() WHERE game_id=? AND skill_key=? AND formula_key=? AND to_jsonb(t)=?::jsonb")) {
                        update.setString(1,recalculated.path(id(row)).toString()); update.setString(2,GAME);
                        update.setString(3,row.path("skill_key").asText()); update.setString(4,row.path("formula_key").asText()); update.setString(5,row.toString());
                        require(update.executeUpdate()==1,"FORMULA_CAS_FAILED");
                    }
                }
                // 同一游戏锁及同一事务内调用正式引用／传递闭包／数值守卫，仅FORMULA来源实际变化。
                guard.validatePending(); committed = checkConverted(c,frozen);
                if(candidateOnly) manager.rollback(transaction); else manager.commit(transaction);
            } catch (Throwable error) {
                if (!transaction.isCompleted()) manager.rollback(transaction); throw error;
            }
        }
        if(candidateOnly) {
            Files.writeString(attempt,"{\"state\":\"rolled_back_verified_candidate\"}\n",StandardCharsets.UTF_8,StandardOpenOption.APPEND);
            try(Connection c=connect(root,true)) {
                ObjectNode unchanged=baseline(c); for(String field:CAS_FIELDS)require(unchanged.path(field).equals(frozen.path(field)),"CANDIDATE_ROLLBACK_CHANGED_"+field); c.rollback();
            }
            emit(summary(committed,"verify-candidate").put("state","rolled_back_verified_candidate"));return;
        }
        Files.write(receipt,JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(committed),StandardOpenOption.CREATE_NEW);
        Files.writeString(attempt,"{\"state\":\"committed\"}\n",StandardCharsets.UTF_8,StandardOpenOption.APPEND);
        emit(summary(committed,"apply").put("receipt",receipt.toString()));
    }

    static void readback(Path root, Path archive, Map<String,String> options) throws Exception {
        ObjectNode frozen=readArchive(root,archive,options,false);
        try(Connection c=connect(root,true)) {
            ObjectNode now=baseline(c); boolean original=true;
            for(String field:CAS_FIELDS) original &= now.path(field).equals(frozen.path(field));
            if(original) { c.rollback(); emit(summary(frozen,"readback").put("state","original_unchanged")); return; }
            ObjectNode verified=checkConverted(c,frozen);
            Path receipt=archive.resolveSibling(archive.getFileName()+".committed.json");
            if(Files.exists(receipt)) require(verified.equals(JSON.readTree(Files.readAllBytes(receipt))),"RECEIPT_CHANGED");
            c.rollback(); emit(summary(verified,"readback").put("state","converted_verified"));
        }
    }

    static ObjectNode baseline(Connection c) throws Exception {
        ObjectNode report=JSON.createObjectNode();
        try(var statement=c.createStatement();var rows=statement.executeQuery("SELECT current_database(),inet_server_addr()::text,inet_server_port()")) {
            rows.next();require(DATABASE.equals(rows.getString(1)),"DATABASE_MISMATCH");
            report.putObject("identity").put("database",rows.getString(1)).put("server",rows.getString(2)).put("port",rows.getInt(3));
        }
        ObjectNode tables=report.putObject("tables");
        for(String table:TABLES) tables.set(table,rows(c,"SELECT to_jsonb(t)::text FROM public."+table+" t"));
        report.set("constraints",rows(c,"SELECT jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))::text FROM pg_constraint WHERE conrelid IN ('public.skill_formulas'::regclass,'public.skill_object_references'::regclass)"));
        ArrayNode nonFormula=filter(tables.path("skill_object_references"),r->!r.path("source_type").asText().equals("FORMULA"));
        report.put("nonFormulaSha256",sha(nonFormula.toString().getBytes(StandardCharsets.UTF_8)));
        report.set("damageTypeReferences",filter(nonFormula,r->r.path("source_type").asText().equals("DAMAGE_TYPE")));
        report.putObject("statistics").put("formulaRows",tables.path("skill_formulas").size()).put("allReferences",tables.path("skill_object_references").size())
            .put("formulaReferences",tables.path("skill_object_references").size()-nonFormula.size()).put("nonFormulaReferences",nonFormula.size());
        return report;
    }

    static void checkOriginal(ObjectNode baseline) {
        JsonNode tables=baseline.path("tables");
        require(tables.path("skill_formulas").size()==1705,"EXACT_FORMULA_COUNT_REQUIRED");
        require(baseline.path("statistics").path("formulaReferences").asInt()==5875,"EXACT_OLD_REFERENCE_COUNT_REQUIRED");
        require(baseline.path("statistics").path("allReferences").asInt()==9907,"EXACT_REFERENCE_COUNT_REQUIRED");
        require(baseline.path("damageTypeReferences").size()==7,"PHASE3A_REFERENCE_COUNT_CHANGED");
        require(filter(tables.path("damage_types"),r->!r.path("calculation_formula").isNull()).size()==4,"PHASE3A_FORMULA_COUNT_CHANGED");
        for(JsonNode row:tables.path("skill_formulas")) require(GAME.equals(row.path("game_id").asText()),"FOREIGN_GAME_FORMULA");
        for(JsonNode row:tables.path("damage_types")) if(!row.path("calculation_formula").isNull())
            require(row.path("calculation_formula").has("inputs"),"PHASE3A_NOT_COMMON");
    }

    static ObjectNode convertAll(ObjectNode baseline) {
        ObjectNode converted=JSON.createObjectNode();
        Set<String> attrs=new TreeSet<>(); Map<String,JsonNode> params=new TreeMap<>();
        for(JsonNode row:baseline.path("tables").path("attributes")) if(GAME.equals(row.path("game_id").asText()) && "ENABLED".equals(row.path("status").asText())) attrs.add(row.path("attribute_key").asText());
        for(JsonNode row:baseline.path("tables").path("skill_parameters")) if(GAME.equals(row.path("game_id").asText())) params.put(row.path("skill_key").asText()+"/"+row.path("parameter_key").asText(),row);
        for(JsonNode row:baseline.path("tables").path("skill_formulas")) {
            String skill=row.path("skill_key").asText();
            ObjectNode definition=new Legacy(skill).convert(row.path("expression"));
            Set<String> own=new TreeSet<>();for(String key:params.keySet()) if(key.startsWith(skill+"/")) own.add(key.substring(skill.length()+1));
            try { SkillFormulaParser.validate(skill,definition,attrs,own); } catch(RuntimeException error) { throw new SafeFailure("NEW_CONTRACT_REJECTED_"+id(row)); }
            converted.set(id(row),definition);
        }
        return converted;
    }

    static ObjectNode legacyInventory(ObjectNode baseline) {
        ObjectNode inventory=JSON.createObjectNode();Map<String,Integer> kinds=new TreeMap<>(),modes=new TreeMap<>(),ops=new TreeMap<>();
        Map<String,JsonNode> params=new HashMap<>();for(JsonNode row:baseline.path("tables").path("skill_parameters"))params.put(row.path("skill_key").asText()+"/"+row.path("parameter_key").asText(),row);
        int maximumNodes=0,maximumDepth=0,maximumInputs=0,maximumInstructions=0;
        for(JsonNode row:baseline.path("tables").path("skill_formulas")) {
            String skill=row.path("skill_key").asText();Legacy source=new Legacy(skill);JsonNode converted=source.convert(row.path("expression"));
            maximumNodes=Math.max(maximumNodes,source.nodes);maximumInputs=Math.max(maximumInputs,converted.path("inputs").size());
            maximumInstructions=Math.max(maximumInstructions,source.nodes+1);
            maximumDepth=Math.max(maximumDepth,inventoryNode(row.path("expression"),skill,params,kinds,modes,ops));
        }
        inventory.set("nodeKinds",JSON.valueToTree(kinds));inventory.set("parameterLeafModes",JSON.valueToTree(modes));inventory.set("operations",JSON.valueToTree(ops));
        return inventory.put("maximumNodes",maximumNodes).put("maximumDepth",maximumDepth).put("maximumInputs",maximumInputs)
            .put("maximumCommonExpressionNodes",maximumNodes).put("maximumCommonStages",1).put("maximumCommonInstructions",maximumInstructions);
    }

    static int inventoryNode(JsonNode n,String skill,Map<String,JsonNode> parameters,Map<String,Integer> kinds,Map<String,Integer> modes,Map<String,Integer> operations) {
        String kind=n.path("nodeType").asText();kinds.merge(kind,1,Integer::sum);int depth=1;
        if(kind.equals("PARAMETER")){JsonNode p=parameters.get(skill+"/"+n.path("parameterKey").asText());require(p!=null,"INVENTORY_PARAMETER_MISSING");modes.merge(p.path("value_mode").asText(),1,Integer::sum);}
        if(kind.equals("OPERATION")){operations.merge(n.path("operation").asText(),1,Integer::sum);for(JsonNode child:n.path("operands"))depth=Math.max(depth,1+inventoryNode(child,skill,parameters,kinds,modes,operations));}
        return depth;
    }

    /** 旧模型独占在一次性工具；严格形状、稳定首次遇到去重输入、六运算及顺序不变。 */
    static final class Legacy {
        final String skill; final Map<String,String> inputKeys=new LinkedHashMap<>(); final ArrayNode inputs=JSON.createArrayNode(); int nodes;
        Legacy(String skill){this.skill=skill;}
        ObjectNode convert(JsonNode old) {
            JsonNode expression=node(old,1); ObjectNode result=JSON.createObjectNode(); result.set("inputs",inputs);
            result.putArray("stages").addObject().put("key","output").put("name","原技能公式输出").set("expression",expression);
            result.put("outputStageKey","output"); return result;
        }
        JsonNode node(JsonNode node,int depth) {
            require(depth<=32 && ++nodes<=256,"LEGACY_BUDGET");
            String kind=node.path("nodeType").asText();
            return switch(kind) {
                case "PARAMETER" -> {
                    exact(node,Set.of("nodeType","parameterKey")); require(key(node.path("parameterKey")),"LEGACY_PARAMETER_KEY");
                    yield read(JSON.createObjectNode().put("kind","parameter").put("skillKey",skill).put("parameterKey",node.path("parameterKey").textValue()));
                }
                case "ATTRIBUTE" -> {
                    exact(node,Set.of("nodeType","attributeOwner","attributeKey","attributeValueKind"));
                    require(Set.of("SOURCE","TARGET").contains(node.path("attributeOwner").asText()),"LEGACY_ATTRIBUTE_OWNER");
                    require(LEGACY_KINDS.contains(node.path("attributeValueKind").asText()) && key(node.path("attributeKey")),"LEGACY_ATTRIBUTE_BINDING");
                    yield read(JSON.createObjectNode().put("kind","attribute").put("object",node.path("attributeOwner").asText().toLowerCase(Locale.ROOT))
                        .put("attributeKey",node.path("attributeKey").textValue()).put("valueKind",node.path("attributeValueKind").textValue()).put("view","current_frame"));
                }
                case "OPERATION" -> {
                    exact(node,Set.of("nodeType","operation","operands"));require(OPS.containsKey(node.path("operation").asText()),"LEGACY_OPERATION");
                    require(node.path("operands").isArray() && node.path("operands").size()==2,"LEGACY_ARITY");
                    ObjectNode expression=JSON.createObjectNode().put("op",OPS.get(node.path("operation").asText()));
                    ArrayNode args=expression.putArray("args"); for(JsonNode child:node.path("operands")) args.add(node(child,depth+1)); yield expression;
                }
                default -> throw new SafeFailure("LEGACY_UNKNOWN_NODE");
            };
        }
        JsonNode read(ObjectNode binding) {
            String identity=canonical(binding).toString(), key=inputKeys.get(identity);
            if(key==null){require(inputKeys.size()<64,"INPUT_BUDGET");key="input_"+inputKeys.size();inputKeys.put(identity,key);inputs.addObject().put("key",key).set("binding",binding);}
            return JSON.createObjectNode().put("op","read").put("inputKey",key);
        }
    }

    static ArrayNode newReferences(ObjectNode converted) {
        List<Aggregate> objects=new ArrayList<>();
        for(String id:fields(converted)){String[] identity=id.split("/",2);objects.add(new Aggregate(SourceType.FORMULA,identity[0],identity[1],JSON.createObjectNode().set("expression",converted.path(id))));}
        ArrayNode result=JSON.createArrayNode();
        for(var ref:SkillObjectReferences.extract(GAME,objects)) {
            ObjectNode row=JSON.createObjectNode().put("game_id",GAME).put("source_skill_key",ref.sourceSkillKey()).put("source_type","FORMULA")
                .put("source_key",ref.sourceKey()).put("field_path",ref.fieldPath()).put("target_type",ref.target().type().name())
                .put("target_skill_key",ref.target().skillKey()).put("target_key",ref.target().key()).put("target_sub_key",ref.target().subKey())
                .put("source_owner_skill_key",ref.sourceSkillKey());row.putNull("source_owner_damage_type_key");result.add(row);
        }
        return sorted(result);
    }

    static ObjectNode checkConverted(Connection c,ObjectNode frozen) throws Exception {
        ObjectNode now=baseline(c);require(now.path("identity").equals(frozen.path("identity")),"IDENTITY_CHANGED");
        require(now.path("constraints").equals(frozen.path("constraints")),"CONSTRAINTS_CHANGED");
        for(String table:TABLES) if(!Set.of("skill_formulas","skill_object_references").contains(table))
            require(now.path("tables").path(table).equals(frozen.path("tables").path(table)),"PROTECTED_TABLE_CHANGED_"+table);
        require(now.path("nonFormulaSha256").equals(frozen.path("nonFormulaSha256")),"NON_FORMULA_REFERENCES_CHANGED");
        require(now.path("damageTypeReferences").equals(frozen.path("damageTypeReferences")),"PHASE3A_REFERENCES_CHANGED");
        require(filter(now.path("tables").path("skill_object_references"),r->r.path("source_type").asText().equals("FORMULA"))
            .equals(frozen.path("newFormulaReferences")),"FORMULA_REFERENCE_EXACT_SET_CHANGED");
        Map<String,JsonNode> originals=new TreeMap<>();for(JsonNode row:frozen.path("tables").path("skill_formulas")) originals.put(id(row),row);
        require(now.path("tables").path("skill_formulas").size()==originals.size(),"FORMULA_COUNT_CHANGED");
        for(JsonNode row:now.path("tables").path("skill_formulas")) {
            JsonNode old=originals.remove(id(row)); require(old!=null,"FORMULA_ADDED"); ObjectNode expected=old.deepCopy();
            expected.set("expression",frozen.path("converted").path(id(row))); expected.set("updated_at",row.path("updated_at"));
            require(row.path("updated_at").isTextual() && expected.equals(row),"FORMULA_ROW_CHANGED");
            SkillFormulaParser.readStored(row.path("skill_key").asText(),row.path("expression").toString());
        }
        require(originals.isEmpty(),"FORMULA_REMOVED");
        now.set("arithmetic",frozen.path("arithmetic")); now.set("newFormulaReferences",frozen.path("newFormulaReferences"));
        return now;
    }

    static ArrayNode compareAll(ObjectNode baseline,ObjectNode definitions) {
        Map<String,JsonNode> params=new TreeMap<>();for(JsonNode row:baseline.path("tables").path("skill_parameters")) params.put(row.path("skill_key").asText()+"/"+row.path("parameter_key").asText(),row);
        ArrayNode evidence=JSON.createArrayNode();
        for(JsonNode row:baseline.path("tables").path("skill_formulas")) evidence.add(compareArithmetic(row.path("expression"),definitions.path(id(row)),row.path("skill_key").asText(),params).put("formula",id(row)));
        return evidence;
    }

    record Ratio(BigInteger numerator,BigInteger denominator) implements Comparable<Ratio> {
        Ratio {if(denominator.signum()==0) throw new ArithmeticException();if(denominator.signum()<0){numerator=numerator.negate();denominator=denominator.negate();}BigInteger gcd=numerator.gcd(denominator);numerator=numerator.divide(gcd);denominator=denominator.divide(gcd);}
        static Ratio of(BigDecimal v){return v.scale()>=0?new Ratio(v.unscaledValue(),BigInteger.TEN.pow(v.scale())):new Ratio(v.unscaledValue().multiply(BigInteger.TEN.pow(-v.scale())),BigInteger.ONE);}
        Ratio add(Ratio b){return new Ratio(numerator.multiply(b.denominator).add(b.numerator.multiply(denominator)),denominator.multiply(b.denominator));}
        Ratio sub(Ratio b){return new Ratio(numerator.multiply(b.denominator).subtract(b.numerator.multiply(denominator)),denominator.multiply(b.denominator));}
        Ratio mul(Ratio b){return new Ratio(numerator.multiply(b.numerator),denominator.multiply(b.denominator));}
        Ratio div(Ratio b){return new Ratio(numerator.multiply(b.denominator),denominator.multiply(b.numerator));}
        public int compareTo(Ratio b){return numerator.multiply(b.denominator).compareTo(b.numerator.multiply(denominator));}
    }

    static ObjectNode compareArithmetic(JsonNode old,JsonNode definition,String skill,Map<String,JsonNode> params) {
        Set<String> skillLevels=new TreeSet<>(),characterLevels=new TreeSet<>();int runtime=0;
        for(JsonNode input:definition.path("inputs")) {
            JsonNode b=input.path("binding");if(!b.path("kind").asText().equals("parameter"))continue;
            JsonNode p=params.get(skill+"/"+b.path("parameterKey").asText());require(p!=null,"PARAMETER_MISSING");
            switch(p.path("value_mode").asText()) {
                case "SKILL_LEVEL" -> skillLevels.addAll(fields(p.path("level_values")));
                case "CHARACTER_LEVEL" -> characterLevels.addAll(fields(p.path("level_values")));
                case "RUNTIME_INPUT" -> {require(p.path("fixed_value").isNull() && p.path("level_values").isNull(),"RUNTIME_INPUT_DEFAULT");runtime++;}
                case "FIXED" -> require(p.path("fixed_value").isNumber(),"FIXED_VALUE_MISSING");
                default -> throw new SafeFailure("PARAMETER_MODE_UNKNOWN");
            }
        }
        if(skillLevels.isEmpty())skillLevels.add("");if(characterLevels.isEmpty())characterLevels.add("");
        require(skillLevels.size()*characterLevels.size()<=10000,"GRADE_COMBINATIONS_BUDGET");
        int cases=0,exactErrors=0,floatErrors=0;
        int scenarios=5+definition.path("inputs").size()*2;
        for(String sl:skillLevels)for(String cl:characterLevels)for(int scenario=0;scenario<scenarios;scenario++) {
            Map<String,BigDecimal> bindings=new HashMap<>(),inputs=new HashMap<>();int slot=0;
            for(JsonNode input:definition.path("inputs")) {
                JsonNode b=input.path("binding");BigDecimal value;
                BigDecimal seed=scenario<5?List.of(BigDecimal.ZERO,new BigDecimal("1"),new BigDecimal("7.25"),new BigDecimal("-1"),new BigDecimal("-3.5")).get(scenario)
                    :(slot==(scenario-5)/2?((scenario-5)%2==0?BigDecimal.ZERO:new BigDecimal("-2.75")):new BigDecimal(slot+".25"));
                if(b.path("kind").asText().equals("parameter")){
                    JsonNode p=params.get(skill+"/"+b.path("parameterKey").asText());String mode=p.path("value_mode").asText();
                    JsonNode raw=mode.equals("FIXED")?p.path("fixed_value"):mode.equals("SKILL_LEVEL")?p.path("level_values").get(sl):mode.equals("CHARACTER_LEVEL")?p.path("level_values").get(cl):null;
                    if(mode.equals("RUNTIME_INPUT")) value=seed;
                    else {require(raw!=null && raw.isNumber(),"GRADE_VALUE_MISSING");value=raw.decimalValue();}
                } else value=seed;
                require(Double.isFinite(value.doubleValue()) && (value.signum()==0 || value.doubleValue()!=0),"INPUT_FLOAT_RANGE");
                inputs.put(input.path("key").asText(),value);bindings.put(canonical(b).toString(),value);slot++;
            }
            Ratio legacy=null,common=null;boolean le=false,ce=false;
            try{legacy=legacyValue(old,skill,bindings);}catch(ArithmeticException error){le=true;}
            try{common=commonValue(definition.path("stages").get(0).path("expression"),inputs);}catch(ArithmeticException error){ce=true;}
            require(le==ce && (le || legacy.equals(common)),"EXACT_ARITHMETIC_DIFFERENCE");if(le)exactErrors++;
            double ld=0,cd=0;le=false;ce=false;
            try{ld=legacyDouble(old,skill,bindings);}catch(ArithmeticException error){le=true;}
            try{cd=commonDouble(definition.path("stages").get(0).path("expression"),inputs);}catch(ArithmeticException error){ce=true;}
            require(le==ce && (le || Double.doubleToLongBits(ld)==Double.doubleToLongBits(cd)),"FLOAT64_ARITHMETIC_DIFFERENCE");if(le)floatErrors++;cases++;
        }
        return JSON.createObjectNode().put("cases",cases).put("exactMatchedErrors",exactErrors).put("float64MatchedErrors",floatErrors).put("runtimeInputDeclarations",runtime);
    }

    static Ratio legacyValue(JsonNode node,String skill,Map<String,BigDecimal> values) {
        String type=node.path("nodeType").asText();
        if(type.equals("PARAMETER"))return Ratio.of(values.get(canonical(JSON.createObjectNode().put("kind","parameter").put("skillKey",skill).put("parameterKey",node.path("parameterKey").asText())).toString()));
        if(type.equals("ATTRIBUTE"))return Ratio.of(values.get(canonical(legacyAttribute(node)).toString()));
        Ratio a=legacyValue(node.path("operands").get(0),skill,values),b=legacyValue(node.path("operands").get(1),skill,values);
        return switch(node.path("operation").asText()){case "ADD"->a.add(b);case "SUBTRACT"->a.sub(b);case "MULTIPLY"->a.mul(b);case "DIVIDE"->a.div(b);case "MIN"->a.compareTo(b)<=0?a:b;case "MAX"->a.compareTo(b)>=0?a:b;default->throw new SafeFailure("LEGACY_EVAL_UNKNOWN");};
    }
    static Ratio commonValue(JsonNode n,Map<String,BigDecimal> inputs){if(n.path("op").asText().equals("read"))return Ratio.of(inputs.get(n.path("inputKey").asText()));Ratio a=commonValue(n.path("args").get(0),inputs),b=commonValue(n.path("args").get(1),inputs);return switch(n.path("op").asText()){case "add"->a.add(b);case "sub"->a.sub(b);case "mul"->a.mul(b);case "div"->a.div(b);case "min"->a.compareTo(b)<=0?a:b;case "max"->a.compareTo(b)>=0?a:b;default->throw new SafeFailure("COMMON_EVAL_UNKNOWN");};}
    static ObjectNode legacyAttribute(JsonNode n){return JSON.createObjectNode().put("kind","attribute").put("object",n.path("attributeOwner").asText().toLowerCase(Locale.ROOT)).put("attributeKey",n.path("attributeKey").asText()).put("valueKind",n.path("attributeValueKind").asText()).put("view","current_frame");}
    static double legacyDouble(JsonNode n,String skill,Map<String,BigDecimal> values){String type=n.path("nodeType").asText();if(type.equals("PARAMETER"))return values.get(canonical(JSON.createObjectNode().put("kind","parameter").put("skillKey",skill).put("parameterKey",n.path("parameterKey").asText())).toString()).doubleValue();if(type.equals("ATTRIBUTE"))return values.get(canonical(legacyAttribute(n)).toString()).doubleValue();double a=legacyDouble(n.path("operands").get(0),skill,values),b=legacyDouble(n.path("operands").get(1),skill,values);return finite(switch(n.path("operation").asText()){case "ADD"->a+b;case "SUBTRACT"->a-b;case "MULTIPLY"->a*b;case "DIVIDE"->a/b;case "MIN"->Math.min(a,b);case "MAX"->Math.max(a,b);default->throw new SafeFailure("LEGACY_FLOAT_UNKNOWN");});}
    static double commonDouble(JsonNode n,Map<String,BigDecimal> inputs){if(n.path("op").asText().equals("read"))return inputs.get(n.path("inputKey").asText()).doubleValue();double a=commonDouble(n.path("args").get(0),inputs),b=commonDouble(n.path("args").get(1),inputs);return finite(switch(n.path("op").asText()){case "add"->a+b;case "sub"->a-b;case "mul"->a*b;case "div"->a/b;case "min"->Math.min(a,b);case "max"->Math.max(a,b);default->throw new SafeFailure("COMMON_FLOAT_UNKNOWN");});}
    static double finite(double v){if(!Double.isFinite(v))throw new ArithmeticException();return v;}

    static ObjectNode readArchive(Path root,Path archive,Map<String,String> options,boolean currentTool)throws Exception{
        byte[] bytes=Files.readAllBytes(archive);require(sha(bytes).equals(required(options,"--archive-sha256")),"ARCHIVE_DIGEST_MISMATCH");ObjectNode frozen=(ObjectNode)JSON.readTree(bytes);require(FORMAT.equals(frozen.path("format").asText()),"ARCHIVE_FORMAT");
        if(currentTool){require(frozen.path("toolSha256").asText().equals(sha(Files.readAllBytes(root.resolve(TOOL)))),"TOOL_CHANGED");require(frozen.path("backendClasses").equals(classHashes(root)),"BACKEND_CLASSES_CHANGED");}return frozen;
    }
    static ObjectNode classHashes(Path root)throws Exception {
        ObjectNode hashes=JSON.createObjectNode();
        Path classes=root.resolve("server/data_manage/target/classes");
        try(var files=Files.walk(classes)) {
            for(Path file:files.filter(Files::isRegularFile).filter(p -> {
                String relative=classes.relativize(p).toString().replace('\\','/');
                return relative.endsWith(".class") || (relative.startsWith("mapper/") && relative.endsWith(".xml"));
            }).sorted().toList()) {
                hashes.put(classes.relativize(file).toString().replace('\\','/'),sha(Files.readAllBytes(file)));
            }
        }
        require(hashes.size()>100,"BACKEND_CLASSES_MISSING");
        return hashes;
    }
    static Connection connect(Path root,boolean readOnly)throws Exception{Map<?,?> config;try(var input=Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))){config=new Yaml().load(input);}Map<?,?> ds=(Map<?,?>)((Map<?,?>)config.get("spring")).get("datasource");String url=System.getenv().getOrDefault("SPRING_DATASOURCE_URL",resolve(ds.get("url"))),user=System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME",resolve(ds.get("username"))),password=System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD",resolve(ds.get("password")));Connection c=DriverManager.getConnection(url,user,password);c.setReadOnly(readOnly);c.setTransactionIsolation(readOnly?Connection.TRANSACTION_REPEATABLE_READ:Connection.TRANSACTION_READ_COMMITTED);c.setAutoCommit(false);return c;}
    static String resolve(Object value){String s=String.valueOf(value);if(!s.startsWith("${")||!s.endsWith("}"))return s;String inner=s.substring(2,s.length()-1);int cut=inner.indexOf(':');return System.getenv().getOrDefault(cut<0?inner:inner.substring(0,cut),cut<0?"":inner.substring(cut+1));}
    static ArrayNode rows(Connection c,String sql)throws Exception{ArrayNode result=JSON.createArrayNode();try(var statement=c.createStatement();var rows=statement.executeQuery(sql)){while(rows.next())result.add(JSON.readTree(rows.getString(1)));}return sorted(result);}
    static ArrayNode filter(JsonNode rows,java.util.function.Predicate<JsonNode> condition){ArrayNode result=JSON.createArrayNode();for(JsonNode row:rows)if(condition.test(row))result.add(row);return sorted(result);}
    static ArrayNode sorted(JsonNode rows){List<JsonNode> values=new ArrayList<>();rows.forEach(r->values.add(canonical(r)));values.sort(Comparator.comparing(JsonNode::toString));ArrayNode result=JSON.createArrayNode();values.forEach(result::add);return result;}
    static JsonNode canonical(JsonNode node){if(node.isObject()){ObjectNode result=JSON.createObjectNode();for(String f:fields(node))result.set(f,canonical(node.get(f)));return result;}if(node.isArray()){ArrayNode result=JSON.createArrayNode();node.forEach(n->result.add(canonical(n)));return result;}return node;}
    static Set<String> fields(JsonNode node){Set<String> result=new TreeSet<>();node.fieldNames().forEachRemaining(result::add);return result;}
    static boolean key(JsonNode n){return n.isTextual() && n.textValue().matches("[a-z][a-z0-9_]{0,63}");}
    static String id(JsonNode row){return row.path("skill_key").asText()+"/"+row.path("formula_key").asText();}
    static void exact(JsonNode n,Set<String> fields){require(n.isObject() && fields(n).equals(fields),"LEGACY_FIELDS");}
    static Map<String,String> options(String[] args){require((args.length-2)%2==0,"ARGUMENT_PAIRS");Map<String,String> result=new HashMap<>();for(int i=2;i<args.length;i+=2)require(result.put(args[i],args[i+1])==null,"DUPLICATE_ARGUMENT");return result;}
    static String required(Map<String,String> values,String name){require(values.containsKey(name),"ARGUMENT_REQUIRED");return values.get(name);}
    static String sha(byte[] value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));}catch(Exception e){throw new SafeFailure("DIGEST_FAILURE");}}
    static void require(boolean ok,String code){if(!ok)throw new SafeFailure(code);}
    static void emit(JsonNode value){System.out.println(value);}
    static void failure(String code){emit(JSON.createObjectNode().put("ok",false).put("code",code));System.exit(1);}
    static ObjectNode summary(ObjectNode evidence,String mode){return JSON.createObjectNode().put("ok",true).put("mode",mode).put("database",DATABASE).put("formulaRows",evidence.path("tables").path("skill_formulas").size()).put("formulaReferenceRows",evidence.path("statistics").path("formulaReferences").asInt()).put("newFormulaReferenceRows",evidence.path("newFormulaReferences").size()).put("nonFormulaSha256",evidence.path("nonFormulaSha256").asText()).put("arithmeticCases",java.util.stream.StreamSupport.stream(evidence.path("arithmetic").spliterator(),false).mapToInt(r->r.path("cases").asInt()).sum());}
    static final class SafeFailure extends RuntimeException {final String code;SafeFailure(String code){this.code=code;}}

    static void selftest() throws Exception {
        JsonNode old=JSON.readTree("{\"nodeType\":\"OPERATION\",\"operation\":\"DIVIDE\",\"operands\":[{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"a\"},{\"nodeType\":\"PARAMETER\",\"parameterKey\":\"a\"}]}");
        ObjectNode common=new Legacy("skill").convert(old);require(common.path("inputs").size()==1,"SELFTEST_DEDUP");
        SkillFormulaParser.validate("skill",common,Set.of(),Set.of("a"));
        JsonNode parameter=JSON.readTree("{\"value_mode\":\"RUNTIME_INPUT\",\"fixed_value\":null,\"level_values\":null}");
        ObjectNode arithmetic=compareArithmetic(old,common,"skill",Map.of("skill/a",parameter));require(arithmetic.path("cases").asInt()==7 && arithmetic.path("exactMatchedErrors").asInt()==2,"SELFTEST_ARITHMETIC");
        boolean rejected=false;try{new Legacy("skill").convert(JSON.readTree("{\"nodeType\":\"FIXED\",\"value\":0}"));}catch(SafeFailure e){rejected=true;}require(rejected,"SELFTEST_UNKNOWN");
        Set<String> keys=new TreeSet<>();for(int i=0;i<64;i++)keys.add("p"+i);
        ObjectNode sixtyFour=new Legacy("skill").convert(legacyBalanced(0,64));require(sixtyFour.path("inputs").size()==64,"SELFTEST_64_INPUTS");
        SkillFormulaParser.validate("skill",sixtyFour,Set.of(),keys);
        rejected=false;try{new Legacy("skill").convert(legacyBalanced(0,65));}catch(SafeFailure error){rejected=error.code.equals("INPUT_BUDGET");}require(rejected,"SELFTEST_65_INPUTS");
        int comparisons=7;
        for(String op:new TreeSet<>(OPS.keySet())) {
            ObjectNode operation=JSON.createObjectNode().put("nodeType","OPERATION").put("operation",op);
            operation.putArray("operands").addObject().put("nodeType","PARAMETER").put("parameterKey","a");
            ((ArrayNode)operation.path("operands")).addObject().put("nodeType","PARAMETER").put("parameterKey","b");
            ObjectNode definition=new Legacy("skill").convert(operation);SkillFormulaParser.validate("skill",definition,Set.of(),Set.of("a","b"));
            comparisons+=compareArithmetic(operation,definition,"skill",Map.of("skill/a",parameter,"skill/b",parameter)).path("cases").asInt();
        }
        emit(JSON.createObjectNode().put("ok",true).put("mode","selftest").put("arithmeticCases",comparisons).put("operations",6).put("inputBoundaryCases",2));
    }

    static JsonNode legacyBalanced(int start,int count) {
        if(count==1)return JSON.createObjectNode().put("nodeType","PARAMETER").put("parameterKey","p"+start);
        ObjectNode node=JSON.createObjectNode().put("nodeType","OPERATION").put("operation","ADD");
        node.putArray("operands").add(legacyBalanced(start,count/2)).add(legacyBalanced(start+count/2,count-count/2));return node;
    }
}
