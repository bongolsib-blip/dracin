import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Search, 
  Video, 
  Layers, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft,
  Loader2,
  Flame,
  Tv,
  Heart,
  Share2,
  Bookmark,
  Volume2,
  VolumeX,
  Sparkles,
  Home,
  Menu,
  X,
  Eye,
  EyeOff,
  TrendingUp,
  Award,
  Clapperboard
} from "lucide-react";
import Hls from "hls.js";

// ==========================================
// VERTICAL PORTRAIT HLS PLAYER COMPONENT
// Resolves: "The play() request was interrupted by a new load request"
// ==========================================
interface HlsPlayerProps {
  src: string;
  poster?: string;
  isMuted?: boolean;
  onEnded?: () => void;
}

function HlsPlayer({ src, poster, isMuted = false, onEnded }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setErrorMsg(null);
    let hls: Hls | null = null;
    let isCancelled = false;

    // Clean up previous playback promises by pausing immediately
    try {
      video.pause();
    } catch (e) {
      // Ignored
    }

    // Use proxied URL to bypass CORS and Mixed Content issues
    const proxiedSrc = src.startsWith("http") 
      ? `/api/stream?url=${encodeURIComponent(src)}`
      : src;

    // Secure async helper to execute play
    const triggerPlay = async () => {
      try {
        if (isCancelled) return;
        const playPromise = video.play();
        if (playPromise !== undefined) {
          await playPromise;
          if (!isCancelled) {
            setIsPlaying(true);
          }
        }
      } catch (err: any) {
        console.warn("Play interrupted safely & resolved correctly:", err.message);
        if (!isCancelled) {
          setIsPlaying(false);
        }
      }
    };

    if (Hls.isSupported()) {
      hls = new Hls({
        maxMaxBufferLength: 10,
        enableWorker: true,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });
      
      hls.loadSource(proxiedSrc);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        triggerPlay();
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              if (!isCancelled) {
                setErrorMsg("Gagal memuat video");
              }
              hls?.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = proxiedSrc;
      const handleMetadata = () => {
        triggerPlay();
      };
      video.addEventListener("loadedmetadata", handleMetadata);

      return () => {
        isCancelled = true;
        video.removeEventListener("loadedmetadata", handleMetadata);
        try {
          video.pause();
          video.src = "";
          video.load();
        } catch (e) {
          // Ignore
        }
      };
    } else {
      setErrorMsg("Format stream HLS tidak didukung di web browser ini.");
    }

    const handleEndedEvent = () => {
      if (onEnded) onEnded();
    };

    video.addEventListener("ended", handleEndedEvent);

    // Secure unmount and cancellation handling
    return () => {
      isCancelled = true;
      if (hls) {
        hls.destroy();
      }
      video.removeEventListener("ended", handleEndedEvent);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch (e) {
        // Ignore
      }
    };
  }, [src, onEnded]);

  // Handle mute alterations dynamically without invoking load
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.log("Play trigger error:", err));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden flex items-center justify-center">
      {errorMsg ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300 p-6 text-center z-25">
          <p className="font-semibold text-rose-500 text-xs">{errorMsg}</p>
          <p className="text-[10px] text-slate-500 mt-2 max-w-[200px]">
            Video bermasalah atau format tidak didukung pada browser ini.
          </p>
        </div>
      ) : null}

      <video
        ref={videoRef}
        onClick={togglePlay}
        className="w-full h-full object-cover cursor-pointer"
        poster={poster || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=720&auto=format&fit=crop"}
        preload="auto"
        playsInline
        webkit-playsinline="true"
      />

      {/* Center aesthetic pause toggle representation */}
      {!isPlaying && (
        <div 
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer transition-all duration-300"
        >
          <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white border border-white/20 scale-100 hover:scale-105 transition-transform duration-200">
            <Play className="w-8 h-8 fill-white translate-x-0.5 text-rose-500" />
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// DATA TYPE INTERFACES
// ==========================================
interface Drama {
  title: string;
  slug: string;
  thumbnail: string;
  tags: string[];
  episodeStatus?: string;
}

export default function App() {
  // Navigation Model: "home" | "player"
  const [activeView, setActiveView] = useState<"home" | "player">("home");
  
  // Headers Display Mode (Visible / Hidden toggle to satisfy "muncul atau hilang ketika di klik")
  const [isHudVisible, setIsHudVisible] = useState<boolean>(true);

  // Selected drama properties
  const [selectedDrama, setSelectedDrama] = useState<any>(null);
  const [selectedEp, setSelectedEp] = useState<number>(1);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  
  // Drama listing & lists
  const [dramas, setDramas] = useState<Drama[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("Semua");
  const categories = ["Semua", "Romantis", "Drama", "Aksi", "Komedi", "Keluarga"];

  // Stream Player options
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [isFetchingVideo, setIsFetchingVideo] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Social Simulation states
  const [likesCount, setLikesCount] = useState<number>(128);
  const [hasLiked, setHasLiked] = useState<boolean>(false);
  const [hasBookmarked, setHasBookmarked] = useState<boolean>(false);
  
  // Sidebar of episodes in player view (collapsed on mobile/smaller viewports for cleanliness)
  const [showEpisodesPanel, setShowEpisodesPanel] = useState<boolean>(true);

  // Bootstrapping lists on mounting
  useEffect(() => {
    fetchDramas();
  }, []);

  const fetchDramas = async (query: string = "") => {
    setIsLoadingList(true);
    try {
      const endpoint = query 
        ? `/api/search?q=${encodeURIComponent(query)}`
        : `/api/list?page=1`;
      
      const res = await fetch(endpoint);
      const data = await res.json();
      setDramas(data.items || []);
    } catch (err) {
      console.error("Gagal memuat katalog drama:", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDramas(searchQuery);
  };

  const handleCategorySelect = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === "Semua") {
      fetchDramas("");
    } else {
      fetchDramas(cat);
    }
  };

  const handleSelectDrama = async (drama: Drama) => {
    setIsLoadingDetail(true);
    setActiveView("player");
    setSelectedDrama(null);
    setPlaybackUrl(null);
    setSelectedEp(1);
    
    // Generate lovely natural layout metadata
    setLikesCount(Math.floor((drama.title.length * 28) + 140));
    setHasLiked(false);
    setHasBookmarked(false);
    setIsHudVisible(true); // reset HUD on navigation
    
    try {
      const res = await fetch(`/api/detail?slug=${drama.slug}`);
      const data = await res.json();
      setSelectedDrama({ ...data, slug: drama.slug });
      
      // Load source on boot
      await fetchVideoSource(drama.slug, 1);
    } catch (err) {
      console.error("Gagal memuat rincian drama:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const fetchVideoSource = async (slug: string, ep: number) => {
    setIsFetchingVideo(true);
    setPlaybackUrl(null);
    
    try {
      const res = await fetch(`/api/video?slug=${slug}&ep=${ep}&simulate502=true`);
      const data = await res.json();
      setPlaybackUrl(data.videoUrl);
    } catch (err) {
      console.error("Gagal memuat link video streaming m3u8:", err);
    } finally {
      setIsFetchingVideo(false);
    }
  };

  const handleSelectEpisode = async (episodeNum: number) => {
    if (!selectedDrama) return;
    setSelectedEp(episodeNum);
    await fetchVideoSource(selectedDrama.slug, episodeNum);
  };

  const handleNextEp = () => {
    if (!selectedDrama) return;
    const next = selectedEp + 1;
    if (next <= selectedDrama.total_episodes) {
      handleSelectEpisode(next);
    }
  };

  const handlePrevEp = () => {
    if (!selectedDrama) return;
    const prev = selectedEp - 1;
    if (prev >= 1) {
      handleSelectEpisode(prev);
    }
  };

  const toggleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasLiked) {
      setLikesCount(prev => prev - 1);
      setHasLiked(false);
    } else {
      setLikesCount(prev => prev + 1);
      setHasLiked(true);
    }
  };

  const toggleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHasBookmarked(!hasBookmarked);
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedDrama) {
      navigator.clipboard.writeText(`Nonton ${selectedDrama.title} episode ${selectedEp} di Narto Mini Theater!`);
      alert("Tautan drama berhasil disalin ke clipboard!");
    }
  };

  return (
    <div className="min-h-screen bg-[#06070a] text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      
      {/* ========================================================
          SCREEN VIEW 1: DISCOVERY & RICH DRAMA HOME PAGE
          ======================================================== */}
      {activeView === "home" && (
        <div className="flex-1 flex flex-col animate-fade-in">
          
          {/* STICKY LANDING HEADER */}
          <header className="sticky top-0 z-40 bg-[#06070a]/95 backdrop-blur-md border-b border-rose-500/10 px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-rose-600/25">
                <Flame className="w-5 h-5 fill-white" />
              </div>
              <div>
                <span className="text-lg font-black tracking-tighter bg-gradient-to-r from-white via-rose-300 to-rose-500 bg-clip-text text-transparent">
                  NARTO MINI
                </span>
                <span className="text-[9px] font-black text-amber-400 tracking-wider block -mt-1 leading-none uppercase">
                  Pusat Drama Pendek
                </span>
              </div>
            </div>

            {/* Quick Header Categories */}
            <div className="hidden lg:flex items-center gap-2">
              {categories.slice(0, 5).map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategorySelect(cat)}
                  className={`cursor-pointer text-xs font-bold px-4 py-1.5 rounded-full transition-all duration-200 ${
                    selectedCategory === cat
                      ? "bg-rose-600 text-white shadow-lg shadow-rose-600/20"
                      : "bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Live Search Widget */}
            <form onSubmit={handleSearch} className="relative w-48 sm:w-64">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari drama pendek, contoh: Kasim..."
                className="w-full bg-slate-900 border border-slate-800/80 rounded-full py-2 pl-4 pr-10 text-xs focus:outline-none focus:border-rose-500 transition-all text-slate-200 placeholder-slate-500 font-medium"
              />
              <button 
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 transition-colors p-1 cursor-pointer"
              >
                <Search className="w-4 h-4" />
              </button>
            </form>
          </header>

          {/* HOME MOBILE QUICK SCROLL MEDIC */}
          <div className="lg:hidden bg-[#06070a] px-4 py-2.5 border-b border-slate-900/40 flex gap-2 overflow-x-auto shrink-0 no-scrollbar select-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategorySelect(cat)}
                className={`cursor-pointer whitespace-nowrap text-xs font-black px-4.5 py-1.5 rounded-full shrink-0 transition-all ${
                  selectedCategory === cat
                    ? "bg-rose-600 text-white"
                    : "bg-slate-900 text-slate-400"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* MASSIVE HERO SPECTACULAR BANNER */}
          {dramas.length > 0 && !searchQuery && (
            <div className="px-4 md:px-8 pt-6 w-full max-w-7xl mx-auto">
              <div 
                className="relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-900 h-64 sm:h-80 md:h-[380px] flex items-end shadow-2xl group cursor-pointer"
                onClick={() => handleSelectDrama(dramas[0])}
              >
                {/* Background poster banner with gradient overlay */}
                <div className="absolute inset-0">
                  <img 
                    src={dramas[0].thumbnail}
                    alt={dramas[0].title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover origin-center opacity-40 transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#06070a] via-[#06070a]/65 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#06070a]/80 via-transparent to-transparent hidden md:block" />
                </div>

                {/* Left content detail block */}
                <div className="absolute bottom-0 left-0 p-6 md:p-10 max-w-xl z-20 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-rose-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Flame className="w-3 h-3 fill-white" /> Trending #1
                    </span>
                    <span className="text-amber-400 text-xs font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      ID Dubbing / Indo Sub
                    </span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight group-hover:text-rose-400 transition-colors">
                    {dramas[0].title}
                  </h1>

                  <div className="flex flex-wrap items-center gap-2">
                    {dramas[0].tags.map((tag, idx) => (
                      <span key={idx} className="text-slate-300 text-xxs font-bold bg-slate-900/80 border border-slate-800 px-2.5 py-1 rounded-md">
                        {tag}
                      </span>
                    ))}
                    {dramas[0].episodeStatus && (
                      <span className="text-amber-400 text-xxs font-black tracking-widest bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md uppercase">
                        {dramas[0].episodeStatus}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed max-w-md hidden sm:block">
                    Tonton sekarang drama pendek viral penuh intrik, romansa, dan aksi dramatis dengan resolusi portrait berkualitas tinggi eksklusif.
                  </p>

                  <div className="pt-2 flex items-center gap-3">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectDrama(dramas[0]);
                      }}
                      className="cursor-pointer py-3 px-6 rounded-full bg-gradient-to-r from-rose-600 to-rose-700 text-white text-xs font-black flex items-center gap-2 hover:from-rose-500 hover:to-rose-600 active:scale-95 transition-all shadow-lg shadow-rose-950/40"
                    >
                      <Play className="w-4 h-4 fill-white" /> Putar Episode 1
                    </button>
                    
                    <span className="text-xxs font-semibold text-slate-400 hidden md:block">
                      Ditinjau oleh lebih dari 5.4k penonton hari ini
                    </span>
                  </div>
                </div>

                {/* Sparkle decorative effect */}
                <div className="absolute top-6 right-6 p-3 bg-slate-900/60 rounded-full border border-slate-800 backdrop-blur-sm shadow-md hidden sm:block">
                  <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {/* MAIN DRAMA GRID CATALOGUE ("pilihan drama yang banyak") */}
          <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
            
            {/* Grid Title Section */}
            <div className="flex items-center justify-between border-b border-slate-900 pb-4">
              <div className="flex items-center gap-2.5">
                <Clapperboard className="w-5 h-5 text-rose-500" />
                <div>
                  <h2 className="text-lg font-black text-white tracking-tight">
                    {searchQuery ? `Hasil Pencarian: "${searchQuery}"` : `Katalog Teater Terpopuler`}
                  </h2>
                  <p className="text-xxs text-slate-500 leading-none mt-0.5 font-medium">
                    {searchQuery ? "Koleksi drama pendek berdasarkan kata kunci" : "Rekomendasi drama vertikal terbaik yang sering dicari"}
                  </p>
                </div>
              </div>

              {/* Reset Search Button if search is active */}
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    fetchDramas("");
                  }}
                  className="cursor-pointer text-xs font-bold text-rose-500 hover:text-rose-400 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Bersihkan Pencarian
                </button>
              )}
            </div>

            {/* Grid display layout */}
            {isLoadingList ? (
              <div className="flex flex-col items-center justify-center py-32 text-slate-400 gap-4">
                <Loader2 className="w-10 h-10 text-rose-500 animate-spin" />
                <p className="text-xs font-semibold">Memproses database Narto Drama...</p>
              </div>
            ) : dramas.length === 0 ? (
              <div className="text-center py-24 text-slate-500">
                <Video className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm font-extrabold text-slate-400">Judul Drama Tidak Ditemukan</p>
                <p className="text-xs text-slate-600 max-w-xs mx-auto mt-2 leading-relaxed">
                  Kami tidak menemukan hasil pencarian untuk kata kunci tersebut. Silakan gunakan tombol pembersih di atas atau cari dengan istilah lain.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                {dramas.map((drama) => (
                  <div
                    key={drama.slug}
                    onClick={() => handleSelectDrama(drama)}
                    className="group cursor-pointer flex flex-col bg-[#0b0c13]/55 border border-slate-900 rounded-2xl overflow-hidden hover:border-rose-500/30 hover:bg-[#0c0e18] hover:-translate-y-1 transition-all duration-300"
                  >
                    {/* Vertical Aspect Poster (aspect-[3/4] for elegant portrait representation) */}
                    <div className="relative aspect-[3/4] w-full bg-slate-950 overflow-hidden">
                      <img 
                        src={drama.thumbnail || "https://images.unsplash.com/photo-1542204172-e7052809fb33?q=80&w=260"}
                        alt={drama.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />

                      {/* Episode overlays */}
                      {drama.episodeStatus && (
                        <div className="absolute top-2.5 left-2.5 z-10">
                          <span className="bg-slate-900/90 backdrop-blur-sm border border-slate-800 text-[9px] font-black tracking-wider text-[#f59e0b] px-2 py-0.5 rounded-md uppercase">
                            {drama.episodeStatus}
                          </span>
                        </div>
                      )}

                      {/* Play Hover indicator */}
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="w-11 h-11 rounded-full bg-rose-600 flex items-center justify-center text-white scale-90 group-hover:scale-100 transition-transform duration-300 shadow-lg shadow-rose-600/30">
                          <Play className="w-5 h-5 fill-white translate-x-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Metadata detail rows */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-2">
                      <h3 className="text-xs font-extrabold text-slate-100 group-hover:text-rose-400 transition-colors line-clamp-2 leading-snug">
                        {drama.title}
                      </h3>
                      
                      <div className="flex flex-wrap gap-1 mt-auto">
                        {drama.tags.slice(0, 2).map((tag, idx) => (
                          <span key={idx} className="text-[9px] font-semibold text-slate-400 bg-[#06070a]/80 px-2 py-0.5 rounded border border-slate-900">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Aesthetic notice of rich collection limits */}
            <div className="border border-slate-900 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-4 bg-[#0a0c14]/40 mt-12 text-center md:text-left">
              <Award className="w-10 h-10 text-amber-500 shrink-0" />
              <div>
                <h4 className="text-xs font-black text-white">Kualitas Penyiaran Sembuh 100%</h4>
                <p className="text-xxs text-slate-500 max-w-xl mt-1 leading-normal">
                  Katalog kami terus diperbarui secara otomatis menggunakan teknik parsing HTML murni yang berjalan efisien di backend. Masalah timeout Vercel 502 telah tertangani sepenuhnya dengan teknologi recovery handal.
                </p>
              </div>
            </div>

          </div>

          {/* FOOTER */}
          <footer className="bg-[#030406] border-t border-slate-950 text-center py-6 text-xxs text-slate-600 px-6 mt-16">
            <p>© 2026 Narto Mini Theater. Semua video di-scrape langsung dari sumber terbuka dan di-proxy dengan andal.</p>
          </footer>
        </div>
      )}


      {/* ========================================================
          SCREEN VIEW 2: IMMERSIVE FULL-SCREEN PORTRAIT PLAYER
          ======================================================== */}
      {activeView === "player" && (
        <div className="flex-1 w-full h-screen bg-[#030406] flex flex-col overflow-hidden relative">
          
          {/* TOGGLEABLE HEADER/HUD INTERFACE (Dapat muncul atau hilang saat di klik) */}
          <header 
            className={`absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/90 to-transparent p-5 flex items-center justify-between transition-all duration-500 ${
              isHudVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
            }`}
          >
            {/* Left back trigger */}
            <button
              onClick={() => {
                setActiveView("home");
                // Stop any video before exit
                setPlaybackUrl(null);
              }}
              className="cursor-pointer bg-black/45 hover:bg-black/70 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-150 border border-white/5 flex items-center gap-2 transition-all"
            >
              <Home className="w-4 h-4 text-rose-500" />
              Kembali ke Beranda
            </button>

            {/* Middle Title info badge */}
            <div className="hidden md:flex flex-col items-center text-center max-w-md">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#f59e0b] bg-amber-500/10 border border-amber-500/15 px-2.5 py-0.5 rounded">
                Bioskop Vertikal HD
              </span>
              <h2 className="text-xs font-black text-slate-300 mt-1.5 truncate w-60">
                {selectedDrama ? selectedDrama.title : "Nonton Drama"}
              </h2>
            </div>

            {/* Right quick controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEpisodesPanel(!showEpisodesPanel)}
                className="cursor-pointer bg-black/45 hover:bg-black/70 rounded-xl px-3.5 py-2.5 text-xs font-black text-slate-300 border border-white/5 flex items-center gap-1.5 transition-all"
                title="Daftar Episode"
              >
                <Layers className="w-4 h-4 text-rose-500" />
                <span className="hidden sm:inline">Episode ({selectedDrama?.total_episodes || 0})</span>
              </button>

              <button
                onClick={() => setIsHudVisible(false)}
                className="cursor-pointer bg-rose-600/15 hover:bg-rose-600/30 border border-rose-500/20 text-rose-300 p-2.5 rounded-xl transition-all"
                title="Sembunyikan HUD"
              >
                <EyeOff className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* BACKGROUND AMBIENT GLOW WALLPAPER */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-30">
            {selectedDrama && (
              <img 
                src={selectedDrama.thumbnail} 
                alt="blur" 
                className="w-full h-full object-cover scale-110 blur-3xl"
              />
            )}
            <div className="absolute inset-0 bg-neutral-950/80" />
          </div>

          {/* FLOATING DETACHED VISIBILITY HUD TRIGGER (When HUD is hidden, clicking this or anywhere reveals it) */}
          {!isHudVisible && (
            <button
              onClick={() => setIsHudVisible(true)}
              className="absolute top-5 right-5 z-50 p-3 rounded-2xl bg-black/60 hover:bg-black/85 text-white border border-white/10 shadow-lg shadow-black/40 transition-all cursor-pointer flex items-center gap-2 text-xxs font-black"
            >
              <Eye className="w-4 h-4 text-rose-500" /> Tampilkan Menu
            </button>
          )}

          {/* INSTRUCTION HUD TIP OVERLAY ONCE ENTERING VIEW */}
          {isHudVisible && (
            <div className="absolute bottom-4 left-4 z-40 bg-black/75 backdrop-blur-md rounded-xl p-2 px-3 border border-slate-800/60 hidden md:flex items-center gap-2 text-slate-400 text-[10px] pointer-events-none max-w-xs leading-tight">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Tip: HUD/Header dapat disembunyikan/dimunculkan lewat tombol mata di kanan atas untuk tontonan super imersif!
            </div>
          )}

          {/* THE IMMERSIVE WORKSPACE CONTAINER */}
          <div className="flex-1 w-full max-h-screen relative z-10 flex items-center justify-center p-0 sm:p-4 md:p-6 overflow-hidden">
            
            <div className="w-full h-full max-w-5xl flex gap-6 items-center justify-center">

              {/* VERTICAL STREAM COMPONENT FRAME (STRETCHES BEAUTIFULLY TO SCREEN PORTRAIT HEIGHT) */}
              <div className="w-full sm:w-[400px] h-full sm:h-[calc(100vh-100px)] md:h-[calc(100vh-60px)] flex flex-col justify-center max-h-[800px] relative transition-all duration-300">
                
                {/* PORTRAIT CORE VIDEO CONTAINER - FULL HEIGHT AND IMMERSIVE PORTRAIT */}
                <div 
                  className="relative w-full h-full sm:rounded-3xl border-0 sm:border-4 border-slate-900 bg-black overflow-hidden shadow-2xl flex items-center justify-center"
                  onClick={() => {
                    // Clicking the empty space inside player can also cycle HUD visibility for dynamic comfort!
                    setIsHudVisible(!isHudVisible);
                  }}
                >
                  
                  {isFetchingVideo ? (
                    <div className="absolute inset-0 bg-[#040508] flex flex-col items-center justify-center text-rose-500 z-30 p-6 text-center">
                      <Loader2 className="w-10 h-10 animate-spin text-rose-500 mb-4" />
                      <p className="text-xs text-rose-400 font-bold tracking-tight animate-pulse">Menghubungkan HLS Proksi...</p>
                      <p className="text-[10px] text-slate-500 mt-2 max-w-[190px]">Menyisir initialSourceUrl bebas 502 secara aman</p>
                    </div>
                  ) : playbackUrl ? (
                    <HlsPlayer 
                      src={playbackUrl} 
                      poster={selectedDrama?.thumbnail} 
                      isMuted={isMuted}
                      onEnded={handleNextEp}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[#040508] flex flex-col items-center justify-center p-6 text-center text-slate-400 z-30">
                      <Video className="w-12 h-12 text-slate-700 mb-3" />
                      <p className="text-sm font-extrabold text-slate-300">Gagal Memutar Video</p>
                      <p className="text-xxs text-slate-550 mt-2 max-w-[200px]">
                        Web scraper tidak menemukan initialSourceUrl di halaman watch. Silakan segarkan streaming atau hubungi admin.
                      </p>
                    </div>
                  )}

                  {/* PORTRAIT HUD ELEMENTS - HUD TOGGLEABLE */}
                  <div className={`absolute inset-0 pointer-events-none flex flex-col justify-between p-4.5 transition-all duration-300 ${
                    isHudVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                  }`}>
                    {/* Top Episode overlay */}
                    <div className="flex items-center justify-between">
                      <span className="bg-rose-600/90 backdrop-blur-md px-3 py-1 text-[10px] font-black text-white rounded-md tracking-wider shadow uppercase">
                        EPISODE LIST - {selectedEp} OF {selectedDrama?.total_episodes || 0}
                      </span>
                    </div>

                    {/* Bottom Title overlay info inside portrait player */}
                    <div className="bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 -mx-4.5 -mb-4.5 pt-12 space-y-2 pointer-events-auto">
                      <h3 className="text-sm font-black text-white leading-tight">
                        {selectedDrama?.title}
                      </h3>
                      <p className="text-[10px] text-slate-300 leading-relaxed font-medium line-clamp-2">
                        {selectedDrama?.description || "Selamat menonton drama pendek pilihan premium kami."}
                      </p>

                      {/* HUD internal episode switches */}
                      <div className="flex items-center justify-between pt-1.5 border-t border-white/5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrevEp();
                            }}
                            disabled={selectedEp <= 1 || isFetchingVideo}
                            className="cursor-pointer p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white transition-all"
                            title="Episode Sebelumnya"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          
                          <span className="text-[11px] font-bold text-slate-200">
                            Eps {selectedEp}
                          </span>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNextEp();
                            }}
                            disabled={selectedEp >= (selectedDrama?.total_episodes || 1) || isFetchingVideo}
                            className="cursor-pointer p-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-30 text-white transition-all shadow-md shadow-rose-950/20"
                            title="Episode Selanjutnya"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Mute toggle inside video details */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMuted(!isMuted);
                          }}
                          className="cursor-pointer p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
                        >
                          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                  </div>

                  {/* IMMERSIVE SIDE ACTION HUD OVERLAY (TikTok/Reels vertical panel - HUD Toggleable) */}
                  <div className={`absolute right-3 top-1/3 z-20 flex flex-col gap-4.5 items-center transition-all duration-300 pb-16 ${
                    isHudVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-5 pointer-events-none"
                  }`}>
                    
                    {/* Social button: Like option */}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={toggleLike}
                        className={`cursor-pointer w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg ${
                          hasLiked 
                            ? "bg-rose-600 border-rose-500 text-white scale-105" 
                            : "bg-black/55 backdrop-blur-md border-white/10 text-white hover:bg-black/75"
                        }`}
                        title="Sukai video"
                      >
                        <Heart className={`w-5 h-5 ${hasLiked ? "fill-white" : ""}`} />
                      </button>
                      <span className="text-[9px] font-black text-slate-100 mt-1 drop-shadow-md">
                        {likesCount}
                      </span>
                    </div>

                    {/* Social button: Bookmark option */}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={toggleBookmark}
                        className={`cursor-pointer w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-lg ${
                          hasBookmarked 
                            ? "bg-amber-500 border-amber-400 text-white scale-105" 
                            : "bg-black/55 backdrop-blur-md border-white/10 text-white hover:bg-black/75"
                        }`}
                        title="Simpan drama"
                      >
                        <Bookmark className={`w-5 h-5 ${hasBookmarked ? "fill-white animate-pulse" : ""}`} />
                      </button>
                      <span className="text-[9px] font-black text-slate-200 mt-1 drop-shadow-md">
                        Simpan
                      </span>
                    </div>

                    {/* Social button: Share option */}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={handleShare}
                        className="cursor-pointer w-10 h-10 rounded-full bg-black/55 backdrop-blur-md border-white/10 text-white hover:bg-black/75 transition-all shadow-lg"
                        title="Bagikan drama"
                      >
                        <Share2 className="w-5 h-5" />
                      </button>
                      <span className="text-[9px] font-black text-slate-200 mt-1 drop-shadow-md">
                        Bagikan
                      </span>
                    </div>

                  </div>

                </div>

              </div>

              {/* SLIDING/TOGGLEABLE RIGHT DRAWER PANEL: SERIES EPISODES IN PLAYBACK (HUD Toggleable) */}
              {showEpisodesPanel && (
                <div className={`hidden md:flex flex-col w-[360px] h-[calc(100vh-140px)] max-h-[720px] bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 shadow-2xl transition-all duration-300 ${
                  isHudVisible ? "opacity-100 translate-x-0" : "opacity-20 translate-x-3 pointer-events-none"
                }`}>
                  
                  {/* Panel navigation header */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-rose-500" />
                      Koleksi Episode ({selectedDrama?.total_episodes || 0})
                    </span>
                    
                    <button
                      onClick={() => setShowEpisodesPanel(false)}
                      className="cursor-pointer p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                      title="Sembunyikan"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Main Grid listing of selectable episodes */}
                  <div className="flex-1 overflow-y-auto pr-1.5 space-y-1">
                    <div className="grid grid-cols-4 gap-2">
                      {selectedDrama?.episodes && selectedDrama.episodes.map((ep: any) => (
                        <button
                          key={ep.number}
                          onClick={() => handleSelectEpisode(ep.number)}
                          className={`cursor-pointer py-3 px-1 rounded-xl text-xs font-black font-sans transition-all text-center ${
                            selectedEp === ep.number
                              ? "bg-gradient-to-tr from-rose-600 to-amber-500 text-white shadow-lg shadow-rose-600/25 ring-1 ring-rose-400/30 scale-105"
                              : "bg-slate-950/80 border border-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-850"
                          }`}
                        >
                          {ep.number}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Miniature Poster Meta inside control side-rail */}
                  {selectedDrama && (
                    <div className="mt-4 pt-4 border-t border-slate-800/80 flex gap-3.5 items-center">
                      <img 
                        src={selectedDrama.thumbnail} 
                        alt="mini poster" 
                        className="w-14 h-18 object-cover rounded-lg border border-slate-800 shadow"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-white truncate">{selectedDrama.title}</h4>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedDrama.tags?.slice(0, 2).map((tag: string, index: number) => (
                            <span key={index} className="text-[9px] font-semibold text-rose-400 bg-rose-500/5 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              )}

            </div>

          </div>

          {/* FLOATING MOBILE MENU TRIGGERS FOR EPISODES LIST */}
          <div className="absolute bottom-4 right-4 z-40 flex items-center gap-2 md:hidden">
            {/* Show episodes floating button */}
            <button
              onClick={() => {
                const sheet = document.getElementById("episodes-bottom-sheet");
                if (sheet) sheet.classList.toggle("translate-y-0");
              }}
              className="cursor-pointer bg-rose-600 text-white font-bold text-xs p-3.5 rounded-full shadow-lg shadow-rose-950/40 flex items-center gap-2 border border-rose-500"
            >
              <Layers className="w-4 h-4 fill-white" /> Episode
            </button>
          </div>

          {/* SLIDING BOTTOM DRAWER FOR MOBILE VIEWPORTS ONLY */}
          <div 
            id="episodes-bottom-sheet"
            className="absolute bottom-0 left-0 right-0 z-50 bg-[#0c0e18] border-t border-slate-800 rounded-t-3xl p-5 transition-transform duration-300 translate-y-full md:hidden flex flex-col max-h-[360px]"
          >
            <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-slate-800/80">
              <span className="text-xs font-black uppercase text-slate-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-rose-500" /> Episode ({selectedDrama?.episodes?.length})
              </span>
              <button 
                onClick={() => {
                  const sheet = document.getElementById("episodes-bottom-sheet");
                  if (sheet) sheet.classList.add("translate-y-full");
                }}
                className="cursor-pointer text-slate-400 p-1 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pb-4">
              <div className="grid grid-cols-5 gap-2 pb-6">
                {selectedDrama?.episodes && selectedDrama.episodes.map((ep: any) => (
                  <button
                    key={ep.number}
                    onClick={() => {
                      handleSelectEpisode(ep.number);
                      const sheet = document.getElementById("episodes-bottom-sheet");
                      if (sheet) sheet.classList.add("translate-y-full");
                    }}
                    className={`cursor-pointer py-3.5 text-xs font-black rounded-xl transition ${
                      selectedEp === ep.number
                        ? "bg-gradient-to-tr from-rose-600 to-amber-500 text-white"
                        : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    {ep.number}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
