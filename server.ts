import express from "express";
import path from "path";
import * as cheerio from "cheerio";
import { Readable } from "stream";

const app = express();
const PORT = 3000;
const BASE_DOMAIN = "https://narto-drama.com";
const WORKER_BASE = "https://ancient-darkness-e578.wakeveh208.workers.dev";

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

// Full scraped HTML logs for visual diagnostic console
app.get("/api/logs/html", (req, res) => {
  res.json({
    slug: latestScrapedSlug,
    ep: latestScrapedEp,
    timestamp: latestScrapedTimestamp,
    status: latestScrapedStatus,
    html: latestScrapedHtml || "Belum ada halaman yang di-scrape atau HTML kosong."
  });
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

  // Try fetching from Cloudflare Worker
  try {
    const workerUrl = `${WORKER_BASE}/api/list?page=${page}`;
    addLog("info", `💡 Mencoba mengambil daftar melalui Cloudflare Worker...`);
    const resp = await fetch(workerUrl, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const data = await resp.json();
      addLog("success", `⚡ [Cloudflare Worker] Berhasil mengambil daftar drama (Halaman ${page})`);
      return res.json(data);
    }
  } catch (err: any) {
    addLog("warn", `⚠️ Cloudflare Worker gagal mengambil list: ${err.message}. Menggunakan fallback scraper...`);
  }

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

  // Try fetching from Cloudflare Worker
  try {
    const workerUrl = `${WORKER_BASE}/api/search?q=${encodeURIComponent(q)}&page=${page}`;
    addLog("info", `💡 Mencoba mencari "${q}" melalui Cloudflare Worker...`);
    const resp = await fetch(workerUrl, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const data = await resp.json();
      addLog("success", `⚡ [Cloudflare Worker] Berhasil mencari "${q}"`);
      return res.json(data);
    }
  } catch (err: any) {
    addLog("warn", `⚠️ Cloudflare Worker gagal mencari "${q}": ${err.message}. Menggunakan fallback scraper...`);
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

  // Try fetching from Cloudflare Worker
  try {
    const workerUrl = `${WORKER_BASE}/api/detail?slug=${encodeURIComponent(slug)}`;
    addLog("info", `💡 Mencoba mengambil detail "${slug}" via Cloudflare Worker...`);
    const resp = await fetch(workerUrl, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const data = await resp.json();
      addLog("success", `⚡ [Cloudflare Worker] Berhasil mengambil rincian drama "${data.title || slug}"`);
      return res.json(data);
    }
  } catch (err: any) {
    addLog("warn", `⚠️ Cloudflare Worker gagal rincian "${slug}": ${err.message}. Menggunakan fallback scraper...`);
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

  // Try fetching from Cloudflare Worker
  try {
    const workerUrl = `${WORKER_BASE}/api/video?slug=${encodeURIComponent(slug)}&ep=${ep}`;
    addLog("info", `💡 Mencoba mengambil video source "${slug}" Eps ${ep} via Cloudflare Worker...`);
    const resp = await fetch(workerUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      if (data && data.wasSuccessful) {
        addLog("success", `⚡ [Cloudflare Worker] Berhasil mengambil video source "${slug}" Eps ${ep}`);
        if (data.sessionCookies) {
          globalSessionCookies = data.sessionCookies;
        }
        return res.json({
          ...data,
          sessionCookies: globalSessionCookies
        });
      }
    }
  } catch (err: any) {
    addLog("warn", `⚠️ Cloudflare Worker gagal mengambil video "${slug}" Eps ${ep}: ${err.message}. Menggunakan fallback scraper...`);
  }

  const result = await getVideoSourceWithFallback(slug, ep, simulate502);
  res.json({
    ...result,
    sessionCookies: globalSessionCookies
  });
});

// Memory cache for video URLs: slug -> Record<episodeNumber, string>
const videoUrlCache = new Map<string, Record<number, string>>();
// Global memory storage for the latest session cookies from narto-drama; used by the streaming proxy to bypass Cloudflare protection
let globalSessionCookies = "";

// Diagnostics variables for detailed scraper troubleshooting
let latestScrapedHtml = "";
let latestScrapedSlug = "";
let latestScrapedEp = 0;
let latestScrapedTimestamp = "";
let latestScrapedStatus = 0;

function cleanUrl(urlStr: string): string {
  if (!urlStr) return "";
  let extracted = urlStr;
  extracted = extracted.replace(/\\u0026/gi, "&").replace(/u0026/gi, "&").replace(/\/u0026/gi, "&");
  extracted = extracted.replace(/\\\/|\\/g, "/");
  if (extracted.startsWith("/")) {
    extracted = `${BASE_DOMAIN}${extracted}`;
  }
  return extracted;
}

function parseEpisodeItemsRaw(rawString: string): any[] {
  try {
    return JSON.parse(rawString);
  } catch (err) {
    try {
      const fn = new Function(`return ${rawString}`);
      return fn();
    } catch (err2: any) {
      console.error("Gagal parse episodeItemsRaw:", err2);
      return [];
    }
  }
}

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

  // STEP 0: Check memory cache first to satisfy "biar pemutaran selanjutnya tidak banyak loading"
  const cachedEpisodes = videoUrlCache.get(slug);
  if (cachedEpisodes && cachedEpisodes[ep]) {
    const cachedUrl = cachedEpisodes[ep];
    logs.push(`⚡ [CACHE MEMORY SUCCESS] Menemukan link streaming tercepat dari memori cache untuk Episode ${ep}: ${cachedUrl}`);
    addLog("success", `Cache Hit Eps ${ep}`, `Berhasil memutar secara instan dari cache memori tanpa loading scraping.`);
    return {
      videoUrl: cachedUrl,
      mode: "fallback",
      wasSuccessful: true,
      logs
    };
  }

  const watchUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}?lang=id-ID`;
  let refreshSourceContextToken = "";

  let cookies = "";
  let initialSourceFromHtml: string | null = null;

  // STEP 1: Fetch the watch page HTML to extract direct source & sibling episode list
  try {
    logs.push(`📥 Mengunduh kode HTML halaman tonton untuk mengambil data & pre-cache episode lain: ${watchUrl}`);
    const watchResp = await fetch(watchUrl, { 
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": HEADERS["Accept-Language"],
        "Referer": `${BASE_DOMAIN}/`
      } 
    });

    latestScrapedSlug = slug;
    latestScrapedEp = ep;
    latestScrapedTimestamp = new Date().toLocaleTimeString("id-ID");
    latestScrapedStatus = watchResp.status;

    const html = await watchResp.text();
    latestScrapedHtml = html;

    // Extract refreshSourceContextToken if present
    const tokenRegex = /const\s+refreshSourceContextToken\s*=\s*["']([^"']*)["']/;
    const tokenMatch = html.match(tokenRegex);
    if (tokenMatch && tokenMatch[1]) {
      refreshSourceContextToken = tokenMatch[1].replace(/\\/g, "");
      logs.push(`🔑 Menemukan refreshSourceContextToken dari HTML.`);
    }

    if (watchResp.status === 200) {
      // Collect cookies from the response headers (useful for API failsafe if needed later)
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
      if (cookies) {
        globalSessionCookies = cookies;
      }
      logs.push(`🍪 Cookie sesi direkam: ${cookies ? "Aktif" : "Kosong"}`);

      // Extract initialSourceUrl from the HTML body
      const sourceRegex = /const\s+initialSourceUrl\s*=\s*["']([^"']+)["']/;
      const sourceMatch = html.match(sourceRegex);
      if (sourceMatch && sourceMatch[1]) {
        initialSourceFromHtml = cleanUrl(sourceMatch[1]);
        logs.push(`📑 Menemukan initialSourceUrl langsung dari HTML: ${initialSourceFromHtml}`);
      }

      // Also extract and populate all episode URLs from episodeItemsRaw to cache
      const episodeItemsRegex = /const\s+episodeItemsRaw\s*=\s*(\[[\s\S]*?\])\s*;/;
      const episodeMatch = html.match(episodeItemsRegex);
      if (episodeMatch && episodeMatch[1]) {
        try {
          const rawItems = parseEpisodeItemsRaw(episodeMatch[1]);
          if (Array.isArray(rawItems) && rawItems.length > 0) {
            const cachedRecords: Record<number, string> = videoUrlCache.get(slug) || {};
            for (const item of rawItems) {
              const epNum = Number(item.number || item.route_episode_number);
              const sourceFromItem = cleanUrl(item.direct_play_url || item.play_url);
              if (epNum && sourceFromItem) {
                cachedRecords[epNum] = sourceFromItem;
                // If the requested episode link was missing, we fill it
                if (epNum === ep && !initialSourceFromHtml) {
                  initialSourceFromHtml = sourceFromItem;
                }
              }
            }
            videoUrlCache.set(slug, cachedRecords);
            logs.push(`📂 Memori Cache terisi! Berhasil menyimpan ${rawItems.length} link episode mendatang untuk play langsung.`);
            addLog("success", `Pre-cache Sukses (${rawItems.length} Ep)`, `Semua episode berikutnya disimpan di RAM untuk mempercepat pemutaran.`);
          }
        } catch (cacheErr: any) {
          logs.push(`⚠️ Gagal mem-parse array episodeItemsRaw: ${cacheErr.message}`);
        }
      }
    } else {
      logs.push(`⚠️ Gagal memuat HTML tonton. Status HTTP: ${watchResp.status}`);
    }
  } catch (err: any) {
    logs.push(`⚠️ Terjadi kesalahan saat memproses HTML tonton: ${err.message}`);
    latestScrapedSlug = slug;
    latestScrapedEp = ep;
    latestScrapedTimestamp = new Date().toLocaleTimeString("id-ID");
    latestScrapedStatus = 0;
    latestScrapedHtml = `EXCEPTION FAILED ON FETCH watchUrl: ${watchUrl}\n\nError Message: ${err.message}\nStack Trace:\n${err.stack || ""}`;
  }

  // STEP 2: Scraper Result check
  if (initialSourceFromHtml) {
    logs.push(`🎉 [Scraper HTML Success] Video link berhasil didapatkan langsung dari parsing HTML!`);
    logs.push(`👉 URL Streaming: ${initialSourceFromHtml}`);
    addLog("success", "Scraping HTML Sukses", `Stream berhasil diambil dari HTML watch page.`);
    return {
      videoUrl: initialSourceFromHtml,
      mode: "fallback",
      wasSuccessful: true,
      logs
    };
  }

  // STEP 3: Call the API /refresh-source only as a failsafe backup
  logs.push(`🔄 [Failsafe Backup] Scraping HTML gagal. Mencoba memanggil API refresh-source...`);
  if (!simulate502) {
    try {
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

      const finalRefreshUrl = `${BASE_DOMAIN}/detail/watch/${slug}/${ep}/refresh-source?lang=id-ID${refreshSourceContextToken ? `&rs_ctx=${encodeURIComponent(refreshSourceContextToken)}` : ""}&force=1`;
      logs.push(`📡 Memanggil API refresh-source: ${finalRefreshUrl}`);

      const resp = await fetch(finalRefreshUrl, { headers: apiHeaders });
      
      if (resp.status === 200) {
        const data = await resp.json() as any;
        let playUrl = data.play_url || data.direct_play_url;
        if (playUrl) {
          playUrl = cleanUrl(playUrl);
          logs.push(`🎉 [Backup API Success] Berhasil mendapatkan source URL dari API /refresh-source!`);
          addLog("success", "API /refresh-source Backup Berhasil", `Mode: ${data.play_url ? "Play" : "Direct"}`);
          
          // Store it in the cache for next time
          const cachedRecords = videoUrlCache.get(slug) || {};
          cachedRecords[ep] = playUrl;
          videoUrlCache.set(slug, cachedRecords);

          return {
            videoUrl: playUrl,
            mode: "api",
            wasSuccessful: true,
            logs
          };
        }
      }
    } catch (err: any) {
      logs.push(`❌ [Backup API Error] Gagal fetch: ${err.message}`);
    }
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

async function refreshSessionCookies(): Promise<void> {
  try {
    console.log("Acquiring fresh session cookies from home page...");
    const resp = await fetch(BASE_DOMAIN, {
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/png,*/*;q=0.8",
        "Accept-Language": HEADERS["Accept-Language"],
      }
    });
    const rawCookies = typeof (resp.headers as any).getSetCookie === "function"
      ? (resp.headers as any).getSetCookie()
      : (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie")] : []);
    
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
    
    if (Object.keys(parsedCookies).length > 0) {
      globalSessionCookies = Object.entries(parsedCookies).map(([k, v]) => `${k}=${v}`).join("; ");
      console.log(`Successfully refreshed global session cookies: ${globalSessionCookies}`);
    }
  } catch (err: any) {
    console.error("Failed to refresh session cookies:", err.message);
  }
}

// 5. THE HLS STREAM STREAMING CORS BYPASS PROXY
app.get("/api/stream", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("Parameter url dibutuhkan");
  }

  const decodedUrl = decodeURIComponent(targetUrl);

  // Redirect stream requests to Cloudflare Worker edge proxy for infinite bandwidth and zero-buffering
  try {
    const cookiesParam = req.query.cookies ? `&cookies=${encodeURIComponent(req.query.cookies as string)}` : (globalSessionCookies ? `&cookies=${encodeURIComponent(globalSessionCookies)}` : "");
    const workerStreamUrl = `${WORKER_BASE}/?url=${encodeURIComponent(decodedUrl)}${cookiesParam}`;
    return res.redirect(302, workerStreamUrl);
  } catch (err: any) {
    addLog("warn", `⚠️ Gagal mengalihkan streaming ke Worker: ${err.message}. Menggunakan Express proxy...`);
  }
  
  const fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://narto-drama.com/",
    "Origin": "https://narto-drama.com",
    "Accept": "*/*",
  };

  if (globalSessionCookies) {
    fetchHeaders["Cookie"] = globalSessionCookies;
  }

  if (req.headers.range) {
    fetchHeaders["Range"] = req.headers.range;
  }

  // Set up AbortController to terminate downstream fetch if the client aborts or closes connection
  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  try {
    let response = await fetch(decodedUrl, { 
      headers: fetchHeaders,
      signal: abortController.signal
    });
    
    if ((response.status === 403 || response.status === 401) && decodedUrl.startsWith("http")) {
      console.log(`[Proxy] Target returned status ${response.status}. Attempting to refresh cookies...`);
      await refreshSessionCookies();
      if (globalSessionCookies) {
        fetchHeaders["Cookie"] = globalSessionCookies;
      }
      response = await fetch(decodedUrl, {
        headers: fetchHeaders,
        signal: abortController.signal
      });
    }

    // Set response headers
    let contentType = response.headers.get("content-type") || "video/mp2t";
    if (decodedUrl.includes("stream/proxy") && contentType.includes("mpegurl")) {
      contentType = "video/mp4";
    }
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
    const isPlaylist = response.ok && (
                       decodedUrl.includes(".m3u8") || 
                       ( (response.headers.get("content-type") || "").includes("mpegurl") && !decodedUrl.includes("stream/proxy") )
                     );

    if (isPlaylist) {
      const text = await response.text();
      const manifestUrlObj = new URL(decodedUrl);
      const parentSearch = manifestUrlObj.search;
      
      const cleanUrlForBase = decodedUrl.split("?")[0];
      const baseUrl = cleanUrlForBase.substring(0, cleanUrlForBase.lastIndexOf("/")) + "/";
      const lines = text.split(/\r?\n/);
      
      const rewrittenLines = lines.map(line => {
        const stripped = line.trim();
        if (stripped && !stripped.startsWith("#")) {
          // Resolve standard relative paths against the parent URL
          let absUrl = stripped.startsWith("http") ? stripped : baseUrl + stripped;
          
          try {
            const absUrlObj = new URL(stripped, decodedUrl);
            // Merge search parameters from parent if they are missing in the child URL
            manifestUrlObj.searchParams.forEach((val, key) => {
              if (!absUrlObj.searchParams.has(key)) {
                absUrlObj.searchParams.set(key, val);
              }
            });
            absUrl = absUrlObj.href;
          } catch (e) {
            // Fallback to manual resolution if URL constructor fails
            if (parentSearch && !absUrl.includes("?")) {
              absUrl += parentSearch;
            }
          }

          return `/api/stream?url=${encodeURIComponent(absUrl)}`;
        }
        
        // Match occurrences of URI="..." inside tags (like subtitles, keys, or external stream links) and rewrite
        if (stripped && stripped.includes('URI="')) {
          return stripped.replace(/URI="([^"]+)"/g, (match, p1) => {
            let absUrl = p1.startsWith("http") ? p1 : baseUrl + p1;
            try {
              const absUrlObj = new URL(p1, decodedUrl);
              manifestUrlObj.searchParams.forEach((val, key) => {
                if (!absUrlObj.searchParams.has(key)) {
                  absUrlObj.searchParams.set(key, val);
                }
              });
              absUrl = absUrlObj.href;
            } catch (e) {
              if (parentSearch && !absUrl.includes("?")) {
                absUrl += parentSearch;
              }
            }
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
      const readable = Readable.fromWeb(response.body as any);
      
      readable.on("error", (err: any) => {
        // Safe logging of aborts or terminated streams due to client disconnect
        if (err?.name === "AbortError" || err?.message?.includes("terminated") || err?.message?.includes("aborted")) {
          console.log("[Stream] Reader stream aborted or terminated cleanly by client action (e.g. skip/stop).");
        } else {
          console.error("[Stream] Reader stream error:", err?.message || err);
        }
        try {
          if (!res.writableEnded) {
            res.end();
          }
        } catch (resErr) {
          // ignore
        }
      });

      res.on("error", (err: any) => {
        console.warn("[Stream] Destination response error:", err?.message || err);
      });

      readable.pipe(res);
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
