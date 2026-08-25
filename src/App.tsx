import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import JSZip from 'jszip';
import AnimatedQRTool from './AnimatedQR';
import {
  Link as LinkIcon,
  Type,
  Mail,
  Phone,
  MessageSquare,
  Wifi,
  User,
  MapPin,
  Calendar,
  Download,
  Copy,
  Printer,
  Camera,
  History,
  Bookmark,
  Trash2,
  FileSpreadsheet,
  Check,
  AlertCircle,
  X,
  Moon,
  Sun,
  Share2,
  BarChart3,
  Globe,
  Film,
} from 'lucide-react';

type ContentType = 'url' | 'text' | 'email' | 'phone' | 'sms' | 'wifi' | 'vcard' | 'location' | 'calendar' | 'batch' | 'analytics';

interface QRSettings {
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  size: number;
  fgColor: string;
  fgColorEnd: string;
  bgColor: string;
  transparentBg: boolean;
  margin: number;
  dotStyle: 'square' | 'rounded' | 'dots';
  logo: string | null;
  logoSize: number;
  frame: 'none' | 'scan_me' | 'website' | 'contact';
  watermarkText?: string;
  watermarkOpacity?: number;
}

interface HistoryItem {
  id: string;
  content: string;
  contentType: ContentType;
  settings: QRSettings;
  timestamp: number;
  label: string;
  notes?: string;
}

interface Preset {
  id: string;
  name: string;
  settings: QRSettings;
}

interface FormData {
  url: string;
  text: string;
  email: { to: string; subject: string; body: string };
  phone: string;
  sms: { phone: string; message: string };
  wifi: { ssid: string; password: string; encryption: 'WPA' | 'WEP' | 'None'; hidden: boolean };
  vcard: { firstName: string; lastName: string; phone: string; email: string; org: string; url: string; photo?: string };
  location: { lat: string; lng: string; address: string };
  calendar: { title: string; start: string; end: string; location: string; description: string };
}

const defaultFormData: FormData = {
  url: 'https://example.com',
  text: 'Hello, World!',
  email: { to: 'example@email.com', subject: 'Hello', body: 'This is a test email.' },
  phone: '+1234567890',
  sms: { phone: '+1234567890', message: 'Hello!' },
  wifi: { ssid: 'MyNetwork', password: 'password123', encryption: 'WPA', hidden: false },
  vcard: { firstName: 'John', lastName: 'Doe', phone: '+1234567890', email: 'john@example.com', org: 'Company', url: 'https://example.com', photo: '' },
  location: { lat: '40.7128', lng: '-74.0060', address: 'New York City' },
  calendar: { title: 'Meeting', start: '', end: '', location: 'Office', description: 'Team meeting' },
};

const defaultSettings: QRSettings = {
  errorCorrection: 'M',
  size: 300,
  fgColor: '#000000',
  fgColorEnd: '#000000',
  bgColor: '#ffffff',
  transparentBg: false,
  margin: 4,
  dotStyle: 'square',
  logo: null,
  logoSize: 20,
  frame: 'none',
  watermarkText: '',
  watermarkOpacity: 0.3,
};

const contentTypes: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: 'url', label: 'URL', icon: <LinkIcon size={16} /> },
  { id: 'text', label: 'Text', icon: <Type size={16} /> },
  { id: 'email', label: 'Email', icon: <Mail size={16} /> },
  { id: 'phone', label: 'Phone', icon: <Phone size={16} /> },
  { id: 'sms', label: 'SMS', icon: <MessageSquare size={16} /> },
  { id: 'wifi', label: 'Wi-Fi', icon: <Wifi size={16} /> },
  { id: 'vcard', label: 'vCard', icon: <User size={16} /> },
  { id: 'location', label: 'Location', icon: <MapPin size={16} /> },
  { id: 'calendar', label: 'Event', icon: <Calendar size={16} /> },
  { id: 'batch', label: 'Batch', icon: <FileSpreadsheet size={16} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} /> },
];

const errorCorrectionLevels = [
  { value: 'L', label: 'Low (7%)', desc: 'Up to 7% damage tolerance' },
  { value: 'M', label: 'Medium (15%)', desc: 'Up to 15% damage tolerance' },
  { value: 'Q', label: 'Quartile (25%)', desc: 'Up to 25% damage tolerance' },
  { value: 'H', label: 'High (30%)', desc: 'Up to 30% damage tolerance' },
];

interface BatchItem {
  row: number;
  content: string;
  filename: string;
  label?: string;
  logoUrl?: string;
  isValid: boolean;
  error?: string;
  type: 'url' | 'text' | 'invalid';
}

const drawQRWithLabelAndLogo = (
  dataUrl: string,
  label: string | undefined,
  logoUrl: string | undefined,
  size: number,
  fgColor: string,
  bgColor: string,
  transparentBg: boolean,
  logoSizePercent: number = 20
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const qrImg = new Image();
    qrImg.crossOrigin = 'anonymous';
    qrImg.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        const fontSize = Math.max(12, Math.round(size * 0.06));
        const padding = Math.max(8, Math.round(size * 0.04));
        const textHeight = label ? (fontSize + padding * 2) : 0;
        
        canvas.width = size;
        canvas.height = size + textHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        
        // Fill background
        if (!transparentBg) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        
        // Draw the QR code
        ctx.drawImage(qrImg, 0, 0, size, size);
        
        // Draw center logo if present
        if (logoUrl) {
          try {
            const logoImg = await new Promise<HTMLImageElement>((res, rej) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => res(img);
              img.onerror = () => rej(new Error('Failed to load logo image'));
              img.src = logoUrl;
            });
            
            const logoWidth = size * (logoSizePercent / 100);
            const logoHeight = logoImg.height * (logoWidth / logoImg.width);
            
            const x = (size - logoWidth) / 2;
            const y = (size - logoHeight) / 2;
            
            // Draw small background border for logo
            ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
            ctx.fillRect(x - 4, y - 4, logoWidth + 8, logoHeight + 8);
            ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
          } catch (logoErr) {
            console.warn('Failed to load or draw logo in batch QR:', logoErr);
          }
        }
        
        // Draw text label
        if (label) {
          ctx.fillStyle = fgColor;
          ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Draw centered label
          ctx.fillText(label, size / 2, size + padding + fontSize / 2);
        }
        
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    qrImg.onerror = (err) => {
      reject(err);
    };
    qrImg.src = dataUrl;
  });
};

const translations = {
  en: {
    appTitle: "QR Generator",
    appSubtitle: "Create custom QR codes",
    history: "History",
    presets: "Presets",
    clear: "Clear",
    noHistory: "No history yet",
    savePreset: "Save Preset",
    noPresets: "No presets saved",
    close: "Close",
    url: "URL",
    text: "Text",
    email: "Email",
    phone: "Phone",
    sms: "SMS",
    wifi: "Wi-Fi",
    vcard: "vCard",
    location: "Location",
    calendar: "Event",
    batch: "Batch",
    analytics: "Analytics",
    subject: "Subject",
    body: "Body",
    message: "Message",
    ssid: "Network Name (SSID)",
    password: "Password",
    encryption: "Encryption",
    hidden: "Hidden Network",
    firstName: "First Name",
    lastName: "Last Name",
    organization: "Organization",
    website: "Website",
    latitude: "Latitude",
    longitude: "Longitude",
    address: "Or Address",
    eventTitle: "Event Title",
    start: "Start",
    end: "End",
    description: "Description",
    notes: "Notes",
    addNotesPlaceholder: "Add custom notes/description...",
    saveNotes: "Save Note",
    errorCorrection: "Error Correction",
    complexityMetrics: "QR Complexity Metrics",
    gridDimensions: "Grid Dimensions",
    densityLevel: "Density Level",
    lowDensity: "Low (Highly Scannable)",
    mediumDensity: "Medium",
    highDensity: "High (Dense)",
    highDensityWarning: "High QR Density Warning",
    highDensityWarningDesc: "With high data density, lowering error correction improves scan reliability. Consider switching to Medium (M) or Low (L).",
    setToMedium: "Set to Medium (M)",
    setToLow: "Set to Low (L)",
    downloadPNG: "Download PNG",
    downloadSVG: "Download SVG",
    copySVG: "Copy SVG",
    copied: "Copied!",
    scanQR: "Scan QR Code",
    scanDescription: "Align QR code inside the frame to scan",
    animatedQR: "Image ⇄ Animated QR",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",
    historyNotesLabel: "Notes / Description",
    restore: "Restore",
    photoUrl: "Photo URL (Base64 or Link)",
    batchDelayLabel: "Generation Delay (ms)",
    batchDelayHelp: "Introduces a short pause between generating each code to prevent browser freezing.",
    fgColorStart: "Foreground Start Color",
    fgColorEnd: "Foreground End Color",
    watermarkHeader: "Watermark Overlay",
    watermarkTextLabel: "Watermark Text",
    watermarkOpacityLabel: "Watermark Opacity",
    batchHistoryTitle: "Batch Download History",
    viewBatchHistory: "View Batch Download History",
    noBatchHistory: "No previous batch downloads found",
    batchRowLimit: "Displays the last 5 batch jobs across sessions.",
    downloadZip: "Download ZIP",
    batchItemsCount: "QR codes generated",
    closeHistory: "Close History",
  },
  fa: {
    appTitle: "کد ساز QR",
    appSubtitle: "کدهای QR سفارشی بسازید",
    history: "تاریخچه",
    presets: "تنظیمات ذخیره شده",
    clear: "پاک کردن",
    noHistory: "هنوز تاریخچه‌ای ثبت نشده است",
    savePreset: "ذخیره تنظیمات فعلی",
    noPresets: "هیچ تنظیماتی ذخیره نشده است",
    close: "بستن",
    url: "آدرس اینترنتی (URL)",
    text: "متن",
    email: "ایمیل",
    phone: "تلفن",
    sms: "پیامک (SMS)",
    wifi: "وای‌فای (Wi-Fi)",
    vcard: "کارت ویزیت (vCard)",
    location: "موقعیت مکانی",
    calendar: "رویداد",
    batch: "سازنده دسته جمعی",
    analytics: "آمار و ارقام",
    subject: "موضوع",
    body: "متن ایمیل",
    message: "متن پیام",
    ssid: "نام شبکه (SSID)",
    password: "رمز عبور",
    encryption: "امنیت رمزگذاری",
    hidden: "شبکه پنهان",
    firstName: "نام",
    lastName: "نام خانوادگی",
    organization: "سازمان / شرکت",
    website: "وب‌سایت",
    latitude: "عرض جغرافیایی",
    longitude: "طول جغرافیایی",
    address: "یا آدرس فیزیکی",
    eventTitle: "عنوان رویداد",
    start: "زمان شروع",
    end: "زمان پایان",
    description: "توضیحات",
    notes: "یادداشت‌ها",
    addNotesPlaceholder: "یادداشت یا توضیحات سفارشی اضافه کنید...",
    saveNotes: "ذخیره یادداشت",
    errorCorrection: "تصحیح خطا (Error Correction)",
    complexityMetrics: "معیارهای پیچیدگی QR",
    gridDimensions: "ابعاد جدول",
    densityLevel: "سطح تراکم",
    lowDensity: "کم (خوانایی بسیار بالا)",
    mediumDensity: "متوسط",
    highDensity: "زیاد (متراکم)",
    highDensityWarning: "هشدار تراکم بالای QR",
    highDensityWarningDesc: "با تراکم بالای داده‌ها، کاهش سطح تصحیح خطا اسکن شدن کد را آسان‌تر می‌کند. گزینه متوسط (M) یا کم (L) را امتحان کنید.",
    setToMedium: "تنظیم روی متوسط (M)",
    setToLow: "تنظیم روی کم (L)",
    downloadPNG: "دانلود PNG",
    downloadSVG: "دانلود SVG",
    copySVG: "کپی SVG",
    copied: "کپی شد!",
    scanQR: "اسکن کد QR",
    scanDescription: "کد QR را داخل قاب قرار دهید تا اسکن شود",
    animatedQR: "تصویر ⇄ QR متحرک",
    lightMode: "حالت روز",
    darkMode: "حالت شب",
    historyNotesLabel: "یادداشت / توضیحات",
    restore: "بازیابی",
    photoUrl: "آدرس عکس (لینک یا کد Base64)",
    batchDelayLabel: "تاخیر ساخت (میلی‌ثانیه)",
    batchDelayHelp: "برای جلوگیری از هنگ کردن مرورگر، یک وقفه کوتاه بین ساخت هر کد قرار می‌دهد.",
    fgColorStart: "رنگ شروع پیش‌زمینه",
    fgColorEnd: "رنگ پایان پیش‌زمینه",
    watermarkHeader: "واترمارک متنی",
    watermarkTextLabel: "متن واترمارک",
    watermarkOpacityLabel: "شفافیت واترمارک",
    batchHistoryTitle: "تاریخچه دانلود بسته‌ها",
    viewBatchHistory: "مشاهده تاریخچه دانلود بسته‌ها",
    noBatchHistory: "هیچ بسته دانلودی در تاریخچه یافت نشد",
    batchRowLimit: "نمایش آخرین ۵ بسته زیپ اسکن و دانلود شده در مرورگر.",
    downloadZip: "دانلود فایل ZIP",
    batchItemsCount: "کد QR ساخته شده",
    closeHistory: "بستن تاریخچه",
  }
};

const colorPalettes = [
  { id: 'classic', name: 'Classic Dark', fgColor: '#000000', fgColorEnd: '#1a1a1a', bgColor: '#ffffff' },
  { id: 'midnight', name: 'Midnight Slate', fgColor: '#1e293b', fgColorEnd: '#334155', bgColor: '#f8fafc' },
  { id: 'ocean', name: 'Ocean Blue', fgColor: '#1d4ed8', fgColorEnd: '#3b82f6', bgColor: '#f0f9ff' },
  { id: 'emerald', name: 'Forest Emerald', fgColor: '#047857', fgColorEnd: '#10b981', bgColor: '#f0fdf4' },
  { id: 'sunset', name: 'Sunset Rose', fgColor: '#be123c', fgColorEnd: '#f43f5e', bgColor: '#fff1f2' },
  { id: 'lavender', name: 'Purple Dream', fgColor: '#6d28d9', fgColorEnd: '#8b5cf6', bgColor: '#faf5ff' },
  { id: 'cyberpunk', name: 'Cyber Neon', fgColor: '#06b6d4', fgColorEnd: '#0d9488', bgColor: '#0f172a' },
  { id: 'chocolate', name: 'Warm Mocha', fgColor: '#78350f', fgColorEnd: '#b45309', bgColor: '#fdf8f6' },
];

interface BatchLog {
  id: string;
  timestamp: number;
  rowCount: number;
  filename: string;
  blob: Blob;
}

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QRBatchHistoryDB', 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('batchLogs')) {
        db.createObjectStore('batchLogs', { keyPath: 'id' });
      }
    };
    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

const saveBatchLog = async (log: BatchLog) => {
  try {
    const db = await initDB();
    const transaction = db.transaction('batchLogs', 'readwrite');
    const store = transaction.objectStore('batchLogs');
    
    const allLogs = await new Promise<BatchLog[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a: BatchLog, b: BatchLog) => a.timestamp - b.timestamp);
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    });

    if (allLogs.length >= 5) {
      const excessCount = allLogs.length - 4;
      for (let i = 0; i < excessCount; i++) {
        store.delete(allLogs[i].id);
      }
    }

    store.put(log);
  } catch (err) {
    console.error('Failed to save batch log to IndexedDB:', err);
  }
};

const getBatchLogs = async (): Promise<BatchLog[]> => {
  try {
    const db = await initDB();
    const transaction = db.transaction('batchLogs', 'readonly');
    const store = transaction.objectStore('batchLogs');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const sorted = (request.result || []).sort((a: BatchLog, b: BatchLog) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.error('Failed to get batch logs:', err);
    return [];
  }
};

function App() {
  const [contentType, setContentType] = useState<ContentType>('url');
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [settings, setSettings] = useState<QRSettings>(defaultSettings);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [copied, setCopied] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('qr-dark-mode');
    if (saved !== null) {
      return saved === 'true';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [language, setLanguage] = useState<'en' | 'fa'>(() => {
    const saved = localStorage.getItem('qr-language');
    if (saved === 'en' || saved === 'fa') return saved;
    return 'en';
  });
  const [showScanner, setShowScanner] = useState(false);
  const [scannerResult, setScannerResult] = useState<string | null>(null);
  const [showAnimatedQR, setShowAnimatedQR] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchDelay, setBatchDelay] = useState<number>(() => {
    const saved = localStorage.getItem('qr-batch-delay');
    return saved ? parseInt(saved, 10) : 50;
  });
  const [csvData, setCsvData] = useState<string>('');
  const [moduleCount, setModuleCount] = useState(0);
  const [dataCapacity, setDataCapacity] = useState(0);
  const [qrVersion, setQrVersion] = useState<number>(1);
  const [newPresetName, setNewPresetName] = useState('');
  const [showPresetModal, setShowPresetModal] = useState(false);

  // New state hooks
  const [activePaletteId, setActivePaletteId] = useState<string>('classic');
  const [showCustomColors, setShowCustomColors] = useState<boolean>(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [showBatchHistoryModal, setShowBatchHistoryModal] = useState(false);
  const [batchLogs, setBatchLogs] = useState<BatchLog[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, number>>({
    url: 4,
    text: 2,
    wifi: 1,
    vcard: 0,
    email: 0,
    phone: 1,
    sms: 0,
    location: 0,
    calendar: 0,
    batch: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerAnimationRef = useRef<number>();

  const loadBatchLogs = useCallback(async () => {
    const logs = await getBatchLogs();
    setBatchLogs(logs);
  }, []);

  useEffect(() => {
    loadBatchLogs();
  }, [loadBatchLogs]);

  // Load history and presets from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('qr-history');
    const savedPresets = localStorage.getItem('qr-presets');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedPresets) setPresets(JSON.parse(savedPresets));
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('qr-history', JSON.stringify(history));
  }, [history]);

  // Save presets to localStorage
  useEffect(() => {
    localStorage.setItem('qr-presets', JSON.stringify(presets));
  }, [presets]);

  // Sync dark mode with documentElement and localStorage
  useEffect(() => {
    localStorage.setItem('qr-dark-mode', String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Sync language with documentElement and localStorage
  useEffect(() => {
    localStorage.setItem('qr-language', language);
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  // Sync batch delay with localStorage
  useEffect(() => {
    localStorage.setItem('qr-batch-delay', String(batchDelay));
  }, [batchDelay]);

  const t = (key: keyof typeof translations['en']): string => {
    return translations[language][key] || translations['en'][key];
  };

  const updateHistoryNotes = (id: string, notes: string) => {
    setHistory(prev =>
      prev.map(item => (item.id === id ? { ...item, notes } : item))
    );
  };

  // Parse URL params for shareable link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type') as ContentType;
    const data = params.get('data');
    const settingsParam = params.get('settings');

    if (type && contentTypes.find(t => t.id === type)) {
      setContentType(type);
      if (data) {
        try {
          const parsedData = JSON.parse(decodeURIComponent(data));
          setFormData(prev => ({ ...prev, [type]: parsedData }));
        } catch {
          if (type === 'url' || type === 'text' || type === 'phone') {
            setFormData(prev => ({ ...prev, [type]: data }));
          }
        }
      }
      if (settingsParam) {
        try {
          setSettings(JSON.parse(decodeURIComponent(settingsParam)));
        } catch (e) {
          console.warn('Failed to parse settingsParam:', e);
        }
      }
    }
  }, []);

  // Generate QR content string
  const getQRContent = useCallback((type: ContentType, data: FormData): string => {
    switch (type) {
      case 'url': {
        let url = data.url.trim();
        if (!/^https?:\/\//i.test(url)) {
          url = 'https://' + url;
        }
        return url;
      }
      case 'text':
        return data.text;
      case 'email': {
        const mailto = new URLSearchParams();
        if (data.email.subject) mailto.set('subject', data.email.subject);
        if (data.email.body) mailto.set('body', data.email.body);
        return `mailto:${data.email.to}?${mailto.toString()}`;
      }
      case 'phone':
        return `tel:${data.phone}`;
      case 'sms':
        return `smsto:${data.sms.phone}?body=${encodeURIComponent(data.sms.message)}`;
      case 'wifi': {
        const wifiStr = `WIFI:T:${data.wifi.encryption};S:${data.wifi.ssid};P:${data.wifi.password};H:${data.wifi.hidden ? 'true' : 'false'};;`;
        return wifiStr;
      }
      case 'vcard': {
        let photoLine = '';
        if (data.vcard.photo) {
          const trimmedPhoto = data.vcard.photo.trim();
          if (trimmedPhoto.startsWith('data:image/')) {
            const match = trimmedPhoto.match(/data:image\/(\w+);base64,(.+)/);
            if (match) {
              const type = match[1].toUpperCase();
              const base64 = match[2];
              photoLine = `\nPHOTO;ENCODING=b;TYPE=${type}:${base64}`;
            } else {
              photoLine = `\nPHOTO;VALUE=URI:${trimmedPhoto}`;
            }
          } else if (trimmedPhoto) {
            photoLine = `\nPHOTO;VALUE=URI:${trimmedPhoto}`;
          }
        }
        return `BEGIN:VCARD\nVERSION:3.0\nN:${data.vcard.lastName};${data.vcard.firstName}\nFN:${data.vcard.firstName} ${data.vcard.lastName}\nTEL:${data.vcard.phone}\nEMAIL:${data.vcard.email}\nORG:${data.vcard.org}\nURL:${data.vcard.url}${photoLine}\nEND:VCARD`;
      }
      case 'location': {
        const lat = parseFloat(data.location.lat);
        const lng = parseFloat(data.location.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          return `geo:${lat},${lng}`;
        }
        return `geo:0,0?q=${encodeURIComponent(data.location.address)}`;
      }
      case 'calendar': {
        const formatDate = (d: string) => {
          if (!d) return '';
          const date = new Date(d);
          return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };
        return `BEGIN:VEVENT\nDTSTART:${formatDate(data.calendar.start)}\nDTEND:${formatDate(data.calendar.end)}\nSUMMARY:${data.calendar.title}\nLOCATION:${data.calendar.location}\nDESCRIPTION:${data.calendar.description}\nEND:VEVENT`;
      }
      default:
        return '';
    }
  }, []);

  const getFrameText = (frame: QRSettings['frame']): string => {
    switch (frame) {
      case 'scan_me': return 'SCAN ME';
      case 'website': return 'VISIT WEBSITE';
      case 'contact': return 'ADD CONTACT';
      default: return '';
    }
  };

  // Debounced QR generation
  useEffect(() => {
    const timeout = setTimeout(() => {
      generateQR();
    }, 300);

    return () => clearTimeout(timeout);
  }, [contentType, formData, settings]);

  const generateQR = useCallback(async () => {
    const content = getQRContent(contentType, formData);
    if (!content || contentType === 'batch' || contentType === 'analytics') {
      setQrDataUrl('');
      setQrSvg('');
      setError(null);
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const options = {
        errorCorrectionLevel: settings.errorCorrection,
        margin: settings.margin,
        color: {
          dark: '#000000',
          light: '#ffffff00', // fully transparent (valid 8-digit hex, the 'qrcode' lib rejects the CSS keyword 'transparent')
        },
        width: settings.size,
      };

      // Generate PNG data URL (black on transparent to color with canvas)
      const dataUrl = await QRCode.toDataURL(content, options);

      // Generate SVG using a placeholder hex for the dark modules, then swap it
      // for the gradient reference afterwards (the 'qrcode' lib validates colors
      // as hex and rejects raw url(#...) references passed directly).
      const GRADIENT_PLACEHOLDER = '#123456';
      let svg = await QRCode.toString(content, {
        ...options,
        color: {
          dark: GRADIENT_PLACEHOLDER,
          light: settings.transparentBg ? '#ffffff00' : settings.bgColor,
        },
        type: 'svg',
      });
      svg = svg.replace(`stroke="${GRADIENT_PLACEHOLDER}"`, 'stroke="url(#qr-gradient)"');

      // Inject linear gradient defs into the SVG
      const gradientDefs = `
  <defs>
    <linearGradient id="qr-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${settings.fgColor}" />
      <stop offset="100%" stop-color="${settings.fgColorEnd || settings.fgColor}" />
    </linearGradient>
  </defs>`;
      svg = svg.replace(/<svg[^>]*>/, (match: string) => `${match}${gradientDefs}`);

      // Frame and logo rendering on canvas
      const hasFrame = settings.frame && settings.frame !== 'none';
      const framePadding = Math.max(16, Math.floor(settings.size * 0.08));
      const bottomArea = Math.max(48, Math.floor(settings.size * 0.22));

      const finalWidth = hasFrame ? settings.size + (framePadding * 2) : settings.size;
      const finalHeight = hasFrame ? settings.size + framePadding + bottomArea : settings.size;

      const canvas = document.createElement('canvas');
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext('2d')!;

      // Load base QR image
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load QR image'));
        img.src = dataUrl;
      });

      // Create offscreen canvas to apply linear gradient to the QR code modules
      const qrCanvas = document.createElement('canvas');
      qrCanvas.width = settings.size;
      qrCanvas.height = settings.size;
      const qrCtx = qrCanvas.getContext('2d')!;
      
      qrCtx.drawImage(qrImg, 0, 0, settings.size, settings.size);
      qrCtx.globalCompositeOperation = 'source-in';
      const qrGrad = qrCtx.createLinearGradient(0, 0, settings.size, settings.size);
      qrGrad.addColorStop(0, settings.fgColor);
      qrGrad.addColorStop(1, settings.fgColorEnd || settings.fgColor);
      qrCtx.fillStyle = qrGrad;
      qrCtx.fillRect(0, 0, settings.size, settings.size);

      if (hasFrame) {
        // Draw frame background using the foreground color
        ctx.fillStyle = settings.fgColor;
        ctx.fillRect(0, 0, finalWidth, finalHeight);

        // Draw inner QR background container
        ctx.fillStyle = settings.bgColor;
        ctx.fillRect(framePadding, framePadding, settings.size, settings.size);

        // Draw QR code canvas inside the container
        ctx.drawImage(qrCanvas, framePadding, framePadding, settings.size, settings.size);

        // Draw Frame Label Text
        const frameText = getFrameText(settings.frame);
        ctx.fillStyle = settings.bgColor === '#ffffff' ? '#ffffff' : settings.bgColor;
        ctx.font = `bold ${Math.max(14, Math.floor(settings.size * 0.065))}px "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(frameText, finalWidth / 2, settings.size + framePadding + (bottomArea / 2));
      } else {
        // No frame - draw plain QR background and QR code
        if (!settings.transparentBg) {
          ctx.fillStyle = settings.bgColor;
          ctx.fillRect(0, 0, settings.size, settings.size);
        }
        ctx.drawImage(qrCanvas, 0, 0, settings.size, settings.size);
      }

      // Draw center logo if present
      if (settings.logo) {
        const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to load logo image'));
          img.src = settings.logo!;
        });

        const logoWidth = settings.size * (settings.logoSize / 100);
        const logoHeight = logoImg.height * (logoWidth / logoImg.width);

        const qrX = hasFrame ? framePadding : 0;
        const qrY = hasFrame ? framePadding : 0;

        const x = qrX + (settings.size - logoWidth) / 2;
        const y = qrY + (settings.size - logoHeight) / 2;

        // Draw small background border for logo
        ctx.fillStyle = settings.bgColor;
        ctx.fillRect(x - 4, y - 4, logoWidth + 8, logoHeight + 8);
        ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
      }

      // Draw subtle text watermark overlay if present
      if (settings.watermarkText) {
        ctx.save();
        ctx.globalAlpha = settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 0.3;
        ctx.fillStyle = settings.fgColor;
        const fontSize = Math.max(10, Math.floor(settings.size * 0.04));
        ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const x = finalWidth - (hasFrame ? framePadding + 8 : 8);
        const y = hasFrame ? framePadding + settings.size - 8 : finalHeight - 8;
        ctx.fillText(settings.watermarkText, x, y);
        ctx.restore();
      }

      setQrDataUrl(canvas.toDataURL());

      // Wrap SVG inside frame if present
      if (hasFrame) {
        const viewBoxMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
        const qrSize = viewBoxMatch ? parseInt(viewBoxMatch[1]) : 41;

        const padding = 3;
        const bottom = 9;
        const finalSvgWidth = qrSize + (padding * 2);
        const finalSvgHeight = qrSize + padding + bottom;
        const frameText = getFrameText(settings.frame);
        const fontSize = Math.max(2, Math.floor(qrSize * 0.08));

        const innerContent = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>$/, '');

        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${finalSvgWidth} ${finalSvgHeight}" width="100%" height="100%">
  <rect width="${finalSvgWidth}" height="${finalSvgHeight}" fill="${settings.fgColor}"/>
  <rect x="${padding}" y="${padding}" width="${qrSize}" height="${qrSize}" fill="${settings.bgColor}"/>
  <g transform="translate(${padding}, ${padding})">
    ${innerContent}
  </g>
  <text x="${finalSvgWidth / 2}" y="${qrSize + padding + (bottom / 2)}" fill="${settings.bgColor}" font-family="system-ui, -apple-system, sans-serif" font-weight="bold" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${frameText}</text>
</svg>`;
      }

      // Append watermark to SVG if present
      if (settings.watermarkText) {
        const isFrame = settings.frame && settings.frame !== 'none';
        const opacity = settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 0.3;
        const viewBoxMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
        const viewW = viewBoxMatch ? parseInt(viewBoxMatch[1]) : 41;
        const viewH = viewBoxMatch ? parseInt(viewBoxMatch[2]) : 41;
        
        const fontSize = Math.max(1.2, Math.floor(viewW * 0.04));
        const padding = isFrame ? (Math.max(16, Math.floor(settings.size * 0.08)) * (viewW / finalWidth)) : 2;
        const xVal = viewW - padding;
        const yVal = isFrame ? (viewW + padding) : viewH - 2;
        
        const svgWatermark = `
  <text x="${xVal}" y="${yVal}" fill="${settings.fgColor}" opacity="${opacity}" font-family="system-ui, -apple-system, sans-serif" font-weight="bold" font-size="${fontSize}" text-anchor="end" dominant-baseline="auto">${settings.watermarkText}</text>`;
        
        svg = svg.replace(/<\/svg>$/, `${svgWatermark}</svg>`);
      }

      setQrSvg(svg);

      // Estimate or calculate metrics
      let calculatedVersion = 1;
      try {
        const qrCreator = QRCode as unknown as { create: (c: string, o: { errorCorrectionLevel: string }) => { version: number } };
        const qrCodeObj = qrCreator.create(content, { errorCorrectionLevel: settings.errorCorrection });
        calculatedVersion = qrCodeObj.version || 1;
      } catch {
        calculatedVersion = Math.ceil(content.length / 17) + 1;
      }
      setQrVersion(calculatedVersion);
      const modules = 17 + calculatedVersion * 4;
      setModuleCount(modules);
      setDataCapacity(Math.pow(2, Math.ceil(Math.log2(content.length + 1))));

      // Record successful generation in mock analytics
      setAnalytics(prev => ({
        ...prev,
        [contentType]: (prev[contentType] || 0) + 1,
      }));

    } catch (err) {
      console.error(err);
      setError('QR is too dense. Lower error correction or shorten content.');
      setQrDataUrl('');
      setQrSvg('');
    }

    setIsGenerating(false);
  }, [contentType, formData, getQRContent, settings]);

  const handleExportPNG = async () => {
    if (!qrDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const scale = 2; // Fixed high-quality upscale factor
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement('a');
      link.download = `qrcode-${settings.frame || 'default'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = qrDataUrl;
  };

  const handleExportSVG = () => {
    if (!qrSvg) return;
    const blob = new Blob([qrSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'qrcode.svg';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!qrDataUrl) return;
    try {
      const parts = qrDataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      await navigator.clipboard.write([
        new ClipboardItem({ [mime]: blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const handlePrint = () => {
    if (!qrDataUrl) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head><title>Print QR Code</title></head>
          <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;">
            <img src="${qrDataUrl}" style="max-width:100%;max-height:100vh;">
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSettings(prev => ({ ...prev, logo: event.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const addToHistory = () => {
    const content = getQRContent(contentType, formData);
    if (!content || contentType === 'batch') return;

    const item: HistoryItem = {
      id: Date.now().toString(),
      content,
      contentType,
      settings: { ...settings },
      timestamp: Date.now(),
      label: contentType.toUpperCase(),
    };

    setHistory(prev => [item, ...prev.slice(0, 9)]);
  };

  const restoreFromHistory = (item: HistoryItem) => {
    setContentType(item.contentType);
    setSettings(item.settings);
    setShowHistory(false);
  };

  const clearHistory = () => {
    setHistory([]);
    setShowHistory(false);
  };

  const savePreset = () => {
    if (!newPresetName.trim()) return;

    const preset: Preset = {
      id: Date.now().toString(),
      name: newPresetName,
      settings: { ...settings },
    };

    setPresets(prev => [...prev, preset]);
    setNewPresetName('');
    setShowPresetModal(false);
  };

  const loadPreset = (preset: Preset) => {
    setSettings(preset.settings);
    setShowPresets(false);
  };

  const deletePreset = (id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  };

  const handleShareURL = () => {
    const params = new URLSearchParams();
    params.set('type', contentType);
    if (['url', 'text', 'phone'].includes(contentType)) {
      params.set('data', (formData as unknown as Record<string, string>)[contentType]);
    } else {
      params.set('data', JSON.stringify(formData[contentType as keyof FormData]));
    }
    params.set('settings', JSON.stringify(settings));

    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      addToHistory();
      handleExportPNG();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  // QR Scanner
  const startScanner = async () => {
    setShowScanner(true);
    setScannerResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        scanQRCode();
      }
    } catch {
      setError('Camera access denied');
      setShowScanner(false);
    }
  };

  const scanQRCode = useCallback(() => {
    if (!videoRef.current || !scannerCanvasRef.current) return;

    const canvas = scannerCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;

    if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        setScannerResult(code.data);
        stopScanner();
        return;
      }
    }

    scannerAnimationRef.current = requestAnimationFrame(scanQRCode);
  }, []);

  const stopScanner = () => {
    if (scannerAnimationRef.current) {
      cancelAnimationFrame(scannerAnimationRef.current);
    }
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(t => t.stop());
    }
    setShowScanner(false);
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvData(event.target?.result as string || '');
      };
      reader.readAsText(file);
    }
  };

  const handleDownloadSampleCSV = () => {
    const csvContent = 'content,filename,label,logo_url\nhttps://example.com,example-site,My Site,https://api.iconify.design/logos:chrome.svg\nHello World,hello-text,Hello,https://api.iconify.design/logos:github-icon.svg\nhttps://google.com,google-search,Google,\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'qr_code_batch_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV auto-validation whenever csvData changes
  useEffect(() => {
    if (!csvData) {
      setBatchItems([]);
      setCsvError(null);
      return;
    }

    const lines = csvData.split('\n');
    const validatedItems: BatchItem[] = [];
    let invalidCount = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return; // Skip empty rows

      // Robust CSV parsing that supports quotes, embedded commas, and spaces
      let parts: string[] = [];
      try {
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < trimmed.length; i++) {
          const char = trimmed[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            parts.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        parts.push(current.trim());
        parts = parts.map(p => p.replace(/^"|"$/g, '').trim());
      } catch {
        parts = trimmed.split(',');
      }

      const content = parts[0]?.trim() || '';
      const filename = parts[1]?.trim() || '';
      const label = parts[2]?.trim() || '';
      const logoUrl = parts[3]?.trim() || '';

      // Skip header row if it contains 'content'
      if (index === 0 && content.toLowerCase() === 'content') {
        return;
      }

      if (!content) {
        invalidCount++;
        validatedItems.push({
          row: index + 1,
          content: '',
          filename,
          label,
          logoUrl,
          isValid: false,
          error: 'Content column is empty',
          type: 'invalid',
        });
      } else {
        const isUrl = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/i.test(content);
        validatedItems.push({
          row: index + 1,
          content,
          filename,
          label,
          logoUrl,
          isValid: true,
          type: isUrl ? 'url' : 'text',
        });
      }
    });

    setBatchItems(validatedItems);

    if (invalidCount > 0) {
      setCsvError(`Detected ${invalidCount} invalid row(s). Rows must have non-empty content.`);
    } else {
      setCsvError(null);
    }
  }, [csvData]);

  const generateBatch = async () => {
    const validItems = batchItems.filter(item => item.isValid);
    if (!validItems.length) return;

    const zip = new JSZip();
    const total = validItems.length;

    for (let i = 0; i < total; i++) {
      const item = validItems[i];
      const data = item.content;
      const filename = item.filename;
      const label = item.label;
      const logoUrl = item.logoUrl;

      try {
        const options = {
          errorCorrectionLevel: settings.errorCorrection,
          margin: settings.margin,
          color: {
            dark: '#000000',
            light: '#ffffff00', // fully transparent (valid 8-digit hex)
          },
          width: settings.size,
        };

        let dataUrl = await QRCode.toDataURL(data, options);

        // Apply gradient using an offscreen canvas
        const itemCanvas = document.createElement('canvas');
        itemCanvas.width = settings.size;
        itemCanvas.height = settings.size;
        const itemCtx = itemCanvas.getContext('2d')!;
        
        const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to load batch item image'));
          img.src = dataUrl;
        });
        
        itemCtx.drawImage(qrImg, 0, 0, settings.size, settings.size);
        itemCtx.globalCompositeOperation = 'source-in';
        const grad = itemCtx.createLinearGradient(0, 0, settings.size, settings.size);
        grad.addColorStop(0, settings.fgColor);
        grad.addColorStop(1, settings.fgColorEnd || settings.fgColor);
        itemCtx.fillStyle = grad;
        itemCtx.fillRect(0, 0, settings.size, settings.size);
        
        dataUrl = itemCanvas.toDataURL();

        if (label || logoUrl) {
          try {
            dataUrl = await drawQRWithLabelAndLogo(
              dataUrl,
              label,
              logoUrl,
              settings.size,
              settings.fgColor,
              settings.transparentBg ? '#ffffff' : settings.bgColor,
              settings.transparentBg,
              settings.logoSize
            );
          } catch (err) {
            console.warn('Failed to draw label/logo for QR batch item:', err);
          }
        }

        if (settings.watermarkText) {
          try {
            const finalImg = await new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error('Failed to load final QR for watermark'));
              img.src = dataUrl;
            });
            const waterCanvas = document.createElement('canvas');
            waterCanvas.width = finalImg.width;
            waterCanvas.height = finalImg.height;
            const waterCtx = waterCanvas.getContext('2d')!;
            
            waterCtx.drawImage(finalImg, 0, 0);
            waterCtx.save();
            waterCtx.globalAlpha = settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 0.3;
            waterCtx.fillStyle = settings.fgColor;
            const fontSize = Math.max(10, Math.floor(settings.size * 0.04));
            waterCtx.font = `bold ${fontSize}px "Inter", sans-serif`;
            waterCtx.textAlign = 'right';
            waterCtx.textBaseline = 'bottom';
            waterCtx.fillText(settings.watermarkText, finalImg.width - 8, finalImg.height - 8);
            waterCtx.restore();
            
            dataUrl = waterCanvas.toDataURL();
          } catch (waterErr) {
            console.warn('Failed to draw watermark for QR batch item:', waterErr);
          }
        }

        const base64 = dataUrl.split(',')[1];
        zip.file(`${filename?.trim() || `qr-${item.row}`}.png`, base64, { base64: true });
      } catch (err) {
        console.warn('Failed to generate QR for batch item:', data, err);
      }

      setBatchProgress(Math.round(((i + 1) / total) * 100));

      if (batchDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    const zipFilename = `qrcodes-${Date.now()}.zip`;
    const blob = await zip.generateAsync({ type: 'blob' });

    // Save batch log to IndexedDB
    const newLog: BatchLog = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      rowCount: total,
      filename: zipFilename,
      blob,
    };
    await saveBatchLog(newLog);
    await loadBatchLogs();

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = zipFilename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setBatchProgress(0);
    setCsvData('');
  };

  const inputClass = `w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent`;

  const renderInputForm = () => {
    switch (contentType) {
      case 'url':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">URL</span>
              <input
                type="url"
                value={formData.url}
                onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                className={inputClass + ' mt-1'}
                placeholder="https://example.com"
              />
            </label>
          </div>
        );
      case 'text':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Plain Text ({formData.text.length} characters)
              </span>
              <textarea
                value={formData.text}
                onChange={e => setFormData(prev => ({ ...prev, text: e.target.value }))}
                className={inputClass + ' mt-1'}
                rows={4}
                placeholder="Enter your text..."
              />
            </label>
          </div>
        );
      case 'email':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Email Address</span>
              <input
                type="email"
                value={formData.email.to}
                onChange={e => setFormData(prev => ({ ...prev, email: { ...prev.email, to: e.target.value } }))}
                className={inputClass + ' mt-1'}
                placeholder="recipient@example.com"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Subject</span>
              <input
                type="text"
                value={formData.email.subject}
                onChange={e => setFormData(prev => ({ ...prev, email: { ...prev.email, subject: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Body</span>
              <textarea
                value={formData.email.body}
                onChange={e => setFormData(prev => ({ ...prev, email: { ...prev.email, body: e.target.value } }))}
                className={inputClass + ' mt-1'}
                rows={3}
              />
            </label>
          </div>
        );
      case 'phone':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</span>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className={inputClass + ' mt-1'}
                placeholder="+1234567890"
              />
            </label>
          </div>
        );
      case 'sms':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</span>
              <input
                type="tel"
                value={formData.sms.phone}
                onChange={e => setFormData(prev => ({ ...prev, sms: { ...prev.sms, phone: e.target.value } }))}
                className={inputClass + ' mt-1'}
                placeholder="+1234567890"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Message</span>
              <textarea
                value={formData.sms.message}
                onChange={e => setFormData(prev => ({ ...prev, sms: { ...prev.sms, message: e.target.value } }))}
                className={inputClass + ' mt-1'}
                rows={3}
              />
            </label>
          </div>
        );
      case 'wifi':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Network Name (SSID)</span>
              <input
                type="text"
                value={formData.wifi.ssid}
                onChange={e => setFormData(prev => ({ ...prev, wifi: { ...prev.wifi, ssid: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Password</span>
              <input
                type="password"
                value={formData.wifi.password}
                onChange={e => setFormData(prev => ({ ...prev, wifi: { ...prev.wifi, password: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Encryption</span>
              <select
                value={formData.wifi.encryption}
                onChange={e => setFormData(prev => ({ ...prev, wifi: { ...prev.wifi, encryption: e.target.value as 'WPA' | 'WEP' | 'None' } }))}
                className={inputClass + ' mt-1'}
              >
                <option value="WPA">WPA/WPA2</option>
                <option value="WEP">WEP</option>
                <option value="None">No Password</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.wifi.hidden}
                onChange={e => setFormData(prev => ({ ...prev, wifi: { ...prev.wifi, hidden: e.target.checked } }))}
                className="rounded text-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Hidden Network</span>
            </label>
          </div>
        );
      case 'vcard':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('firstName')}</span>
                <input
                  type="text"
                  value={formData.vcard.firstName}
                  onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, firstName: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('lastName')}</span>
                <input
                  type="text"
                  value={formData.vcard.lastName}
                  onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, lastName: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('phone')}</span>
              <input
                type="tel"
                value={formData.vcard.phone}
                onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, phone: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('email')}</span>
              <input
                type="email"
                value={formData.vcard.email}
                onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, email: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('organization')}</span>
              <input
                type="text"
                value={formData.vcard.org}
                onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, org: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('website')}</span>
              <input
                type="url"
                value={formData.vcard.url}
                onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, url: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('photoUrl')}</span>
              <input
                type="text"
                placeholder="https://example.com/photo.jpg or data:image/png;base64,..."
                value={formData.vcard.photo || ''}
                onChange={e => setFormData(prev => ({ ...prev, vcard: { ...prev.vcard, photo: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
          </div>
        );
      case 'location':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Latitude</span>
                <input
                  type="text"
                  value={formData.location.lat}
                  onChange={e => setFormData(prev => ({ ...prev, location: { ...prev.location, lat: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                  placeholder="40.7128"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Longitude</span>
                <input
                  type="text"
                  value={formData.location.lng}
                  onChange={e => setFormData(prev => ({ ...prev, location: { ...prev.location, lng: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                  placeholder="-74.0060"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Or Address</span>
              <input
                type="text"
                value={formData.location.address}
                onChange={e => setFormData(prev => ({ ...prev, location: { ...prev.location, address: e.target.value } }))}
                className={inputClass + ' mt-1'}
                placeholder="123 Main St, City"
              />
            </label>
          </div>
        );
      case 'calendar':
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Event Title</span>
              <input
                type="text"
                value={formData.calendar.title}
                onChange={e => setFormData(prev => ({ ...prev, calendar: { ...prev.calendar, title: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Start</span>
                <input
                  type="datetime-local"
                  value={formData.calendar.start}
                  onChange={e => setFormData(prev => ({ ...prev, calendar: { ...prev.calendar, start: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">End</span>
                <input
                  type="datetime-local"
                  value={formData.calendar.end}
                  onChange={e => setFormData(prev => ({ ...prev, calendar: { ...prev.calendar, end: e.target.value } }))}
                  className={inputClass + ' mt-1'}
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Location</span>
              <input
                type="text"
                value={formData.calendar.location}
                onChange={e => setFormData(prev => ({ ...prev, calendar: { ...prev.calendar, location: e.target.value } }))}
                className={inputClass + ' mt-1'}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</span>
              <textarea
                value={formData.calendar.description}
                onChange={e => setFormData(prev => ({ ...prev, calendar: { ...prev.calendar, description: e.target.value } }))}
                className={inputClass + ' mt-1'}
                rows={2}
              />
            </label>
          </div>
        );
      case 'batch':
        return (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex-1 px-3 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-center cursor-pointer hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center justify-center">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVUpload}
                  className="hidden"
                />
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Upload CSV File</span>
              </label>
              <button
                type="button"
                onClick={handleDownloadSampleCSV}
                className="px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all font-medium text-sm flex items-center justify-center gap-2 shadow-sm"
              >
                <Download size={16} />
                Download Sample CSV
              </button>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Or paste CSV data</span>
              <textarea
                value={csvData}
                onChange={e => setCsvData(e.target.value)}
                className={inputClass + ' mt-1 font-mono text-sm'}
                rows={5}
                placeholder="content,filename,label,logo_url&#10;https://example1.com,site1,My Site 1,https://example.com/logo.png&#10;https://example2.com,site2"
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Format: first column is raw content, second column is filename (optional), third column is label (optional), fourth column is logo_url (optional)
            </p>

            {/* Delay configuration setting */}
            <div className="bg-gray-50 dark:bg-gray-800/40 p-3 rounded-lg border border-gray-200 dark:border-gray-700/60 space-y-1.5">
              <label className="block">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('batchDelayLabel')}</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">{batchDelay} ms</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="10"
                  value={batchDelay}
                  onChange={e => setBatchDelay(parseInt(e.target.value, 10))}
                  className="w-full mt-2"
                />
              </label>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                {t('batchDelayHelp')}
              </p>
            </div>

            {/* Live Data Preview and Validation Dashboard */}
            {batchItems.length > 0 && (
              <div className="mt-4 space-y-3 bg-gray-50 dark:bg-gray-900/40 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b dark:border-gray-700 pb-2">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    CSV Preview & Validation ({batchItems.length} rows)
                  </h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    csvError ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                  }`}>
                    {csvError ? 'Needs Review' : 'Validated & Ready'}
                  </span>
                </div>

                {csvError && (
                  <div className="p-2 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-xs rounded border border-red-100 dark:border-red-900/50 flex gap-2 items-start">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{csvError}</span>
                  </div>
                )}

                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-b dark:border-gray-700">
                        <th className="p-2 font-medium w-12 text-center">Row</th>
                        <th className="p-2 font-medium">Content</th>
                        <th className="p-2 font-medium">Filename</th>
                        <th className="p-2 font-medium">Label</th>
                        <th className="p-2 font-medium">Logo URL</th>
                        <th className="p-2 font-medium w-24 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {batchItems.map(item => (
                        <tr key={item.row} className={`${item.isValid ? 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20' : 'bg-red-50/40 dark:bg-red-900/10'}`}>
                          <td className="p-2 text-center font-mono text-gray-500">{item.row}</td>
                          <td className="p-2 font-mono truncate max-w-[150px] text-gray-700 dark:text-gray-300" title={item.content}>
                            {item.content || <span className="text-red-400 italic">empty</span>}
                          </td>
                          <td className="p-2 font-mono text-gray-600 dark:text-gray-400">
                            {item.filename ? `${item.filename}.png` : <span className="text-gray-400 italic">qr-{item.row}.png</span>}
                          </td>
                          <td className="p-2 font-mono text-gray-600 dark:text-gray-400">
                            {item.label || <span className="text-gray-400 italic">-</span>}
                          </td>
                          <td className="p-2 font-mono text-gray-600 dark:text-gray-400 truncate max-w-[120px]" title={item.logoUrl}>
                            {item.logoUrl || <span className="text-gray-400 italic">-</span>}
                          </td>
                          <td className="p-2 text-center">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              item.isValid 
                                ? (item.type === 'url' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300')
                                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            }`}>
                              {item.isValid ? (item.type === 'url' ? 'URL' : 'Text') : 'Error'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {batchProgress > 0 && (
              <div className="space-y-1">
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all"
                    style={{ width: `${batchProgress}%` }}
                  />
                </div>
                <p className="text-xs text-center text-gray-600 dark:text-gray-400">{batchProgress}%</p>
              </div>
            )}
            <button
              onClick={generateBatch}
              disabled={!csvData.trim() || batchItems.filter(i => i.isValid).length === 0}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
            >
              Generate & Download {batchItems.filter(i => i.isValid).length} Valid QR Codes
            </button>

            <button
              type="button"
              onClick={() => setShowBatchHistoryModal(true)}
              className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors font-medium shadow-sm flex items-center justify-center gap-2"
            >
              <History size={16} />
              {translations[language].viewBatchHistory}
            </button>
          </div>
        );
      case 'analytics': {
        const totalGenerated = Object.values(analytics).reduce((a, b) => a + b, 0);
        const maxVal = Math.max(...Object.values(analytics), 1);
        const sortedCategories = Object.entries(analytics).sort((a, b) => b[1] - a[1]);
        const topCategoryName = sortedCategories[0]?.[1] > 0 ? sortedCategories[0][0] : 'None';

        return (
          <div className="space-y-5">
            {/* Quick stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-indigo-50 dark:bg-indigo-950/30 p-4 rounded-xl border border-indigo-100/50 dark:border-indigo-900/20">
                <p className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Session Generations</p>
                <p className="text-3xl font-extrabold text-indigo-900 dark:text-indigo-100 mt-1">{totalGenerated}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-xl border border-emerald-100/50 dark:border-emerald-900/20">
                <p className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Primary Category</p>
                <p className="text-3xl font-extrabold text-emerald-900 dark:text-emerald-100 mt-1 capitalize truncate">{topCategoryName}</p>
              </div>
            </div>

            {/* Simple Beautiful Bar Chart */}
            <div className="bg-gray-50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">Content Type Distribution</h3>
              <div className="space-y-3">
                {Object.entries(analytics)
                  .filter(([key]) => key !== 'analytics')
                  .map(([key, value]) => {
                    const percent = Math.round((value / maxVal) * 100);
                    const displayPercent = totalGenerated > 0 ? Math.round((value / totalGenerated) * 100) : 0;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-16 text-xs font-semibold text-gray-600 dark:text-gray-400 capitalize truncate">{key}</span>
                        <div className="flex-1 h-2.5 bg-gray-200 dark:bg-gray-700/60 rounded-full overflow-hidden relative">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-500"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs font-bold text-gray-700 dark:text-gray-300 font-mono">
                          {value} ({displayPercent}%)
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Quick interactive tips */}
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 rounded-xl text-xs flex gap-3 border border-amber-100/50 dark:border-amber-900/10">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="font-bold">Design Tip</p>
                <p className="mt-0.5 opacity-90 leading-relaxed">Higher error correction is recommended for custom designs containing logos, while lower correction works best for dense text arrays.</p>
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={`min-h-screen transition-colors ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
              <div className="w-6 h-6 bg-white rounded grid grid-cols-3 grid-rows-3 gap-px p-1">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="bg-indigo-600 rounded-sm" />
                ))}
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('appTitle')}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLanguage(lang => lang === 'en' ? 'fa' : 'en')}
              className="px-2.5 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition-colors flex items-center gap-1 border border-gray-300/40 dark:border-gray-600/40"
              aria-label="Switch Language"
            >
              <Globe size={15} />
              <span>{language === 'en' ? 'FA' : 'EN'}</span>
            </button>
            <button
              onClick={() => {
                setShowHistory(!showHistory);
                setShowPresets(false);
              }}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
              aria-label={t('history')}
            >
              <History size={20} />
            </button>
            <button
              onClick={() => {
                setShowPresets(!showPresets);
                setShowHistory(false);
              }}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
              aria-label={t('presets')}
            >
              <Bookmark size={20} />
            </button>
            <button
              onClick={() => setShowAnimatedQR(true)}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
              aria-label={t('animatedQR')}
              title={t('animatedQR')}
            >
              <Film size={20} />
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
              aria-label={darkMode ? t('lightMode') : t('darkMode')}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Panel - Input */}
          <div className="flex-1 space-y-4">
            {/* Content Type Tabs */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-2">
              <div className="flex flex-wrap gap-1">
                {contentTypes.map(type => (
                  <button
                    key={type.id}
                    onClick={() => setContentType(type.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      contentType === type.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {type.icon}
                    <span className="hidden sm:inline">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Input Form */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                {contentTypes.find(t => t.id === contentType)?.icon}
                {contentTypes.find(t => t.id === contentType)?.label} Content
              </h2>
              {renderInputForm()}
            </div>

            {/* Customization Panel */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Customization</h2>

              <div className="space-y-4">
                {/* Error Correction */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Error Correction
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {errorCorrectionLevels.map(level => (
                      <button
                        key={level.value}
                        onClick={() => setSettings(prev => ({ ...prev, errorCorrection: level.value as QRSettings['errorCorrection'] }))}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          settings.errorCorrection === level.value
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* QR Code Complexity / Version Indicator */}
                {contentType !== 'batch' && contentType !== 'analytics' && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700/50">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">QR Complexity Metrics</span>
                      <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">Version {qrVersion}/40</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                      <div className="flex justify-between">
                        <span>Grid Dimensions:</span>
                        <span className="font-mono">{moduleCount} × {moduleCount} modules</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Density Level:</span>
                        <span className={`font-medium ${
                          qrVersion < 5 ? 'text-green-600 dark:text-green-400' :
                          qrVersion < 12 ? 'text-amber-600 dark:text-amber-400' :
                          'text-rose-600 dark:text-rose-400'
                        }`}>
                          {qrVersion < 5 ? 'Low (Highly Scannable)' : qrVersion < 12 ? 'Medium' : 'High (Dense)'}
                        </span>
                      </div>
                    </div>

                    {/* Auto warning / suggestion to lower error correction if version >= 10 and EC is Q or H */}
                    {qrVersion >= 10 && (settings.errorCorrection === 'H' || settings.errorCorrection === 'Q') && (
                      <div className="mt-2.5 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded text-xs text-amber-800 dark:text-amber-300">
                        <p className="font-semibold flex items-center gap-1.5 mb-1">
                          <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
                          High QR Density Warning
                        </p>
                        <p className="mb-2 text-[11px] leading-relaxed">
                          With high data density, lowering error correction improves scan reliability. Consider switching to Medium (M) or Low (L).
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSettings(prev => ({ ...prev, errorCorrection: 'M' }))}
                            className="px-2 py-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 rounded text-[11px] font-semibold transition-colors"
                          >
                            Set to Medium (M)
                          </button>
                          <button
                            type="button"
                            onClick={() => setSettings(prev => ({ ...prev, errorCorrection: 'L' }))}
                            className="px-2 py-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 rounded text-[11px] font-semibold transition-colors"
                          >
                            Set to Low (L)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Size */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Size: {settings.size}px
                  </label>
                  <input
                    type="range"
                    min={128}
                    max={1024}
                    value={settings.size}
                    onChange={e => setSettings(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Frame Templates */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Frame Template
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'none', label: 'No Frame' },
                      { id: 'scan_me', label: 'Scan Me' },
                      { id: 'website', label: 'Website' },
                      { id: 'contact', label: 'Contact' }
                    ].map(frameOpt => (
                      <button
                        key={frameOpt.id}
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, frame: frameOpt.id as QRSettings['frame'] }))}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                          (settings.frame || 'none') === frameOpt.id
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        {frameOpt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Colors & Palette Presets */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Color Palette Preset
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowCustomColors(!showCustomColors)}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {showCustomColors ? 'Hide Custom Colors' : 'Show Custom Colors'}
                    </button>
                  </div>

                  {/* Preset Theme Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {colorPalettes.map(palette => {
                      const isActive = activePaletteId === palette.id && !showCustomColors;
                      return (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => {
                            setActivePaletteId(palette.id);
                            setShowCustomColors(false);
                            setSettings(prev => ({
                              ...prev,
                              fgColor: palette.fgColor,
                              fgColorEnd: palette.fgColorEnd || palette.fgColor,
                              bgColor: palette.bgColor,
                              transparentBg: false,
                            }));
                          }}
                          className={`flex items-center gap-2 p-2 rounded-xl text-left border transition-all ${
                            isActive
                              ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 shadow-sm'
                              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          <div className="flex -space-x-1.5 flex-shrink-0">
                            <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600" style={{ backgroundColor: palette.fgColor }} />
                            <span className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600" style={{ backgroundColor: palette.bgColor }} />
                          </div>
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{palette.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom color manual input drawer */}
                  {showCustomColors && (
                    <div className="space-y-3 mt-3 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-xl border border-gray-100 dark:border-gray-800 transition-all">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                            {translations[language].fgColorStart}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={settings.fgColor}
                              onChange={e => setSettings(prev => ({ ...prev, fgColor: e.target.value }))}
                              className="w-8 h-8 rounded-lg cursor-pointer flex-shrink-0 border dark:border-gray-700"
                            />
                            <input
                              type="text"
                              value={settings.fgColor}
                              onChange={e => setSettings(prev => ({ ...prev, fgColor: e.target.value }))}
                              className={inputClass + ' text-xs py-1 px-2 w-full'}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                            {translations[language].fgColorEnd}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={settings.fgColorEnd || settings.fgColor}
                              onChange={e => setSettings(prev => ({ ...prev, fgColorEnd: e.target.value }))}
                              className="w-8 h-8 rounded-lg cursor-pointer flex-shrink-0 border dark:border-gray-700"
                            />
                            <input
                              type="text"
                              value={settings.fgColorEnd || settings.fgColor}
                              onChange={e => setSettings(prev => ({ ...prev, fgColorEnd: e.target.value }))}
                              className={inputClass + ' text-xs py-1 px-2 w-full'}
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                          Background
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={settings.bgColor}
                            onChange={e => setSettings(prev => ({ ...prev, bgColor: e.target.value }))}
                            className="w-8 h-8 rounded-lg cursor-pointer flex-shrink-0 border dark:border-gray-700"
                            disabled={settings.transparentBg}
                          />
                          <input
                            type="text"
                            value={settings.bgColor}
                            onChange={e => setSettings(prev => ({ ...prev, bgColor: e.target.value }))}
                            className={inputClass + ' text-xs py-1 px-2 w-full'}
                            disabled={settings.transparentBg}
                          />
                        </div>
                        <label className="flex items-center gap-1.5 mt-1.5">
                          <input
                            type="checkbox"
                            checked={settings.transparentBg}
                            onChange={e => setSettings(prev => ({ ...prev, transparentBg: e.target.checked }))}
                            className="rounded text-indigo-600 w-3.5 h-3.5"
                          />
                          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-400">Transparent</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Margin */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Margin (quiet zone): {settings.margin} modules
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    value={settings.margin}
                    onChange={e => setSettings(prev => ({ ...prev, margin: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Dot Style */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Dot Style
                  </label>
                  <div className="flex gap-2">
                    {(['square', 'rounded', 'dots'] as const).map(style => (
                      <button
                        key={style}
                        onClick={() => setSettings(prev => ({ ...prev, dotStyle: style }))}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          settings.dotStyle === style
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {style.charAt(0).toUpperCase() + style.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Center Logo (optional)
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                      <input
                        type="file"
                        accept="image/png,image/svg+xml"
                        ref={fileInputRef}
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Upload Image</span>
                    </label>
                    {settings.logo && (
                      <button
                        onClick={() => setSettings(prev => ({ ...prev, logo: null }))}
                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {settings.logo && (
                    <div className="mt-3">
                      <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                        Logo size: {settings.logoSize}%
                      </label>
                      <input
                        type="range"
                        min={10}
                        max={40}
                        value={settings.logoSize}
                        onChange={e => setSettings(prev => ({ ...prev, logoSize: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* Watermark Section */}
                <div className="border-t border-gray-100 dark:border-gray-700/50 pt-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5">
                    <span className="w-1.5 h-3.5 bg-indigo-500 rounded-full" />
                    {translations[language].watermarkHeader}
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                        {translations[language].watermarkTextLabel}
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Confidential, Verified"
                        value={settings.watermarkText || ''}
                        onChange={e => setSettings(prev => ({ ...prev, watermarkText: e.target.value }))}
                        className={inputClass + ' text-xs py-1.5 px-3 w-full'}
                      />
                    </div>
                    {settings.watermarkText && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                          <span>{translations[language].watermarkOpacityLabel}</span>
                          <span>{Math.round((settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 0.3) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 0.3}
                          onChange={e => setSettings(prev => ({ ...prev, watermarkOpacity: parseFloat(e.target.value) }))}
                          className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Preview & Export */}
          <div className="lg:w-96 space-y-4 lg:sticky lg:top-6 lg:self-start">
            {/* QR Preview */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Preview</h2>

              <div className="flex justify-center items-center min-h-[280px] bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
                {isGenerating ? (
                  <div className="animate-pulse text-gray-400">Generating...</div>
                ) : qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Generated QR Code"
                    className={`max-w-full max-h-64 transition-all duration-300 ${isGenerating ? 'opacity-50 scale-95' : 'opacity-100 scale-100'}`}
                  />
                ) : contentType === 'batch' ? (
                  <p className="text-gray-400 text-sm text-center">Batch mode - use CSV input</p>
                ) : (
                  <p className="text-gray-400 text-sm text-center">Enter content to generate</p>
                )}
              </div>

              {/* Stats */}
              {qrDataUrl && (
                <div className="mt-3 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>Modules: {moduleCount}x{moduleCount}</span>
                  <span>Capacity: ~{dataCapacity} chars</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>

            {/* Export Actions */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Export</h2>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleExportPNG}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download size={16} />
                    PNG
                  </button>
                  <button
                    onClick={handleExportSVG}
                    disabled={!qrSvg}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download size={16} />
                    SVG
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleCopy}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={handlePrint}
                    disabled={!qrDataUrl}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Printer size={16} />
                    Print
                  </button>
                </div>
                <button
                  onClick={handleShareURL}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Share2 size={16} />
                  Copy Share Link
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
              <div className="flex gap-2">
                <button
                  onClick={startScanner}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Camera size={16} />
                  Test Scan
                </button>
                <button
                  onClick={() => setShowPresetModal(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  <Bookmark size={16} />
                  Save Preset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('history')}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={clearHistory}
                    disabled={history.length === 0}
                    className="text-sm text-red-500 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('clear')}
                  </button>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    <X size={20} className="text-gray-500" />
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto max-h-[60vh]">
                {history.length === 0 ? (
                  <p className="p-4 text-center text-gray-500 dark:text-gray-400">{t('noHistory')}</p>
                ) : (
                  <div className="divide-y dark:divide-gray-700">
                    {history.map(item => (
                      <div
                        key={item.id}
                        className="p-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            onClick={() => restoreFromHistory(item)}
                            className="flex-1 flex items-start gap-3 text-start focus:outline-none"
                            title="Click to restore this QR"
                          >
                            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                              {contentTypes.find(t => t.id === item.contentType)?.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                                {item.label}
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-mono">
                                  {item.contentType}
                                </span>
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                {item.content.slice(0, 40)}
                                {item.content.length > 40 && '...'}
                              </p>
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                {new Date(item.timestamp).toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US')}
                              </p>
                            </div>
                          </button>
                          <button
                            onClick={() => restoreFromHistory(item)}
                            className="text-xs px-2 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 rounded font-medium transition-all flex-shrink-0"
                          >
                            {t('restore')}
                          </button>
                        </div>
                        {/* Notes annotation */}
                        <div className="mt-2.5">
                          <label className="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 mb-1">
                            {t('historyNotesLabel')}
                          </label>
                          <input
                            type="text"
                            value={item.notes || ''}
                            placeholder={t('addNotesPlaceholder')}
                            onChange={e => updateHistoryNotes(item.id, e.target.value)}
                            className="w-full px-2.5 py-1 text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded focus:ring-1 focus:ring-indigo-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Presets Panel */}
        {showPresets && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-end p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Presets</h3>
                <button
                  onClick={() => setShowPresets(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[60vh]">
                {presets.length === 0 ? (
                  <p className="p-4 text-center text-gray-500 dark:text-gray-400">No presets saved</p>
                ) : (
                  <div className="divide-y dark:divide-gray-700">
                    {presets.map(preset => (
                      <div key={preset.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => loadPreset(preset)}
                            className="flex-1 text-left"
                          >
                            <p className="font-medium text-gray-900 dark:text-white">{preset.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              EC: {preset.settings.errorCorrection} | Size: {preset.settings.size}px
                            </p>
                          </button>
                          <button
                            onClick={() => deletePreset(preset.id)}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scanner Modal */}
        {showScanner && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Scan QR Code</h3>
                <button
                  onClick={stopScanner}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="relative aspect-square bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                />
                <canvas ref={scannerCanvasRef} className="hidden" />
                <div className="absolute inset-4 border-2 border-white/50 rounded-lg" />
              </div>
              <div className="p-4">
                {scannerResult ? (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Scanned successfully!</p>
                    <p className="text-xs text-green-600 dark:text-green-500 mt-1 break-all">{scannerResult}</p>
                  </div>
                ) : (
                  <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                    Point camera at a QR code
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Image ⇄ Animated QR Modal */}
        {showAnimatedQR && (
          <AnimatedQRTool
            language={language}
            darkMode={darkMode}
            onClose={() => setShowAnimatedQR(false)}
          />
        )}

        {/* Preset Modal */}
        {showPresetModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Save Preset</h3>
                <button
                  onClick={() => setShowPresetModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="p-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Preset Name</span>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={e => setNewPresetName(e.target.value)}
                    className={inputClass + ' mt-1'}
                    placeholder="My preset"
                  />
                </label>
                <button
                  onClick={savePreset}
                  disabled={!newPresetName.trim()}
                  className="mt-4 w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Batch Download History Modal */}
        {showBatchHistoryModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <History size={20} className="text-indigo-500" />
                  {translations[language].batchHistoryTitle}
                </h3>
                <button
                  onClick={() => setShowBatchHistoryModal(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="p-4 max-h-[400px] overflow-y-auto space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {translations[language].batchRowLimit}
                </p>
                {batchLogs.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 dark:text-gray-500">
                    {translations[language].noBatchHistory}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {batchLogs.slice(0, 5).map(log => (
                      <div
                        key={log.id}
                        className="p-3 bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 rounded-xl flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate" title={log.filename}>
                            {log.filename}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span>•</span>
                            <span>{log.rowCount} {translations[language].batchItemsCount}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const url = URL.createObjectURL(log.blob);
                            const link = document.createElement('a');
                            link.download = log.filename;
                            link.href = url;
                            link.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors flex items-center gap-1 flex-shrink-0"
                        >
                          <Download size={14} />
                          {translations[language].downloadZip}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t dark:border-gray-700 flex justify-end">
                <button
                  onClick={() => setShowBatchHistoryModal(false)}
                  className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  {translations[language].close}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Keyboard Shortcut Hint */}
        <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm px-3 py-1.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Cmd</kbd> + <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">Enter</kbd> to export
          </p>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

export default App;
