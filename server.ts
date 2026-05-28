import express from "express";
import path from "path";
import * as cheerio from "cheerio";
import { Readable } from "stream";

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

    // Guarantee there is always at least 1 clickable option in the collection so UI buttons remain active
    if (episodes.length === 0) {
      totalEpisodes = 1;
      episodes.push({
        label: "1",
        number: 1,
        isActive: true
      });
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

  const watchUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}?lang=id-ID`;
  const refreshUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}/refresh-source?lang=id-ID&force=1`;

  let cookies = "";
  let initialSourceFromHtml: string | null = null;

  // STEP 1: Fetch the watch page HTML to establish session & get cookies
  try {
    logs.push(`📥 Mengunduh kode HTML halaman tonton untuk menginisialisasi sesi & cookie: ${watchUrl}`);
    const watchResp = await fetch(watchUrl, { 
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": HEADERS["Accept-Language"],
        "Referer": `${BASE_DOMAIN}/`
      } 
    });

    if (watchResp.status === 200) {
      // Collect cookies from the response headers
      const rawCookies = typeof (watchResp.headers as any).getSetCookie === "function"
        ? (watchResp.headers as any).getSetCookie()
        : (watchResp.headers.get("set-cookie") ? [watchResp.headers.get("set-cookie")] : []);
      
      const parsedCookies: Record<string, string> = {};
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

      cookies = Object.entries(parsedCookies).map(([k, v]) => `${k}=${v}`).join("; ");
      logs.push(`🍪 Cookie sesi berhasil direkam: ${cookies ? "Ada (" + Object.keys(parsedCookies).length + " keys)" : "Kosong"}`);

      // Extract initialSourceUrl from the HTML body as solid fallback
      const html = await watchResp.text();
      const sourceRegex = /const\s+initialSourceUrl\s*=\s*["']([^"']+)["']/;
      const sourceMatch = html.match(sourceRegex);
      if (sourceMatch && sourceMatch[1]) {
        let extracted = sourceMatch[1];
        extracted = extracted.replace(/\\u0026/gi, "&").replace(/u0026/gi, "&").replace(/\/u0026/gi, "&");
        extracted = extracted.replace(/\\\/|\\/g, "/");
        if (extracted.startsWith("/")) {
          extracted = `${BASE_DOMAIN}${extracted}`;
        }
        initialSourceFromHtml = extracted;
        logs.push(`📑 Menemukan initialSourceUrl dari HTML sebagai cadangan: ${initialSourceFromHtml}`);
      }
    } else {
      logs.push(`⚠️ Gagal memuat HTML tonton. Status HTTP: ${watchResp.status}`);
    }
  } catch (err: any) {
    logs.push(`⚠️ Terjadi kesalahan saat memuat halaman sesi: ${err.message}`);
  }

  // STEP 2: Call the API /refresh-source with established cookies & AJAX headers
  if (simulate502) {
    logs.push(`⚠️ SIMULATED 502 ACTIVE: Melewati pemanggilan API refresh-source.`);
  } else {
    try {
      logs.push(`📡 Mencoba memanggil API refresh-source dengan sesi & headers AJAX: ${refreshUrl}`);
      
      const apiHeaders: Record<string, string> = {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "application/json",
        "Accept-Language": HEADERS["Accept-Language"],
        "Referer": watchUrl,
        "X-Requested-With": "XMLHttpRequest",
      };

      if (cookies) {
        apiHeaders["Cookie"] = cookies;
      }

      const resp = await fetch(refreshUrl, { headers: apiHeaders });
      
      if (resp.status !== 200) {
        logs.push(`❌ [API Error] Server mengembalikan HTTP ${resp.status} ${resp.statusText}`);
        addLog("error", `API Gagal (HTTP ${resp.status})`, `Mendeteksi kesalahan Gateway/Server.`);
      } else {
        const data = await resp.json() as any;
        let playUrl = data.play_url || data.direct_play_url;
        if (playUrl) {
          if (playUrl.startsWith("/")) {
            playUrl = `${BASE_DOMAIN}${playUrl}`;
          }
          logs.push(`🎉 [API Success] Berhasil mendapatkan source URL dari API /refresh-source!`);
          logs.push(`👉 URL Streaming: ${playUrl}`);
          addLog("success", "API /refresh-source Sukses Berhasil", `Sesi & AJAX aktif. Mode URL: ${data.play_url ? "Play" : "Direct"}`);
          return {
            videoUrl: playUrl,
            mode: "api",
            wasSuccessful: true,
            logs
          };
        } else {
          logs.push(`⚠️ [API Warning] Respons API sukses (200), tetapi 'play_url' atau 'direct_play_url' kosong.`);
          addLog("warn", "API Return Kosong", "API sukses tetapi link streaming kosong.");
        }
      }
    } catch (err: any) {
      logs.push(`❌ [API Network Error] Gagal fetch API: ${err.message}`);
      addLog("error", "API Network Error", `${err.message}.`);
    }
  }

  // STEP 3: Fallback to initial source from HTML if API didn't succeed
  if (initialSourceFromHtml) {
    logs.push(`🎉 [Fallback Success] Menggunakan cadangan initialSourceUrl dari HTML.`);
    addLog("success", "Fallback HTML Sukses", `Stream berhasil diambil dari HTML watch page.`);
    return {
      videoUrl: initialSourceFromHtml,
      mode: "fallback",
      wasSuccessful: true,
      logs
    };
  }

  logs.push(`❌ Gagal mendapatkan link video dari API maupun HTML.`);
  addLog("error", "Semua Metode Gagal", "Gagal mendapatkan videoUrl.");
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

  // Set up AbortController to terminate downstream fetch if the client aborts or closes connection
  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  try {
    const response = await fetch(decodedUrl, { 
      headers: fetchHeaders,
      signal: abortController.signal
    });
    
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

    // Pipe response bodies for actual media assets (MP4 or .ts chunks) natively via stream pipeline
    if (response.body) {
      Readable.fromWeb(response.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      // Direct stream cancellation - ignored safely
      return;
    }
    console.error("General Stream proxy error:", error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
});


// =========================
// VITE CLIENT INTEGRATION
// =========================
async function startServer() {
  if (process.env.VERCEL) {
    // Di lingkungan serverless Vercel, file statis dilayani langsung oleh CDN Vercel,
    // jadi kita tidak perlu memount middleware Vite atau file statis.
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
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

export default app;
