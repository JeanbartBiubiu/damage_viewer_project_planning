package xyz.game.datamanage.support.maintenance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import xyz.game.datamanage.support.account.AccountRequestPath;
import xyz.game.datamanage.support.account.AccountStore;
import xyz.game.datamanage.support.authoring.GameConfigurationWriteGuard;

@Component
public class MaintenanceBatches {
    public static final String BODY=MaintenanceBatches.class.getName()+".body";
    private final AccountStore store;
    private final ObjectMapper json;
    private final MaintenanceBaseline baseline;
    private final MaintenanceReceiptVerifier receipts;
    private final MaintenancePrincipals principals;
    private final GameConfigurationWriteGuard configurations;
    public MaintenanceBatches(AccountStore store,ObjectMapper json,MaintenanceBaseline baseline,MaintenanceReceiptVerifier receipts,MaintenancePrincipals principals,GameConfigurationWriteGuard configurations) {
        this.store=store;this.json=json;this.baseline=baseline;this.receipts=receipts;this.principals=principals;this.configurations=configurations;
    }
    public Object create(MaintenancePrincipal principal,JsonNode request) {
        MaintenanceJson.fields(request,"batchId","gameId","reference","sourceRevision","baselineDigest","candidateDigest","operations","receipt");
        UUID id=MaintenanceReceiptVerifier.uuid(request,"batchId");String game=MaintenanceJson.text(request,"gameId",64);MaintenanceBaseline.game(game);
        String reference=MaintenanceJson.text(request,"reference",256),revision=MaintenanceJson.text(request,"sourceRevision",256);
        MaintenanceJson.digest(request,"baselineDigest");MaintenanceJson.digest(request,"candidateDigest");
        JsonNode operations=request.path("operations");
        if(!operations.isArray() || operations.isEmpty() || operations.size()>100) throw MaintenanceJson.invalid();
        for(JsonNode operation:operations) {
            MaintenanceJson.fields(operation,"method","path","bodySha256");
            String method=MaintenanceJson.text(operation,"method",6),path=MaintenanceJson.text(operation,"path",1024);
            MaintenanceJson.digest(operation,"bodySha256");
            if(!java.util.Set.of("POST","PUT","PATCH","DELETE").contains(method) || !safeWrite(game,method,path)) throw MaintenanceJson.invalid();
        }
        return store.tx(()-> {
            principals.lock(principal);JsonNode proof=receipts.verify(request.path("receipt"),store.now());
            for(String field:java.util.List.of("batchId","gameId","reference","sourceRevision","baselineDigest","candidateDigest"))
                if(!request.path(field).equals(proof.path(field))) throw MaintenanceJson.denied();
            if(!principal.principalId().toString().equals(proof.path("principalId").asText()) || !MaintenanceJson.hash(json,operations).equals(proof.path("operationsDigest").asText())) throw MaintenanceJson.denied();
            baseline.lock(game);if(!baseline.digest(game).equals(request.path("baselineDigest").textValue())) throw MaintenanceJson.conflict();
            store.jdbc().update("INSERT INTO auth.maintenance_batches(id,principal_id,game_id,reference,source_revision,baseline_digest,candidate_digest,current_digest,operations,receipt,state,next_operation) VALUES (?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,'PREPARED',0)",
                id,principal.principalId(),game,reference,revision,request.path("baselineDigest").textValue(),request.path("candidateDigest").textValue(),request.path("baselineDigest").textValue(),operations.toString(),request.path("receipt").toString());
            return view(id,principal);
        });
    }
    public Object view(UUID id,MaintenancePrincipal principal) {
        Map<String,Object> row=store.first("SELECT * FROM auth.maintenance_batches WHERE id=?",(r,n)-> {
            if(principal!=null && !principal.principalId().equals(r.getObject("principal_id",UUID.class))) throw MaintenanceJson.denied();
            return Map.<String,Object>of("batchId",id,"gameId",r.getString("game_id"),"state",r.getString("state"),"nextOperation",r.getInt("next_operation"),"operationCount",parse(r.getString("operations")).size(),"currentDigest",r.getString("current_digest"));
        },id);if(row==null) throw MaintenanceJson.conflict();return row;
    }
    public Object open(UUID id) {
        return store.tx(()-> {
            Batch prepared = batch(id, false);
            principals.lock(prepared.principal());
            baseline.lock(prepared.gameId());
            Batch row = batch(id, true);
            if (!row.principal().equals(prepared.principal())) throw MaintenanceJson.denied();
            if (!row.gameId().equals(prepared.gameId()) || !row.state().equals("PREPARED")
                || !baseline.digest(row.gameId()).equals(row.currentDigest())) throw MaintenanceJson.conflict();
            if(gameMaintained(row.gameId())) throw MaintenanceJson.conflict();
            receipts.verify(row.receipt(),store.now());
            store.jdbc().update("UPDATE auth.maintenance_batches SET state='OPEN',updated_at=clock_timestamp() WHERE id=?",id);
            return view(id,null);
        });
    }
    public Object complete(UUID id) {
        return store.tx(()-> {
            baseline.lock(batch(id,false).gameId());Batch row=batch(id,true);
            if(!row.state().equals("OPEN") || row.index()!=row.operations().size() || !baseline.digest(row.gameId()).equals(row.currentDigest())) throw MaintenanceJson.conflict();
            store.jdbc().update("UPDATE auth.maintenance_batches SET state='COMPLETE',updated_at=clock_timestamp() WHERE id=?",id);
            return view(id,null);
        });
    }
    public Object renew(UUID id,MaintenancePrincipal principal,JsonNode envelope) {
        return store.tx(()-> {
            principals.lock(principal);baseline.lock(batch(id,false).gameId());Batch row=batch(id,true);
            if(!row.principal().equals(principal.principalId()) || row.state().equals("COMPLETE") || row.state().equals("FAILED")) throw MaintenanceJson.denied();
            JsonNode old=MaintenanceJson.parse(json,java.util.Base64.getUrlDecoder().decode(row.receipt().path("payload").asText()));
            JsonNode renewed=receipts.verify(envelope,store.now());
            for(String field:java.util.List.of("version","batchId","principalId","gameId","reference","sourceRevision","baselineDigest","candidateDigest","operationsDigest","engineDigest","adapterVersion","outcome"))
                if(!old.path(field).equals(renewed.path(field))) throw MaintenanceJson.denied();
            if(!baseline.digest(row.gameId()).equals(row.currentDigest())) throw MaintenanceJson.conflict();
            store.jdbc().update("UPDATE auth.maintenance_batches SET receipt=?::jsonb,updated_at=clock_timestamp() WHERE id=?",envelope.toString(),id);
            return view(id,principal);
        });
    }
    /** 仅将失败窗口交给已经独立验证的恢复批次，不先解除公网维护。 */
    public Object recover(UUID id,UUID recoveryId) {
        return store.tx(()-> {
            if (id.equals(recoveryId)) throw MaintenanceJson.conflict();
            String gameId = batch(id, false).gameId();
            Batch prepared = batch(recoveryId, false);
            if (!gameId.equals(prepared.gameId())) throw MaintenanceJson.conflict();
            principals.lock(prepared.principal());
            baseline.lock(gameId);
            Batch original = batch(id, true), replacement = batch(recoveryId, true);
            if (!replacement.principal().equals(prepared.principal())) throw MaintenanceJson.denied();
            if (!gameId.equals(original.gameId()) || !gameId.equals(replacement.gameId())
                || !original.state().equals("OPEN") || !replacement.state().equals("PREPARED")
                || !original.currentDigest().equals(replacement.currentDigest())
                || !baseline.digest(original.gameId()).equals(replacement.currentDigest())) throw MaintenanceJson.conflict();
            receipts.verify(replacement.receipt(),store.now());
            store.jdbc().update("UPDATE auth.maintenance_batches SET state='FAILED',updated_at=clock_timestamp() WHERE id=?",id);
            store.jdbc().update("UPDATE auth.maintenance_batches SET state='OPEN',updated_at=clock_timestamp() WHERE id=?",recoveryId);
            return view(recoveryId,null);
        });
    }
    public boolean gameMaintained(String game) {
        return Boolean.TRUE.equals(store.first("SELECT true FROM auth.maintenance_batches WHERE game_id=? AND state='OPEN'",(r,n)->r.getBoolean(1),game));
    }
    public Object execute(MaintenancePrincipal principal,HttpServletRequest request,java.util.function.Supplier<Object> action) {
        return store.tx(()-> {
            principals.lock(principal);String raw=request.getHeader("X-Damage-Maintenance-Batch");UUID id;
            try {id=UUID.fromString(raw);if(!id.toString().equals(raw)) throw MaintenanceJson.invalid();} catch(IllegalArgumentException|NullPointerException e){throw MaintenanceJson.denied();}
            baseline.lock(batch(id,false).gameId());Batch row=batch(id,true);
            if(!row.principal().equals(principal.principalId()) || !row.state().equals("OPEN") || row.index()>=row.operations().size()) throw MaintenanceJson.conflict();
            receipts.verify(row.receipt(),store.now());
            JsonNode operation=row.operations().get(row.index());String path=AccountRequestPath.path(request);
            if(!operation.path("method").asText().equals(request.getMethod()) || !operation.path("path").asText().equals(path)
                || !operation.path("bodySha256").asText().equals(MaintenanceJson.sha(body(request))) || !baseline.digest(row.gameId()).equals(row.currentDigest())) throw MaintenanceJson.conflict();
            Object result=action.get();
            // 引用索引属于游戏业务基线，须先完成同事务最终态同步，再记录提交摘要。
            configurations.validatePending();
            String after=baseline.digest(row.gameId());
            store.jdbc().update("INSERT INTO auth.maintenance_commits(batch_id,operation_index,principal_id,method,path,body_sha256,before_digest,after_digest) VALUES (?,?,?,?,?,?,?,?)",id,row.index(),principal.principalId(),request.getMethod(),path,operation.path("bodySha256").asText(),row.currentDigest(),after);
            store.jdbc().update("UPDATE auth.maintenance_batches SET next_operation=next_operation+1,current_digest=?,updated_at=clock_timestamp() WHERE id=?",after,id);
            return result;
        });
    }
    private boolean safeWrite(String game,String method,String path) {
        if(!path.startsWith("/api/admin/games/"+game+"/") && !path.equals("/api/admin/games/"+game)) return false;
        if(path.indexOf('%')>=0 || path.indexOf(';')>=0 || path.contains("//") || path.indexOf('?')>=0 || path.contains("..")) return false;
        return xyz.game.datamanage.support.auth.ApiAccessCatalog.access(method,path).equals("MAINTENANCE");
    }
    private static byte[] body(HttpServletRequest request) {
        if(!(request.getAttribute(BODY) instanceof byte[] bytes)) throw MaintenanceJson.denied();return bytes;
    }
    private record Batch(UUID principal,String gameId,String state,int index,String currentDigest,JsonNode operations,JsonNode receipt) {}
    private Batch batch(UUID id,boolean lock) {
        Batch row=store.first("SELECT * FROM auth.maintenance_batches WHERE id=?"+(lock?" FOR UPDATE":""),(r,n)->new Batch(r.getObject("principal_id",UUID.class),r.getString("game_id"),r.getString("state"),r.getInt("next_operation"),r.getString("current_digest"),parse(r.getString("operations")),parse(r.getString("receipt"))),id);
        if(row==null) throw MaintenanceJson.conflict();return row;
    }
    private JsonNode parse(String value) {return MaintenanceJson.parse(json,value.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
}
