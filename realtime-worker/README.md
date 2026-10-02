# Class Realtime API

`class` IRS 的獨立即時協調服務。Cloudflare Worker 負責建房與安全邊界，每間教室由一個 Durable Object 管理 WebSocket、短暫訊號交換及 P2P 失敗時的 Relay。

## 資料原則

- 不使用 D1 保存姓名、答案、聊天、題目或畫板。
- Durable Object 只保存房間期限、容量與教師 owner token 的雜湊。
- 教室到期後由 alarm 關閉 WebSocket 並刪除暫態資料。
- 第一階段 Relay 只接受 8 KiB 以下的白名單 JSON 訊息。

## 本機執行

```bash
npm install
npm test
npm run dev
```

允許的本機前端來源為 `http://localhost:4177`，Worker 預設在 `http://localhost:8790`。

## API

- `GET /health`
- `POST /api/rooms`
- `GET /api/rooms/:roomId`
- `GET /api/rooms/:roomId/connect?role=teacher|student&clientId=...`（WebSocket upgrade）

教師 WebSocket 必須要求 subprotocol：`classroom.v1` 與 `owner.<ownerToken>`。學生使用 `classroom.v1`；短效 join／fallback ticket 會在公開服務防護階段加入。

## 部署

```bash
npm run deploy
```

正式部署前必須完成改善計畫 P00 的 Cloudflare 帳戶額度確認，並在公開啟用前完成 Turnstile、join token 與壓測。
