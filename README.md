# 🎬 YT Down

> Download YouTube videos and audio in the highest quality — via web or Telegram bot.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎬 **Best Video** | Downloads the highest resolution available (up to 4K) as MP4 |
| 🎵 **Best Audio** | Extracts audio and converts to MP3 at maximum quality |
| 🤖 **Telegram Bot** | Send a YouTube link → get video/audio directly in chat |
| ⚡ **Fast Downloads** | Concurrent fragment downloading (4x faster from YouTube) |
| 🔒 **Secure** | Helmet headers, rate limiting, no tracking |
| 📱 **Responsive** | Works on desktop, tablet, and mobile |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org/)

### Install

```bash
git clone https://github.com/somoyitsme/ytdown.git
cd ytdown
npm install
```

### Configure

Create a `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
PORT=3000
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
```

> Get a bot token from [@BotFather](https://t.me/BotFather) on Telegram.

### Run

```bash
# Start web server
npm start

# Start Telegram bot (separate terminal)
npm run bot
```

- **Website** → `http://localhost:3000`
- **Telegram Bot** → send any YouTube link to your bot

---

## 🏗️ Project Structure

```
├── server.js        # Express web server + download API
├── bot.js           # Telegram bot (standalone)
├── index.html       # Frontend UI
├── styles.css       # Design system (dark glassmorphism)
├── app.js           # Frontend JavaScript
├── Dockerfile       # Container setup (Node + yt-dlp + ffmpeg)
├── render.yaml      # Render deployment blueprint
├── .env             # Secrets (not committed)
└── package.json
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/info?url=...` | GET | Fetch video metadata + available quality |
| `/api/download?url=...&type=video` | GET | Download best quality MP4 |
| `/api/download?url=...&type=audio` | GET | Download best quality MP3 |
| `/api/health` | GET | Server + yt-dlp status check |

---

## 🐳 Docker

```bash
docker build -t ytdown .
docker run -p 3000:3000 --env-file .env ytdown
```

---

## 🔒 Security

- **Secrets**: Stored in `.env`, never committed to Git
- **Helmet**: 11+ security headers (XSS, clickjacking, HSTS)
- **Rate Limiting**: Configurable per-IP request limits
- **Dotfile Blocking**: `.env` cannot be accessed via browser

---

## 📝 License

MIT © [somoyitsme](https://github.com/somoyitsme)
