// ===== SVG Icon Helpers =====
const icons = {
  download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  user: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  video: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  music: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
};

// ===== DOM Elements =====
const urlInput = document.getElementById('url-input');
const fetchBtn = document.getElementById('fetch-btn');
const loader = document.getElementById('loader');
const errorMsg = document.getElementById('error-msg');
const resultsSection = document.getElementById('results');

// ===== State =====
let videoData = null;
let currentUrl = '';

// ===== Validation =====
function isValidUrl(url) {
  const patterns = [
    /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|facebook\.com|fb\.watch)\/[^\s]+/i
  ];
  return patterns.some(p => p.test(url.trim()));
}

// ===== Escape HTML to prevent XSS =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Render Results =====
function renderResults(data) {
  document.getElementById('thumb').src = data.thumbnail;
  document.getElementById('thumb').alt = data.title;
  document.getElementById('video-title').textContent = data.title;

  document.getElementById('video-meta').innerHTML = `
    <span class="result-card__meta-item">${icons.user} ${escapeHtml(data.channel)}</span>
    <span class="result-card__meta-item">${icons.clock} ${data.duration}</span>
    <span class="result-card__meta-item">${icons.eye} ${data.views}</span>
  `;

  // Video download card
  const videoCard = document.getElementById('dl-video');
  if (data.bestVideo) {
    videoCard.querySelector('.dl-card__quality').textContent = data.bestVideo.quality;
    videoCard.querySelector('.dl-card__resolution').textContent = data.bestVideo.resolution;
    videoCard.querySelector('.dl-card__format').textContent = `MP4 • ${data.bestVideo.size}`;
    const badge = videoCard.querySelector('.dl-card__badge');
    badge.className = `dl-card__badge ${data.bestVideo.badge}`;
    badge.textContent = data.bestVideo.quality;
  }

  // Audio download card
  const audioCard = document.getElementById('dl-audio');
  if (data.bestAudio) {
    audioCard.querySelector('.dl-card__quality').textContent = 'MP3';
    audioCard.querySelector('.dl-card__resolution').textContent = data.bestAudio.bitrate
      ? `Source: ${data.bestAudio.bitrate}kbps → MP3 Best`
      : 'Best Quality MP3';
    audioCard.querySelector('.dl-card__format').textContent = `MP3 • ${data.bestAudio.size}`;
  }
}

// ===== Fetch Handler =====
async function handleFetch() {
  const url = urlInput.value.trim();

  errorMsg.classList.remove('active');
  resultsSection.classList.remove('active');

  if (!url) {
    showError('Please enter a video URL.');
    return;
  }

  if (!isValidUrl(url)) {
    showError('Please enter a valid YouTube or Facebook URL');
    return;
  }

  currentUrl = url;
  fetchBtn.disabled = true;
  loader.classList.add('active');

  try {
    const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch video info');
    }

    videoData = data;
    resultsSection.classList.add('active');
    renderResults(data);

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    loader.classList.remove('active');
    fetchBtn.disabled = false;
  }
}

// ===== Download Handler =====
function triggerDownload(type, btnElement) {
  if (!currentUrl) return;

  const params = new URLSearchParams({ url: currentUrl, type });
  const downloadUrl = `/api/download?${params.toString()}`;

  // Visual feedback
  const originalHTML = btnElement.innerHTML;
  btnElement.innerHTML = `<span class="dl-card__btn-spinner"></span> Preparing...`;
  btnElement.disabled = true;

  // Trigger browser download
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => {
    btnElement.innerHTML = originalHTML;
    btnElement.disabled = false;
  }, 4000);
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('active');
}

// ===== Event Listeners =====
fetchBtn.addEventListener('click', handleFetch);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleFetch(); });

document.getElementById('btn-download-video').addEventListener('click', function () {
  triggerDownload('video', this);
});

document.getElementById('btn-download-audio').addEventListener('click', function () {
  triggerDownload('audio', this);
});

// ===== Auto-paste from clipboard =====
urlInput.addEventListener('focus', async () => {
  if (!urlInput.value && navigator.clipboard && navigator.clipboard.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (isValidYoutubeUrl(text)) {
        urlInput.value = text;
        urlInput.select();
      }
    } catch {
      // Clipboard permission denied — ignore
    }
  }
});
