# IRS 即時問答混合連線改善計畫

- 文件狀態：執行中 v2
- 日期：2026-10-02
- 適用頁面：`pro.html` 的 IRS 即時問答
- 本計畫範圍：連線、容量、可靠性、本機保存、公開服務防護
- 不在本輪直接實作：既有 UI 大改、D1 保存學生答案、影音經雲端中繼

## 0. 目前實作進度（2026-10-02）

- 已完成 P01～P03 核心：共同協定、原生 DataChannel、Durable Object 訊號／Relay、P2P 成功後關閉學生 WebSocket、直連失敗自動備援。
- 已完成 P04 核心：question ID、答案 ACK／同 message ID 重送、IndexedDB 原子去重、題目／學生／答案保存、教師重新整理後接回同一房間、CSV／JSON 匯出與單一教室本機清除；教師控制訊息的持久化 outbox 仍列為後續強化。
- 已完成 P05 的 owner token、Origin、8 KiB 白名單、連線速率、60 人上限、Turnstile 建房驗證程式、90 秒 HMAC join ticket 與緊急停止新房開關；尚未完成匿名用量警戒與正式壓測。
- 已用瀏覽器自動測試驗證 DIRECT、強制 RELAY、第一次 ACK 遺失重送去重、IndexedDB 實際落地、無 ticket WebSocket 被拒絕，以及教師重整後同房恢復並繼續第二題。
- 混合模式目前仍由 `?transport=hybrid` 隱藏開關啟用；60 人驗收前維持 legacy 預設。

## 1. 決策摘要

IRS 改採「P2P 優先、Cloudflare 協助配對、失敗或超量才中繼、教師電腦保存資料」的混合架構。

初期產品規格：

- 每間教室公開支援 60 人，硬上限先設 60。
- 教師端最多維持 30 條 WebRTC DataChannel；此值需依壓測調整。
- P2P 失敗、逾時或超過直連上限的學生，自動切換 Cloudflare WebSocket 中繼。
- P2P 建立後，學生關閉訊號 WebSocket；正常出題、作答與心跳皆不經後端。
- 教師只保留一條可休眠的控制 WebSocket，讓失敗學生能即時啟用備援。
- 60 人驗收後再進行 100 人壓測；通過前不宣稱支援 100 人。
- 題目、名單、答案與問答歷史保存在教師瀏覽器的 IndexedDB。
- D1 不保存逐筆答案、聊天室內容、姓名或畫板軌跡。
- 螢幕分享仍使用 WebRTC；沒有雲端影音中繼備援。
- 新即時服務獨立部署為 `class-realtime-api`，不混入 Vote 或站點統計 Worker。

## 2. 現況與問題

目前 IRS 由 PeerJS／WebRTC 提供點對點連線：

- 教師和每位學生各建立一條連線，教師端形成星狀拓撲。
- `new Peer(...)` 未指定自有 PeerServer，會依賴公共 PeerJS 訊號服務。
- 「校內模式」只更換 ICE server 組合，仍不是真正由教師電腦提供區網服務。
- 校外模式加入公共 TURN，容量、穩定性與服務延續性不可控制。
- 教師端以迴圈逐一廣播題目、聊天、畫板及計分狀態；人數增加時，教師 CPU、記憶體與上傳流量同步增加。
- 問答歷史主要存在 JavaScript 記憶體，重新整理或分頁崩潰可能遺失。
- 目前的「校外建議 10 台」與 README 的「30～50 人」定義不一致，缺少實測容量證據。

因此，改善不能只把答案改寫進資料庫。真正需要解決的是：訊號服務不可控、P2P 失敗沒有可靠備援、教師端連線無上限、本機狀態不可恢復，以及公開服務可能遭濫用。

## 3. 目標與非目標

### 3.1 目標

1. 同 Wi-Fi 或網路條件良好時，答題資料直接傳到教師電腦。
2. P2P 被學校防火牆阻擋時，學生仍可自動改走 WebSocket 完成基本問答。
3. 教師端直連數達上限後，新學生仍能透過雲端中繼加入。
4. 後端只做短暫協調與傳輸，不把免費資料庫當即時訊息佇列。
5. 教師重新整理後可恢復已確認的名單、題目與作答歷史。
6. 公開服務具有教室期限、人數、訊息大小、速率與建立房間限制。
7. 第一階段通過 60 人同時作答，第二階段才挑戰 100 人。

### 3.2 非目標

- 不建立學生永久帳號或雲端學習歷程。
- 不把聊天、姓名與答案寫入 D1 作長期保存。
- 不承諾透過免費後端向 60～100 台裝置中繼教師螢幕影音。
- 不採用學生裝置作為其他學生的中繼節點；學生離線、休眠或換網路會造成連鎖中斷。
- 不在容量尚未實測前對外宣稱 100 人或 300 人。

## 4. 目標架構

```text
                         ┌─────────────────────────┐
                         │ Cloudflare Worker       │
                         │ 建房、驗證、限流、Token │
                         └───────────┬─────────────┘
                                     │
                         ┌───────────▼─────────────┐
                         │ Durable Object／教室    │
                         │ 訊號交換、短暫狀態、    │
                         │ WebSocket 備援與超量中繼│
                         └──────┬───────────┬──────┘
                                │           │
                  WebRTC 配對／ │           │ WebSocket Relay
                  控制 WebSocket│           │
                                │           │
學生（直連組） ── RTCDataChannel ──▶ 教師瀏覽器 ◀── 學生（中繼組）
                                        │
                                        ▼
                              IndexedDB／CSV／JSON

影音與螢幕分享：學生 ◀──── WebRTC P2P ────▶ 教師
```

### 4.1 雲端負責

- 建立短效教室與產生 Room ID。
- 驗證教師建立權限及學生加入權杖。
- 加入時短暫交換 WebRTC offer、answer 與 ICE candidate；直連成功後停止處理該學生的應用資料。
- 管理教室人數、角色、期限及連線模式。
- 只在 P2P 失敗、斷線或直連額滿時轉送小型 JSON 訊息。
- 回報匿名且不含內容的服務健康指標。

### 4.2 教師電腦負責

- 保存學生顯示名稱、目前題目、答案、搶答順序與歷史。
- 驗證每題每位學生只能有一份有效答案。
- 即時計算統計圖、文字雲、已答／未答狀態。
- 對收到的訊息回傳 ACK。
- 自動寫入 IndexedDB，並提供 CSV／JSON 匯出。
- 重新整理後恢復房間與歷史，再向學生同步目前狀態。

### 4.3 資料庫負責

初版不需要 D1 保存 IRS 內容。若日後需要營運統計，只可保存聚合資料，例如：

- 日期
- 建立教室數
- 成功加入數
- P2P 成功率
- 中繼訊息數與總位元組
- 錯誤類型計數

禁止寫入姓名、答案、聊天內容、題目文字、IP 或 Firebase UID。

## 5. 混合傳輸規則

### 5.0 「P2P 正常時不麻煩後端」的邊界

瀏覽器之間首次建立 WebRTC，仍需要一個很短暫的訊號交換管道；否則教師與學生無法交換 offer、answer 及 ICE candidate。這不代表作答資料必須經過後端。

本計畫採冷備援：

1. 學生加入時才連線到 Cloudflare，交換必要訊號並取得 fallback ticket。
2. RTCDataChannel 開啟後，學生關閉訊號 WebSocket。
3. 題目、答案、聊天室及連線健康檢查直接在學生與教師間傳送。
4. 教師端只保留一條可休眠的控制 WebSocket，不為每位直連學生維持後端資料通道。
5. P2P 不可用時，學生才用 fallback ticket 開啟 Relay WebSocket。
6. Relay 穩定一段時間後可在背景重試 P2P；恢復成功才切回 DIRECT。

因此「正常 P2P 階段」後端不會收到題目或答案、不執行資料庫讀寫，也沒有每位學生持續的 WebSocket；後端只承擔最初配對與例外接管。

### 5.1 學生連線狀態機

```text
CONNECTING_CONTROL
        │
        ▼
NEGOTIATING_P2P ── 5～8 秒內成功 ──▶ DIRECT／關閉學生控制 WebSocket
        │                                │
        │ 失敗／教師直連額滿             │ 連線失效
        ▼                                ▼
      RELAY ◀──────────────────── RECONNECTING
        │                                ▲
        └── 冷卻後背景重試 P2P ──────────┘
```

### 5.2 分流政策

- 教師保留一條支援休眠的控制 WebSocket，供訊號交換與 Relay 接管。
- 學生加入時短暫開啟控制 WebSocket，取得短效加入 Token 與 fallback ticket。
- 直連名額未滿時才發起 WebRTC DataChannel 協商。
- P2P 成功後，應用資料改走 DataChannel，學生端控制 WebSocket 隨即關閉。
- 連續遺失三次 P2P ping／ACK、ICE `failed`、`disconnected` 超過 5 秒、DataChannel 關閉，或教師拒絕新直連時，才開啟 RELAY。
- 中繼學生的答案經 Durable Object 送到教師的單一 WebSocket。
- RELAY 至少穩定 60 秒後才能背景重試 P2P；切回前需連續通過健康檢查，避免 DIRECT／RELAY 反覆震盪。
- 教師 UI 顯示總人數、直連、中繼、重連中及離線人數。
- 連線模式切換不得讓學生重複作答或重複加入名單。

### 5.3 功能分級

| 等級 | 功能 | P2P | WebSocket 中繼 |
|---|---|---:|---:|
| 關鍵低流量 | 加入、題目、ABCD、OX、投票、搶答、文字回答、停止作答 | 支援 | 支援 |
| 一般互動 | 聊天、計分同步、名單狀態 | 支援 | 支援並限速 |
| 高頻互動 | 畫板軌跡 | 優先 | 批次、降頻、限制大小 |
| 高流量媒體 | 教師廣播、學生投影、音訊、影片 | 支援 | 不支援 |

當學生使用 RELAY 且嘗試螢幕分享時，介面須明確提示「目前為相容連線模式，螢幕分享需建立 P2P 直連」。

## 6. 訊息協定

所有應用訊息使用共同信封，避免不同傳輸各自發展不相容格式：

```json
{
  "v": 1,
  "type": "answer.submit",
  "roomId": "ABCD-1234",
  "senderId": "random-client-id",
  "messageId": "uuid",
  "questionId": "uuid",
  "sequence": 17,
  "sentAt": 1790899200000,
  "payload": {
    "value": "A"
  }
}
```

必要規則：

- `messageId` 全域唯一，用於重送去重。
- `sequence` 對每位連線者單調遞增，用於偵測漏訊息與亂序。
- `questionId` 不可只用題次，避免教師重整後撞號。
- 教師收到並寫入 IndexedDB 後才回 `message.ack`。
- 學生在 ACK 前保留未確認訊息，採指數退避重送。
- 教師以 `(roomId, questionId, senderId)` 判斷每題唯一答案。
- 搶答名次由教師收到並接受訊息的順序決定；UI 必須說明這是網路到達順序。
- RELAY 與 DIRECT 切換時沿用相同 `senderId`、`messageId` 與 `sequence`。

## 7. 教師端本機保存

### 7.1 IndexedDB 資料模型

- `rooms`：Room ID、教師擁有者 Token、建立時間、到期時間、狀態。
- `students`：房間、匿名 client ID、顯示名稱、性別選項、最後連線時間。
- `questions`：question ID、題型、開始／結束時間、狀態。
- `answers`：question ID、client ID、答案、收到時間、message ID、傳輸模式。
- `outbox`：教師尚未確認送達學生端的控制訊息。

### 7.2 保存時機

- 建立教室後立即保存房間資料。
- 學生加入或離線時更新名單。
- 教師發題與停題時保存題目狀態。
- 每份答案確認後立即寫入，成功後才 ACK。
- 課程結束後提供 CSV、JSON 及「清除本機紀錄」。

### 7.3 復原

- 啟動時檢查未到期房間，詢問教師是否恢復。
- 教師重連成功後，以本機狀態重新宣告目前題目與已答名單。
- 學生重新加入時沿用本機 client ID，教師據此去重。
- 呼叫 `navigator.storage.persist()`；若瀏覽器拒絕，顯示本機資料可能被清理的說明。
- IndexedDB 不是永久備份，仍須保留手動匯出。

## 8. 公開服務與免費額度保護

### 8.1 建議初始限制

| 項目 | 初始值 |
|---|---:|
| 每間教室人數 | 60 |
| 教師 P2P 直連數 | 30 |
| 教室有效時間 | 4 小時 |
| 教師同時開啟教室 | 1；登入制可評估提高 |
| 文字答案 | 200 字 |
| 聊天訊息 | 300 字 |
| 單一 JSON 訊息 | 8 KiB |
| 畫板批次頻率 | 最多 10 次／秒 |
| P2P 協商時間 | 5～8 秒 |
| 教師離線寬限 | 60～120 秒 |
| Relay 回切冷卻 | 至少 60 秒 |

所有數值都必須以壓測與實際 Cloudflare 帳戶額度校正，不以計畫值當成已驗證容量。

### 8.2 防濫用

- 建立教室需通過 Cloudflare Turnstile。
- 決策門禁：正式公開前決定教師是否需要 Google 登入；學生維持免登入。
- Room ID 只負責尋址，教師另持不可猜測的 owner token。
- 學生加入時取得短效、限房間的 join token。
- 驗證 WebSocket Origin，不把 CORS 當作唯一防護。
- 每連線限制訊息速率、未確認訊息數與錯誤次數。
- 重複或過期 message ID 直接丟棄。
- 拒絕二進位檔、圖片、影音及超過限制的 JSON。
- 教師離線超過寬限即暫停學生送出；房間到期後關閉所有連線。
- 提供全域 `ALLOW_NEW_ROOMS` 緊急開關；關閉時既有房間可在期限內完成。
- 設定每日建立房間與中繼流量警戒線，達警戒線先降低新房間容量，再停止建房。

### 8.3 隱私

- 顯示名稱應允許暱稱，不要求學生 Email。
- 雲端紀錄不得包含訊息內容。
- Worker 日誌不得輸出 Token、姓名或答案。
- 傳輸全程使用 HTTPS／WSS；未來如需讓中繼端也無法讀取內容，再加入端對端加密。

## 9. 程式結構規畫

前端建議新增：

```text
js/pro/irs-protocol.js       訊息格式、驗證、版本、去重鍵
js/pro/irs-transport.js      統一傳輸介面與狀態機
js/pro/irs-webrtc.js         原生 DataChannel 直連
js/pro/irs-relay.js          Worker／Durable Object WebSocket
js/pro/irs-persistence.js    IndexedDB、自動保存、復原
js/pro/irs-metrics.js        不含內容的本機品質統計
```

後端建議獨立放置：

```text
realtime-worker/
├── src/index.js             建房、加入、健康檢查
├── src/classroom.js         Durable Object 教室與 WebSocket
├── src/protocol.js          後端訊息驗證
├── src/security.js          Token、Origin、Turnstile、限流
├── test/                    協定、濫用與房間生命週期測試
├── migrations/              初版預期不需要 D1 migration
├── package.json
└── wrangler.toml.example
```

既有 `irs.js` 暫時保留畫面與業務邏輯，但不可再直接操作 `Peer` 或 `conn.send()`；應逐步改成呼叫統一 transport。`data.js` 的聊天室及廣播也改走相同介面。

建議介面：

```js
transport.connectTeacher()
transport.connectStudent()
transport.send(message)
transport.broadcast(message)
transport.onMessage(handler)
transport.onStateChange(handler)
transport.close()
```

## 10. 分階段執行

### P00：基線與決策門禁（5%）

工作：

- 固定目前 PeerJS 版本、連線模式與錯誤類型基線。
- 實測現行 10、20、30 人加入與同時作答。
- 決定教師採 Google 登入或 Turnstile 訪客房。
- 在 Cloudflare 帳戶確認 Durable Objects、WebSocket 與免費方案當下限制。
- 凍結 v1 訊息協定與容量初始值。

驗收：

- 有可重跑的基線腳本與報告。
- 身分方案、房間期限、人數上限有明確決策。
- 不再以 README 宣稱取代實測結果。

### P01：傳輸抽象層（15%）

工作：

- 建立 `irs-protocol.js` 與 `irs-transport.js`。
- 將既有加入、發題、答題、停題與聊天改由 transport 發送。
- Legacy PeerJS 包裝為 `legacy` adapter，行為先保持不變。

驗收：

- 現有 UI 與功能沒有回歸。
- 業務程式不再直接散落呼叫 PeerJS connection。
- 可由 feature flag 在 legacy 與 hybrid 間切換。

### P02：Cloudflare 教室與純中繼 MVP（30%）

工作：

- 建立獨立 Worker 與 Durable Object。
- 完成建房、加入、教師 ownership、房間到期與 WebSocket Relay。
- 加入 payload schema、大小、速率、人數與 Origin 驗證。
- 先用 Relay 驗證完整問答流程，不接 D1。

驗收：

- 被 WebRTC 防火牆阻擋時仍能完成基本問答。
- 關閉房間後連線與暫態資料會釋放。
- 後端沒有學生答案資料表。

### P03：P2P 優先與自動分流（50%）

工作：

- 由 Durable Object 交換 WebRTC SDP／ICE。
- 建立原生 RTCDataChannel；P2P 成功後切換 DIRECT。
- DIRECT 成功後關閉學生控制 WebSocket，確認正常應用訊息完全不進 Worker。
- 簽發短效 fallback ticket，P2P 失效時才重新開啟 Relay WebSocket。
- P2P 逾時、斷線或直連額滿時無感切到 RELAY。
- 加入回切冷卻與防震盪規則，網路恢復後可安全回到 DIRECT。
- 教師 UI 顯示各連線模式及重連狀態。

驗收：

- 同一學生切換 transport 不會重複加入或重複計票。
- DIRECT 穩定後學生沒有持續後端連線，應用訊息不經 Worker 中繼。
- RELAY 學生可以和 DIRECT 學生參與同一題。

### P04：本機保存與重整復原（68%）

工作：

- 實作 IndexedDB schema、autosave、ACK 與 outbox。
- 教師重整後恢復房間、名單、題目與答案歷史。
- 學生端保存未 ACK 訊息並在重連後重送。
- 完成 CSV／JSON 匯出與清除功能。

驗收：

- 已 ACK 答案在教師重新整理後不遺失。
- 未 ACK 答案重送後只計一次。
- 本機資料可由教師主動完全刪除。

### P05：公開服務防護（80%）

工作：

- 接入 Turnstile；依 P00 決策接入或不接入 Firebase 教師登入。
- 完成 join token、owner token、限速、訊息限制及緊急開關。
- 不含內容的品質指標與用量警戒。
- 顯示清楚的連線、容量、隱私與資料保存說明。

驗收：

- Room ID 洩漏不能取得教師權限。
- 非允許 Origin、過量訊息、過期 Token 與超額房間會被拒絕。
- 日誌抽查不包含姓名、答案與密鑰。

### P06：60／100 人壓測（93%）

測試矩陣：

- 60 人於 30 秒內加入。
- 60 人於 2 秒內同時送出 ABCD、文字與搶答。
- 30 DIRECT＋30 RELAY 混合。
- 另以 30 人全 DIRECT 房間驗證：穩定後只有教師保留控制 WebSocket，後端應用中繼訊息數為 0。
- DIRECT 學生斷線後才建立 Relay，並驗證未 ACK 訊息可續傳。
- 20% 學生同時斷線後重連。
- 教師重新整理並恢復。
- 學校 Wi-Fi、手機網路、跨網路與阻擋 WebRTC 的情境。
- 異常客戶端大量送訊息、超長文字及偽造 sequence。
- 60 人通過後才執行 100 人測試。

60 人驗收門檻：

- 加入成功率至少 98%，失敗者能得到可操作的重試訊息。
- 已 ACK 答案遺失數為 0，重複計票數為 0。
- 作答 ACK 延遲：DIRECT p95 小於 1.5 秒、RELAY p95 小於 2.5 秒。
- 教師頁在答案尖峰仍可操作，不發生分頁崩潰。
- 教師重整後 10 秒內恢復可用狀態。
- 後端沒有逐筆答案持久化紀錄。

100 人只有在相同正確性門檻通過後才可成為公開規格；延遲門檻可依實測另訂，但不得放寬資料正確性。

### P07：試辦與正式切換（100%）

工作：

- 先以隱藏 feature flag 開放測試。
- 依序進行 10、30、60 人真實課堂試辦。
- 觀察 P2P 成功率、中繼比例、重連率及教師端效能。
- 通過後將 hybrid 設為預設；legacy 保留一個版本週期。

驗收：

- GitHub Pages、Worker、Durable Object 與回退版本均完成正式驗證。
- 使用說明的人數、限制與實際壓測一致。
- 有可在數分鐘內切回 legacy 的操作文件。

## 11. 測試與證據要求

必須保留下列證據，不接受只看畫面成功：

- 每次壓測的版本 SHA、日期、瀏覽器版本、網路環境及教師硬體。
- 加入成功率、DIRECT／RELAY 人數、ACK 延遲、斷線與重連統計。
- 教師 IndexedDB 中答案數與學生端 ACK 數對帳。
- 後端用量與是否產生 D1 寫入的查核。
- DIRECT 穩定期間的學生 WebSocket 數、Worker 應用訊息數與 Relay 位元組應為 0。
- 教師重新整理、Worker 重啟、房間到期與緊急開關結果。
- 手機與桌面實機，不以單一桌面瀏覽器模擬全部驗收。

## 12. 回退策略

- 前端保留 `legacy` 與 `hybrid` adapter，預設值由單一設定控制。
- Worker 故障時，不自動把未確認答案標成成功。
- 若 P2P 可用而 Worker 中繼異常，已建立的 DIRECT 連線可繼續目前題目。
- 若建立房間服務異常，顯示暫停服務及既有本機紀錄匯出入口。
- 回退不得刪除 IndexedDB；舊版無法理解的新資料應保持不動。
- 正式切換後至少保留一個版本週期的 legacy 回退能力，再評估移除公共 PeerJS。

## 13. 上線前待決策

1. 教師建立公開房間是否必須 Google 登入？
   - 建議：試辦期 Turnstile 即可；正式大眾服務評估教師 Google 登入，學生維持免登入。
2. 訪客教師與登入教師是否採不同容量／期限？
   - 建議：訪客 40 人／90 分鐘，登入教師 60 人／4 小時。
3. RELAY 模式是否開放聊天室與畫板？
   - 建議：聊天室開放並限速；畫板批次降頻；影音不開放。
4. 100 人是否為必要公開規格？
   - 建議：第一版只承諾 60 人，100 人列為壓測升級目標。

## 14. 完成定義

只有同時符合下列條件，改善案才算完成：

- 60 人真實或等價混合壓測通過。
- P2P 失敗者可自動使用 Relay，不需手動切換模式。
- P2P 正常時學生關閉後端連線，所有應用資料直接進入教師電腦。
- 已 ACK 答案不因重連、重送或教師重新整理而遺失或重複。
- 教師電腦保存完整問答歷史，後端無逐筆答案資料表。
- 公開建立教室具有驗證、限流、期限、人數與緊急停止能力。
- 螢幕分享沒有誤走 Cloudflare 訊息中繼。
- 使用說明、容量宣稱、隱私說明與壓測證據一致。
- 正式環境可健康檢查、可觀測且可安全回退。
