# 英雄与技能图片接口实录

## 盘点结果

- 输入清单：`英雄技能全量页面输入/图片待上传清单.json`，共 1026 项。
- 用途分布：角色代表图片 171 项，技能图标 855 项。
- 本地准备结果：171 张角色图已按页面规则居中裁剪并缩放为 64×64；855 张技能图原本就是 64×64，直接复用。
- 输出目录：`prepared/`；索引：`prepared-manifest.json`。
- 输出最大文件 11944 字节，全部小于 262144 字节；输出尺寸全部为 64×64。

## 脚本行为

`upload-images.cjs` 默认只读取源文件、准备本地图片并生成索引。`--sample` 只进行只读接口抽样；只有显式传入 `--execute` 才会进入串行业务写入路径。可用 `--limit=正整数` 限制执行数量，并生成 `execute-summary.json`。

图片标识按 `entry_16171_<targetKey>` 生成，并在脚本中检查长度。写入路径先读代表图关系，再读图片标识；已有代表图关系必须含 `imageKey` 与 `enabled` 后才保留，未关联时才创建图片并关联。图片标识 GET 的明确 404 才表示可创建，其他错误阻断。POST 后独立 GET，强制核对内容校验值、大小、尺寸、启用状态及图片归属；已有同标识图片也执行同样核对。PUT 后回读要求代表图 `image.imageKey` 等于预期值。所有请求带超时，逐项结果写入日志，日志只保留摘要、校验值、大小和目标，不记录完整 base64。图片处理库从已存在的捆绑运行时加载，未安装依赖。

## 只读抽样证据

执行了：

```powershell
$entryNode = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$entryScript = 'C:/project/damage_viewer_project_planning/数据参考/全量录入-2026-09/API实录/图片/upload-images.cjs'
& $entryNode $entryScript --sample
```

结果：

- `GET /characters/champion_aatrox/representative-image` 返回 `{ "image": null }`。
- `GET /skills/aatrox_q/representative-image` 返回当前关系 `{ "image": null }`。
- `GET /images/entry_16171_champion_aatrox` 返回图片不存在（404）。
- 当时的只读抽样没有执行 POST 或 PUT；下节记录之后的实际全量写入。

## 接口与缓存边界

上述接口回读的是服务端持久化图片元数据及角色、技能代表图关系；本地 `prepared/` 与 `prepared-manifest.json` 只是待上传文件证据。浏览器页面的图片缓存或索引缓存属于另一层，不能替代服务端接口回读，也不能据此声称业务数据已经保存。

## 实际写入与最终核对

首 6 项已获授权并完成实际串行上传：`champion_aatrox`、`aatrox_p`、`aatrox_q`、`aatrox_w`、`aatrox_e`、`aatrox_r`，执行汇总为 6 成功、0 失败、0 跳过。每项均在 POST 后独立 GET 校验了完整 dataURL 内容哈希、尺寸、大小和启用状态，关联后再次 GET 且代表图标识匹配。独立回读证据保存在 `first-six-independent-get.json`。

随后已获授权执行全量 1026 项串行上传：新增图片并关联 994 项，复用既有代表图关系 32 项，失败 0 项。独立全量关系 GET 已检查 1026 项：当前稳定图片标识 1000 项、既有关系保留 26 项、禁用 0 项、失败 0 项。既有 26 项保留其原始图片标识；本次没有用源文件哈希替换既有图片内容。

实际全量命令为 `& $entryNode $entryScript --execute`。全量关系回读证据保存在 `full-relation-verification.json`，执行汇总保存在 `execute-summary.json`。累计新增 1000 张图片并建立关系，保留本轮前的 26 条关系；“994 新增、32 复用”只是最后一次执行的计数，包含首批 6 条已写入关系的复用。

浏览器同步及列表验收另见[页面验收记录](../页面验收-2026-09-07.md)，不能用接口核对替代。
