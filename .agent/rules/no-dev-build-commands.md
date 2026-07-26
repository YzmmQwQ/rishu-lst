---
trigger: always_on
---

# 禁止执行开发/构建命令

**严格禁止**自行执行以下命令（包括但不限于）：

- `npm run dev` / `npm dev`
- `npm run build` / `npm run build --workspaces`
- `npm start` / `npm run start`
- `npm run preview` / `npm run preview -w packages/client`
- 以及任何等效的 `yarn …` 变体

## 正确做法

当需要启动开发服务器或执行构建时，**告诉用户需要运行的命令**，由用户自行在终端中执行。

```
// ✅ 正确 — 提示用户执行
"请在终端中运行 `npm run dev` 启动开发服务器。"

// ❌ 错误 — 自行执行
Shell: npm run dev
```

## 允许的操作

以下命令**可以**正常执行，不受此规则限制：

- `npm install` / `npm install <pkg>` — 安装依赖
- `npx …` — 执行工具命令（如 `npx prisma migrate`）
- `npm run lint` / `npm run typecheck` — 代码检查
- `npx shadcn@latest add …` — 添加 shadcn 组件
