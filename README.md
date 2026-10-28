# 每日复盘｜部署源码包

手机优先的"每日复盘 / 时空隧道"页面。复盘记录保存到你自己 Cloudflare 账号的 KV 存储：本机留有副本，换设备输入同一访问令牌即可继续，清除浏览器数据不会丢失云端记录。

## 本地预览

需要 Node.js 20 或更新版本。

```bash
npm install
npm run dev
```

本地接口使用 `.dev.vars` 中的 `REVIEW_TOKEN`（默认 `local-dev-token`）校验，在页面右侧"云端访问令牌"输入同一令牌即可连接。本地数据仅写入 `.wrangler/state`，不会上传。

注意：本地预览同样需要先完成下面第 2 步（创建 KV 命名空间并把 id 填入 `wrangler.jsonc`），否则无法启动。

## 首次部署

1. 登录 Cloudflare 账号：

   ```bash
   npx wrangler login
   ```

2. 创建 KV 命名空间，把命令输出中的 `id` 粘贴到 `wrangler.jsonc` 中 `kv_namespaces[0].id` 的占位处：

   ```bash
   npx wrangler kv namespace create REVIEW_KV
   ```

3. 设置云端访问令牌（自定一串足够长的随机字母数字；之后在页面里输入同一令牌即可连接）：

   ```bash
   npx wrangler secret put REVIEW_TOKEN
   ```

4. 部署：

   ```bash
   npm run deploy
   ```

成功后 Wrangler 会显示线上地址。打开页面，在"云端访问令牌"中输入第 3 步设置的令牌，即可开始记录。

## 数据说明

- 保存时先写入本机副本，再同步到 Cloudflare KV；云端不可达时照常离线记录，联网后自动补传。
- 多设备按"每条记录最后写入优先"合并，同一卡片保留较新的版本；同一天可以保存多张独立卡片。旧记录会自动获得稳定标识，继续保留。
- 所有 `/api` 请求必须携带访问令牌；数据经 HTTPS 传输，但在 Cloudflare 侧不做加密存储，请勿记录密码等敏感内容。
- 未手写总结时由本地演示规则生成，不调用 AI 服务。

## 同一天记录多张卡片

保存一张复盘后，点击「＋ 再记一张」填写新的内容。使用「当天卡片」切换和修改已有卡片；时空隧道会分别展示所有卡片，日期筛选会显示当天的全部记录。新建或切换时，未保存的内容会先提示确认。

