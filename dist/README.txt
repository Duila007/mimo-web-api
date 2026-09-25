编译产物说明（单文件版）
========================

mimo-web-api.mjs 是把整个服务打包后的单文件构建（零依赖，Node.js ≥ 18 直接运行）。

运行方式（二选一）：

1. 完整目录运行（推荐）
   保持本目录在项目根目录下（与 .env、package.json 同级的上一级），在项目根目录执行：
       node dist/mimo-web-api.mjs
   .env 与 data/ 目录会按项目根目录解析。

2. 单文件部署
   把 mimo-web-api.mjs 放到任意目录的子文件夹里（例如 /opt/app/dist/），
   并把 .env 放在它的上一级目录（/opt/app/.env），然后：
       node /opt/app/dist/mimo-web-api.mjs

环境变量也可完全替代 .env（Docker / pm2 场景直接注入即可）。

注意：
- .env 与 data/ 含账号凭证，不要提交到代码仓库
- 改了 src/ 源码后需要重新构建才会更新本文件
