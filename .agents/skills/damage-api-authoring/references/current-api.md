# 现行入口与变更核对

核对基准日期：2026-10-17。下列路径用于定位真源，不替代当前请求类型；工作树位置以根规则为准。

| 对象 | 前端契约真源，相对 `C:/project/damage_web_dev/web/` | 后端真源，相对 `C:/project/damage_backend_dev/server/data_manage/src/main/java/xyz/game/datamanage/` |
| --- | --- | --- |
| 技能完整配置 | `src/services/skillConfigurationClient.ts`、`src/types/skillConfiguration.ts`；各组成的类型与表单转换 | `controller/adminapi/skill/SkillConfigurationAdminController.java`、`model/skillconfiguration/SkillConfigurationSaveRequest.java`、`service/skillconfiguration/SkillConfigurationService.java` |
| 角色、等级属性与技能关系 | `src/services/characterClient.ts`、`skillRelationClient.ts`及对应类型 | `controller/adminapi/character/`、`controller/adminapi/skillrelation/CharacterSkillRelationAdminController.java`及`model/character/` |
| 装备、直接属性与技能关系 | `src/services/equipmentClient.ts`、`skillRelationClient.ts`及对应类型 | `controller/adminapi/equipment/`、`controller/adminapi/skillrelation/EquipmentSkillRelationAdminController.java`及`model/equipment/` |
| 构筑系统与选项 | `src/services/buildClient.ts`及`src/types/build.ts` | `controller/adminapi/build/`与实际服务；按当前映射定位 |
| 计算可用目录 | `src/services/simulationAvailabilityClient.ts`及`src/types/simulationAvailability.ts` | `controller/adminapi/simulation/SimulationAvailabilityAdminController.java`、`service/simulation/availability/` |

读取技能聚合使用`GET /api/admin/games/{gameId}/skills/{skillKey}/configuration`。修改已有技能使用同一路径的`PATCH`，顶层为`baseDigest`、可选的`skill`、`changes`；每项变化为`objectType / operation / key / value`。当前采用批次只更新触发规则：`objectType=TRIGGER_RULE`、`operation=UPDATE`，`value`须符合更新请求类型，不带规则标识、所属对象和时间戳等只读字段。完整规则的未变动作、条件、保护配置仍保留。

新建技能的同路由`POST`要求完整主体且不允许基线摘要，不能将更新请求改方法后直接复用。当前配套脚本不执行新建或删除。角色、属性、关系及构筑各有自己的保护与返回形状，先读对应客户端与后端，不能套用技能的摘要协议。

以下入口均以`/api/admin/games/{gameId}`为前缀，当前请求不接受`baseDigest`。更新前比较完整基线，更新后独立读取；这些入口不能使用触发规则脚本。

| 对象 | 当前读取与写入 | 请求边界 |
| --- | --- | --- |
| 角色主体 | `GET /characters/{characterKey}`；集合`POST`新建，单项`PUT`修改 | 新建含`characterKey / name / description`，修改仅`name / description` |
| 角色等级属性 | `GET /characters/{characterKey}/attributes`；同路径`PUT` | `{levelValues}`完整替换等级属性图；保留所有原属性和等级，不能只提交本次变化单元 |
| 装备主体 | `GET /equipment/{equipmentKey}`；集合`POST`新建，单项`PUT`修改 | 新建含`equipmentKey / name / description`，修改仅`name / description` |
| 装备属性 | `GET /equipment/{equipmentKey}/attributes`；同路径`PUT` | `{attributeValues}`完整替换属性图；未提交原属性不会自动保留 |
| 角色、装备技能关系 | `GET /character-skill-relations?characterKey=...`或`/equipment-skill-relations?equipmentKey=...`；集合`POST`挂载，单项`PUT /{所属对象键}/{skillKey}`调序 | 挂载提供所属对象键、`skillKey / sortOrder`；修改仅`{sortOrder}`，不能改为另一条关系 |

构筑完整读取为`GET /build-systems/{systemKey}/definition`；系统、分组、选项和技能授予分别沿当前控制器写入，完整读取不是整套保存入口。本技能不自动删除任何对象或关系；数据删除继续按任务授权与引用保护处理。

认证沿现有管理接口；不得修改鉴权或借用他人的令牌。当前本地开发文档允许任意非空测试值，仅在确认当前服务仍为该模式时使用；不得把这个约定带到其他环境。

遇到字段、枚举、数组结构或协议变化时，依次核对控制器与请求类型、聚合准备和事务校验、前端保存转换、完整回读形状，以及运行适配中的实际消费者。更新本说明和脚本的输入校验，并至少复查正常保存、摘要漂移及结果不明回读三个场景。旧冻结请求是来源与历史证据，不能无条件直接重放。

项目范围继续以`数据参考/全量录入-2026-09/阶段进度.json`为唯一账本；本次五批为49名英雄。计算可用目录中的证明资源只接收真实验证产物，数据补录脚本不得手工提升可用状态。
