# 使用者提供的家庭記帳網站：公開技術參考

使用者提供 `https://fambudget-web.onrender.com/index.html#/` 作為其他人成果參考。2026-10-21 嘗試使用公開網頁檢索工具開啟，工具回報無法存取；沒有登入該站、開啟使用者先前的驗證 token、呼叫該站模型或推測付費額度。以下是可核對的**歷史公開程式**，不是目前網站的模型／作者／部署成功證據。

## 已確認的歷史線索

固定版本 `168a89de91f8d91ec66af55bdb6de53571ec7656`（2026-10-16）：

- [公開手冊](https://github.com/ChunWei-0801/-/blob/168a89de91f8d91ec66af55bdb6de53571ec7656/frontend/docs/index.html#L70-L72) 同列該 Render 主機與儲存庫；只能建立歷史關聯。
- [模型呼叫程式](https://github.com/ChunWei-0801/-/blob/168a89de91f8d91ec66af55bdb6de53571ec7656/backend/app/services/llm/client.py#L36-L60) 透過後端 httpx 呼叫 OpenAI 相容 `/v1/chat/completions`，傳 messages、model、max_tokens、temperature。該請求未包含 tools／tool_choice，不能稱為已實作原生 function calling。相容端點也不能證明一定呼叫 OpenAI 或免費。
- [記帳抽取程式](https://github.com/ChunWei-0801/-/blob/168a89de91f8d91ec66af55bdb6de53571ec7656/backend/app/services/llm/parse.py#L39-L120) 使用少量示例提示產生 JSON，後端核對日期、金額、分類，保留原句與缺漏欄位。
- [部署設定](https://github.com/ChunWei-0801/-/blob/168a89de91f8d91ec66af55bdb6de53571ec7656/render.yaml#L37-L41) 模型網址預設空白。文件中的 Qwen、LoRA、GGUF 規劃不能當作訓練／執行的證據。

## 現有免費方案如何參考

| 可參考的做法 | 本專題目前實作與差異 |
| --- | --- |
| 自然語言抽成可檢查的 JSON | 使用者裝置執行免費 Qwen，模型引用交易與金額原文，使用者核對後才入帳。 |
| 抽取後再驗證，保留原句 | 逐筆嚴格核對來源與金額，排除捏造候選，保留其他合格草稿；模型原判斷與來源規則的調整分開。 |
| 缺漏欄位與信心提示 | 展示可編輯缺漏／來源核對提醒；不用模型自報的信心分數冒充實測準確率。 |
| 理財與操作問答 | 從受權限控制的精確帳務、操作語料和三份附官方來源的理財摘要提供資料，再由同一本機模型解釋。不是全文書籍訓練。 |
| 評估模型效果 | 模型原判斷與來源檢查後結果分開比較，保留實測時間與 token；重播不當作新推論或整體準確率。 |

目前無法確認參考網站的即時互動畫面與技術。沒有因參考而改用付費 API，也沒有取消本專題的驗證與來源揭露。後續若取得該站公開原始碼／公開可讀技術說明，可再依具體證據補充。
