# 图片接口脚本盘点与草案

## 盘点结果

- 输入清单：`英雄技能全量页面输入/图片待上传清单.json`，共 1026 项。
- 用途分布：角色代表图片 171 项，技能图标 855 项。
- 本地准备结果：171 张角色图已按页面规则居中裁剪并缩放为 64×64；855 张技能图原本就是 64×64，直接复用。
- 输出目录：`prepared/`；索引：`prepared-manifest.json`。
- 输出最大文件 11944 字节，全部小于 262144 字节；输出尺寸全部为 64×64。

## 脚本行为

`upload-images.cjs` 默认只读取源文件、准备本地图片并生成索引。`--sample` 只进行只读接口抽样；只有显式传入 `--execute` 才会进入串行业务写入路径。可用 `--limit=正整数` 限制执行数量，并生成 `execute-summary.json`。

图片标识按 `entry_16171_<targetKey>` 生成，并在脚本中检查长度。写入路径设计为先读代表图关系，再读图片标识；已有代表图关系必须含 `imageKey` 与 `enabled` 后才保留，未关联时才允许后续创建图片、关联代表图并独立回读。图片标识 GET 的明确 404 才表示可创建，其他错误仍阻断。POST 后会独立 GET 并核对标识、归属名称及可取得的内容 sha256；已有同标识图片也执行同样核对。PUT 后回读要求代表图 `image.imageKey` 等于预期值。所有请求带超时，逐项结果写入日志，日志只保留摘要、哈希、大小和目标，不记录完整 base64。脚本未安装依赖，优先使用当前环境的 `sharp`，否则从已存在的捆绑运行时加载。

## 只读抽样证据

执行了：

```text
<捆绑 Node.js> upload-images.cjs --sample
```

结果：

- `GET /characters/champion_aatrox/representative-image` 返回 `{ "image": null }`。
- `GET /skills/aatrox_q/representative-image` 返回当前关系 `{ "image": null }`。
- `GET /images/entry_16171_champion_aatrox` 返回图片不存在（404）。
- 本次没有执行 `POST /images` 或 `PUT /characters|skills/{key}/representative-image`。

## 接口与缓存边界

上述接口回读的是服务端持久化图片元数据及角色、技能代表图关系；本地 `prepared/` 与 `prepared-manifest.json` 只是待上传文件证据。浏览器页面的图片缓存或索引缓存属于另一层，不能替代服务端接口回读，也不能据此声称业务数据已经保存。

## 待放行事项

首 6 项已获授权并完成实际串行上传：`champion_aatrox`、`aatrox_p`、`aatrox_q`、`aatrox_w`、`aatrox_e`、`aatrox_r`，执行汇总为 6 成功、0 失败、0 跳过。每项均在 POST 后独立 GET 校验了完整 dataURL 内容哈希、尺寸、大小和启用状态，关联后再次 GET 且代表图标识匹配。独立回读证据保存在 `first-six-independent-get.json`。

随后已获授权执行全量 1026 项串行上传：新增图片并关联 994 项，复用既有代表图关系 32 项，失败 0 项。独立全量关系 GET 已检查 1026 项：当前稳定图片标识 1000 项、既有关系保留 26 项、禁用 0 项、失败 0 项。既有 26 项保留其原始图片标识；本次没有用源文件哈希替换既有图片内容。

全量关系回读证据保存在 `full-relation-verification.json`，执行汇总保存在 `execute-summary.json`。
