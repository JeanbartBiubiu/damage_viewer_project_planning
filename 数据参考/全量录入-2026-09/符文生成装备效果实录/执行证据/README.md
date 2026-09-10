# 四件符文衍生装备执行准备

本目录只保存四件符文衍生装备补录的执行器和独立核对器。候选、请求计划、独立数学报告和神奇之鞋迁移意图均按字节散列固定；准备阶段只做本地读取与结构校验，不调用业务接口、数据库、浏览器或 Git。

## 固定输入与计划

执行器读取：

- ../rune-equipment-ownership-luna-candidate/修订一/完整候选.json
- ../rune-equipment-ownership-luna-candidate/修订一/写前请求计划.json
- ../rune-equipment-ownership-luna-candidate/修订一/独立数学报告.json
- ../rune-equipment-ownership-luna-candidate/神奇之鞋迁移意图.json
- ../rune-equipment-ownership-root-20260910/当前保护快照.json
- ../rune-equipment-ownership-root-20260910/补充查重与分类.json
- ../rune-equipment-ownership-root-20260910/旧鞋效果真实引用只读核对.json
- ../rune-equipment-ownership-v3-cursor-review-run-20260910/Cursor来源复核结论.md

脚本启动时重新计算上述输入的字节散列，并拒绝漂移。72 项主保护之外，补充查重与分类快照固定 6 个只读结果，其中旧效果代表图必须是 200 且 image 为 null；四个新技能查重必须是 404。当前冻结的业务计划为 30 个写请求：25 个 POST、4 个 PUT、1 个 DELETE。技能、参数、公式、效果、装备技能关系和技能代表图都从候选及计划派生，计划正文的请求体必须与候选逐字节等价。后端创建接口正常成功码为 201，执行器同时接受兼容的 200；更新接受 200；唯一删除只接受 204。空的 204 响应按无正文处理。

## 先做离线检查

使用固定运行时：

~~~powershell
$node = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/受保护执行器.mjs' --validate-only
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/独立GET核对.mjs' --validate-only
~~~

两条命令都应输出 STATIC_VALIDATION_PASS、businessApiCalls: 0 和 businessWrites: 0。独立核对器在离线模式不会创建网络日志，也不会导入执行器；它会独立检查候选计数、计划方法数量、候选请求体、有限数值、整数毫秒、等级值、公式引用、二元运算、真实属性和乘区字典，以及运行输入没有默认值。

如果只需要服务上的只读预检，可以由根负责人之后运行：

~~~powershell
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/受保护执行器.mjs' --preflight
~~~

该模式固定只发 GET，把结果放在 只读预检/时间/。它应报告新对象缺失或逐字段一致，核对 72 项旧保护和唯一删除的删前门槛；首次零写入时不会把新鞋缺失误报成删前失败。只读预检不改变业务数据。

## 根负责人执行与续跑

业务服务固定使用 http://127.0.0.1:8080/api/admin/games/lol。根负责人确认服务、输入和审计结果后，才可显式执行：

~~~powershell
$env:RUNE_EQUIPMENT_OWNERSHIP_CONFIRM = 'CONFIRM_RUNE_EQUIPMENT_OWNERSHIP_30_WRITES'
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/受保护执行器.mjs' --execute --acknowledge-unique-delete
~~~

执行器要求单独的 实际写入锁.json，用独占创建方式建立 实际写入/时间/，每次意图、请求日志、状态和锁状态均逐次落盘。请求日志和意图文件只写脱敏请求体、响应摘要、散列和状态，不写 Authorization、令牌、Cookie 或其他凭据。写请求前先查重，已有对象只有在候选字段逐项一致时才跳过；缺失对象才写入，冲突、未知网络结果、非预期状态码或写后详情不一致立即停止。

失败后只使用原实际写入目录续跑：

~~~powershell
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/受保护执行器.mjs' --execute --resume 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/实际写入/时间' --acknowledge-unique-delete
~~~

续跑必须同时通过目录锁和全局锁。已有未确定意图绝不重放写请求；若写请求已经可能发出，脚本只能用写后 GET 恢复确定状态。唯一旧效果已经 404 时只核对详情 404、旧效果列表为空和旧代表图 404，标记为已完成并禁止再次 DELETE。旧效果仍为 200 时，删除前再次核对新鞋技能、参数、效果，旧技能全部 19 个参数、2 个公式、旧效果列表及详情、旧过程、内部状态、触发规则、代表图为空和静态无引用证据。删除返回 409 或其他非 204 时停止，绝不删除依赖或绕过保护。旧效果删除后只允许四条装备技能关系由空变成各自唯一的计划关系；一旦新鞋关系已经挂载，脚本没有恢复旧效果的路径。

装备关系的比较口径固定为响应对象的 items 与 total：必须有完整列表且 total === items.length，不能有 hasNext 或未取完的页。每条关系的游戏字段 gameId、equipmentKey、skillKey、sortOrder 必须精确匹配；若服务返回 createdAt 或 updatedAt，只接受可解析的时间字符串。旧快照中的 19 个原参数、2 个原公式、3 条符文关系以及其他装备主体、属性和图片逐项保持；计划内变化仅有四条新装备关系、旧鞋效果详情和旧鞋效果代表图的删除后状态。

## 执行后独立只读核对

根负责人完成并看到 实际写入/时间/执行结果.json 为 COMPLETED 后，使用只读核对器：

~~~powershell
& $node 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/独立GET核对.mjs' --run 'C:/project/damage_web_dev/.agents/artifacts/rune-equipment-ownership-execution/实际写入/时间'
~~~

它只使用 GET，重新固定输入散列，复核 72 项最终保护、补充快照中的旧效果代表图删除后 404、新四件装备技能及其子对象、代表图、关系核心字段，以及旧效果的 404 门槛；输出 独立GET核对/时间/GET复核报告.json 和 最终GET快照.json。该报告是实时接口只读证据，不替代候选数学报告，也不把接口保存结果表述为运行时或浏览器验证。

实际执行、服务重启和最终业务验收由根负责人安排。本目录的脚本默认不会触发上述业务副作用。
