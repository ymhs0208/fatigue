# PulseAI | 智能辦公健康助理 🛡️

**PulseAI** 是一款結合邊緣運算 (Edge AI)、物聯網 (IoT) 推播與生成式 AI (GenAI) 的全端健康管理系統。專為長時間久坐的辦公室族群或學生設計，透過電腦視覺即時監測使用者的坐姿與疲勞狀態，結合番茄鐘工作法與 AI 健康教練，打造全方位的智慧健康防護網。

---

## ✨ 核心功能 (Features)

1. **🍅 智能番茄鐘與自動運動引導**
   - 內建 90分鐘、52分鐘、25分鐘與自訂專注模式，倒數結束後自動切換至「運動模式」。
   - 引導使用者進行：雙手握拳伸展 (Knuckle Stretch)、頭部轉動 (Neck Stretch)、雙手向上伸展 (Arm Stretch)，並透過 AI 判定動作是否確實完成。

2. **👁️ 邊緣運算即時健康偵測 (Edge AI Vision)**
   - 透過 WebCam 實時運算，不上傳影像，保障隱私。
   - **眼部疲勞：** 偵測眨眼頻率與閉眼時間 (EAR 演算法)。
   - **高低肩 / 歪斜：** 透過身體特徵點計算肩膀水平狀態。
   - **螢幕距離：** 透過臉部佔比判定是否過度靠近螢幕。
   - **精神不濟：** 偵測打哈欠或手部摀嘴動作 (MAR 演算法)。
   - **環境光源：** 偵測當前環境亮度是否充足。

3. **📢 即時語音警告與 UI 互動**
   - 當觸發不良姿勢時，網頁前端會即時以紅光閃爍，並透過 TTS (Text-to-Speech) 語音提醒使用者調整姿勢。

4. **☁️ 雲端資料同步與圖表儀表板 (Cloud Dashboard)**
   - 將健康警報數據 (高低肩次數、哈欠次數等) 透過 Webhook 同步至 Google Sheets。
   - 內建前端雲端儀表板，使用 Chart.js 即時繪製個人健康趨勢圖表。

5. **🤖 GenAI 專屬健康教練與 Discord 報表**
   - 支援發送「日報」與「週報」至 Discord 頻道。
   - 串接 **NVIDIA NIM API (Gemma / Llama 3.1)**，根據使用者當日的健康警報數據，由 AI 自動生成個人化的姿勢改善建議。

---

## 🛠️ 技術架構 (Tech Stack)

* **後端 (Backend):** Python 3, Flask, Flask-SocketIO (WebSocket 即時通訊)
* **前端 (Frontend):** HTML5, Tailwind CSS, JavaScript, Chart.js
* **電腦視覺 (Computer Vision):** OpenCV, MediaPipe (Face Mesh, Hands, Pose), NumPy
* **雲端與第三方 API (Cloud & APIs):**
  * Google Apps Script (GAS) - 作為 Google Sheets 資料庫的輕量 API
  * Discord Webhook - 報表推送
  * NVIDIA NIM API (OpenAI 相容格式) - 生成式 AI 健康建議

---

## 🚀 安裝與執行環境 (Installation)

### 1. 系統需求
* Python 3.8 或以上版本
* 具備視訊鏡頭 (WebCam) 的電腦

### 2. 安裝必要套件
請打開終端機 (Terminal / CMD) 並執行以下指令安裝所需套件：
```bash
pip install opencv-python numpy requests mediapipe openai Flask flask-socketio python-dotenv