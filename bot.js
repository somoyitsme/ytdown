/**
 * GrabTube Telegram Bot
 *
 * Lets users send a YouTube link and receive the video (MP4) or audio (MP3)
 * directly in Telegram.
 *
 * Setup:
 *   1. Talk to @BotFather on Telegram → /newbot → get your token
 *   2. Create a .env file or set the environment variable:
 *        TELEGRAM_BOT_TOKEN=your_token_here
 *   3. Run:  node bot.js
 *
 * Telegram Bot API limits file uploads to 50 MB.
 * For files > 50 MB the bot will send a warning with the web link instead.
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ===== Configuration =====
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

if (!TOKEN) {
  console.error('\n  ❌  TELEGRAM_BOT_TOKEN is not set.');
  console.error('  Create a bot via @BotFather and run:');
  console.error('    TELEGRAM_BOT_TOKEN=your_token node bot.js\n');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const TEMP_DIR = path.join(os.tmpdir(), 'grabtube-bot');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024; // 50 MB

// ===== YouTube URL detection =====
const YT_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/,
  /(?:https?:\/\/)?youtu\.be\/([\w-]+)/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([\w-]+)/,
];

function extractVideoId(text) {
  for (const p of YT_PATTERNS) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

// ===== yt-dlp helpers =====
function ytdlpInfo(url) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('Failed to parse video info')); }
      }
    );
  });
}

function formatDuration(sec) {
  if (!sec) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '?';
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(0) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function formatViews(count) {
  if (!count) return '0';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(count);
}

// Find best resolution height
function getBestHeight(info) {
  let best = 0;
  for (const f of (info.formats || [])) {
    if (!f.height || f.vcodec === 'none' || f.protocol === 'm3u8_native') continue;
    if (f.height > best) best = f.height;
  }
  return best;
}

// Estimate sizes
function estimateSizes(info) {
  const formats = info.formats || [];
  const duration = info.duration || 0;

  // Video: find best video + best audio stream sizes
  let videoStreamSize = 0, bestHeight = 0, bestVideoFormat = null;
  for (const f of formats) {
    if (!f.height || f.vcodec === 'none' || f.protocol === 'm3u8_native') continue;
    if (f.height > bestHeight) {
      bestHeight = f.height;
      bestVideoFormat = f;
      videoStreamSize = f.filesize || f.filesize_approx || 0;
    }
  }

  let audioStreamSize = 0;
  for (const f of formats) {
    if (f.vcodec && f.vcodec !== 'none') continue;
    const size = f.filesize || f.filesize_approx || 0;
    if (size > audioStreamSize) audioStreamSize = size;
  }

  let videoTotal = videoStreamSize + audioStreamSize;
  if (!videoTotal && duration && bestVideoFormat) {
    const vbr = bestVideoFormat.vbr || bestVideoFormat.tbr || 0;
    videoTotal = (vbr * 1000 / 8) * duration;
  }

  // MP3 estimate
  const mp3Size = duration ? Math.round((320 * 1000 / 8) * duration) : 0;

  return { videoSize: videoTotal, mp3Size };
}

// Download to file using yt-dlp
function downloadToFile(url, type, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ['--no-playlist', '--no-warnings'];

    if (type === 'audio') {
      args.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
    }

    args.push('-o', outputPath, url);

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrData = '';

    proc.stderr.on('data', d => { stderrData += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderrData.slice(-300)}`));
    });

    proc.on('error', reject);
  });
}

// ===== Bot Commands =====

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    '👋 *Welcome to GrabTube Bot!*',
    '',
    'Send me any YouTube link and I\'ll give you options to download:',
    '🎬 *Video* — Best quality MP4',
    '🎵 *Audio* — Best quality MP3',
    '',
    'Just paste a link to get started!',
  ].join('\n'), { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, [
    '📖 *How to use GrabTube Bot*',
    '',
    '1. Copy a YouTube video link',
    '2. Paste it here in the chat',
    '3. Choose Video or Audio',
    '4. Wait for the download to complete',
    '',
    '⚠️ *Limits:*',
    '• Telegram allows max 50 MB file uploads',
    '• For larger files, use the web version',
    '',
    '*Commands:*',
    '/start — Welcome message',
    '/help — This help message',
  ].join('\n'), { parse_mode: 'Markdown' });
});

// ===== Handle YouTube links =====
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const videoId = extractVideoId(msg.text);
  if (!videoId) return; // Not a YouTube link, ignore

  const chatId = msg.chat.id;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Send "fetching" status
  const statusMsg = await bot.sendMessage(chatId, '🔍 *Fetching video info...*', { parse_mode: 'Markdown' });

  try {
    const info = await ytdlpInfo(url);
    const bestHeight = getBestHeight(info);
    const { videoSize, mp3Size } = estimateSizes(info);
    const quality = bestHeight >= 2160 ? '4K' : `${bestHeight}p`;

    // Build info message
    const infoText = [
      `🎬 *${escapeMarkdown(info.title || 'Untitled')}*`,
      '',
      `👤 ${escapeMarkdown(info.uploader || info.channel || 'Unknown')}`,
      `⏱ ${formatDuration(info.duration)}  •  👁 ${formatViews(info.view_count)} views`,
      '',
      `📹 Best Video: *${quality}* (${info.width || '?'}×${bestHeight}) — ~${formatSize(videoSize)}`,
      `🎵 Best Audio: *MP3* — ~${formatSize(mp3Size)}`,
      '',
      'Choose your download:',
    ].join('\n');

    // Inline keyboard buttons
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `🎬 Download Video (${quality})`, callback_data: `dl:video:${videoId}` },
          ],
          [
            { text: `🎵 Download MP3`, callback_data: `dl:audio:${videoId}` },
          ],
        ],
      },
      parse_mode: 'Markdown',
    };

    // Send thumbnail + info
    try {
      await bot.sendPhoto(chatId, info.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, {
        caption: infoText,
        ...keyboard,
      });
    } catch {
      // If photo fails, send text only
      await bot.sendMessage(chatId, infoText, keyboard);
    }

    // Delete the "fetching" message
    bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

  } catch (err) {
    console.error('[BOT ERROR]', err.message);
    bot.editMessageText(
      '❌ Failed to fetch video info. Please check the link and try again.',
      { chat_id: chatId, message_id: statusMsg.message_id }
    );
  }
});

// ===== Handle download button clicks =====
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!data.startsWith('dl:')) return;

  const [, type, videoId] = data.split(':');
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const isAudio = type === 'audio';
  const ext = isAudio ? 'mp3' : 'mp4';
  const label = isAudio ? '🎵 MP3' : '🎬 Video';

  // Acknowledge the button press
  bot.answerCallbackQuery(query.id, { text: `Starting ${label} download...` });

  const statusMsg = await bot.sendMessage(chatId,
    `⬇️ *Downloading ${label}...*\nThis may take a moment.`,
    { parse_mode: 'Markdown' }
  );

  const tempFile = path.join(TEMP_DIR, `${videoId}_${Date.now()}.${ext}`);

  try {
    await downloadToFile(url, type, tempFile);

    // Check file size
    const stats = fs.statSync(tempFile);

    if (stats.size > TELEGRAM_FILE_LIMIT) {
      await bot.editMessageText(
        `⚠️ *File too large for Telegram* (${formatSize(stats.size)})\n\nTelegram limits uploads to 50 MB. Use the web version instead.`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
      );
      fs.unlinkSync(tempFile);
      return;
    }

    // Upload to Telegram
    await bot.editMessageText(
      `📤 *Uploading ${label}...* (${formatSize(stats.size)})`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' }
    );

    if (isAudio) {
      await bot.sendAudio(chatId, tempFile, {
        caption: `🎵 Downloaded via GrabTube Bot`,
      });
    } else {
      await bot.sendVideo(chatId, tempFile, {
        caption: `🎬 Downloaded via GrabTube Bot`,
        supports_streaming: true,
      });
    }

    // Delete status message
    bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

  } catch (err) {
    console.error('[DOWNLOAD ERROR]', err.message);
    bot.editMessageText(
      `❌ Download failed: ${err.message.slice(0, 200)}`,
      { chat_id: chatId, message_id: statusMsg.message_id }
    );
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

// ===== Escape Markdown special chars =====
function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// ===== Startup =====
console.log('\n  🤖 GrabTube Telegram Bot is running!\n');
console.log('  Send a YouTube link to your bot to test.\n');
