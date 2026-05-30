# ⚡ Hubungkan Aplikasi ke Cloudflare Worker (Full Scraper API & Streaming Proxy)

Layanan serverless gratis dari **Vercel** memiliki batas waktu eksekusi singkat (10 detik), memori rendah, dan tidak dirancang untuk streaming data video berukuran besar. Hal ini sering memicu tersendat (*buffering*) atau melambat signifikan saat memutar vidoe.

Dengan memindahkan **seluruh backend & scraper API** ke Cloudflare Workers gratisan (mendapat limit **100.000 request per hari** secara gratis!), semua waktu muat, scraping pencarian, pengambilan rincian drama, dan putaran aliran video Anda akan diproses langsung di jaringan Edge Global terdekat milik Cloudflare secara instan dengan ultra-low latency!

---

## 🚀 Langkah-Langkah Memasang ke Cloudflare:

1. **Buka Cloudflare**: Masuk ke [Cloudflare Workers & Pages](https://dash.cloudflare.com/).
2. **Buat Worker baru**: Klik tombol **"Create Application"** -> **"Create Worker"**.
3. **Konfigurasi dan Deploy**: Beri nama Worker sesuka hati Anda, lalu langsung klik tombol **"Deploy"** di bagian bawah.
4. **Masukkan Kode**: Klik tombol **"Edit Code"** (atau masuk ke editor online bawaan Cloudflare). Hapus semua kode bawaan yang ada di berkas `worker.js` / `index.js`.
5. **Tempelkan Kode**: Copy/Salin seluruh kode script di bawah ini dan tempelkan ke editor Cloudflare.
6. **Simpan**: Klik tombol **"Save and Deploy"** di pojok kanan atas editor.
7. **Aktifkan di Aplikasi**: Salin alamat URL Worker Anda (misal: `https://ancient-darkness-e578.wakeveh208.workers.dev`). Buka aplikasi **Narto Mini Theater**, buka menu **Diagnostik Scraper** di bawah kiri, masuk ke tab **Cloudflare Proxy**, tempelkan URL tersebut ke kolom input, klik **Simpan & Aktifkan**!

---

## 📝 Kode Script All-In-One Cloudflare Worker:

```javascript
// Global Memory Caches per isolate instance
const videoUrlCache = new Map();
let globalSessionCookies = "";

const BASE_DOMAIN = "https://narto-drama.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
};

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const path = urlObj.pathname;
    const targetUrlStr = urlObj.searchParams.get("url");

    // Standard CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "public, max-age=3600"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ==========================================
      // 1. API: LIST DRAMA /api/list
      // ==========================================
      if (path === "/api/list") {
        const page = urlObj.searchParams.get("page") || "1";
        const url = `${BASE_DOMAIN}/?lang=id-ID&page=${page}`;
        
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) throw new Error(`HTTP Error ${resp.status}`);
        const html = await resp.text();
        
        const items = extractCards(html);
        const hasNext = html.includes("Next");

        return new Response(JSON.stringify({ items, hasNext }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // ==========================================
      // 2. API: SEARCH DRAMA /api/search
      // ==========================================
      if (path === "/api/search") {
        const q = urlObj.searchParams.get("q") || "";
        const page = urlObj.searchParams.get("page") || "1";
        
        if (!q) {
          return new Response(JSON.stringify({ items: [], count: 0 }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const url = `${BASE_DOMAIN}/search?q=${encodeURIComponent(q)}&lang=id-ID&page=${page}`;
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) throw new Error(`HTTP Error ${resp.status}`);
        const html = await resp.text();

        const items = extractCards(html);
        return new Response(JSON.stringify({ items, count: items.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // ==========================================
      // 3. API: DETAIL DRAMA /api/detail
      // ==========================================
      if (path === "/api/detail") {
        const slug = urlObj.searchParams.get("slug") || "";
        if (!slug) {
          return new Response(JSON.stringify({ error: "Missing slug parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const url = `${BASE_DOMAIN}/detail/watch/${slug}?lang=id-ID&from=home`;
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) throw new Error(`HTTP Error ${resp.status}`);
        const html = await resp.text();

        const detail = parseDetail(html, slug);
        return new Response(JSON.stringify(detail), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // ==========================================
      // 4. API: VIDEO SOURCE /api/video
      // ==========================================
      if (path === "/api/video") {
        const slug = urlObj.searchParams.get("slug") || "";
        const ep = Number(urlObj.searchParams.get("ep") || "1");

        if (!slug) {
          return new Response(JSON.stringify({ error: "Missing slug parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Check RAM Cache
        const cachedEpisodes = videoUrlCache.get(slug);
        if (cachedEpisodes && cachedEpisodes[ep]) {
          return new Response(JSON.stringify({
            videoUrl: cachedEpisodes[ep],
            mode: "fallback",
            wasSuccessful: true,
            sessionCookies: globalSessionCookies,
            logs: ["⚡ [Worker Cache RAM Success] Link streaming diambil dari Cache RAM Worker!"]
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const logs = [];
        logs.push(`🔍 Memulai pencarian video source untuk: ${slug} (Eps ${ep})`);

        const watchUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}?lang=id-ID`;
        let refreshSourceContextToken = "";
        let localCookies = "";
        let initialSourceFromHtml = null;

        // Fetch HTML watch page for scraping
        const watchResp = await fetch(watchUrl, {
          headers: {
            ...HEADERS,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Referer": `${BASE_DOMAIN}/`
          }
        });

        const html = await watchResp.text();

        // Extract cookies if any
        const rawCookies = [];
        watchResp.headers.forEach((value, key) => {
          if (key === "set-cookie") {
            rawCookies.push(value);
          }
        });

        const parsedCookies = {};
        for (const cookieStr of rawCookies) {
          if (!cookieStr) continue;
          const parts = cookieStr.split(";");
          const entry = parts[0];
          const eqIdx = entry.indexOf("=");
          if (eqIdx > 0) {
            const key = entry.substring(0, eqIdx).trim();
            const val = entry.substring(eqIdx + 1).trim();
            parsedCookies[key] = val;
          }
        }

        localCookies = Object.entries(parsedCookies).map(([k, v]) => `${k}=${v}`).join("; ");
        if (localCookies) {
          globalSessionCookies = localCookies;
        }

        logs.push(`🍪 Cookie sesi direkam: ${localCookies ? "Aktif" : "Kosong"}`);

        // Extract token
        const tokenRegex = /const\s+refreshSourceContextToken\s*=\s*["']([^"']*)["']/;
        const tokenMatch = html.match(tokenRegex);
        if (tokenMatch && tokenMatch[1]) {
          refreshSourceContextToken = tokenMatch[1].replace(/\\/g, "");
          logs.push(`🔑 Menemukan refreshSourceContextToken dari HTML.`);
        }

        // Extract initialSourceUrl from HTML body
        const sourceRegex = /const\s+initialSourceUrl\s*=\s*["']([^"']+)["']/;
        const sourceMatch = html.match(sourceRegex);
        if (sourceMatch && sourceMatch[1]) {
          initialSourceFromHtml = cleanUrl(sourceMatch[1]);
          logs.push(`📑 Menemukan initialSourceUrl langsung dari HTML.`);
        }

        // Populate sibling episode caches
        const episodeItemsRegex = /const\s+episodeItemsRaw\s*=\s*(\[[\s\S]*?\])\s*;/;
        const episodeMatch = html.match(episodeItemsRegex);
        if (episodeMatch && episodeMatch[1]) {
          try {
            const rawItems = parseEpisodeItemsRaw(episodeMatch[1]);
            if (Array.isArray(rawItems) && rawItems.length > 0) {
              const cachedRecords = videoUrlCache.get(slug) || {};
              for (const item of rawItems) {
                const epNum = Number(item.number || item.route_episode_number);
                const sourceFromItem = cleanUrl(item.direct_play_url || item.play_url);
                if (epNum && sourceFromItem) {
                  cachedRecords[epNum] = sourceFromItem;
                  if (epNum === ep && !initialSourceFromHtml) {
                    initialSourceFromHtml = sourceFromItem;
                  }
                }
              }
              videoUrlCache.set(slug, cachedRecords);
              logs.push(`📂 Memori Cache terisi! Berhasil menyimpan ${rawItems.length} link episode.`);
            }
          } catch(e) {
            logs.push(`⚠️ Gagal mem-parse array episodeItemsRaw: ${e.message}`);
          }
        }

        if (initialSourceFromHtml) {
          logs.push(`🎉 [Scraper HTML Success] Stream didapatkan langsung dari HTML!`);
          return new Response(JSON.stringify({
            videoUrl: initialSourceFromHtml,
            mode: "fallback",
            wasSuccessful: true,
            sessionCookies: globalSessionCookies,
            logs
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Failsafe Backup call to API refresh-source
        logs.push(`🔄 Scraping HTML gagal. Memanggil API refresh-source...`);
        try {
          const apiHeaders = new Headers();
          apiHeaders.set("User-Agent", HEADERS["User-Agent"]);
          apiHeaders.set("Accept", "application/json");
          apiHeaders.set("Referer", watchUrl);
          apiHeaders.set("X-Requested-With", "XMLHttpRequest");
          if (globalSessionCookies) {
            apiHeaders.set("Cookie", globalSessionCookies);
          }

          const finalRefreshUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}/refresh-source?lang=id-ID${refreshSourceContextToken ? `&rs_ctx=${encodeURIComponent(refreshSourceContextToken)}` : ""}&force=1`;
          logs.push(`📡 Memanggil API refresh-source: ${finalRefreshUrl}`);

          const resp = await fetch(finalRefreshUrl, { headers: apiHeaders });
          if (resp.ok) {
            const data = await resp.json();
            let playUrl = data.play_url || data.direct_play_url;
            if (playUrl) {
              playUrl = cleanUrl(playUrl);
              logs.push(`🎉 [Backup API Success] Berhasil mendapatkan source URL dari API!`);
              
              const cachedRecords = videoUrlCache.get(slug) || {};
              cachedRecords[ep] = playUrl;
              videoUrlCache.set(slug, cachedRecords);

              return new Response(JSON.stringify({
                videoUrl: playUrl,
                mode: "api",
                wasSuccessful: true,
                sessionCookies: globalSessionCookies,
                logs
              }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (err) {
          logs.push(`❌ [Backup API Error] Gagal fetch: ${err.message}`);
        }

        return new Response(JSON.stringify({
          videoUrl: null,
          mode: "fallback",
          wasSuccessful: false,
          sessionCookies: globalSessionCookies,
          logs
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // ==========================================
      // 5. THE HLS STREAM STREAMING BYPASS PROXY (DEFAULT ROUTING)
      // ==========================================
      if (targetUrlStr) {
        const decodedUrl = decodeURIComponent(targetUrlStr);

        const fetchHeaders = new Headers();
        fetchHeaders.set("User-Agent", HEADERS["User-Agent"]);
        fetchHeaders.set("Referer", `${BASE_DOMAIN}/`);
        fetchHeaders.set("Origin", BASE_DOMAIN);

        const clientCookies = urlObj.searchParams.get("cookies");
        if (clientCookies) {
          fetchHeaders.set("Cookie", decodeURIComponent(clientCookies));
        } else if (globalSessionCookies) {
          fetchHeaders.set("Cookie", globalSessionCookies);
        }

        const clientRange = request.headers.get("Range");
        if (clientRange) {
          fetchHeaders.set("Range", clientRange);
        }

        const response = await fetch(decodedUrl, { headers: fetchHeaders });

        const contentType = response.headers.get("content-type") || "";
        const isPlaylist = decodedUrl.includes(".m3u8") || contentType.includes("mpegurl");

        if (isPlaylist && response.ok) {
          let text = await response.text();
          const base = decodedUrl.substring(0, decodedUrl.lastIndexOf("/")) + "/";
          const lines = text.split(/\r?\n/);
          
          const cookieParam = clientCookies ? `&cookies=${encodeURIComponent(clientCookies)}` : (globalSessionCookies ? `&cookies=${encodeURIComponent(globalSessionCookies)}` : "");

          const rewrittenLines = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (match, p1) => {
                  let absUrl = p1.startsWith("http") ? p1 : base + p1;
                  try {
                    const absUrlObj = new URL(p1, decodedUrl);
                    absUrl = absUrlObj.href;
                  } catch(e) {}
                  const proxied = `${urlObj.origin}${urlObj.pathname}?url=${encodeURIComponent(absUrl)}${cookieParam}`;
                  return `URI="${proxied}"`;
                });
              }
              return line;
            }
            let absUrl = trimmed.startsWith("http") ? trimmed : base + trimmed;
            try {
              const absUrlObj = new URL(trimmed, decodedUrl);
              absUrl = absUrlObj.href;
            } catch(e) {}
            return `${urlObj.origin}${urlObj.pathname}?url=${encodeURIComponent(absUrl)}${cookieParam}`;
          });

          return new Response(rewrittenLines.join("\n"), {
            status: response.status,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=3600"
            }
          });
        }

        // Direct binary chunk piping
        const resHeaders = new Headers(response.headers);
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.set("Cache-Control", "public, max-age=3600");

        return new Response(response.body, {
          status: response.status,
          headers: resHeaders
        });
      }

      // Root worker status page
      return new Response("⚡ Cloudflare Edge Scraper & Streaming Proxy is Online!", {
        headers: { "Content-Type": "text/html", ...corsHeaders }
      });

    } catch (err) {
      return new Response(`Worker Error: ${err.message}`, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};

// ==========================================
// UTILITY HELPERS FOR PARSING
// ==========================================

function cleanUrl(urlStr) {
  if (!urlStr) return "";
  let extracted = urlStr;
  extracted = extracted.replace(/\\u0026/gi, "&").replace(/u0026/gi, "&").replace(/\/u0026/gi, "&");
  extracted = extracted.replace(/\\\/|\\/g, "/");
  if (extracted.startsWith("/")) {
    extracted = `${BASE_DOMAIN}${extracted}`;
  }
  return extracted;
}

function parseEpisodeItemsRaw(rawString) {
  try {
    return JSON.parse(rawString);
  } catch (err) {
    const items = [];
    const objRegex = /\{([^{}]+)\}/g;
    let match;
    while ((match = objRegex.exec(rawString)) !== null) {
      const objStr = match[1];
      const numMatch = objStr.match(/(?:"number"|number|route_episode_number)\s*:\s*(?:"([^"]+)"|(\d+))/);
      const num = numMatch ? Number(numMatch[1] || numMatch[2]) : null;
      
      const playMatch = objStr.match(/(?:"direct_play_url"|"play_url"|direct_play_url|play_url)\s*:\s*"([^"]+)"/);
      const playUrl = playMatch ? playMatch[1] : null;

      if (num && playUrl) {
        items.push({ number: num, play_url: playUrl });
      }
    }
    return items;
  }
}

function extractCards(html) {
  const cards = [];
  const cardBlocks = html.split('class="card"');
  
  for (let i = 1; i < cardBlocks.length; i++) {
    const block = cardBlocks[i].split("</article>")[0];
    
    // Extract title
    const titleMatch = block.match(/<h3[^>]*class="title"[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract href
    const hrefMatch = block.match(/href="([^"]+)"/i);
    const href = hrefMatch ? hrefMatch[1] : "";

    // Extract poster
    const srcMatch = block.match(/src="([^"]+)"/i);
    let thumbnail = srcMatch ? srcMatch[1] : "";
    if (thumbnail && thumbnail.startsWith("/")) {
      thumbnail = BASE_DOMAIN + thumbnail;
    }

    // Extract card-ep status
    const epMatch = block.match(/<div[^>]*class="card-ep"[^>]*>([\s\S]*?)<\/div>/i);
    const status = epMatch ? epMatch[1].replace(/<[^>]*>/g, "").trim() : "";

    // Extract movie-tags
    const tags = [];
    const tagMatches = block.matchAll(/class="movie-tag"[^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of tagMatches) {
      tags.push(match[1].replace(/<[^>]*>/g, "").trim());
    }

    if (title && href) {
      const cleanHref = href.split("?")[0];
      const slug = cleanHref.split("/").pop() || "";
      cards.push({
        title,
        href: cleanHref.startsWith("http") ? cleanHref : BASE_DOMAIN + cleanHref,
        slug,
        thumbnail,
        tags,
        episodeStatus: status
      });
    }
  }
  return cards;
}

function parseDetail(html, slug) {
  const titleMatch = html.match(/<h1[^>]*class="movie-title"[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "";

  const subMatch = html.match(/<p[^>]*class="movie-sub"[^>]*>([\s\S]*?)<\/p>/i);
  const subText = subMatch ? subMatch[1].replace(/<[^>]*>/g, "").trim() : "";

  const descMatch = html.match(/<div[^>]*class="movie-desc"[^>]*>([\s\S]*?)<\/div>/i);
  const desc = descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : "";

  // Tags
  const tags = [];
  const tagMatches = html.matchAll(/class="movie-tag-pill"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of tagMatches) {
    tags.push(match[1].replace(/<[^>]*>/g, "").trim());
  }

  // Poster
  const posterMatch = html.match(/class="poster"[^>]*src="([^"]+)"/i) || html.match(/src="([^"]+)"/i);
  let poster = posterMatch ? posterMatch[1] : "";
  if (poster && poster.startsWith("/")) {
    poster = BASE_DOMAIN + poster;
  }

  // Episodes elements
  const episodes = [];
  const epItemMatches = html.matchAll(/class="[^"]*episode-item[^"]*"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of epItemMatches) {
    const label = match[1].replace(/<[^>]*>/g, "").trim();
    const numMatch = label.match(/\d+/);
    const number = numMatch ? Number(numMatch[0]) : 1;
    episodes.push({
      label,
      number,
      isActive: match[0].includes("active") || match[0].includes("primary")
    });
  }

  let totalEpisodes = episodes.length;
  if (totalEpisodes === 0) {
    const epMatch = subText.match(/(\d+)\s*Episode/i);
    if (epMatch) {
      totalEpisodes = Number(epMatch[1]);
      for (let i = 1; i <= totalEpisodes; i++) {
        episodes.push({
          label: `${i}`,
          number: i,
          isActive: i === 1
        });
      }
    }
  }

  if (episodes.length === 0) {
    totalEpisodes = 1;
    episodes.push({
      label: "1",
      number: 1,
      isActive: true
    });
  }

  return {
    title: title || slug.replace(/-/g, " "),
    thumbnail: poster,
    description: desc || "Tidak ada deskripsi.",
    tags,
    total_episodes: totalEpisodes,
    episode_raw: subText,
    episodes
  };
}
```
