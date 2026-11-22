# 维护身份与提交契约

本目录定义公共查看与私有维护共用一个后端时的跨端约束。结构和职责见[单后端方案](../../文档记录/概要设计/项目/公共查看与AI维护单后端方案.md)。

## 计算票据第 2 版

保留现行头 `alg=Ed25519`、`typ=dv-wasm-grant+jwt`、受信 `kid`。正文共同字段为 `iss=damage-viewer`、`aud=damage-viewer-wasm`、`sub`（主体 UUID）、`subjectType`、`scope=[engine:compute]`、整数秒 `iat/nbf/exp`、`authorizationVersion=2`、UUID `jti`。`nbf=iat`。

- 玩家 `subjectType=PLAYER`，额外精确包含 `canLogin=1`，`exp=iat+86400`。
- 维护 `subjectType=MAINTENANCE`，`sub` 为私有入口登记的维护主体，正文省略 `canLogin`，`0 < exp-iat <= 1800`。
- 未知字段、错误类别、跨类别字段、错误版本、签名和期限拒绝。只接受第 2 版。
- 编译和运行绑定 `subjectType:小写UUID`；同 UUID 的不同类别不能共用编译会话。数值运行规则保持。

## 私有维护入口

私有接口前缀为 `/internal/maintenance`。公网默认拒绝该前缀与所有游戏配置写入。私有 Nginx 通过受权限限制的本机套接字连接同一后端的私有连接器。浏览器和命令行经受控入口使用后端配置的固定维护主体。部署窗口和账号开通继续各自使用独立凭据。

| 方法与路径 | 输入或结果 |
| --- | --- |
| `GET /me` | 返回已启用主体的 `{principalId, displayName}` |
| `POST /wasm-grant` | 空 JSON 请求；返回 `{grant, expiresAt}` |
| `POST /games/{gameId}/simulation-preview` | 接收 `{selection, updates:[{skillKey, request}]}`，在只读事务返回按候选配置重建的完整场景快照 |

私有入口从后端实际连接器派生。浏览器私有接口请求的 `Sec-Fetch-Site` 须为 `same-origin`，附带的 `Origin` 须精确匹配。浏览器非读取请求及命令行的请求须携带允许的 `Origin` 和 `X-Damage-Client: web`。窗口内私有回读遵守相同来源约束。后端事务核对固定维护主体已登记且启用。取票和编辑流程省略应用登录、会话及 Cookie。

候选预检支持已有技能的聚合新增、修改及任务明确授权的组成删除，`request` 沿现行技能 `PATCH` 类型并携带当前 `baseDigest`，不接受技能主体新建或删除。一次一致性只读事务核对基线并用现有装配器重新计算执行闭包、引用和目录；本场装配需要的只读定义更新可投影，完全无关的更新拒绝。它不调用写入守卫或持久化方法，不需要正式批次窗口；后续业务保存仍须独立验证回执及已打开的匹配批次。

普通和预检响应都明确提供[执行闭包技能列表](../simulation/README.md)，并将它纳入快照摘要。维护候选分别核对完整投影和执行覆盖：开发候选使用预检列表，自动候选使用普通快照列表，只对本场投影项累计覆盖；全批每项变更至少一场覆盖。必要只读定义不因此获得执行覆盖，静态可达也不替代独立运行和有效断言。签发前后继续重新读取真实服务核对完整快照。

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

全部操作完成后 `POST /batches/{batchId}/complete` 仅部署凭据可调用，将状态改为 `COMPLETE` 并解除游戏批次占用。部署者在正式证明交接和私有验收完成后完成批次并恢复公网。失败保持 OPEN，可查询已提交事实。每次正式写入复核维护主体和验证回执，回执到期须重新验证并签发。所有批次内部接口公网拒绝。

重新独立验证后，由私有入口调用 `POST /batches/{batchId}/renew`，正文直接为新回执。后端核对当前配置基线、批次身份、冻结请求、候选及引擎身份。需要恢复部分已提交变更时，先以当前现场为基线准备并独立验证一个新恢复批次，再由部署凭据调用 `POST /batches/{batchId}/recover/{recoveryId}`（空 JSON）。原 OPEN 批次变为 `FAILED`、新恢复批次在同一事务变为 OPEN，公网窗口继续保持。恢复逐笔调用同一管理接口。

撤回私有入口权限或停用维护主体会拒绝新的编辑和取票请求。已签发的维护票据可用于计算至自身到期。
