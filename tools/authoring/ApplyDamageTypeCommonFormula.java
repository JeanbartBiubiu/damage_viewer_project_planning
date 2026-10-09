import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.math.MathContext;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.yaml.snakeyaml.Yaml;
import xyz.game.datamanage.support.formula.DamageTypeFormulaBindings;
import xyz.game.datamanage.support.formula.FormulaContractValidator;

/** 本批一次性转换。凭据只在进程内读取，任何异常只输出稳定种类或SQL状态。 */
public final class ApplyDamageTypeCommonFormula {
    private static final ObjectMapper JSON = new ObjectMapper()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));
    private static final String DATABASE = "test0221";
    private static final String GAME = "lol";
    private static final Path SQL_PATH = Path.of("db/game_manage/migrations/damage_type_common_formula_references.sql");
    private static final Path TOOL_PATH = Path.of("tools/authoring/ApplyDamageTypeCommonFormula.java");
    private static final List<String> FIELDS = List.of("resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance", "resistanceFactor");
    private static final List<String> OLD_STAGES = List.of("RESISTANCE_BEFORE_PENETRATION", "PENETRATION_PERCENT", "PENETRATION_FLAT", "EFFECTIVE_RESISTANCE", "RESISTANCE_FACTOR");
    private static final List<String> NAMES = List.of("穿透前抗性", "比例穿透", "固定穿透", "有效抗性", "结算倍率");
    private static final String ROWS_SQL = "SELECT to_jsonb(t)::text FROM public.damage_types t ORDER BY game_id,damage_type_key";
    private static final String ATTRS_SQL = "SELECT to_jsonb(t)::text FROM public.attributes t WHERE game_id='lol' ORDER BY attribute_key";
    private static final String REFERENCES_SQL = """
        SELECT jsonb_build_object('game_id',game_id,'source_skill_key',source_skill_key,'source_type',source_type,
          'source_key',source_key,'field_path',field_path,'target_type',target_type,'target_skill_key',target_skill_key,
          'target_key',target_key,'target_sub_key',target_sub_key)::text
        FROM public.skill_object_references
        """;
    private static final String CONSTRAINTS_SQL = """
        SELECT jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))::text
        FROM pg_constraint c WHERE c.conrelid IN ('public.damage_types'::regclass,'public.skill_object_references'::regclass)
        ORDER BY c.conrelid::regclass::text,c.conname
        """;
    private static final String COLUMNS_SQL = """
        SELECT jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
          'generated',a.attgenerated,'expression',pg_get_expr(d.adbin,d.adrelid))::text
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='public.skill_object_references'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
        """;
    private static final String INDEXES_SQL = "SELECT jsonb_build_object('name',indexname,'definition',indexdef)::text FROM pg_indexes WHERE schemaname='public' AND tablename='skill_object_references' ORDER BY indexname";

    public static void main(String[] args) {
        try {
            require(args.length >= 4, "ARGUMENTS_REQUIRED");
            Path root = Path.of(args[0]).toAbsolutePath().normalize();
            String mode = args[1];
            Map<String, String> options = options(args);
            Path archive = Path.of(required(options, "--archive")).toAbsolutePath().normalize();
            require(Path.of(required(options, "--archive")).isAbsolute(), "ARCHIVE_MUST_BE_ABSOLUTE");
            require(archive.startsWith(root.resolve("output/formula-phase3").normalize()), "ARCHIVE_OUTSIDE_FORMULA_PHASE3");
            Set<String> allowedArguments = switch (mode) {
                case "preview" -> Set.of("--archive");
                case "apply" -> Set.of("--archive", "--archive-sha256", "--sql-sha256", "--tool-sha256", "--database");
                case "readback" -> Set.of("--archive", "--archive-sha256");
                default -> throw new SafeFailure("UNKNOWN_MODE");
            };
            require(allowedArguments.containsAll(options.keySet()), "UNKNOWN_ARGUMENT");
            switch (mode) {
                case "preview" -> preview(root, archive);
                case "apply" -> apply(root, archive, options);
                case "readback" -> readback(root, archive, options);
                default -> throw new SafeFailure("UNKNOWN_MODE");
            }
        } catch (SafeFailure error) {
            emit(JSON.createObjectNode().put("ok", false).put("code", error.code));
            System.exit(1);
        } catch (SQLException error) {
            emit(JSON.createObjectNode().put("ok", false).put("code", "DATABASE_FAILURE")
                .put("sqlState", error.getSQLState() == null ? "" : error.getSQLState()));
            System.exit(1);
        } catch (Throwable error) {
            emit(JSON.createObjectNode().put("ok", false).put("code", "LOCAL_FAILURE").put("kind", error.getClass().getSimpleName()));
            System.exit(1);
        }
    }

    private static void preview(Path root, Path archive) throws Exception {
        require(!Files.exists(archive), "ARCHIVE_EXISTS");
        ObjectNode baseline;
        try (Connection connection = connect(root, true)) {
            baseline = baseline(connection);
            checkOriginal(baseline);
            ObjectNode converted = JSON.createObjectNode();
            ArrayNode arithmetic = JSON.createArrayNode();
            Set<String> enabled = enabled(baseline.path("attributes"));
            for (JsonNode row : baseline.path("formulaRows")) {
                String key = row.path("damage_type_key").textValue();
                JsonNode old = row.get("calculation_formula");
                JsonNode definition = convert(old, enabled);
                converted.set(key, definition);
                arithmetic.add(compareArithmetic(old, definition).put("damageTypeKey", key));
            }
            baseline.set("converted", converted);
            baseline.set("arithmetic", arithmetic);
            baseline.set("newReferences", newReferences(converted));
            baseline.put("format", "damage-type-common-formula-transition-v1");
            baseline.put("sqlSha256", sha(Files.readAllBytes(root.resolve(SQL_PATH))));
            baseline.put("toolSha256", sha(Files.readAllBytes(root.resolve(TOOL_PATH))));
            baseline.set("validatorClasses", validatorClasses());
            connection.rollback();
        }
        Files.createDirectories(archive.getParent());
        byte[] bytes = JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(baseline);
        Files.write(archive, bytes, StandardOpenOption.CREATE_NEW);
        emit(JSON.createObjectNode().put("ok", true).put("mode", "preview").put("database", DATABASE)
            .put("archive", archive.toString()).put("archiveSha256", sha(bytes))
            .put("sqlSha256", baseline.path("sqlSha256").textValue()).put("toolSha256", baseline.path("toolSha256").textValue())
            .put("formulaRows", baseline.path("formulaRows").size()).put("oldReferenceRows", baseline.path("oldReferences").size())
            .put("newReferenceRows", baseline.path("newReferences").size()).set("arithmetic", baseline.path("arithmetic")));
    }

    private static void apply(Path root, Path archive, Map<String, String> options) throws Exception {
        require(DATABASE.equals(required(options, "--database")), "EXACT_DATABASE_REQUIRED");
        ObjectNode frozen = readArchive(root, archive, options, true);
        require(frozen.path("sqlSha256").textValue().equals(required(options, "--sql-sha256")), "SQL_APPROVAL_MISMATCH");
        require(frozen.path("toolSha256").textValue().equals(required(options, "--tool-sha256")), "TOOL_APPROVAL_MISMATCH");
        Path attempt = archive.resolveSibling(archive.getFileName() + ".attempt.jsonl");
        Path receipt = archive.resolveSibling(archive.getFileName() + ".committed.json");
        require(!Files.exists(attempt) && !Files.exists(receipt), "ATTEMPT_EXISTS_USE_READBACK");
        // 独占写入尝试在任何数据库变更之前；结果不明不得移除它重放。
        Files.writeString(attempt, JSON.createObjectNode().put("mode", "apply").put("state", "started")
            .put("archiveSha256", required(options, "--archive-sha256")).toString() + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        ObjectNode committed;
        try (Connection connection = connect(root, false)) {
            try {
                try (var lock = connection.prepareStatement("SELECT game_id FROM public.games WHERE game_id=? FOR UPDATE")) {
                    lock.setString(1, GAME);
                    try (var rows = lock.executeQuery()) { require(rows.next(), "GAME_MISSING"); }
                }
                try (var statement = connection.createStatement()) {
                    statement.execute("LOCK TABLE public.damage_types, public.attributes, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE");
                }
                ObjectNode current = baseline(connection);
                checkOriginal(current);
                for (String field : List.of("identity", "allDamageTypeRows", "formulaRows", "attributes", "constraints", "columns", "indexes", "oldReferences", "oldReferencesSha256", "relatedReferences")) {
                    require(current.path(field).equals(frozen.path(field)), "BASELINE_CHANGED_" + field);
                }
                Set<String> enabled = enabled(current.path("attributes"));
                ObjectNode recalculated = JSON.createObjectNode();
                for (JsonNode row : current.path("formulaRows")) {
                    recalculated.set(row.path("damage_type_key").textValue(), convert(row.get("calculation_formula"), enabled));
                }
                require(recalculated.equals(frozen.path("converted")), "CONVERSION_CHANGED");
                for (JsonNode row : current.path("formulaRows")) compareArithmetic(row.get("calculation_formula"), recalculated.get(row.path("damage_type_key").textValue()));
                try (var statement = connection.createStatement()) { statement.execute(Files.readString(root.resolve(SQL_PATH), StandardCharsets.UTF_8)); }
                for (JsonNode row : frozen.path("formulaRows")) {
                    try (var update = connection.prepareStatement("UPDATE public.damage_types SET calculation_formula=?::jsonb,updated_at=now() WHERE game_id=? AND damage_type_key=? AND updated_at=?::timestamptz AND calculation_formula=?::jsonb")) {
                        update.setString(1, JSON.writeValueAsString(frozen.path("converted").get(row.path("damage_type_key").textValue())));
                        update.setString(2, GAME); update.setString(3, row.path("damage_type_key").textValue());
                        update.setString(4, row.path("updated_at").textValue()); update.setString(5, JSON.writeValueAsString(row.get("calculation_formula")));
                        require(update.executeUpdate() == 1, "FORMULA_CONCURRENT_CHANGE");
                    }
                }
                try (var insert = connection.prepareStatement("INSERT INTO public.skill_object_references (game_id,source_skill_key,source_type,source_key,field_path,target_type,target_skill_key,target_key,target_sub_key) VALUES (?,?,?,?,?,?,?,?,?)")) {
                    for (JsonNode row : frozen.path("newReferences")) {
                        int parameter = 1;
                        for (String field : List.of("game_id", "source_skill_key", "source_type", "source_key", "field_path", "target_type", "target_skill_key", "target_key", "target_sub_key")) insert.setString(parameter++, row.path(field).textValue());
                        insert.addBatch();
                    }
                    if (!frozen.path("newReferences").isEmpty()) insert.executeBatch();
                }
                committed = checkConverted(connection, frozen);
                connection.commit();
            } catch (Throwable error) {
                connection.rollback();
                throw error;
            }
        }
        Files.write(receipt, JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(committed), StandardOpenOption.CREATE_NEW);
        Files.writeString(attempt, JSON.createObjectNode().put("state", "committed").toString() + "\n", StandardCharsets.UTF_8, StandardOpenOption.APPEND);
        emit(summary(committed, "apply").put("receipt", receipt.toString()));
    }

    private static void readback(Path root, Path archive, Map<String, String> options) throws Exception {
        ObjectNode frozen = readArchive(root, archive, options, false);
        try (Connection connection = connect(root, true)) {
            ObjectNode current = baseline(connection);
            boolean original = true;
            for (String field : List.of("identity", "allDamageTypeRows", "formulaRows", "attributes", "constraints", "columns", "indexes", "oldReferences", "oldReferencesSha256", "relatedReferences", "newReferencesPresent")) {
                original &= current.path(field).equals(frozen.path(field));
            }
            if (original) {
                connection.rollback();
                emit(JSON.createObjectNode().put("ok", true).put("mode", "readback").put("state", "original_unchanged")
                    .put("database", DATABASE).put("formulaRows", current.path("formulaRows").size())
                    .put("oldReferenceRows", current.path("oldReferences").size()).put("oldReferencesSha256", current.path("oldReferencesSha256").textValue()));
                return;
            }
            ObjectNode evidence = checkConverted(connection, frozen);
            Path receipt = archive.resolveSibling(archive.getFileName() + ".committed.json");
            if (Files.exists(receipt)) require(evidence.equals(JSON.readTree(Files.readAllBytes(receipt))), "COMMITTED_RECEIPT_CHANGED");
            connection.rollback();
            emit(summary(evidence, "readback").put("state", "converted_verified"));
        }
    }

    private static ObjectNode checkConverted(Connection connection, ObjectNode frozen) throws Exception {
        ObjectNode now = baseline(connection);
        require(now.path("identity").equals(frozen.path("identity")), "IDENTITY_CHANGED");
        require(now.path("attributes").equals(frozen.path("attributes")), "ATTRIBUTES_CHANGED");
        require(now.path("oldReferences").equals(frozen.path("oldReferences")), "OLD_REFERENCE_ROWS_CHANGED");
        require(now.path("oldReferencesSha256").equals(frozen.path("oldReferencesSha256")), "OLD_REFERENCE_DIGEST_CHANGED");
        require(now.path("newReferencesPresent").equals(frozen.path("newReferences")), "NEW_REFERENCES_MISMATCH");
        require(now.path("formulaRows").size() == frozen.path("formulaRows").size(), "FORMULA_ROW_COUNT_CHANGED");
        Map<String, JsonNode> originals = rowIndex(frozen.path("allDamageTypeRows"));
        for (JsonNode row : now.path("allDamageTypeRows")) {
            String id = rowId(row);
            JsonNode original = originals.remove(id);
            require(original != null, "DAMAGE_TYPE_ROW_ADDED");
            ObjectNode expected = original.deepCopy();
            if (GAME.equals(row.path("game_id").textValue()) && frozen.path("converted").has(row.path("damage_type_key").textValue())) {
                expected.set("calculation_formula", frozen.path("converted").get(row.path("damage_type_key").textValue()));
                require(row.path("updated_at").isTextual(), "UPDATED_AT_MISSING");
                expected.set("updated_at", row.get("updated_at"));
            }
            require(expected.equals(row), "DAMAGE_TYPE_ROW_MISMATCH");
        }
        require(originals.isEmpty(), "DAMAGE_TYPE_ROW_REMOVED");
        require(now.path("indexes").equals(frozen.path("indexes")), "REFERENCE_INDEX_CHANGED");
        checkNewStructure(now, frozen);
        ObjectNode evidence = JSON.createObjectNode();
        for (String field : List.of("identity", "allDamageTypeRows", "formulaRows", "attributes", "constraints", "columns", "indexes", "oldReferencesSha256", "newReferencesPresent")) evidence.set(field, now.path(field));
        evidence.put("oldReferenceRows", now.path("oldReferences").size());
        evidence.put("totalReferenceRows", now.path("oldReferences").size() + now.path("newReferencesPresent").size());
        return evidence;
    }

    private static void checkNewStructure(ObjectNode now, ObjectNode frozen) {
        Map<String, JsonNode> constraints = new HashMap<>();
        for (JsonNode constraint : now.path("constraints")) constraints.put(constraint.path("name").textValue(), constraint);
        for (JsonNode old : frozen.path("constraints")) {
            String name = old.path("name").textValue();
            if (!Set.of("fk_skill_object_references_skill", "ck_skill_object_references_source_type").contains(name)) require(old.equals(constraints.get(name)), "OLD_CONSTRAINT_CHANGED");
        }
        require(constraints.size() == frozen.path("constraints").size() + 2, "CONSTRAINT_COUNT_MISMATCH");
        require(constraints.containsKey("fk_skill_object_references_damage_type") && constraints.containsKey("ck_skill_object_references_source_shape"), "NEW_CONSTRAINT_MISSING");
        require(constraints.get("fk_skill_object_references_skill").path("definition").asText().contains("source_owner_skill_key"), "SKILL_OWNER_FK_MISSING");
        require(constraints.get("fk_skill_object_references_damage_type").path("definition").asText().contains("source_owner_damage_type_key"), "DAMAGE_TYPE_OWNER_FK_MISSING");
        require(constraints.get("ck_skill_object_references_source_type").path("definition").asText().contains("DAMAGE_TYPE"), "SOURCE_TYPE_CONSTRAINT_MISMATCH");
        require(now.path("columns").size() == frozen.path("columns").size() + 2, "COLUMN_COUNT_MISMATCH");
        for (int i = 0; i < frozen.path("columns").size(); i++) require(now.path("columns").get(i).equals(frozen.path("columns").get(i)), "OLD_COLUMN_CHANGED");
        for (int i = frozen.path("columns").size(); i < now.path("columns").size(); i++) {
            JsonNode column = now.path("columns").get(i);
            require("s".equals(column.path("generated").asText()) && !column.path("notNull").asBoolean(), "OWNER_COLUMN_NOT_GENERATED_NULLABLE");
        }
    }

    private static ObjectNode baseline(Connection connection) throws Exception {
        ObjectNode baseline = JSON.createObjectNode();
        ArrayNode identity = rows(connection, "SELECT jsonb_build_object('database',current_database(),'user',current_user,'serverAddress',inet_server_addr()::text,'serverPort',inet_server_port(),'serverVersion',current_setting('server_version'))::text");
        require(DATABASE.equals(identity.get(0).path("database").textValue()), "DATABASE_NOT_TEST0221");
        baseline.set("identity", identity.get(0));
        ArrayNode all = rows(connection, ROWS_SQL);
        baseline.set("allDamageTypeRows", all);
        ArrayNode formulas = JSON.createArrayNode();
        for (JsonNode row : all) if (!row.path("calculation_formula").isNull()) formulas.add(row);
        baseline.set("formulaRows", formulas);
        baseline.set("attributes", rows(connection, ATTRS_SQL));
        baseline.set("constraints", rows(connection, CONSTRAINTS_SQL));
        baseline.set("columns", rows(connection, COLUMNS_SQL));
        baseline.set("indexes", rows(connection, INDEXES_SQL));
        ArrayNode old = sorted(rows(connection, REFERENCES_SQL + " WHERE source_type <> 'DAMAGE_TYPE'"));
        baseline.set("oldReferences", old);
        baseline.put("oldReferencesSha256", sha(JSON.writeValueAsBytes(old)));
        baseline.set("newReferencesPresent", sorted(rows(connection, REFERENCES_SQL + " WHERE source_type = 'DAMAGE_TYPE'")));
        ArrayNode related = JSON.createArrayNode();
        for (JsonNode row : old) if (GAME.equals(row.path("game_id").textValue()) && "DAMAGE_TYPE".equals(row.path("target_type").textValue())) related.add(row);
        baseline.set("relatedReferences", related);
        return baseline;
    }

    private static void checkOriginal(ObjectNode baseline) {
        require(baseline.path("formulaRows").size() == 3, "EXPECTED_THREE_FORMULAS");
        require(baseline.path("newReferencesPresent").isEmpty(), "DAMAGE_TYPE_INDEX_ALREADY_PRESENT");
        require(baseline.path("oldReferences").size() == 9900, "EXPECTED_9900_OLD_REFERENCES");
        Set<String> keys = new TreeSet<>();
        for (JsonNode row : baseline.path("formulaRows")) {
            require(GAME.equals(row.path("game_id").textValue()) && "ENABLED".equals(row.path("status").textValue()), "FORMULA_SOURCE_NOT_APPROVED");
            keys.add(row.path("damage_type_key").textValue());
        }
        require(keys.equals(Set.of("magic", "physics", "real")), "FORMULA_KEYS_NOT_APPROVED");
        for (JsonNode column : baseline.path("columns")) require(!column.path("name").asText().startsWith("source_owner_"), "STRUCTURE_ALREADY_MIGRATED");
    }

    /** 离线转换入口，不由正式API调用；只使用原树，不按类型生成模板。 */
    public static JsonNode convert(JsonNode old, Set<String> enabledAttributeKeys) {
        exact(old, Set.copyOf(FIELDS));
        ObjectNode result = JSON.createObjectNode();
        ArrayNode inputs = result.putArray("inputs");
        ArrayNode stages = result.putArray("stages");
        Map<String, String> bindings = new LinkedHashMap<>();
        int[] nodes = {0};
        for (int i = 0; i < FIELDS.size(); i++) {
            stages.addObject().put("key", FIELDS.get(i)).put("name", NAMES.get(i))
                .set("expression", convertNode(old.get(FIELDS.get(i)), i, 1, nodes, bindings, inputs));
        }
        result.put("outputStageKey", FIELDS.get(4));
        var issue = FormulaContractValidator.validate(result, DamageTypeFormulaBindings.allowed(enabledAttributeKeys));
        require(issue == null, "CONVERTED_FORMULA_INVALID" + (issue == null ? "" : "_" + issue.code()));
        return result;
    }

    private static JsonNode convertNode(JsonNode old, int ownerStage, int depth, int[] nodes, Map<String, String> bindings, ArrayNode inputs) {
        require(depth <= 32 && ++nodes[0] <= 256, "LEGACY_FORMULA_LIMIT");
        require(old != null && old.isObject() && old.path("nodeType").isTextual(), "LEGACY_NODE_SHAPE");
        ObjectNode node = JSON.createObjectNode();
        switch (old.path("nodeType").textValue()) {
            case "FIXED" -> {
                exact(old, Set.of("nodeType", "value"));
                require(old.path("value").isNumber(), "LEGACY_FIXED_NOT_NUMERIC");
                node.put("op", "const").put("value", old.path("value").decimalValue().toPlainString());
            }
            case "ATTRIBUTE" -> {
                exact(old, Set.of("nodeType", "attributeOwner", "attributeKey", "attributeValueKind"));
                require(Set.of("SOURCE", "TARGET").contains(old.path("attributeOwner").asText()), "LEGACY_ATTRIBUTE_OWNER");
                require(Set.of("BASE", "BONUS", "TOTAL").contains(old.path("attributeValueKind").asText()), "LEGACY_ATTRIBUTE_KIND");
                require(old.path("attributeKey").isTextual(), "LEGACY_ATTRIBUTE_KEY");
                var binding = JSON.createObjectNode().put("kind", "attribute")
                    .put("object", old.path("attributeOwner").textValue().toLowerCase(java.util.Locale.ROOT))
                    .put("attributeKey", old.path("attributeKey").textValue()).put("valueKind", old.path("attributeValueKind").textValue()).put("view", "current_frame");
                String fingerprint = canonical(binding).toString();
                String input = bindings.get(fingerprint);
                if (input == null) {
                    input = "attribute_" + bindings.size();
                    bindings.put(fingerprint, input);
                    inputs.addObject().put("key", input).set("binding", binding);
                }
                node.put("op", "read").put("inputKey", input);
            }
            case "STAGE_RESULT" -> {
                exact(old, Set.of("nodeType", "stageKey"));
                int target = OLD_STAGES.indexOf(old.path("stageKey").asText());
                require(target >= 0 && target < ownerStage, "LEGACY_STAGE_REFERENCE");
                node.put("op", "ref").put("stageKey", FIELDS.get(target));
            }
            case "OPERATION" -> {
                exact(old, Set.of("nodeType", "operation", "operands"));
                String operation = Map.of("ADD", "add", "SUBTRACT", "sub", "MULTIPLY", "mul", "DIVIDE", "div", "MIN", "min", "MAX", "max").get(old.path("operation").asText());
                require(operation != null && old.path("operands").isArray() && old.path("operands").size() == 2, "LEGACY_OPERATION");
                node.put("op", operation);
                ArrayNode arguments = node.putArray("args");
                for (JsonNode child : old.path("operands")) arguments.add(convertNode(child, ownerStage, depth + 1, nodes, bindings, inputs));
            }
            default -> throw new SafeFailure("LEGACY_NODE_UNKNOWN");
        }
        return node;
    }

    /** 原树与共同树使用独立解释器核对全部五个结果；包含0、负值及比例／固定穿透边界。 */
    public static ObjectNode compareArithmetic(JsonNode old, JsonNode converted) {
        List<String> fingerprints = new ArrayList<>();
        for (JsonNode input : converted.path("inputs")) fingerprints.add(canonical(input.path("binding")).toString());
        List<BigDecimal> boundaries = List.of("0", "-1", "1", "0.25", "1.25", "50", "100", "-50", "-100")
            .stream().map(BigDecimal::new).toList();
        List<Map<String, BigDecimal>> cases = new ArrayList<>();
        Map<String, BigDecimal> zero = new HashMap<>();
        fingerprints.forEach(key -> zero.put(key, BigDecimal.ZERO));
        cases.add(zero);
        if (fingerprints.size() <= 3) arithmeticCases(fingerprints, boundaries, 0, new HashMap<>(), cases);
        else for (String key : fingerprints) for (BigDecimal boundary : boundaries) {
            Map<String, BigDecimal> values = new HashMap<>(zero); values.put(key, boundary); cases.add(values);
        }
        int comparisons = 0;
        double maxDoubleDifference = 0;
        for (Map<String, BigDecimal> values : cases) {
            Map<String, BigDecimal> legacyStages = new LinkedHashMap<>();
            for (int i = 0; i < FIELDS.size(); i++) legacyStages.put(OLD_STAGES.get(i), legacyValue(old.get(FIELDS.get(i)), values, legacyStages));
            Map<String, JsonNode> declarations = new HashMap<>();
            for (JsonNode stage : converted.path("stages")) declarations.put(stage.path("key").textValue(), stage.path("expression"));
            Map<String, BigDecimal> actualInputs = new HashMap<>();
            for (JsonNode input : converted.path("inputs")) actualInputs.put(input.path("key").textValue(), values.get(canonical(input.path("binding")).toString()));
            Map<String, BigDecimal> commonStages = new HashMap<>();
            Map<String, Double> legacyDoubles = new LinkedHashMap<>();
            for (int i = 0; i < FIELDS.size(); i++) legacyDoubles.put(OLD_STAGES.get(i), legacyDouble(old.get(FIELDS.get(i)), values, legacyDoubles));
            Map<String, Double> commonDoubles = new HashMap<>();
            for (int i = 0; i < FIELDS.size(); i++) {
                BigDecimal actual = commonStage(FIELDS.get(i), declarations, actualInputs, commonStages);
                require(actual.compareTo(legacyStages.get(OLD_STAGES.get(i))) == 0, "ARITHMETIC_MISMATCH");
                double before = legacyDoubles.get(OLD_STAGES.get(i));
                double after = commonDoubleStage(FIELDS.get(i), declarations, actualInputs, commonDoubles);
                require(Double.isFinite(before) && Double.isFinite(after), "DOUBLE64_NOT_FINITE");
                double difference = Math.abs(before - after);
                require(difference <= Math.max(1, Math.abs(before)) * 1e-12, "DOUBLE64_ARITHMETIC_MISMATCH");
                maxDoubleDifference = Math.max(maxDoubleDifference, difference);
                comparisons++;
            }
        }
        return JSON.createObjectNode().put("cases", cases.size()).put("stageComparisons", comparisons).put("maxAbsoluteDifference", "0")
            .put("maxDouble64AbsoluteDifference", Double.toString(maxDoubleDifference));
    }

    private static void arithmeticCases(List<String> keys, List<BigDecimal> values, int index, Map<String, BigDecimal> current, List<Map<String, BigDecimal>> result) {
        if (index == keys.size()) { result.add(Map.copyOf(current)); return; }
        for (BigDecimal value : values) { current.put(keys.get(index), value); arithmeticCases(keys, values, index + 1, current, result); }
    }

    private static BigDecimal legacyValue(JsonNode node, Map<String, BigDecimal> values, Map<String, BigDecimal> stages) {
        return switch (node.path("nodeType").textValue()) {
            case "FIXED" -> node.path("value").decimalValue();
            case "STAGE_RESULT" -> stages.get(node.path("stageKey").textValue());
            case "ATTRIBUTE" -> {
                var binding = JSON.createObjectNode().put("kind", "attribute").put("object", node.path("attributeOwner").textValue().toLowerCase(java.util.Locale.ROOT))
                    .put("attributeKey", node.path("attributeKey").textValue()).put("valueKind", node.path("attributeValueKind").textValue()).put("view", "current_frame");
                yield values.get(canonical(binding).toString());
            }
            case "OPERATION" -> {
                BigDecimal left = legacyValue(node.path("operands").get(0), values, stages);
                BigDecimal right = legacyValue(node.path("operands").get(1), values, stages);
                yield switch (node.path("operation").textValue()) {
                    case "ADD" -> left.add(right); case "SUBTRACT" -> left.subtract(right); case "MULTIPLY" -> left.multiply(right);
                    case "DIVIDE" -> left.divide(right, MathContext.DECIMAL128); case "MIN" -> left.min(right); case "MAX" -> left.max(right);
                    default -> throw new SafeFailure("LEGACY_EVALUATION_OPERATION");
                };
            }
            default -> throw new SafeFailure("LEGACY_EVALUATION_NODE");
        };
    }

    private static BigDecimal commonStage(String key, Map<String, JsonNode> declarations, Map<String, BigDecimal> inputs, Map<String, BigDecimal> stages) {
        if (!stages.containsKey(key)) stages.put(key, commonValue(declarations.get(key), declarations, inputs, stages));
        return stages.get(key);
    }

    private static BigDecimal commonValue(JsonNode node, Map<String, JsonNode> declarations, Map<String, BigDecimal> inputs, Map<String, BigDecimal> stages) {
        String operation = node.path("op").textValue();
        if (operation.equals("const")) return new BigDecimal(node.path("value").textValue());
        if (operation.equals("read")) return inputs.get(node.path("inputKey").textValue());
        if (operation.equals("ref")) return commonStage(node.path("stageKey").textValue(), declarations, inputs, stages);
        List<BigDecimal> arguments = new ArrayList<>();
        for (JsonNode argument : node.path("args")) arguments.add(commonValue(argument, declarations, inputs, stages));
        BigDecimal a = arguments.get(0), b = arguments.get(1);
        return switch (operation) {
            case "add" -> a.add(b); case "sub" -> a.subtract(b); case "mul" -> a.multiply(b);
            case "div" -> a.divide(b, MathContext.DECIMAL128); case "min" -> a.min(b); case "max" -> a.max(b);
            default -> throw new SafeFailure("COMMON_EVALUATION_OPERATION");
        };
    }

    private static double legacyDouble(JsonNode node, Map<String, BigDecimal> values, Map<String, Double> stages) {
        String type = node.path("nodeType").textValue();
        if ("FIXED".equals(type)) return node.path("value").decimalValue().doubleValue();
        if ("STAGE_RESULT".equals(type)) return stages.get(node.path("stageKey").textValue());
        if ("ATTRIBUTE".equals(type)) {
            JsonNode binding = JSON.createObjectNode().put("kind", "attribute")
                .put("object", node.path("attributeOwner").textValue().toLowerCase(java.util.Locale.ROOT))
                .put("attributeKey", node.path("attributeKey").textValue()).put("valueKind", node.path("attributeValueKind").textValue()).put("view", "current_frame");
            return values.get(canonical(binding).toString()).doubleValue();
        }
        double left = legacyDouble(node.path("operands").get(0), values, stages);
        double right = legacyDouble(node.path("operands").get(1), values, stages);
        return switch (node.path("operation").textValue()) {
            case "ADD" -> left + right; case "SUBTRACT" -> left - right; case "MULTIPLY" -> left * right;
            case "DIVIDE" -> left / right; case "MIN" -> Math.min(left, right); case "MAX" -> Math.max(left, right);
            default -> throw new SafeFailure("LEGACY_DOUBLE64_OPERATION");
        };
    }

    private static double commonDoubleStage(String key, Map<String, JsonNode> declarations, Map<String, BigDecimal> inputs, Map<String, Double> stages) {
        if (!stages.containsKey(key)) stages.put(key, commonDouble(declarations.get(key), declarations, inputs, stages));
        return stages.get(key);
    }

    private static double commonDouble(JsonNode node, Map<String, JsonNode> declarations, Map<String, BigDecimal> inputs, Map<String, Double> stages) {
        return switch (node.path("op").textValue()) {
            case "const" -> new BigDecimal(node.path("value").textValue()).doubleValue();
            case "read" -> inputs.get(node.path("inputKey").textValue()).doubleValue();
            case "ref" -> commonDoubleStage(node.path("stageKey").textValue(), declarations, inputs, stages);
            default -> {
                double a = commonDouble(node.path("args").get(0), declarations, inputs, stages);
                double b = commonDouble(node.path("args").get(1), declarations, inputs, stages);
                yield switch (node.path("op").textValue()) {
                    case "add" -> a + b; case "sub" -> a - b; case "mul" -> a * b;
                    case "div" -> a / b; case "min" -> Math.min(a, b); case "max" -> Math.max(a, b);
                    default -> throw new SafeFailure("COMMON_DOUBLE64_OPERATION");
                };
            }
        };
    }

    private static ArrayNode newReferences(JsonNode formulas) {
        ArrayNode references = JSON.createArrayNode();
        for (String key : new TreeSet<>(fieldNames(formulas))) {
            JsonNode inputs = formulas.path(key).path("inputs");
            for (int i = 0; i < inputs.size(); i++) references.add(JSON.createObjectNode().put("game_id", GAME)
                .put("source_skill_key", "").put("source_type", "DAMAGE_TYPE").put("source_key", key)
                .put("field_path", "inputs/" + i + "/binding/attributeKey").put("target_type", "ATTRIBUTE")
                .put("target_skill_key", "").put("target_key", inputs.get(i).path("binding").path("attributeKey").textValue()).put("target_sub_key", ""));
        }
        return sorted(references);
    }

    private static ObjectNode readArchive(Path root, Path archive, Map<String, String> options, boolean checkTool) throws Exception {
        byte[] bytes = Files.readAllBytes(archive);
        require(sha(bytes).equals(required(options, "--archive-sha256")), "ARCHIVE_DIGEST_MISMATCH");
        ObjectNode frozen = (ObjectNode) JSON.readTree(bytes);
        require("damage-type-common-formula-transition-v1".equals(frozen.path("format").asText()), "ARCHIVE_FORMAT");
        require(frozen.path("sqlSha256").asText().equals(sha(Files.readAllBytes(root.resolve(SQL_PATH)))), "SQL_CHANGED");
        if (checkTool) {
            require(frozen.path("toolSha256").asText().equals(sha(Files.readAllBytes(root.resolve(TOOL_PATH)))), "TOOL_CHANGED");
            require(frozen.path("validatorClasses").equals(validatorClasses()), "VALIDATOR_CHANGED");
        }
        return frozen;
    }

    private static ObjectNode validatorClasses() throws Exception {
        ObjectNode result = JSON.createObjectNode();
        for (String name : List.of("FormulaContractValidator", "FormulaContractSchema", "DamageTypeFormulaBindings")) {
            try (var stream = FormulaContractValidator.class.getResourceAsStream(name + ".class")) {
                require(stream != null, "VALIDATOR_CLASS_MISSING"); result.put(name, sha(stream.readAllBytes()));
            }
        }
        for (Class<?> nested : FormulaContractValidator.class.getDeclaredClasses()) {
            String name = nested.getName().substring(nested.getPackageName().length() + 1);
            try (var stream = FormulaContractValidator.class.getResourceAsStream(name + ".class")) {
                require(stream != null, "VALIDATOR_CLASS_MISSING"); result.put(name, sha(stream.readAllBytes()));
            }
        }
        return result;
    }

    private static Connection connect(Path root, boolean readOnly) throws Exception {
        Map<?, ?> configuration;
        try (var input = Files.newInputStream(root.resolve("server/data_manage/src/main/resources/application.yml"))) { configuration = new Yaml().load(input); }
        Map<?, ?> datasource = (Map<?, ?>) ((Map<?, ?>) configuration.get("spring")).get("datasource");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", resolve(datasource.get("url")));
        String user = System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", resolve(datasource.get("username")));
        String password = System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", resolve(datasource.get("password")));
        Connection connection = DriverManager.getConnection(url, user, password);
        connection.setReadOnly(readOnly);
        connection.setTransactionIsolation(readOnly ? Connection.TRANSACTION_REPEATABLE_READ : Connection.TRANSACTION_READ_COMMITTED);
        connection.setAutoCommit(false);
        return connection;
    }

    private static String resolve(Object value) {
        String text = String.valueOf(value);
        if (!text.startsWith("${") || !text.endsWith("}")) return text;
        String inner = text.substring(2, text.length() - 1); int split = inner.indexOf(':');
        return System.getenv().getOrDefault(split < 0 ? inner : inner.substring(0, split), split < 0 ? "" : inner.substring(split + 1));
    }

    private static ArrayNode rows(Connection connection, String sql) throws Exception {
        ArrayNode result = JSON.createArrayNode();
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            while (rows.next()) result.add(canonical(JSON.readTree(rows.getString(1))));
        }
        return result;
    }

    private static Set<String> enabled(JsonNode attributes) {
        Set<String> keys = new TreeSet<>();
        for (JsonNode row : attributes) if ("ENABLED".equals(row.path("status").asText())) keys.add(row.path("attribute_key").textValue());
        return keys;
    }

    private static ArrayNode sorted(ArrayNode rows) {
        List<JsonNode> ordered = new ArrayList<>(); rows.forEach(row -> ordered.add(canonical(row)));
        ordered.sort(java.util.Comparator.comparing(JsonNode::toString));
        ArrayNode result = JSON.createArrayNode(); ordered.forEach(result::add); return result;
    }

    private static JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            ObjectNode value = JSON.createObjectNode();
            for (String field : new TreeSet<>(fieldNames(node))) value.set(field, canonical(node.get(field)));
            return value;
        }
        if (node.isArray()) { ArrayNode value = JSON.createArrayNode(); node.forEach(child -> value.add(canonical(child))); return value; }
        return node;
    }

    private static Set<String> fieldNames(JsonNode node) { Set<String> names = new HashSet<>(); node.fieldNames().forEachRemaining(names::add); return names; }
    private static void exact(JsonNode node, Set<String> names) { require(node != null && node.isObject() && fieldNames(node).equals(names), "LEGACY_FIELDS"); }
    private static String rowId(JsonNode row) { return row.path("game_id").textValue() + "/" + row.path("damage_type_key").textValue(); }
    private static Map<String, JsonNode> rowIndex(JsonNode rows) { Map<String, JsonNode> result = new HashMap<>(); rows.forEach(row -> result.put(rowId(row), row)); return result; }
    private static Map<String, String> options(String[] args) { require((args.length - 2) % 2 == 0, "ARGUMENT_PAIRS"); Map<String, String> result = new HashMap<>(); for (int i = 2; i < args.length; i += 2) require(result.put(args[i], args[i + 1]) == null, "DUPLICATE_ARGUMENT"); return result; }
    private static String required(Map<String, String> options, String name) { require(options.containsKey(name), "ARGUMENT_REQUIRED"); return options.get(name); }
    private static void require(boolean ok, String code) { if (!ok) throw new SafeFailure(code); }
    private static String sha(byte[] bytes) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch (Exception error) { throw new SafeFailure("DIGEST_FAILURE"); } }
    private static void emit(JsonNode value) { System.out.println(value); }
    private static ObjectNode summary(ObjectNode evidence, String mode) { return JSON.createObjectNode().put("ok", true).put("mode", mode).put("database", DATABASE).put("formulaRows", evidence.path("formulaRows").size()).put("oldReferenceRows", evidence.path("oldReferenceRows").asInt()).put("totalReferenceRows", evidence.path("totalReferenceRows").asInt()).put("oldReferencesSha256", evidence.path("oldReferencesSha256").textValue()); }
    private static final class SafeFailure extends RuntimeException { private final String code; SafeFailure(String code) { this.code = code; } }
}
