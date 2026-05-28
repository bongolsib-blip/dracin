import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";

const app = express();
const PORT = 3000;
const BASE_DOMAIN = "https://narto-drama.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
  "Referer": "https://narto-drama.com/",
  "Origin": "https://narto-drama.com"
};

interface ApiLog {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
  details?: string;
}

let apiLogs: ApiLog[] = [];

function addLog(type: ApiLog["type"], message: string, details?: string) {
  apiLogs.unshift({
    id: Math.random().toString(36).substring(7),
    timestamp: new Date().toLocaleTimeString("id-ID"),
    type,
    message,
    details
  });
  if (apiLogs.length > 50) apiLogs.pop();
}

// Ensure first log on setup
addLog("info", "Server scraping drama & HLS-fallback aktif di port 3000!");

// =========================
// HELPERS
// =========================
function extractSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/|\/$/g, "");
    const parts = pathname.split("/");
    return parts[parts.length - 1] || "";
  } catch {
    const parts = url.split("?")[0].replace(/^\/|\/$/g, "").split("/");
    return parts[parts.length - 1] || "";
  }
}

// =========================
// API ENDPOINTS
// =========================

// Logs for visual diagnostic console
app.get("/api/logs", (req, res) => {
  res.json({ logs: apiLogs });
});

// Clear logs
app.post("/api/logs/clear", (req, res) => {
  apiLogs = [];
  addLog("info", "Log dibersihkan secara manual");
  res.json({ status: "ok" });
});

// 1. LIST DRAMA API
app.get("/api/list", async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : 1;
  const url = `${BASE_DOMAIN}/?lang=id-ID&page=${page}`;
  addLog("info", `Mengambil daftar drama halaman ${page}`);

  try {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}`);
    }
    const html = await resp.text();
    const $ = cheerio.load(html);
    const items: any[] = [];

    $("article.card").each((_, element) => {
      const card = $(element);
      const titleTag = card.find("h3.title");
      const title = titleTag.text().trim();
      
      const linkTag = card.find("a.card-link-overlay");
      const hrefAttr = linkTag.attr("href") || "";
      const href = hrefAttr.startsWith("http") ? hrefAttr : `${BASE_DOMAIN}${hrefAttr}`;
      
      const imgTag = card.find("img.poster");
      let thumbnail = imgTag.attr("src") || "";
      if (thumbnail && thumbnail.startsWith("/")) {
        thumbnail = `${BASE_DOMAIN}${thumbnail}`;
      }
      
      const tags: string[] = [];
      card.find("a.movie-tag").each((_, tagEl) => {
        tags.push($(tagEl).text().trim());
      });

      const epText = card.find("div.card-ep").text().trim();

      if (title && hrefAttr) {
        items.push({
          title,
          href: href.split("?")[0],
          slug: extractSlug(href.split("?")[0]),
          thumbnail,
          tags,
          episodeStatus: epText
        });
      }
    });

    let hasNext = false;
    const pager = $("div.pager");
    if (pager.length > 0) {
      const nextBtn = pager.find("a.pager-link").filter((_, el) => {
        return $(el).text().includes("Next");
      });
      if (nextBtn.length > 0) {
        hasNext = true;
      }
    }

    addLog("success", `Sukses mengambil ${items.length} drama dari halaman ${page}`);
    res.json({ items, hasNext });
  } catch (error: any) {
    addLog("error", `Gagal mengambil daftar drama`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. SEARCH API (Scrapes search page directly)
app.get("/api/search", async (req, res) => {
  const q = req.query.q as string || "";
  const page = req.query.page ? Number(req.query.page) : 1;
  addLog("info", `Melakukan pencarian lokal untuk: "${q}"`);

  if (!q) {
    return res.json({ items: [], count: 0 });
  }

  try {
    const searchUrl = `${BASE_DOMAIN}/search?q=${encodeURIComponent(q)}&lang=id-ID&page=${page}`;
    const resp = await fetch(searchUrl, { headers: HEADERS });
    if (!resp.ok) {
      throw new Error(`HTTP Error ${resp.status}`);
    }

    const html = await resp.text();
    const $ = cheerio.load(html);
    const items: any[] = [];

    $("article.card").each((_, el) => {
      const card = $(el);
      const titleTag = card.find("h3.title");
      const title = titleTag.text().trim();

      const linkTag = card.find("a.card-link-overlay");
      const hrefAttr = linkTag.attr("href") || "";
      if (!hrefAttr || title.toLowerCase().includes("iklan")) return;

      const cleanHref = hrefAttr.split("?")[0];
      const fullUrl = cleanHref.startsWith("/") ? `${BASE_DOMAIN}${cleanHref}` : cleanHref;
      const slug = extractSlug(cleanHref);

      const imgTag = card.find("img.poster");
      let thumbnail = imgTag.attr("src") || "";
      if (thumbnail && thumbnail.startsWith("/")) {
        thumbnail = `${BASE_DOMAIN}${thumbnail}`;
      }

      const epText = card.find("div.card-ep").text().trim();
      const tags: string[] = [];
      card.find("a.movie-tag").each((_, tagEl) => {
        tags.push($(tagEl).text().trim());
      });

      items.push({
        title,
        href: fullUrl,
        slug,
        thumbnail,
        status: epText,
        tags
      });
    });

    addLog("success", `Pencarian "${q}" menghasilkan ${items.length} drama`);
    res.json({ items, count: items.length });
  } catch (error: any) {
    addLog("error", `Gagal melakukan pencarian`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. DETAIL DRAMA & EPISODES API
app.get("/api/detail", async (req, res) => {
  const slug = req.query.slug as string;
  addLog("info", `Mengambil detail drama untuk slug: "${slug}"`);

  if (!slug) {
    return res.status(400).json({ error: "Parameter slug dibutuhkan" });
  }

  try {
    const detailUrl = `${BASE_DOMAIN}/detail/watch/${slug}?lang=id-ID&from=home`;
    const resp = await fetch(detailUrl, { headers: HEADERS });
    
    if (!resp.ok) {
      throw new Error(`Drama watch page returned HTTP ${resp.status}`);
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    const title = $("h1.movie-title").text().trim();
    const subText = $("p.movie-sub").text().trim();
    const desc = $("div.movie-desc").text().trim();
    
    const tags: string[] = [];
    $("a.movie-tag-pill").each((_, el) => {
      tags.push($(el).text().trim());
    });

    let poster = $("img.poster").first().attr("src") || $("img").first().attr("src") || "";
    if (poster && poster.startsWith("/")) {
      poster = `${BASE_DOMAIN}${poster}`;
    }

    // Parse list episode
    const episodes: any[] = [];
    $("a.episode-item").each((_, el) => {
      const epEl = $(el);
      const label = epEl.text().trim();
      const numMatch = label.match(/\d+/);
      const number = numMatch ? Number(numMatch[0]) : 1;
      episodes.push({
        label,
        number,
        isActive: epEl.hasClass("active") || epEl.hasClass("primary")
      });
    });

    // If no episode container, let's extract episodes count through regex from scripts or generate based on subText
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

    addLog("success", `Detail drama "${title || slug}" terbaca (${totalEpisodes} Episode)`);
    res.json({
      title: title || slug.replace(/-/g, " "),
      thumbnail: poster,
      description: desc || "Tidak ada deskripsi.",
      tags,
      total_episodes: totalEpisodes,
      episode_raw: subText,
      episodes
    });
  } catch (error: any) {
    addLog("error", `Gagal mengambil detail drama`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. GET VIDEO SOURCE & THE LEGENDARY HTML SCRAPING FALLBACK
app.get("/api/video", async (req, res) => {
  const slug = req.query.slug as string;
  const ep = req.query.ep ? Number(req.query.ep) : 1;
  const simulate502 = req.query.simulate502 === "true";

  if (!slug) {
    return res.status(400).json({ error: "Missing slug parameter" });
  }

  const result = await getVideoSourceWithFallback(slug, ep, simulate502);
  res.json(result);
});

// THE EXPLANATION & IMPLEMENTATION IN TYPESCRIPT NODE.JS
async function getVideoSourceWithFallback(
  slug: string, 
  ep: number, 
  simulate502: boolean
): Promise<{ 
  videoUrl: string | null; 
  mode: "api" | "fallback"; 
  wasSuccessful: boolean;
  logs: string[]; 
}> {
  const logs: string[] = [];
  logs.push(`🔍 Memulai pencarian video source untuk: ${slug} (Eps ${ep})`);

  // Target refresh-source endpoint
  const refreshUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}/refresh-source?lang=id-ID&force=1`;

  if (simulate502) {
    logs.push(`⚠️ SIMULATED 502 ACTIVE: Melompati API /refresh-source langsung ke HTML Fallback.`);
    addLog("warn", "Simulasi 502 Diaktifkan", `Bypass API /refresh-source langsung ke scraping HTML untuk episode ${ep}`);
  } else {
    try {
      logs.push(`📡 Mencoba memanggil API: ${refreshUrl}`);
      const resp = await fetch(refreshUrl, { headers: HEADERS });
      
      if (resp.status !== 200) {
        logs.push(`❌ [API Error] Server mengembalikan HTTP ${resp.status} ${resp.statusText}`);
        addLog("error", `API Gagal (HTTP ${resp.status})`, `Mendeteksi kesalahan Gateway/Server. Melakukan fallback ke scraping HTML watch page...`);
      } else {
        const data = await resp.json() as any;
        const playUrl = data.play_url || data.direct_play_url;
        if (playUrl) {
          logs.push(`✅ [API Success] Berhasil mendapatkan source URL dari API: ${playUrl}`);
          addLog("success", "API /refresh-source Berhasil", `Mode URL: ${data.play_url ? "Play URL" : "Direct Play"}`);
          return {
            videoUrl: playUrl,
            mode: "api",
            wasSuccessful: true,
            logs
          };
        } else {
          logs.push(`⚠️ [API Warning] Respons API sukses (200), tetapi 'play_url' atau 'direct_play_url' kosong.`);
          addLog("warn", "API Return Kosong", "API sukses tetapi link streaming kosong. Mencoba fallback...");
        }
      }
    } catch (err: any) {
      logs.push(`❌ [API Network Error] Gagal fetch API: ${err.message}`);
      addLog("error", "API Network Error", `${err.message}. Mencoba fallback...`);
    }
  }

  // ==========================================
  // THE LEGENDARY HTML SCRAPING FALLBACK
  // ==========================================
  logs.push(`🔄 KICKING OFF SCRAPER HTML FALLBACK...`);
  const watchUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}?lang=id-ID`;
  logs.push(`📥 Mengunduh kode HTML halaman tonton langsung dari: ${watchUrl}`);

  try {
    const rawHtmlResp = await fetch(watchUrl, { headers: HEADERS });
    if (rawHtmlResp.status !== 200) {
      logs.push(`❌ [HTML Scraper Error] Gagal mengunduh halaman tonton. Status HTTP: ${rawHtmlResp.status}`);
      addLog("error", "HTML Scraper Gagal", `HTTP status: ${rawHtmlResp.status}`);
      return { videoUrl: null, mode: "fallback", wasSuccessful: false, logs };
    }

    const html = await rawHtmlResp.text();
    logs.push(`📑 HTML sukses diunduh (${html.length} bytes). Memindai script tonton...`);

    // Guna regex untuk mencari initialSourceUrl di dalam text javascript
    const sourceRegex = /const\s+initialSourceUrl\s*=\s*["']([^"']+)["']/;
    const sourceMatch = html.match(sourceRegex);

    if (sourceMatch && sourceMatch[1]) {
      let extractedUrl = sourceMatch[1];
      // Decode escaped forward slashes e.g. \/ -> / dan unicode characters
      extractedUrl = extractedUrl.replace(/\\\/|\\/g, "/").replace(/\\u0026/g, "&");
      
      logs.push(`🎉 [HTML Scraper Success] Berhasil mengekstrak initialSourceUrl dari HTML!`);
      logs.push(`👉 URL Ekstraksi: ${extractedUrl}`);
      addLog("success", "HTML Scraper Berhasil!", `Bypass 502 sukses! Mengekstrak: ${extractedUrl.substring(0, 60)}...`);
      return {
        videoUrl: extractedUrl,
        mode: "fallback",
        wasSuccessful: true,
        logs
      };
    } else {
      logs.push(`❌ [HTML Scraper Error] Variabel 'initialSourceUrl' TIDAK ditemukan dalam HTML watch page.`);
      addLog("error", "Scraper Gagal", "Variabel initialSourceUrl tidak ditemukan di script HTML.");
    }
  } catch (scrapError: any) {
    logs.push(`❌ [HTML Scraper Error Fatal] Terjadi exception: ${scrapError.message}`);
    addLog("error", "Exception Scraping HTML watch page", scrapError.message);
  }

  return {
    videoUrl: null,
    mode: "fallback",
    wasSuccessful: false,
    logs
  };
}

// 5. THE HLS STREAM STREAMING CORS BYPASS PROXY
app.get("/api/stream", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("Parameter url dibutuhkan");
  }

  const decodedUrl = decodeURIComponent(targetUrl);
  
  const fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://narto-drama.com/",
    "Origin": "https://narto-drama.com",
    "Accept": "*/*",
  };

  if (req.headers.range) {
    fetchHeaders["Range"] = req.headers.range;
  }

  try {
    const response = await fetch(decodedUrl, { headers: fetchHeaders });
    
    // Set response headers
    const contentType = response.headers.get("content-type") || "video/mp2t";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (response.headers.get("content-length")) {
      res.setHeader("Content-Length", response.headers.get("content-length")!);
    }
    if (response.headers.get("content-range")) {
      res.setHeader("Content-Range", response.headers.get("content-range")!);
    }
    res.status(response.status);

    // If it's a playlist (.m3u8), we need to rewrite paths so segments go through this proxy
    if (decodedUrl.includes(".m3u8")) {
      const text = await response.text();
      const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf("/")) + "/";
      const lines = text.split(/\r?\n/);
      
      const rewrittenLines = lines.map(line => {
        const stripped = line.trim();
        if (stripped && !stripped.startsWith("#")) {
          const absUrl = stripped.startsWith("http") ? stripped : baseUrl + stripped;
          return `/api/stream?url=${encodeURIComponent(absUrl)}`;
        }
        
        // Match occurrences of URI="..." inside tags (like subtitles or external stream links) and rewrite
        if (stripped && stripped.includes('URI="')) {
          return stripped.replace(/URI="([^"]+)"/g, (match, p1) => {
            const absUrl = p1.startsWith("http") ? p1 : baseUrl + p1;
            return `URI="/api/stream?url=${encodeURIComponent(absUrl)}"`;
          });
        }
        
        return line;
      });
      
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(rewrittenLines.join("\n"));
    }

    // Pipe response bodies for actual .ts media chunks
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.send();
    }
  } catch (error: any) {
    console.error("General Stream proxy error:", error);
    res.status(500).send(error.message);
  }
});


// =========================
// VITE CLIENT INTEGRATION
// =========================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer();
