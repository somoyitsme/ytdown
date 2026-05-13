require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Security Middleware =====
// Helmet: sets secure HTTP headers (XSS protection, no sniff, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for our frontend
  crossOriginEmbedderPolicy: false,
}));

// Disable x-powered-by header (hides that we use Express)
app.disable('x-powered-by');

// Rate limiting: prevent API abuse
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

// Apply rate limiting to API routes only
app.use('/api/', apiLimiter);

// Serve static frontend files
app.use(express.static(path.join(__dirname), {
  dotfiles: 'deny', // Block access to .env, .gitignore, etc.
}));
app.use(express.json());


// ===== Temp directory for downloads =====
const TEMP_DIR = path.join(os.tmpdir(), 'grabtube-downloads');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ===== In-memory cache for video info (avoids re-fetching same URL) =====
const infoCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(url) {
  const entry = infoCache.get(url);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  infoCache.delete(url);
  return null;
}

function setCache(url, data) {
  infoCache.set(url, { data, time: Date.now() });
  // Evict old entries to prevent memory leak
  if (infoCache.size > 200) {
    const oldest = infoCache.keys().next().value;
    infoCache.delete(oldest);
  }
}

// ===== Utility: Run yt-dlp and return parsed JSON (optimized) =====
function ytdlpInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',  // Skip SSL verify (faster)
      '--socket-timeout', '15',   // Don't hang on slow connections
      url,
    ];

    execFile('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse video information'));
      }
    });
  });
}

// ===== Helper: Format duration =====
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ===== Helper: Format view count =====
function formatViews(count) {
  if (!count) return '0 views';
  if (count >= 1_000_000_000) return (count / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B views';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K views';
  return count + ' views';
}

// ===== Helper: Format file size =====
function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(0) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

// ===== Helper: Map quality to badge class =====
function qualityBadge(height) {
  if (height >= 2160) return 'badge--4k';
  if (height >= 1440) return 'badge--1080';
  if (height >= 1080) return 'badge--1080';
  if (height >= 720) return 'badge--720';
  if (height >= 480) return 'badge--480';
  return 'badge--360';
}

// ===== Helper: Find the best video resolution + estimated file size =====
function findBestVideo(info) {
  const formats = info.formats || [];
  let best = null;
  let bestHeight = 0;

  for (const f of formats) {
    if (!f.height || f.vcodec === 'none' || f.protocol === 'm3u8_native') continue;
    if (f.height > bestHeight) {
      bestHeight = f.height;
      best = f;
    }
  }

  if (!best) return null;

  // Estimate total download size: video stream + best audio stream
  const videoSize = best.filesize || best.filesize_approx || 0;

  let audioSize = 0;
  for (const f of formats) {
    if (f.vcodec && f.vcodec !== 'none') continue;
    const size = f.filesize || f.filesize_approx || 0;
    if (size > audioSize) audioSize = size;
  }

  // If no exact sizes, estimate from duration and bitrate
  let totalSize = videoSize + audioSize;
  if (!totalSize && info.duration) {
    const vbr = best.vbr || best.tbr || 0;
    totalSize = (vbr * 1000 / 8) * info.duration; // rough estimate
  }

  return {
    quality: bestHeight >= 2160 ? '4K' : `${bestHeight}p`,
    resolution: `${best.width || '?'}×${bestHeight}`,
    badge: qualityBadge(bestHeight),
    size: formatSize(totalSize),
    sizeBytes: totalSize,
  };
}

// ===== Helper: Find best audio source bitrate + estimated MP3 size =====
function findBestAudio(info) {
  const formats = info.formats || [];
  let bestBitrate = 0;
  let bestAudioSize = 0;

  for (const f of formats) {
    if (f.vcodec && f.vcodec !== 'none') continue;
    const br = f.abr || f.tbr || 0;
    if (br > bestBitrate) {
      bestBitrate = br;
      bestAudioSize = f.filesize || f.filesize_approx || 0;
    }
  }

  // Estimate MP3 output size: 320kbps × duration (yt-dlp --audio-quality 0 ≈ V0 ~245kbps avg, but close to 320 CBR)
  const duration = info.duration || 0;
  const mp3EstimateBytes = duration ? Math.round((320 * 1000 / 8) * duration) : bestAudioSize;

  return {
    bitrate: Math.round(bestBitrate),
    size: formatSize(mp3EstimateBytes),
    sizeBytes: mp3EstimateBytes,
  };
}

// ===== API: Get video info =====
app.get('/api/info', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  // Basic URL validation
  const ytPatterns = [
    /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+/,
    /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/,
  ];

  if (!ytPatterns.some(p => p.test(url))) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    // Check cache first (instant response if cached)
    const cached = getCached(url);
    if (cached) {
      console.log(`[INFO] Cache hit for: ${url}`);
      return res.json(cached);
    }

    console.log(`[INFO] Fetching info for: ${url}`);
    const info = await ytdlpInfo(url);

    const bestVideo = findBestVideo(info);
    const bestAudio = findBestAudio(info);

    const result = {
      title: info.title || 'Untitled',
      channel: info.uploader || info.channel || 'Unknown',
      duration: formatDuration(info.duration),
      durationSec: info.duration || 0,
      views: formatViews(info.view_count),
      thumbnail: info.thumbnail || `https://img.youtube.com/vi/${info.id}/maxresdefault.jpg`,
      bestVideo,
      bestAudio,
    };

    // Cache the result
    setCache(url, result);
    res.json(result);
  } catch (err) {
    console.error(`[ERROR] Info fetch failed:`, err.message);
    res.status(500).json({ error: 'Failed to fetch video info. Please check the URL and try again.' });
  }
});

// ===== API: Download video/audio =====
// Strategy: Download to temp file with concurrent fragments (4x faster from YouTube),
// then stream the completed file to the user at their full internet speed.
app.get('/api/download', (req, res) => {
  const { url, type } = req.query;

  if (!url || !type) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const ext = type === 'audio' ? 'mp3' : 'mp4';
  const tempId = crypto.randomBytes(8).toString('hex');
  const tempFile = path.join(TEMP_DIR, `${tempId}.${ext}`);
  let aborted = false;

  console.log(`[DOWNLOAD] Starting: type=${type}, url=${url}`);

  // Build yt-dlp args for fast download to temp file
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--concurrent-fragments', '4',   // Download 4 fragments in parallel (MUCH faster)
    '--socket-timeout', '30',
    '--retries', '3',
  ];

  if (type === 'audio') {
    args.push('-f', 'bestaudio');
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', 'bestvideo+bestaudio/best');
    args.push('--merge-output-format', 'mp4');
  }

  args.push('-o', tempFile, url);

  const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr.on('data', (data) => {
    console.log(`[yt-dlp] ${data.toString().trim()}`);
  });

  // Handle client disconnect — kill yt-dlp and clean up
  req.on('close', () => {
    if (!res.writableEnded) {
      aborted = true;
      proc.kill('SIGTERM');
      // Clean up temp file
      setTimeout(() => {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      }, 1000);
    }
  });

  proc.on('error', (err) => {
    console.error('[DOWNLOAD ERROR]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed' });
    }
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  });

  proc.on('close', (code) => {
    if (aborted) return;

    if (code !== 0) {
      console.error(`[DOWNLOAD] yt-dlp exited with code ${code}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed. Please try again.' });
      }
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      return;
    }

    // yt-dlp may add codec extension — find the actual file
    let actualFile = tempFile;
    if (!fs.existsSync(tempFile)) {
      // yt-dlp sometimes appends original extension before conversion
      const dir = path.dirname(tempFile);
      const base = path.basename(tempFile, `.${ext}`);
      const candidates = fs.readdirSync(dir).filter(f => f.startsWith(base));
      if (candidates.length > 0) {
        actualFile = path.join(dir, candidates[0]);
      } else {
        if (!res.headersSent) res.status(500).json({ error: 'File not found after download' });
        return;
      }
    }

    // Get file size for Content-Length (enables browser progress bar)
    const stat = fs.statSync(actualFile);
    const fileSize = stat.size;

    // Derive filename from URL cache or fallback
    const cached = getCached(url);
    const title = cached ? cached.title.replace(/[<>:"/\\|?*]/g, '_') : 'download';
    const filename = `${title}.${ext}`;

    console.log(`[DOWNLOAD] Streaming ${formatSize(fileSize)} to user: ${filename}`);

    // Stream the file to the user at their full internet speed
    res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    const fileStream = fs.createReadStream(actualFile, { highWaterMark: 1024 * 1024 }); // 1MB chunks for speed
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log(`[DOWNLOAD] Complete: ${filename}`);
      // Clean up temp file after streaming
      fs.unlink(actualFile, () => {});
    });

    fileStream.on('error', (err) => {
      console.error('[STREAM ERROR]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Streaming failed' });
      fs.unlink(actualFile, () => {});
    });
  });
});

// ===== Health check =====
app.get('/api/health', (req, res) => {
  execFile('yt-dlp', ['--version'], (err, stdout) => {
    res.json({
      status: 'ok',
      ytdlp: err ? 'not found' : stdout.trim(),
    });
  });
});

// ===== Start server =====
app.listen(PORT, () => {
  console.log(`\n  🚀 GrabTube server running at http://localhost:${PORT}\n`);
});
