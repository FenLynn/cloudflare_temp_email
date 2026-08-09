# Sci Dashboard 邮件通知桥

## 目的

邮箱完整管理页继续由 `https://mail.660415.xyz/admin` 提供。Dashboard 顶部只按需读取最新邮件摘要，不复制管理员密码，不保存邮件原文，也不替代完整管理页。

## 数据链路

1. Dashboard 请求 `sci-worker` 的 `GET /api/mail/notifications`。
2. `sci-worker` 通过 `TEMP_EMAIL` Service Binding 调用具名 RPC EntryPoint。
3. 邮箱 Worker 的 `DashboardMailEntrypoint.getNotifications()` 从 D1 读取最近邮件。
4. RPC 返回发件人、收件地址、主题、摘要、时间、验证码和复杂邮件标记。
5. Dashboard 显示摘要；附件或复杂邮件仍进入完整管理页处理。

## 安全边界

- Service Binding 是 Cloudflare 账户内授予 `sci-worker` 的能力，不保存或传递邮箱管理员密码。
- 具名 RPC EntryPoint 没有供浏览器直接调用的公开 URL。
- 响应不包含原始 MIME、完整 HTML 或附件内容。
- Dashboard 不接触邮箱管理员密码；完整管理页认证仍只留在邮箱域名下。
- 兼容用的 `/admin/notifications` 仍沿用原管理员认证，并禁止缓存。

## 维护位置

- Worker 摘要接口：`worker/src/admin_api/admin_mail_api.ts`
- Worker 路由：`worker/src/admin_api/index.ts`
- 内部 RPC EntryPoint：`worker/src/worker.ts`
- 前端桥接：`frontend/src/utils/dashboard-mail-bridge.js`
- 管理页挂载：`frontend/src/views/Admin.vue`

浏览器桥接仅作为兼容通道保留；Dashboard 主链路不再依赖它。

## 故障处理

- RPC 不可用：检查 `sci-worker` 的 `TEMP_EMAIL` Service Binding 是否指向 `cloudflare_temp_email` 的 `DashboardMailEntrypoint`。
- 邮件读取超时：通知面板不会影响完整邮箱，直接进入完整邮箱继续操作。

## 验证

```powershell
cd frontend
corepack pnpm test
corepack pnpm build:pages

cd ..\worker
corepack pnpm lint
```

不要在本地执行 Wrangler 部署；部署仅通过仓库既有 GitHub 流程完成。
