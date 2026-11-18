# 维护身份与提交契约

本目录定义公共查看与私有维护共用一个后端时的跨端约束，供本轮实现使用。方案入口为[单后端方案](../../文档记录/概要设计/项目/公共查看与AI维护单后端方案.md)。具体请求类型以实现和测试为准；共享变化由主负责人统一更新本页。

## 计算票据第 2 版

保留现行头 `alg=Ed25519`、`typ=dv-wasm-grant+jwt`、受信 `kid`。正文共同字段为 `iss=damage-viewer`、`aud=damage-viewer-wasm`、`sub`（主体 UUID）、`subjectType`、`scope=[engine:compute]`、整数秒 `iat/nbf/exp`、`authorizationVersion=2`、UUID `jti`。`nbf=iat`。

- 玩家 `subjectType=PLAYER`，额外精确包含 `canLogin=1`，`exp=iat+86400`。
- 维护 `subjectType=MAINTENANCE`，不含 `canLogin`，`0 < exp-iat <= 1800`，签发端保证不晚于维护会话截止。
- 未知字段、错误类别、跨类别字段、错误版本、签名和期限拒绝。只接受第 2 版。
- 编译和运行绑定 `subjectType:小写UUID`；同 UUID 的不同类别不能共用编译会话。数值运行规则保持。

## 维护会话

私有接口前缀 `/internal/maintenance`，公网全部拒绝。宿主使用 `X-Damage-Maintenance-Token` 建立会话，长期凭据不交给页面。

| 方法与路径 | 输入或结果 |
| --- | --- |
| `POST /sessions` | 宿主私有凭据认证，空 JSON 请求；返回维护身份并设置独立会话和防伪 Cookie |
| `GET /me` | 返回 `{principalId, displayName, expiresAt}` |
| `POST /logout` | 撤销当前会话，清理维护 Cookie |
| `POST /wasm-grant` | 有效维护会话及防伪；返回 `{grant, expiresAt}` |
| `POST /games/{gameId}/simulation-preview` | 有效维护会话及防伪；接收 `{selection, updates:[{skillKey, request}]}`，返回按候选配置重建的完整场景快照，不持久化 |

维护 Cookie 名称固定 `__Host-damage-maint-session`（只限 HTTP 的安全 Cookie）和 `__Host-damage-maint-csrf`（页面可读），路径 `/`，不设置共享域。状态变更携带 `Origin`、`X-Damage-Client: web` 和 `X-CSRF-Token`。会话 30 分钟固定到期，撤销和凭据版本复核须在真实写事务中继续成立。

候选预检支持已有技能的聚合新增、修改及任务明确授权的组成删除，`request` 沿现行技能 `PATCH` 类型并携带当前 `baseDigest`，不接受技能主体新建或删除。一次一致性只读事务核对基线并用现有装配器重新计算执行闭包、引用和目录；未进入本场景的覆盖项拒绝。它不调用写入守卫或持久化方法，不需要正式批次窗口；后续业务保存仍须独立验证回执及已打开的匹配批次。

普通玩家会话响应移除 `canEdit`，不因此取得维护身份。维护客户端通过 `X-Damage-Maintenance-Batch` 携带已验证批次编号；无批次不能保存生产配置。私有页面可以编辑草稿和导出候选请求，正式保存只提交与批次完全匹配的请求。

## 公网接口清单与提交批次

后端维护唯一的方法与路由分类清单并导出部署配置，新增未分类业务路由检查失败。公网保留读取、现有账号流程、只读快照 POST 和访问上报，不将全部 `/api/admin/**` 或所有 GET 直接开放。

批次至少绑定主体、游戏、问题或任务编号、证据修订、配置与依赖基线、冻结请求序列、候选及验证档案摘要。验证回执由独立执行者签发，后端验证受信来源、有效期与内容身份；调用者不能自报通过。每一配置写入必须匹配当前批次下一项冻结请求，且处于对应游戏维护窗口。恢复先读回逐项事实，不盲重放。

### 批次接口及回执

以下路径相对 `/internal/maintenance`。`GET /games/{gameId}/baseline` 返回 `{gameId, baselineDigest}`，摘要来自现行完整游戏配置（含图片内容身份），排除更新时间及维护/账号数据。读事务保证一致，正式提交先取游戏锁再核对。

`POST /batches` 接受 `{batchId, gameId, reference, sourceRevision, baselineDigest, candidateDigest, operations, receipt}`。编号为 UUID；摘要为小写 SHA-256。`operations` 是有序的 `{method, path, bodySha256}` 数组，1～100 项，方法仅 POST/PUT/PATCH/DELETE，路径必须为该游戏下的实际配置写路由。`bodySha256` 对实际发送的 UTF-8 请求正文字节计算；空正文按空字节计算，不能解析后随意重排。`candidateDigest` 是冻结候选完整内容摘要，`operationsDigest` 为后端与工具使用同一规范化 JSON（递归排序键、数组保序）对 `operations` 计算的摘要；其中字段均为字符串，因此没有数值表示歧义。

`receipt` 为 `{payload, signature}`，两者均无填充 base64url；payload 为 UTF-8 JSON 原始字节，signature 为受信 Ed25519 对这些字节的签名。payload 精确字段为 `{version, batchId, principalId, gameId, reference, sourceRevision, baselineDigest, candidateDigest, operationsDigest, evidenceDigest, engineDigest, adapterVersion, issuedAt, expiresAt, outcome}`；`version=maintenance-validation-v1`、`outcome=PASSED`，`issuedAt/expiresAt` 为整数秒，期限正且不超过 3600 秒。其余身份均与冻结批次一致。后端只配置验证公钥，配置写入客户端不得取得私钥。

`GET /batches/{batchId}` 返回 `{batchId, gameId, state, nextOperation, operationCount, currentDigest}`。新批次状态 `PREPARED`；私有运维部署凭据 `X-Damage-Deployment-Token` 调用 `POST /batches/{batchId}/open` 后为 `OPEN`，每个游戏只能有一个 OPEN 批次；此凭据与维护凭据和账号开通凭据分离。open 的空 JSON 请求只在公网实际维护并排空相关请求后执行。配置请求携带 `X-Damage-Maintenance-Batch`，真实事务锁定维护主体、批次和游戏，匹配下一项方法/路径/原始正文摘要并复核当前基线。业务写入、维护审计、nextOperation 和 currentDigest 同事务提交；失败回滚，未知结果先 GET 批次及独立配置回读，不重放。

批次提交摘要包含最终引用索引。业务动作返回后，先由游戏配置守卫在同一事务内完成最终校验和引用同步，再计算摘要及记录提交事实；普通提交前复核仍保留。最终校验、引用同步或维护审计任一步失败，业务、索引和批次进度全部回滚。

全部操作完成后 `POST /batches/{batchId}/complete` 仅部署凭据可调用，将状态改为 `COMPLETE` 并解除游戏批次占用；部署者只有在正式证明交接和私有验收完成后才能 complete、恢复公网。失败保持 OPEN，可查询已提交事实，不自动解除。维护会话和验证回执在每次正式写入继续复核期限与身份，过期须重新验证形成新回执，不允许调大过期时间沿用旧签名。所有批次内部接口公网拒绝。

重新独立验证后，可由有效维护会话调用 `POST /batches/{batchId}/renew`，正文直接为新回执 envelope；批次身份、冻结请求、候选及引擎身份必须与原回执相同，后端重新核对当前配置基线，不能借续签改变候选。需要恢复部分已提交变更时，先以当前现场为基线准备并独立验证一个新恢复批次，再由部署凭据调用 `POST /batches/{batchId}/recover/{recoveryId}`（空JSON），原 OPEN 批次变为 `FAILED`、新恢复批次在同一事务变为 OPEN；公网窗口始终保持。恢复也逐笔调用相同管理接口，不提供直接SQL或无回执解锁入口。

`POST /revoke` 使用宿主长期维护凭据撤销主体并提升版本，所有短期会话失效；重新启用或轮换要求私密配置提供更高的凭据版本。维护会话 /me、/logout、/wasm-grant 形状沿用上节。
