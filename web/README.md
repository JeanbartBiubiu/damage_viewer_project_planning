# Damage Viewer Web

基于当前仓库里的接口契约和后端控制器，先搭出来的一版基础 Web 骨架。

## 这版已经包含

- `Vite + React + TypeScript` 的最小项目结构
- 对齐现有 Public 接口的总览页和工作台
- 按 `前端/图片资源IndexDB缓存方案.md` 落的 IndexDB 图片缓存页
- 预留 Admin 后台入口，并接上后端已存在的 `formula / coefficient / status` 只读快照

## 目录

- `src/App.tsx`：整体外壳、全局路由壳、API 基址和当前 gameId
- `src/pages/OverviewPage.tsx`：接口总览与当前游戏快照
- `src/pages/WorkspacePage.tsx`：当前版本和 Bundle 预览
- `src/pages/ImagesPage.tsx`：IndexDB 图片缓存与同步
- `src/pages/AdminPage.tsx`：Admin JWT、接口矩阵和后台只读快照

## 启动

```bash
npm install
npm run dev
```

默认会请求 `http://localhost:8080`，也可以在页面顶部手动切换 API 基址。
