# Class Realtime API

`class` IRS 的獨立即時協調服務。Cloudflare Worker 負責建房與安全邊界，每間教室由一個 Durable Object 管理 WebSocket、短暫訊號交換及 P2P 失敗時的 Relay。

## 資料原則

- 不使用 D1 保存姓名、答案、聊天、題目或畫板。
- Durable Object 只保存房間期限、容量與教師 owner token 的雜湊。
- 教室到期後由 alarm 關閉 WebSocket 並刪除暫態資料。
- 第一階段 Relay 只接受 8 KiB 以下的白名單 JSON 訊息。
- 學生先取得綁定 Room ID 與 client ID 的 90 秒 HMAC ticket，WebSocket 不接受無票加入。
- 教師建立正式房間需通過 Turnstile；本機 `localhost` 開發不呼叫 Turnstile。

## 本機執行

```bash
npm install
npm test
npm run dev
```

允許的本機前端來源為 `http://localhost:4177`，Worker 預設在 `http://localhost:8790`。

## API

- `GET /health`
- `GET /api/config`
- `POST /api/rooms`
- `POST /api/rooms/:roomId/ticket`
- `GET /api/rooms/:roomId`
- `GET /api/rooms/:roomId/connect?role=teacher|student&clientId=...`（WebSocket upgrade）

教師 WebSocket 必須要求 subprotocol：`classroom.v1` 與 `owner.<ownerToken>`。學生使用 `classroom.v1`，並於查詢參數附上短效 ticket。ticket 只允許指定房間與 client ID，過期後 Relay 重連會先換發新票。

## 正式環境安全設定

`wrangler.toml` 預設 `REQUIRE_TURNSTILE=true`。正式服務若缺少 site key、Turnstile secret 或 join ticket secret 會停止建房／加入，不會退化為未保護模式。

1. 建立只允許 `polik18.github.io` 的 managed Turnstile widget。
2. 將公開 site key 寫入 `TURNSTILE_SITE_KEY`。
3. 將兩個 secret 直接寫入 Cloudflare，不要放進 Git：

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put JOIN_TOKEN_SECRET
```

緊急停止新教室時，把 `ALLOW_NEW_ROOMS` 改為 `false` 後部署；已建立的教室仍可運作到原定期限。

## 部署

```bash
npm run deploy
```

正式部署前仍須完成改善計畫的 60 人壓測。未通過前，前端只可使用 `?transport=hybrid` 隱藏開關，不得改成預設或宣稱正式容量。
