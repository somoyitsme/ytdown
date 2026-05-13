FROM node:20-slim

# Install yt-dlp + ffmpeg (required for audio conversion & video merging)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (Docker layer caching)
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

# Expose port for the web server (optional — bot doesn't need it)
EXPOSE 3000

# Default: run the bot. Override in render.yaml per service.
CMD ["node", "bot.js"]
