# Relay load test

先啟動本機 Worker，再執行：

```bash
npm run dev
npm run load:relay -- 60
```

腳本會建立一間短效教室，為每位模擬學生取得 HMAC ticket，開啟 Relay WebSocket，同時送出一題答案並等待教師 ACK。輸出包含加入數、唯一答案數、ACK 數與 round-trip p50／p95／max。

這是單機、低網路延遲的協定與尖峰路徑測試，不等於真實教室容量證明。正式容量仍須測試 Cloudflare 正式 Worker、不同裝置、校園 Wi‑Fi、行動網路，以及 30 DIRECT＋30 RELAY 混合情境。
