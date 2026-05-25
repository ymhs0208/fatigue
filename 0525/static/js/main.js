// static/js/main.js

const socket = io();
let myChart = null;

// 網頁載入時，檢查是否有存儲過的 Webhook URL
document.addEventListener("DOMContentLoaded", () => {
    const savedUrl = localStorage.getItem("discordWebhookUrl");
    if (savedUrl) {
        document.getElementById("discord-webhook-input").value = savedUrl;
        socket.emit('update_discord_webhook', { url: savedUrl });
    }
});

// =====================================
// UI Modal 控制邏輯
// =====================================
function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function saveSettings(btnElement) {
    const url = document.getElementById('discord-webhook-input').value.trim();
    localStorage.setItem("discordWebhookUrl", url);
    socket.emit('update_discord_webhook', { url: url });
    
    const originalText = btnElement.innerText;
    btnElement.innerText = "已儲存！";
    btnElement.classList.replace('bg-cyan-500', 'bg-emerald-500');
    btnElement.classList.replace('hover:bg-cyan-600', 'hover:bg-emerald-600');
    
    setTimeout(() => {
        btnElement.innerText = originalText;
        btnElement.classList.replace('bg-emerald-500', 'bg-cyan-500');
        btnElement.classList.replace('hover:bg-emerald-600', 'hover:bg-cyan-600');
    }, 1000);
}

// =====================================
// 時間設定邏輯 (包含 Header 與 Modal 狀態同步)
// =====================================
function setPomodoro(seconds, btn, isHeader = false) {
    // 1. 清除 Modal 內所有快選按鈕的 active 狀態
    const modalButtons = document.querySelectorAll('#timer-buttons button');
    modalButtons.forEach(b => {
        b.className = "text-sm font-bold text-slate-600 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all flex-grow text-center";
        const span = b.querySelector('span');
        if(span) span.className = "text-[10px] text-slate-400 font-normal";
    });

    // 2. 清除 Header 內按鈕的 active 狀態
    const headerButtons = document.querySelectorAll('#header-timer-buttons button');
    headerButtons.forEach(b => {
        b.className = "text-xs font-bold text-slate-500 px-4 py-2 rounded-full hover:bg-white transition-all border border-transparent";
    });
    
    // 若有傳入按鈕，則根據位置給予對應的 active 樣式
    if (btn) {
        if (isHeader) {
            btn.className = "btn-active text-xs font-bold text-slate-600 px-4 py-2 rounded-full transition-all border border-transparent";
            
            // 如果是在 header 點擊 25 分，把 modal 裡的 25 分也點亮
            if (seconds === 1500) {
                const modal25 = document.getElementById('btn-mode-25');
                if (modal25) {
                    modal25.className = "btn-active text-sm font-bold text-cyan-700 px-4 py-2.5 rounded-xl border border-cyan-200 transition-all flex-grow text-center shadow-sm";
                    const span = modal25.querySelector('span');
                    if(span) span.className = "text-[10px] text-cyan-600/80 font-normal";
                }
            }
        } else {
            btn.className = "btn-active text-sm font-bold text-cyan-700 px-4 py-2.5 rounded-xl border border-cyan-200 transition-all flex-grow text-center shadow-sm";
            const span = btn.querySelector('span');
            if(span) span.className = "text-[10px] text-cyan-600/80 font-normal";
            
            // 如果是在 modal 點擊 25 分，把 header 裡的 25 分也點亮
            if (seconds === 1500) {
                const header25 = document.getElementById('btn-header-25m');
                if (header25) header25.className = "btn-active text-xs font-bold text-slate-600 px-4 py-2 rounded-full transition-all border border-transparent";
            }
        }
        
        // 清空自訂輸入框
        document.getElementById('custom-work-mins').value = '';
    }

    // 發送秒數給後端
    socket.emit('set_pomodoro_time', { seconds: seconds });
}

function applyCustomTimer() {
    const minsInput = document.getElementById('custom-work-mins').value;
    const mins = parseInt(minsInput);
    
    if (isNaN(mins) || mins <= 0) {
        alert("請輸入有效的專注時間（大於 0 的分鐘數）！");
        return;
    }
    
    const seconds = mins * 60;
    
    // 傳入 null 代表這是自訂時間，取消所有按鈕的高亮
    setPomodoro(seconds, null, false);
    
    // 給予按鈕視覺回饋
    const btnElement = document.getElementById('btn-apply-time');
    const originalText = btnElement.innerText;
    btnElement.innerText = "已套用！";
    btnElement.classList.replace('bg-indigo-500', 'bg-emerald-500');
    btnElement.classList.replace('hover:bg-indigo-600', 'hover:bg-emerald-600');
    
    setTimeout(() => {
        btnElement.innerText = originalText;
        btnElement.classList.replace('bg-emerald-500', 'bg-indigo-500');
        btnElement.classList.replace('hover:bg-emerald-600', 'hover:bg-indigo-600');
        closeSettings(); // 套用完自訂時間自動關閉設定視窗
    }, 800);
}

// =====================================
// 雲端儀表板與 Socket 接收邏輯
// =====================================
function openDashboard() {
    const modal = document.getElementById('dashboard-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    document.getElementById('chart-loading').classList.remove('hidden');
    document.getElementById('chart-container').classList.add('hidden');
    socket.emit('request_cloud_data');
}

function closeDashboard() {
    const modal = document.getElementById('dashboard-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

socket.on('cloud_data_response', function(res) {
    document.getElementById('chart-loading').classList.add('hidden');
    document.getElementById('chart-container').classList.remove('hidden');
    if(res.error) { alert("獲取雲端資料失敗：" + res.error); return; }

    const data = res.data;
    if(!data || data.length === 0) { alert("雲端試算表目前沒有資料！請先發送日報。"); return; }

    const labels = data.map(row => { let d = new Date(row['日期']); return (d.getMonth()+1) + '/' + d.getDate(); });
    const workTimes = data.map(row => (row['專注時長(秒)'] / 60).toFixed(1)); 
    const alertEyes = data.map(row => row['閉眼次數'] || 0);
    const alertShoulders = data.map(row => row['高低肩次數'] || 0);
    const alertLight = data.map(row => row['太暗次數'] || 0);

    const ctx = document.getElementById('healthChart').getContext('2d');
    if(myChart) myChart.destroy(); 

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: '專注時間 (分鐘)', data: workTimes, type: 'line', borderColor: '#06b6d4', backgroundColor: '#06b6d4', borderWidth: 3, tension: 0.3, yAxisID: 'y' },
                { label: '閉眼警告 (次)', data: alertEyes, backgroundColor: 'rgba(239, 68, 68, 0.5)', yAxisID: 'y1' },
                { label: '高低肩警告 (次)', data: alertShoulders, backgroundColor: 'rgba(245, 158, 11, 0.5)', yAxisID: 'y1' },
                { label: '光線太暗 (次)', data: alertLight, backgroundColor: 'rgba(234, 179, 8, 0.5)', yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { type: 'linear', display: true, position: 'left', title: {display: true, text:'專注時間(分)'} },
                y1: { type: 'linear', display: true, position: 'right', grid: {drawOnChartArea: false}, title: {display: true, text:'警報次數'} }
            }
        }
    });
});

// 語音與系統控制
let isVoiceEnabled = false;
window.speechUtterances = []; 
let prevStates = { eyes: "OPEN", distance: "GOOD", shoulders: "BALANCED", mode: "CALIBRATION", light: "GOOD" };

function toggleVoice() {
    isVoiceEnabled = !isVoiceEnabled;
    const btn = document.getElementById('btn-voice'), icon = document.getElementById('icon-voice'), text = document.getElementById('text-voice');
    if (isVoiceEnabled) {
        btn.classList.add('border-emerald-300', 'bg-emerald-50'); btn.classList.remove('border-transparent');
        icon.className = "fa-solid fa-volume-high text-emerald-600";
        text.innerText = "語音開啟"; text.classList.replace('text-slate-500', 'text-emerald-700');
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        playVoice("語音提醒已開啟");
    } else {
        btn.classList.remove('border-emerald-300', 'bg-emerald-50'); btn.classList.add('border-transparent');
        icon.className = "fa-solid fa-volume-xmark text-slate-400 group-hover:text-slate-600 transition-colors";
        text.innerText = "靜音"; text.classList.replace('text-emerald-700', 'text-slate-500');
        window.speechSynthesis.cancel(); window.speechUtterances = [];
    }
}

function playVoice(text) {
    if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW'; utterance.rate = 1.1; utterance.pitch = 1.0;
    window.speechUtterances.push(utterance);
    utterance.onend = function () { const idx = window.speechUtterances.indexOf(utterance); if (idx > -1) window.speechUtterances.splice(idx, 1); };
    utterance.onerror = function () { window.speechSynthesis.cancel(); };
    window.speechSynthesis.speak(utterance);
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
}

function recalibrate() { socket.emit('request_recalibrate'); }
function sendReport(type) {
    document.getElementById('report-text-' + type).innerText = "發送中..."; 
    document.getElementById('btn-report-' + type).classList.add('opacity-50');
    socket.emit('request_discord_report', { type: type });
}

socket.on('report_status', function (data) {
    const rtype = data.type || 'daily', btn = document.getElementById('btn-report-' + rtype);
    document.getElementById('report-text-' + rtype).innerText = data.success ? "成功！" : "失敗";
    setTimeout(() => { document.getElementById('report-text-' + rtype).innerText = rtype === 'daily' ? "發日報" : "發週報"; btn.classList.remove('opacity-50'); }, 3000);
});

socket.on('state_update', function (state) {
    if (state.shoulders === "UNEVEN" && prevStates.shoulders !== "UNEVEN") playVoice("肩膀歪斜，請挺直身體。");
    if (state.eyes === "CLOSED" && prevStates.eyes !== "CLOSED") playVoice("偵測到閉眼，請保持清醒。");
    if (state.distance === "TOO CLOSE" && prevStates.distance !== "TOO CLOSE") playVoice("太靠近螢幕了，請往後坐。");
    if (state.light === "TOO DARK" && prevStates.light !== "TOO DARK") playVoice("環境光線不足，請打開檯燈保護眼睛。");
    if (state.mode === "EXERCISE_HAND" && prevStates.mode === "WORK") playVoice("專注時間結束，請起立活動一下身體吧。");
    prevStates = { shoulders: state.shoulders, eyes: state.eyes, distance: state.distance, light: state.light, mode: state.mode };

    const tr = Math.max(0, state.target_work_time - state.work_time);
    document.getElementById('timer').innerText = `${Math.floor(tr / 60).toString().padStart(2, '0')}:${Math.floor(tr % 60).toString().padStart(2, '0')}`;
    document.getElementById('work-bar').style.width = Math.min((state.work_time / state.target_work_time) * 100, 100) + "%";

    const container = document.getElementById('tomato-container');
    if (state.pomodoro_count > 0 && container.children.length !== state.pomodoro_count) {
        container.innerHTML = Array(state.pomodoro_count).fill('<span class="text-xl">🍅</span>').join('');
    } else if (state.pomodoro_count === 0) container.innerHTML = '';

    document.getElementById('overlay-absent').classList.toggle('hidden', !state.user_absent);
    document.getElementById('overlay-calib').classList.toggle('hidden', state.mode !== "CALIBRATION");
    
    const isEx = state.mode.startsWith("EXERCISE");
    document.getElementById('overlay-exercise').classList.toggle('hidden', !isEx);
    if (isEx) {
        document.getElementById('ex-title').innerText = state.exercise_task.split("(")[0].trim();
        document.getElementById('ex-progress').innerText = state.exercise_progress.split("/")[0].trim();
        document.getElementById('ex-status').innerText = state.exercise_status;
    }

    function update(cid, vid, isAlert, text) {
        const c = document.getElementById(cid), v = document.getElementById(vid);
        if (isAlert) {
            c.classList.add('alert-pulse', 'border-red-300', 'bg-red-50'); v.className = "font-bold text-xl text-red-600"; v.innerText = text;
        } else {
            c.classList.remove('alert-pulse', 'border-red-300', 'bg-red-50'); v.className = "font-bold text-xl text-slate-800"; v.innerText = text;
        }
    }

    update('card-shoulders', 'val-shoulders', state.shoulders === "UNEVEN", state.shoulders === "UNEVEN" ? "高低肩！" : "平衡");
    update('card-eyes', 'val-eyes', state.eyes === "CLOSED", state.eyes === "CLOSED" ? "疲勞！" : "正常");
    update('card-mouth', 'val-mouth', state.mouth === "YAWN/COVER", state.mouth === "YAWN/COVER" ? "打哈欠！" : "無");
    update('card-dist', 'val-dist', state.distance === "TOO CLOSE", state.distance === "TOO CLOSE" ? "太近！" : "適中");
    update('card-light', 'val-light', state.light === "TOO DARK", state.light === "TOO DARK" ? "太暗！" : "明亮");
});