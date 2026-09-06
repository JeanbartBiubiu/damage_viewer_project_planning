# 稳定流程的接口实录

用户于 2026-09-07 授权已验证页面流程改用后端接口。以下脚本固定指向本地 `127.0.0.1:8080` 的 `lol`，使用公开占位值 `local-entry`；不读取真实凭据，不访问生产环境，不执行 SQL。它们是本批固定资料的执行脚本，不接受任意目标环境或任意数据导入。

统一标准以[数据录入标准流程](../../../文档记录/详细设计/项目/角色技能数据录入标准流程.md)为准。接口完整前缀为 `http://127.0.0.1:8080/api/admin/games/lol`，请求头为 `Authorization: Bearer local-entry`；这仅是本地占位约定。执行前核对对应输入与已录范围。

本机系统的 Node.js 版本较旧，以下 PowerShell 起步命令明确使用已存在的捆绑运行时；不安装依赖、不改全局 PATH：

```powershell
Set-Location 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/API实录'
$entryNode = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $entryNode --version
```

应显示 `v24.19.0`。下面表格中 `node` 均替换为 `& $entryNode` 后执行：

| 内容 | 命令 | 核对产物 |
| --- | --- | --- |
| 134 件效果装备基本资料与直接属性 | `node 装备/record.mjs item_3107 --all --apply` | `装备/summary.json`、逐件 JSON、主负责人独立核对 |
| 浏览器批次交回的 7 名英雄补录 | `node 英雄补录/record.mjs --all --apply` | `英雄补录/summary-all.json`，仅处理固定 7 名 |
| 171 名英雄全部明确属性只读核对 | `node 英雄全量核对/audit.mjs` | `英雄全量核对/汇总.json`、逐名 JSON；不改业务数据 |
| 855 项技能基本资料及角色关联 | `node 技能/record-skills.mjs --apply` | `技能/records/`、执行日志和最后一次执行汇总 |
| 1026 个英雄与技能图片用途 | `node 图片/upload-images.cjs --execute` | `图片/execute-summary.json`、`full-relation-verification.json` |
| 134 件效果装备图片 | `node 装备图片/record.mjs --all --apply` | `装备图片/汇总.json`、`代表图关系最终核对.json` |
| 汇总已核对进度 | `node 更新阶段进度.mjs` | `../阶段进度.json`、`../英雄/录入进度.jsonl`；只更新记录 |

装备、英雄补录及装备图片脚本没有 `--apply` 会拒绝写入；技能脚本不带该参数仅查询和生成计划。英雄与技能图片脚本以 `--execute` 显式执行，不带它只准备本地文件；首次验证可追加 `--limit=6`。图片处理依赖脚本会从上述捆绑目录加载，无需使用系统 Node。首次验证少量对象，再扩大到完整固定批次。

图片查重先 GET `/{characters或skills或equipment}/{key}/representative-image`，已有且启用的关系保留原图键；没有关系再 GET `/images/{计划图片键}`。仅明确 404 才可尝试创建，POST 后独立 GET 内容核对，再 PUT 代表图关系并回读；名称冲突须读取同名图片核对内容后复用。已有关系的原图键不因本次源清单生成了新键而改变，停用或内容不符项留待核对。完成后按 SOP 到左侧“图片管理”同步，检查“同步完成”提示及列表缩略图；接口回读和浏览器缓存验收分别记账。

角色等级图和装备属性均为整个集合替换，因此先取现值再补缺。已有明确值冲突时保留证据并停当前项，不覆盖其他属性；技能基本资料优先保留既有已编写对象。超时或中断不代表未保存，重跑前先按稳定键查询，核对后补缺。

逐名与逐件文件是保存及独立回读证据；生成时间不同的汇总只代表对应批次。浏览器输入证据、接口回读和战斗运行不是同一种证据。本轮完整技能机制和装备效果仍有待录项，符文管理入口尚未建立，不能用主体数量代替完整数据完成率。
