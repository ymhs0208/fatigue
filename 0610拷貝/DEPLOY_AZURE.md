# Azure Linux VM 部署

這個專案使用 Flask-SocketIO。以下設定以一台 Ubuntu VM、Gunicorn、Nginx
與 systemd 運行，網站不會因為閒置而休眠。

## 1. 建立 Azure VM

在 [Azure Portal](https://portal.azure.com/) 搜尋「Virtual machines」，建立
一台 Linux VM：

- Image：Ubuntu Server 24.04 LTS
- Size：選帳號免費額度涵蓋的機型；建立前再次確認右側預估費用
- Authentication：SSH public key
- Inbound ports：SSH (22)、HTTP (80)、HTTPS (443)

下載私鑰後，在本機執行：

```bash
chmod 400 ~/Downloads/你的金鑰.pem
ssh -i ~/Downloads/你的金鑰.pem azureuser@你的VM公用IP
```

建議在 VM 的 Networking 頁面，把 SSH 22 的來源限制成自己的 IP。HTTP 80
與 HTTPS 443 可維持 Internet 開放。

## 2. 安裝伺服器軟體

登入 VM 後執行：

```bash
sudo apt update
sudo apt install -y git nginx python3-venv
```

## 3. 上傳專案

最方便的方式是先把專案推到 GitHub 私人儲存庫，再於 VM 執行：

```bash
git clone 你的GitHub儲存庫網址 pulseai
cd pulseai
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

不要把 `.env` 上傳到 GitHub。在 VM 建立環境變數檔：

```bash
nano .env
```

填入：

```dotenv
NVIDIA_API_KEY=你的金鑰
SUPABASE_URL=你的網址
SUPABASE_KEY=你的金鑰
```

若暫時不用 AI 或 Supabase，對應欄位可以不填。

先測試服務：

```bash
.venv/bin/gunicorn --workers 1 --threads 100 --bind 127.0.0.1:5001 app:app
```

看到 Gunicorn 啟動後按 `Ctrl+C`。必須維持一個 worker，因為目前 Socket.IO
房間狀態儲存在單一程序的記憶體。

## 4. 設定 systemd 常駐

先取得專案絕對路徑：

```bash
pwd
```

建立服務：

```bash
sudo nano /etc/systemd/system/pulseai.service
```

貼上以下內容，將 `/home/azureuser/pulseai` 改成剛才 `pwd` 顯示的路徑：

```ini
[Unit]
Description=PulseAI Flask SocketIO
After=network.target

[Service]
User=azureuser
Group=www-data
WorkingDirectory=/home/azureuser/pulseai
EnvironmentFile=/home/azureuser/pulseai/.env
ExecStart=/home/azureuser/pulseai/.venv/bin/gunicorn --workers 1 --threads 100 --timeout 120 --bind 127.0.0.1:5001 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

啟動並檢查：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pulseai
sudo systemctl status pulseai
```

查看錯誤紀錄：

```bash
sudo journalctl -u pulseai -n 100 --no-pager
```

## 5. 設定 Nginx 與 WebSocket

```bash
sudo nano /etc/nginx/sites-available/pulseai
```

貼上：

```nginx
server {
    listen 80;
    server_name 你的網域;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

啟用設定：

```bash
sudo ln -s /etc/nginx/sites-available/pulseai /etc/nginx/sites-enabled/pulseai
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 6. 綁定網域及 HTTPS

瀏覽器只允許網站在 HTTPS 或 localhost 使用攝影機，因此正式上線必須有網域
和 HTTPS。先在網域 DNS 建立 `A` 紀錄，指向 VM 公用 IP。

DNS 生效後執行：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的網域
sudo certbot renew --dry-run
```

完成後開啟 `https://你的網域`，允許相機權限並確認頁面連線狀態。

## 更新網站

```bash
cd /home/azureuser/pulseai
git pull
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart pulseai
sudo systemctl reload nginx
```

## 費用提醒

Azure VM 不會自動休眠。免費額度結束後，VM、磁碟、公用 IP 與流量可能繼續
計費。請在 Azure Cost Management 建立 Budget 與電子郵件警示。
