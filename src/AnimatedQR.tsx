import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import JSZip from 'jszip';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import {
  X,
  Play,
  Pause,
  Download,
  RefreshCw,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Zap,
  ZapOff,
  Upload,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  ScanLine,
  Clapperboard,
  Loader2,
} from 'lucide-react';

/* ============================================================================
 * Protocol
 * ----------------------------------------------------------------------------
 * Every QR frame encodes a plain-text string:
 *
 *   Q1|<sessionId>|<index>|<total>|<chunkCrc32Hex>|<totalCrc32Hex>|<base64Chunk>
 *
 * - sessionId: random 5-char id identifying one image's broadcast, so the
 *   scanner never mixes chunks from two different images/sessions.
 * - index/total: this chunk's position and the total chunk count.
 * - chunkCrc32Hex: CRC32 of THIS chunk's payload only -> lets the scanner
 *   silently discard a single misread frame instead of corrupting the image.
 * - totalCrc32Hex: CRC32 of the full base64 payload -> final integrity check
 *   once every chunk has been collected.
 * ==========================================================================*/

const PROTOCOL_TAG = 'Q1';

const RELIABILITY_PRESETS = {
  fast: 220,
  balanced: 140,
  reliable: 90,
} as const;
type ReliabilityKey = keyof typeof RELIABILITY_PRESETS;

// ---------------------------------------------------------------------------
// CRC32 (pure JS, table-based) — used for per-chunk and whole-payload checks.
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Hex(str: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return crc.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function fmt(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('file read error'));
    reader.readAsDataURL(file);
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load error'));
    img.src = src;
  });
}

function fitDimensions(w: number, h: number, maxDim: number): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
}

// Decodes every frame of an uploaded animated GIF — not just the first one —
// by properly compositing each frame onto a persistent canvas according to
// the GIF disposal spec (so it works correctly for any real .gif, including
// the exact file this tool exports), then runs jsQR against each composited
// frame in sequence.
async function scanGifFile(file: File, onFrameDecoded: (text: string) => void): Promise<void> {
  const buffer = await file.arrayBuffer();
  const parsedGif = parseGIF(buffer);
  const frames: ParsedFrame[] = decompressFrames(parsedGif, true);
  if (frames.length === 0) return;

  const fullWidth = parsedGif.lsd.width;
  const fullHeight = parsedGif.lsd.height;

  const canvas = document.createElement('canvas');
  canvas.width = fullWidth;
  canvas.height = fullHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) return;

  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = fullWidth;
  scanCanvas.height = fullHeight;
  const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
  if (!scanCtx) return;

  let previousFrame: ParsedFrame | null = null;
  let savedRegion: ImageData | null = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const { left, top, width, height } = frame.dims;

    // Apply the PREVIOUS frame's disposal method now, right before drawing
    // this frame — that is when the GIF spec says disposal takes effect.
    if (previousFrame) {
      const p = previousFrame.dims;
      if (previousFrame.disposalType === 2) {
        ctx.clearRect(p.left, p.top, p.width, p.height);
      } else if (previousFrame.disposalType === 3 && savedRegion) {
        ctx.putImageData(savedRegion, p.left, p.top);
      }
      // disposalType 0 or 1: leave the canvas as-is.
    }

    // If this frame will need "restore to previous" disposal afterwards,
    // snapshot the region it's about to overwrite first.
    savedRegion = frame.disposalType === 3 ? ctx.getImageData(left, top, width, height) : null;

    patchCanvas.width = width;
    patchCanvas.height = height;
    const patchImageData = patchCtx.createImageData(width, height);
    patchImageData.data.set(frame.patch);
    patchCtx.putImageData(patchImageData, 0, 0);
    ctx.drawImage(patchCanvas, left, top);

    // The main canvas now holds this frame fully composited — scan it.
    scanCtx.clearRect(0, 0, fullWidth, fullHeight);
    scanCtx.drawImage(canvas, 0, 0);
    const imageData = scanCtx.getImageData(0, 0, fullWidth, fullHeight);
    const code = jsQR(imageData.data, fullWidth, fullHeight, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) onFrameDecoded(code.data);

    previousFrame = frame;

    if (i % 8 === 0) {
      // Yield periodically so the UI stays responsive on long GIFs.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

// Non-standard torch capability, not present in lib.dom.d.ts.
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

interface DecodeSession {
  sid: string;
  total: number;
  totalCrc: string;
  chunks: Map<number, string>;
}

// ---------------------------------------------------------------------------
// Translations (self-contained so this component can be dropped in anywhere)
// ---------------------------------------------------------------------------
const dict = {
  en: {
    title: 'Image ⇄ Animated QR',
    subtitle: 'Turn a small image into a looping QR sequence, or scan one back into an image',
    tabEncode: 'Image → QR',
    tabDecode: 'Scan → Image',
    close: 'Close',
    // Encode
    uploadImage: 'Choose an image',
    dropHint: 'Click to choose an image (PNG, JPG…)',
    changeImage: 'Change image',
    maxDimension: 'Max size',
    quality: 'JPEG quality',
    reliability: 'Scan reliability',
    reliabilityFast: 'Fast — denser codes',
    reliabilityBalanced: 'Balanced',
    reliabilityReliable: 'Reliable — more frames',
    regenerate: 'Regenerate',
    preparing: 'Generating QR frames…',
    fps: 'Playback speed',
    fpsUnit: 'fps',
    frames: 'Frames',
    dataSize: 'Encoded size',
    play: 'Play',
    pause: 'Pause',
    loop: 'Loop',
    downloadZip: 'Download frames (.zip)',
    downloadGif: 'Download as GIF (all-in-one)',
    generatingGif: 'Building GIF…',
    gifReady: 'GIF ready',
    frameOf: 'Frame {n} / {t}',
    chooseImageFirst: 'Choose a small, simple image to begin — photos work best under a few hundred pixels.',
    tooManyFrames: 'That produces {n} frames. For faster, more reliable scanning, try a smaller size or lower quality.',
    sessionId: 'Session',
    // Decode
    startCamera: 'Start camera scan',
    stopCamera: 'Stop camera',
    torchOn: 'Flashlight',
    torchOff: 'Flashlight off',
    uploadFrames: 'Or upload the exported .gif itself, or photos of captured frames',
    waitingFirstFrame: 'Point the camera steadily at the animated QR code',
    receivedFrames: '{n} / {t} frames received',
    reconstructed: 'Image reconstructed successfully',
    downloadImage: 'Download image',
    scanAgain: 'Scan again',
    reset: 'Reset',
    integrityError: 'Integrity check failed on the assembled image — resetting, please scan again.',
    cameraDenied: 'Camera access was denied. Allow camera permission in your browser and try again.',
    cameraNotFound: 'No camera was found on this device.',
    cameraInsecure: 'Camera access requires a secure connection (HTTPS).',
    cameraGeneric: 'Could not access the camera.',
    otherQrIgnored: 'A QR code was detected but it is not part of a QRaft animated sequence — ignored.',
    mismatchedSession: 'Ignoring frames from a different image. Press Reset to start scanning a new one.',
  },
  fa: {
    title: 'تصویر ⇄ QR متحرک',
    subtitle: 'یک تصویر کوچک را به دنباله‌ای از کدهای QR متحرک تبدیل کنید، یا آن را دوباره با دوربین به تصویر برگردانید',
    tabEncode: 'تصویر ← QR',
    tabDecode: 'اسکن ← تصویر',
    close: 'بستن',
    // Encode
    uploadImage: 'انتخاب تصویر',
    dropHint: 'برای انتخاب تصویر کلیک کنید (PNG, JPG…)',
    changeImage: 'تغییر تصویر',
    maxDimension: 'حداکثر ابعاد',
    quality: 'کیفیت JPEG',
    reliability: 'اولویت اسکن',
    reliabilityFast: 'سریع — کدهای متراکم‌تر',
    reliabilityBalanced: 'متعادل',
    reliabilityReliable: 'قابل‌اطمینان — فریم بیشتر',
    regenerate: 'ساخت دوباره',
    preparing: 'در حال ساخت فریم‌های QR…',
    fps: 'سرعت پخش',
    fpsUnit: 'فریم بر ثانیه',
    frames: 'تعداد فریم',
    dataSize: 'حجم داده رمزنگاری‌شده',
    play: 'پخش',
    pause: 'توقف',
    loop: 'تکرار خودکار',
    downloadZip: 'دانلود فریم‌ها (zip.)',
    downloadGif: 'دانلود به‌صورت GIF (یکجا)',
    generatingGif: 'در حال ساخت GIF…',
    gifReady: 'GIF آماده شد',
    frameOf: 'فریم {n} از {t}',
    chooseImageFirst: 'یک تصویر کوچک و ساده انتخاب کنید — تصاویر زیر چند صد پیکسل بهترین نتیجه را می‌دهند.',
    tooManyFrames: 'این تنظیمات {n} فریم تولید می‌کند. برای اسکن سریع‌تر و مطمئن‌تر، ابعاد یا کیفیت را کاهش دهید.',
    sessionId: 'شناسه نشست',
    // Decode
    startCamera: 'شروع اسکن با دوربین',
    stopCamera: 'توقف دوربین',
    torchOn: 'روشن کردن فلاش',
    torchOff: 'خاموش کردن فلاش',
    uploadFrames: 'یا خود فایل GIF خروجی، یا عکس فریم‌های گرفته‌شده را آپلود کنید',
    waitingFirstFrame: 'دوربین را به‌صورت ثابت روی کد QR متحرک بگیرید',
    receivedFrames: '{n} از {t} فریم دریافت شد',
    reconstructed: 'تصویر با موفقیت بازسازی شد',
    downloadImage: 'دانلود تصویر',
    scanAgain: 'اسکن دوباره',
    reset: 'شروع مجدد',
    integrityError: 'بررسی یکپارچگی تصویر بازسازی‌شده ناموفق بود — در حال شروع مجدد، لطفاً دوباره اسکن کنید.',
    cameraDenied: 'دسترسی به دوربین رد شد. لطفاً اجازه دسترسی به دوربین را در مرورگر فعال کرده و دوباره تلاش کنید.',
    cameraNotFound: 'هیچ دوربینی روی این دستگاه یافت نشد.',
    cameraInsecure: 'دسترسی به دوربین نیازمند اتصال امن (HTTPS) است.',
    cameraGeneric: 'امکان دسترسی به دوربین وجود نداشت.',
    otherQrIgnored: 'یک کد QR شناسایی شد اما بخشی از یک دنباله متحرک QRaft نیست — نادیده گرفته شد.',
    mismatchedSession: 'فریم‌های مربوط به یک تصویر دیگر نادیده گرفته می‌شوند. برای شروع اسکن تصویر جدید، دکمه شروع مجدد را بزنید.',
  },
};

type Dict = typeof dict.en;

function mapCameraError(err: unknown, d: Dict): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') return d.cameraDenied;
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') return d.cameraNotFound;
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) return d.cameraInsecure;
  return d.cameraGeneric;
}

interface AnimatedQRToolProps {
  language: 'en' | 'fa';
  darkMode: boolean;
  onClose: () => void;
}

const AnimatedQRTool: React.FC<AnimatedQRToolProps> = ({ language, onClose }) => {
  const d: Dict = dict[language];
  const isRtl = language === 'fa';

  const [mode, setMode] = useState<'encode' | 'decode'>('encode');

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{d.title}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{d.subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" aria-label={d.close}>
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="px-4 pt-3 flex-shrink-0">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => setMode('encode')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'encode'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <ImageIcon size={15} />
              {d.tabEncode}
            </button>
            <button
              onClick={() => setMode('decode')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'decode'
                  ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <ScanLine size={15} />
              {d.tabDecode}
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 flex-1">
          {mode === 'encode' ? <EncodePanel d={d} /> : <DecodePanel d={d} />}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Encode panel: image -> chunked, checksummed, looping QR animation
// ============================================================================
const EncodePanel: React.FC<{ d: Dict }> = ({ d }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [maxDimension, setMaxDimension] = useState(220);
  const [quality, setQuality] = useState(0.55);
  const [reliability, setReliability] = useState<ReliabilityKey>('balanced');

  const [qrFrames, setQrFrames] = useState<string[]>([]);
  const [encodedByteLength, setEncodedByteLength] = useState(0);
  const [sessionId, setSessionId] = useState<string>('');
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gifProgress, setGifProgress] = useState<{ done: number; total: number } | null>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [fps, setFps] = useState(5);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateFrames = useCallback(async (frameTexts: string[]): Promise<string[]> => {
    const frames: string[] = new Array(frameTexts.length);
    setGenProgress({ done: 0, total: frameTexts.length });
    for (let i = 0; i < frameTexts.length; i++) {
      const url = await QRCode.toDataURL(frameTexts[i], {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 380,
      });
      frames[i] = url;
      if (i % 4 === 0 || i === frameTexts.length - 1) {
        setGenProgress({ done: i + 1, total: frameTexts.length });
        // Yield to the main thread so the UI stays responsive for large images.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return frames;
  }, []);

  const processFile = useCallback(
    async (file: File, dim: number, q: number, rel: ReliabilityKey) => {
      setError(null);
      setPlaying(false);
      setQrFrames([]);
      setCurrentFrame(0);
      setGenProgress(null);
      try {
        const dataUrl = await readFileAsDataURL(file);
        const img = await loadImageEl(dataUrl);
        const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, dim);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(img, 0, 0, width, height);
        const jpegUrl = canvas.toDataURL('image/jpeg', q);
        const base64 = jpegUrl.split(',')[1] ?? '';
        if (!base64) throw new Error('encode failed');
        setSourcePreview(jpegUrl);
        setEncodedByteLength(base64.length);

        const chunkSize = RELIABILITY_PRESETS[rel];
        const total = Math.max(1, Math.ceil(base64.length / chunkSize));
        const sid = Math.random().toString(36).slice(2, 7);
        const totalCrc = crc32Hex(base64);
        setSessionId(sid);

        const frameTexts: string[] = [];
        for (let i = 0; i < total; i++) {
          const payload = base64.slice(i * chunkSize, (i + 1) * chunkSize);
          frameTexts.push(`${PROTOCOL_TAG}|${sid}|${i}|${total}|${crc32Hex(payload)}|${totalCrc}|${payload}`);
        }

        const frames = await generateFrames(frameTexts);
        setQrFrames(frames);
        setGenProgress(null);
        setPlaying(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setGenProgress(null);
      }
    },
    [generateFrames]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    void processFile(file, maxDimension, quality, reliability);
  };

  const handleRegenerate = () => {
    if (selectedFile) void processFile(selectedFile, maxDimension, quality, reliability);
  };

  // Animation loop
  useEffect(() => {
    if (!playing || qrFrames.length === 0) return;
    const interval = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = prev + 1;
        if (next >= qrFrames.length) {
          if (loop) return 0;
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [playing, fps, loop, qrFrames.length]);

  const downloadZip = async () => {
    if (qrFrames.length === 0) return;
    const zip = new JSZip();
    qrFrames.forEach((durl, i) => {
      const base64Data = durl.split(',')[1] ?? '';
      zip.file(`frame_${String(i + 1).padStart(4, '0')}.png`, base64Data, { base64: true });
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qraft-animated-frames.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Bakes all QR frames into a single looping animated GIF file, using the
  // current playback speed as the per-frame delay, so it plays back exactly
  // like the on-screen preview.
  const downloadGif = async () => {
    if (qrFrames.length === 0) return;
    setError(null);
    setGifProgress({ done: 0, total: qrFrames.length });
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('canvas unavailable');

      const firstImg = await loadImageEl(qrFrames[0]);
      canvas.width = firstImg.naturalWidth;
      canvas.height = firstImg.naturalHeight;

      // All QR frames share the same black/white palette, so a palette built
      // from the first frame covers every frame — build it once up front.
      ctx.drawImage(firstImg, 0, 0, canvas.width, canvas.height);
      const firstFrameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const palette = quantize(firstFrameData.data, 64);

      const gif = GIFEncoder();
      const delayMs = Math.round(1000 / fps);

      for (let i = 0; i < qrFrames.length; i++) {
        const img = i === 0 ? firstImg : await loadImageEl(qrFrames[i]);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const indexed = applyPalette(frameData.data, palette);
        gif.writeFrame(indexed, canvas.width, canvas.height, {
          palette: i === 0 ? palette : undefined,
          delay: delayMs,
          repeat: 0,
        });
        if (i % 5 === 0 || i === qrFrames.length - 1) {
          setGifProgress({ done: i + 1, total: qrFrames.length });
          // Yield to the main thread periodically so the UI stays responsive.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      gif.finish();
      const bytes = gif.bytes();
      const blob = new Blob([bytes], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qraft-animated-qr.gif';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGifProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {!sourcePreview ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl py-10 flex flex-col items-center gap-2 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
        >
          <Upload size={28} />
          <span className="text-sm font-medium">{d.dropHint}</span>
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <img src={sourcePreview} alt="" className="w-16 h-16 object-cover rounded-lg border dark:border-gray-700" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
          >
            {d.changeImage}
          </button>
        </div>
      )}

      {/* Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span>{d.maxDimension}</span>
            <span className="font-mono">{maxDimension}px</span>
          </label>
          <input
            type="range"
            min={64}
            max={480}
            step={8}
            value={maxDimension}
            onChange={(e) => setMaxDimension(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
        </div>
        <div>
          <label className="flex items-center justify-between text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span>{d.quality}</span>
            <span className="font-mono">{Math.round(quality * 100)}%</span>
          </label>
          <input
            type="range"
            min={0.2}
            max={0.92}
            step={0.02}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{d.reliability}</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['fast', d.reliabilityFast],
              ['balanced', d.reliabilityBalanced],
              ['reliable', d.reliabilityReliable],
            ] as [ReliabilityKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setReliability(key)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                reliability === key
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {selectedFile && (
        <button
          onClick={handleRegenerate}
          disabled={!!genProgress}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} />
          {d.regenerate}
        </button>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {genProgress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{d.preparing}</span>
            <span>{genProgress.done}/{genProgress.total}</span>
          </div>
          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{ width: `${(genProgress.done / genProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {qrFrames.length > 0 && !genProgress && (
        <div className="space-y-3">
          {qrFrames.length > 260 && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 rounded-lg text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{fmt(d.tooManyFrames, { n: qrFrames.length })}</span>
            </div>
          )}

          <div className="flex justify-center">
            <div className="bg-white p-2 rounded-xl border dark:border-gray-700 inline-block">
              <img src={qrFrames[currentFrame]} alt="" className="w-56 h-56 sm:w-64 sm:h-64" />
            </div>
          </div>

          <div className="text-center text-xs text-gray-500 dark:text-gray-400 font-mono">
            {fmt(d.frameOf, { n: currentFrame + 1, t: qrFrames.length })}
          </div>

          <input
            type="range"
            min={0}
            max={qrFrames.length - 1}
            value={currentFrame}
            onChange={(e) => {
              setPlaying(false);
              setCurrentFrame(Number(e.target.value));
            }}
            className="w-full accent-indigo-600"
          />

          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button
              onClick={() => setCurrentFrame((p) => (p - 1 + qrFrames.length) % qrFrames.length)}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium flex items-center gap-1.5 hover:bg-indigo-700"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {playing ? d.pause : d.play}
            </button>
            <button
              onClick={() => setCurrentFrame((p) => (p + 1) % qrFrames.length)}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <ChevronRight size={16} />
            </button>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 ms-2 select-none">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="accent-indigo-600" />
              {d.loop}
            </label>
          </div>

          <div>
            <label className="flex items-center justify-between text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{d.fps}</span>
              <span className="font-mono">{fps} {d.fpsUnit}</span>
            </label>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <div>
              <div className="text-gray-400 dark:text-gray-500">{d.frames}</div>
              <div className="font-mono text-gray-700 dark:text-gray-200">{qrFrames.length}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-gray-500">{d.dataSize}</div>
              <div className="font-mono text-gray-700 dark:text-gray-200">{formatBytes(encodedByteLength)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-gray-400 dark:text-gray-500">{d.sessionId}</div>
              <div className="font-mono text-gray-700 dark:text-gray-200">{sessionId}</div>
            </div>
          </div>

          {gifProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{d.generatingGif}</span>
                <span>{gifProgress.done}/{gifProgress.total}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: `${(gifProgress.done / gifProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={downloadGif}
            disabled={!!gifProgress}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {gifProgress ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
            {d.downloadGif}
          </button>

          <button
            onClick={downloadZip}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            <Download size={14} />
            {d.downloadZip}
          </button>
        </div>
      )}

      {!sourcePreview && <p className="text-center text-xs text-gray-400 dark:text-gray-500">{d.chooseImageFirst}</p>}
    </div>
  );
};

// ============================================================================
// Decode panel: live camera scan (careful, checksum-verified) + file fallback
// ============================================================================
const DecodePanel: React.FC<{ d: Dict }> = ({ d }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const sessionRef = useRef<DecodeSession | null>(null);
  const frameFileInputRef = useRef<HTMLInputElement>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [sessionTotal, setSessionTotal] = useState<number | null>(null);
  const [receivedIndices, setReceivedIndices] = useState<Set<number>>(new Set());
  const [reconstructedSrc, setReconstructedSrc] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const resetSession = useCallback(() => {
    sessionRef.current = null;
    setSessionTotal(null);
    setReceivedIndices(new Set());
    setReconstructedSrc(null);
    setNotice(null);
  }, []);

  const stopCameraScan = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  // Handles one decoded QR payload string, from either the camera or an
  // uploaded still photo. Validates the protocol tag, chunk checksum, and
  // (once complete) the whole-image checksum before ever touching the UI.
  const handleDecodedText = useCallback(
    (text: string) => {
      const parts = text.split('|');
      if (parts.length < 7 || parts[0] !== PROTOCOL_TAG) return; // not one of ours
      const sid = parts[1];
      const idx = parseInt(parts[2], 10);
      const total = parseInt(parts[3], 10);
      const chunkCrc = parts[4];
      const totalCrc = parts[5];
      const payload = parts.slice(6).join('|');

      if (!Number.isInteger(idx) || !Number.isInteger(total) || idx < 0 || idx >= total || total <= 0) return;
      if (crc32Hex(payload) !== chunkCrc) return; // misread frame — silently discard, will retry

      if (!sessionRef.current) {
        sessionRef.current = { sid, total, totalCrc, chunks: new Map() };
        setSessionTotal(total);
        setNotice(null);
      }
      const session = sessionRef.current;
      if (session.sid !== sid) {
        setNotice(d.mismatchedSession);
        return;
      }

      if (!session.chunks.has(idx)) {
        session.chunks.set(idx, payload);
        setReceivedIndices(new Set(session.chunks.keys()));
      }

      if (session.chunks.size === session.total) {
        let assembled = '';
        for (let i = 0; i < session.total; i++) assembled += session.chunks.get(i) ?? '';
        if (crc32Hex(assembled) === session.totalCrc) {
          setReconstructedSrc(`data:image/jpeg;base64,${assembled}`);
          stopCameraScan();
        } else {
          setNotice(d.integrityError);
          session.chunks.clear();
          setReceivedIndices(new Set());
        }
      }
    },
    [d, stopCameraScan]
  );

  const tick = useCallback(() => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = hiddenCanvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const scale = Math.min(1, 1000 / Math.max(vw, vh));
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            handleDecodedText(code.data);
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleDecodedText]);

  const startCameraScan = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? (track.getCapabilities() as TorchCapabilities) : undefined;
      setTorchSupported(!!caps?.torch);
      setCameraActive(true);
      scanningRef.current = true;
      tick();
    } catch (err) {
      setCameraError(mapCameraError(err, d));
      setCameraActive(false);
    }
  }, [d, tick]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as TorchConstraintSet] });
      setTorchOn((t) => !t);
    } catch {
      // Torch toggle not supported on this device/browser — ignore.
    }
  }, [torchOn]);

  const handleScanAgain = useCallback(() => {
    resetSession();
    void startCameraScan();
  }, [resetSession, startCameraScan]);

  const handleFrameFilesUpload = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        try {
          if (isGifFile(file)) {
            // Full animated GIF: decode and scan every frame in it.
            await scanGifFile(file, handleDecodedText);
            continue;
          }
          // A single still photo of one frame (e.g. a phone photo of a screen).
          const dataUrl = await readFileAsDataURL(file);
          const img = await loadImageEl(dataUrl);
          const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) handleDecodedText(code.data);
        } catch {
          // Skip unreadable file, keep processing the rest.
        }
      }
    },
    [handleDecodedText]
  );

  useEffect(() => {
    return () => {
      stopCameraScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadImage = () => {
    if (!reconstructedSrc) return;
    const a = document.createElement('a');
    a.href = reconstructedSrc;
    a.download = 'qraft-reconstructed.jpg';
    a.click();
  };

  const receivedCount = receivedIndices.size;
  const showGrid = sessionTotal !== null && sessionTotal <= 200;

  return (
    <div className="space-y-4">
      <canvas ref={hiddenCanvasRef} className="hidden" />
      <input
        ref={frameFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void handleFrameFilesUpload(e.target.files);
          e.target.value = '';
        }}
      />

      {reconstructedSrc ? (
        <div className="space-y-3">
          <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center gap-2">
            <CheckCircle2 size={18} className="text-green-600 dark:text-green-400 flex-shrink-0" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">{d.reconstructed}</span>
          </div>
          <div className="flex justify-center bg-gray-50 dark:bg-gray-900 rounded-xl p-3">
            <img src={reconstructedSrc} alt="" className="max-w-full max-h-80 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadImage}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Download size={14} />
              {d.downloadImage}
            </button>
            <button
              onClick={handleScanAgain}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <RefreshCw size={14} />
              {d.scanAgain}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative aspect-square bg-black rounded-xl overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
            {cameraActive ? (
              <>
                <div className="absolute inset-8 border-2 border-white/60 rounded-lg pointer-events-none" />
                {torchSupported && (
                  <button
                    onClick={toggleTorch}
                    className="absolute top-3 end-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                    aria-label={torchOn ? d.torchOff : d.torchOn}
                  >
                    {torchOn ? <ZapOff size={16} /> : <Zap size={16} />}
                  </button>
                )}
              </>
            ) : (
              <div className="absolute inset-0 bg-black flex flex-col items-center justify-center gap-3 text-gray-400">
                <Camera size={32} />
              </div>
            )}
          </div>

          {cameraError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          {notice && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 rounded-lg text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {cameraActive ? (
            <button
              onClick={stopCameraScan}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {d.stopCamera}
            </button>
          ) : (
            <button
              onClick={() => void startCameraScan()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Camera size={15} />
              {d.startCamera}
            </button>
          )}

          {sessionTotal === null ? (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500">{d.waitingFirstFrame}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-300 font-mono">
                <span>{fmt(d.receivedFrames, { n: receivedCount, t: sessionTotal })}</span>
                <span>{Math.round((receivedCount / sessionTotal) * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: `${(receivedCount / sessionTotal) * 100}%` }}
                />
              </div>
              {showGrid && (
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1">
                  {Array.from({ length: sessionTotal }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-sm ${
                        receivedIndices.has(i) ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                      title={`${i + 1}`}
                    />
                  ))}
                </div>
              )}
              <button
                onClick={resetSession}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <RefreshCw size={12} />
                {d.reset}
              </button>
            </div>
          )}

          <button
            onClick={() => frameFileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-500"
          >
            <Upload size={14} />
            {d.uploadFrames}
          </button>
        </>
      )}
    </div>
  );
};

export default AnimatedQRTool;
