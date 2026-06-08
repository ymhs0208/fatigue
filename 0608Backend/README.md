
# PulseAI | 智能辦公健康助理 🛡️

**PulseAI** 是一款結合邊緣運算 (Edge AI)、物聯網 (IoT) 推播與生成式 AI (GenAI) 的全端健康管理系統。專為長時間久坐的辦公室族群或學生設計，透過電腦視覺即時監測使用者的坐姿與疲勞狀態，結合番茄鐘工作法與 AI 健康教練，打造全方位的智慧健康防護網。

---

## ✨ 核心功能 (Features)

1. **🍅 智能番茄鐘與運動引導**
   - 內建專注模式，結束後自動進入運動模式，引導 knuckle stretch, neck stretch 等動作，並透過 AI 判定動作準確度。
2. **👁️ 邊緣運算即時健康偵測 (Edge AI Vision)**
   - **剛性特徵測距：** 採用瞳孔間距 (IOD) 取代傳統臉部佔比，在不同鏡頭環境下依然保持高準確度。
   - **姿勢嚴格校正：** 在初始化階段強制進行水平基準檢測，確保每一位使用者的健康數據皆基於標準坐姿。
   - **多維度監測：** 同步監測眼部疲勞 (EAR)、肩膀高低 (Postural Slope)、打哈欠 (MAR) 與環境光線。
3. **☁️ 雲端同步與儀表板**
   - 使用 Supabase 儲存歷史健康數據，並透過 Webhook 將每日/每週報告推送至 Discord。
4. **🧠 生成式 AI 洞察**
   - 串接 NVIDIA NIM (Gemma/Llama 3.1) 提供個人化健康建議。

---

## 🛠️ 技術架構 (Tech Stack)

* **後端:** Python 3, Flask, Flask-SocketIO (WebSocket 即時通訊), Thread Lock 安全機制
* **前端:** HTML5, Tailwind CSS, JavaScript (膠囊式 UI 設計)
* **電腦視覺:** OpenCV, MediaPipe (Face Mesh, Hands, Pose)
* **雲端:** Supabase, Discord Webhook, NVIDIA NIM API

---

## 🚀 安裝與執行環境

### 1. 系統需求
* Python 3.8 或以上版本
* 具備 WebCam 的電腦

### 2. 安裝必要套件
```bash
pip install opencv-python numpy requests mediapipe openai Flask flask-socketio python-dotenv supabase

```

### 3. 環境變數設定 (.env)

在專案根目錄建立 `.env` 檔案，填入以下內容：

```env
NVIDIA_API_KEY=your_key_here
SUPABASE_URL=your_url_here
SUPABASE_KEY=your_key_here

```

### 4. 啟動系統

```bash
python app.py

```

---

## 💡 工程設計亮點 (Engineering Highlights)

* **Thread-Safe Architecture:** 導入 `state_lock` 保護系統全域狀態，解決多執行緒衝突問題。
* **Robust Vision:** 改用 IOD 剛性特徵取代臉部寬高比，大幅提升距離檢測的抗干擾能力。
* **Strict Calibration:** 於校正階段加入肩膀水平度絕對限制，確保基準值準確。
* **Capsule UX:** 前端介面採用圓潤膠囊設計，支援置頂懸浮，提供更無感的辦公輔助體驗。

---

