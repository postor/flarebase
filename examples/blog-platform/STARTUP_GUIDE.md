# Blog Platform 启动指南

## 快速启动

### 完整开发环境（推荐）
```bash
cd examples/blog-platform
npm run dev
```

这会同时启动：
- **Blog Platform** (http://localhost:3002) - 蓝色标签
- **Flarebase Server** (http://localhost:3000) - 绿色标签
- **Auth Hook Service** - 黄色标签

### 其他启动选项

**仅前端 + Flarebase**（不含auth hook）
```bash
npm run dev:minimal
```

**仅前端**
```bash
npm run dev:blog
```

**仅Flarebase**
```bash
npm run dev:flarebase
```

**仅Auth Hook**
```bash
npm run dev:auth-hook
```

## 生产环境构建

```bash
npm run build
npm run start
```

## 服务架构

```
┌─────────────────────────────────────┐
│    npm run dev (并发启动3个服务)      │
└─────────────────────────────────────┘
            │
            ├─── Blog Platform (3002)
            │    └── Next.js Frontend
            │
            ├─── Flarebase Server (3000)
            │    └── Rust Backend
            │
            └─── Auth Hook Service
                 └── Node.js Handler
```

## 端口说明

| 服务 | 端口 | 用途 |
|------|------|------|
| Blog Platform | 3002 | Web界面 |
| Flarebase Server | 3000 | API & WebSocket |
| Auth Hook | - | 内部通信 |

## 故障排除

### 端口冲突
如果端口被占用，修改以下配置：
- Blog: `next dev -p 3003`
- Flarebase: 环境变量 `HTTP_ADDR=0.0.0.0:3001`

### Auth Hook未响应
```bash
# 单独测试
npm run dev:auth-hook
```

### Flarebase编译慢
首次运行需要编译Rust代码，请耐心等待。

## 开发工作流

1. **启动开发环境**
   ```bash
   npm run dev
   ```

2. **访问应用**
   - 打开 http://localhost:3002
   - 注册新账号
   - 登录并创建文章

3. **停止所有服务**
   - 按 `Ctrl + C`

## 依赖要求

- Node.js 18+
- Rust/Cargo (用于Flarebase)
- npm 或 yarn

## 首次运行

```bash
# 安装依赖
npm install

# 启动所有服务
npm run dev
```

## 相关文档

- [完整README](./README.md)
- [JWT使用指南](./JWT_SWR_USAGE.md)
- [测试设置](./TEST_SETUP.md)
