# 部署指南

## 前置条件（二选一）

- **Docker 方式（推荐）**：服务器已安装 Docker 与 Docker Compose
  - 国内服务器可用一键脚本：`curl -fsSL https://get.docker.com | bash`，或使用宝塔面板的 Docker 管理
- **裸 Node 方式**：服务器已安装 Node.js ≥ 18（`node -v` 检查）

## 方式一：Docker 部署（推荐）

### 1. 上传项目目录

把本地 `mimo-web-api/` 整个目录传到服务器，例如放到 `/opt/mimo-web-api`：

```bash
# 在本地 Git Bash 执行（改成你的服务器地址）
scp -r "mimo-web-api" root@你的服务器IP:/opt/mimo-web-api
```

也可以用宝塔面板 / WinSCP 等图形工具上传。

### 2. 准备 .env

在服务器上项目目录里创建 `.env`（可从本地复制一份再改）：

```bash
cd /opt/mimo-web-api
cp .env.example .env
vi .env   # 或用宝塔文件编辑器
```

必须检查的三项：

```ini
# 访问密钥：务必改成强随机串（本地测试用的密钥不要带上服务器）
API_KEY=sk-改成一串随机字符

# AT/RT 账号（passToken 在小米账号域下长期有效，会话过期自动换发）
MIMO_ACCOUNTS=[{"userId":"你的userId","passToken":"你的passToken"}]

# 面板/接口端口（默认 8000）
PORT=8000
```

> passToken 获取：浏览器登录 aistudio.xiaomimimo.com → F12 → 应用 → Cookie →
> `https://account.xiaomi.com` → 复制 `passToken` 的值。
> 也可以部署后直接在面板「添加账号」里用手机号/密码登录，自动获取。

### 3. 启动

```bash
cd /opt/mimo-web-api
docker compose up -d --build
docker compose logs -f        # 看启动日志，Ctrl+C 退出（不影响运行）
```

### 4. 验证

```bash
curl http://127.0.0.1:8000/ping
curl -H "Authorization: Bearer 你的API_KEY" http://127.0.0.1:8000/session/check
```

浏览器打开 `http://服务器IP:8000/panel` → 输入 API_KEY → 查看「账号池」是否健康。

### 5. 云服务器安全组 / 防火墙

放行 TCP 8000 端口（阿里云/腾讯云在控制台"安全组"里加规则；有防火墙的执行
`firewall-cmd --add-port=8000/tcp --permanent && firewall-cmd --reload` 或 ufw 对应命令）。

### 6. 更新版本

本地改完代码后重新上传整个目录（或只传变化的 src 文件），然后在服务器执行：

```bash
cd /opt/mimo-web-api
docker compose up -d --build
```

`data/` 目录（会话缓存、统计、面板账号）已通过 compose 卷挂载，重建容器不会丢失。

## 方式二：裸 Node 部署（不装 Docker）

```bash
cd /opt/mimo-web-api
# .env 准备同上
node -v                    # 确保 >= 18
npm start                  # 前台试跑
```

确认能跑之后用 pm2 常驻：

```bash
npm i -g pm2
pm2 start src/server.js --name mimo-web-api
pm2 save && pm2 startup    # 开机自启
```

更新代码后：`pm2 restart mimo-web-api`。

## 安全建议（公网部署必读）

1. **API_KEY 一定要改强**：它同时是 API 和管理面板的登录凭证。
2. **不要裸奔 8000 端口**：配合 Nginx 反代 + HTTPS，或安全组只放行自己的 IP。
3. **passToken 等同账号长期登录凭证**：`.env` 与 `data/` 目录权限收紧（`chmod 600 .env`）。
4. 面板地址 `/panel` 用完后不放心可暂时关闭（安全组封 8000，仅本机访问）。

## Nginx 反代示例（可选，配域名 + HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name api.你的域名.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;              # 流式响应必需
        proxy_read_timeout 300s;
    }
}
```

客户端 base_url 填 `https://api.你的域名.com/v1`。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 401 会话无效 | AT/RT 模式会自动换发重试；仍 401 说明 passToken 失效（改过密码/退出登录），重新获取或在面板重新登录 |
| 面板打不开 | 安全组未放行 8000，或容器没起来（`docker compose logs -f` 查看） |
| 短信验证码收不到/滑块异常 | 换个网络环境重试；面板内滑块为小米官方风控，属正常环节 |
| 想强制刷新会话 | 面板「全部立即换发」按钮，或 `curl -X POST -H "Authorization: Bearer KEY" .../session/refresh` |
