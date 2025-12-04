import React, { useState, useCallback, useRef, useEffect } from 'react';
import { parseSRT, stringifySRT, parsePlainText, isSRTContent, isLRCContent, parseLRC, stringifyLRC } from './services/parser';
import { translateBatch } from './services/geminiService';
import { SubtitleBlock, ContentType, AppModel, OutputFormat, Theme, LLMProvider, CustomLLMConfig } from './types';
import { UploadIcon, PlayIcon, DownloadIcon, SparklesIcon, FileTextIcon, CheckCircleIcon, SunIcon, MoonIcon, SettingsIcon, CopyIcon } from './components/Icons';

const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文 (Chinese Simplified)' },
  { code: 'zh-TW', name: '繁体中文 (Chinese Traditional)' },
  { code: 'en', name: '英语 (English)' },
  { code: 'ja', name: '日语 (Japanese)' },
  { code: 'ko', name: '韩语 (Korean)' },
  { code: 'fr', name: '法语 (French)' },
  { code: 'es', name: '西班牙语 (Spanish)' },
  { code: 'de', name: '德语 (German)' },
  { code: 'ru', name: '俄语 (Russian)' },
];

const TONES = [
  "信达雅 (文学/字幕) - 优美、传神、注重意境",
  "标准 (正式) - 准确、客观、商务风格",
  "口语 (日常) - 自然、轻松、贴近生活",
  "专业 (技术) - 精准、术语规范"
];

const App: React.FC = () => {
  // --- STATE: Content & Processing ---
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("translation");
  const [contentType, setContentType] = useState<ContentType>(ContentType.PLAIN_TEXT);
  const [rawText, setRawText] = useState(""); 

  // --- STATE: Configuration ---
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [selectedTone, setSelectedTone] = useState(TONES[0]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(OutputFormat.ONLY_TRANSLATION);
  
  // --- STATE: System & Models ---
  const [theme, setTheme] = useState<Theme>('dark');
  const [previewMode, setPreviewMode] = useState<'split' | 'formatted'>('split');
  const [showSettings, setShowSettings] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Provider Config
  const [provider, setProvider] = useState<LLMProvider>(LLMProvider.GEMINI);
  const [geminiModel, setGeminiModel] = useState<string>(AppModel.FLASH);
  const [customConfig, setCustomConfig] = useState<CustomLLMConfig>({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelName: 'gpt-4o-mini'
  });

  // --- EFFECT: Theme ---
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // --- EFFECT: Re-parse when ContentType changes manually ---
  useEffect(() => {
      if (!rawText) return;
      
      const currentTranslations = blocks.map(b => b.translatedText);
      let newBlocks: SubtitleBlock[] = [];

      if (contentType === ContentType.SUBTITLE_SRT) {
          newBlocks = parseSRT(rawText);
      } else if (contentType === ContentType.LYRICS_LRC) {
          newBlocks = parseLRC(rawText);
      } else {
          newBlocks = parsePlainText(rawText);
      }

      if (newBlocks.length === currentTranslations.length) {
          newBlocks = newBlocks.map((b, i) => ({
              ...b,
              translatedText: currentTranslations[i]
          }));
      }

      setBlocks(newBlocks);
  }, [contentType]);


  // --- HANDLERS: File & Input ---
  const processContent = (text: string, name?: string) => {
    setRawText(text);
    if (name) setFileName(name.replace(/\.[^/.]+$/, ""));
    
    // Intelligent Detection
    if (isSRTContent(text)) {
        setContentType(ContentType.SUBTITLE_SRT);
        setBlocks(parseSRT(text));
    } else if (isLRCContent(text)) {
        setContentType(ContentType.LYRICS_LRC);
        setBlocks(parseLRC(text));
    } else {
        setContentType(ContentType.PLAIN_TEXT);
        setBlocks(parsePlainText(text));
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      processContent(text, file.name);
    };
    reader.readAsText(file);
  };

  const onDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleManualInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setRawText(text);
      
      // Auto-detect only if empty
      if (blocks.length === 0) {
        if (isSRTContent(text)) {
            setContentType(ContentType.SUBTITLE_SRT);
            setBlocks(parseSRT(text));
        } else if (isLRCContent(text)) {
            setContentType(ContentType.LYRICS_LRC);
            setBlocks(parseLRC(text));
        } else {
            setContentType(ContentType.PLAIN_TEXT);
            setBlocks(parsePlainText(text));
        }
      } else {
        // Re-parse with current type
        if (contentType === ContentType.SUBTITLE_SRT) {
            setBlocks(parseSRT(text));
        } else if (contentType === ContentType.LYRICS_LRC) {
            setBlocks(parseLRC(text));
        } else {
            setBlocks(parsePlainText(text));
        }
      }
  };

  // --- HANDLERS: Translation ---
  const startTranslation = async () => {
    if (blocks.length === 0) return;
    setIsProcessing(true);
    setProgress(0);

    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(blocks.length / BATCH_SIZE);

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, blocks.length);
      const batch = blocks.slice(startIdx, endIdx);
      
      setBlocks(prev => prev.map((b, idx) => 
        idx >= startIdx && idx < endIdx ? { ...b, isTranslating: true } : b
      ));

      try {
        const sourceTexts = batch.map(b => b.originalText);
        const context = i > 0 ? `Previous sentence: ${blocks[startIdx - 1].translatedText}` : undefined;
        
        const translatedTexts = await translateBatch({
          texts: sourceTexts,
          targetLanguage: targetLang,
          tone: selectedTone,
          modelName: provider === LLMProvider.GEMINI ? geminiModel : customConfig.modelName,
          context,
          provider,
          customConfig: provider === LLMProvider.CUSTOM ? customConfig : undefined
        });

        setBlocks(prev => prev.map((b, idx) => {
          if (idx >= startIdx && idx < endIdx) {
            return {
              ...b,
              translatedText: translatedTexts[idx - startIdx] || b.originalText,
              isTranslating: false
            };
          }
          return b;
        }));

        setProgress(Math.round(((i + 1) / totalBatches) * 100));

      } catch (error: any) {
        console.error("Batch failed", error);
        setIsProcessing(false);
        const errorMsg = error?.message || "未知错误";
        alert(`翻译因 API 错误中断: ${errorMsg}\n请检查配置或网络。`);
        setBlocks(prev => prev.map(b => ({ ...b, isTranslating: false })));
        return;
      }
    }

    setIsProcessing(false);
  };

  // --- HANDLERS: Export & Copy ---
  const generateFormattedContent = () => {
    if (contentType === ContentType.SUBTITLE_SRT) {
      return stringifySRT(blocks, outputFormat);
    } else if (contentType === ContentType.LYRICS_LRC) {
      return stringifyLRC(blocks, outputFormat);
    } else {
      return blocks.map(b => {
        const original = b.originalText;
        const translated = b.translatedText || original;
        
        switch (outputFormat) {
          case OutputFormat.ONLY_TRANSLATION:
            return translated;
          case OutputFormat.DUAL_TRANS_SRC:
            return `${translated}\n${original}`;
          case OutputFormat.DUAL_SRC_TRANS:
            return `${original}\n${translated}`;
          default:
            return translated;
        }
      }).join('\n\n');
    }
  };

  const handleDownload = () => {
    const content = generateFormattedContent();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    let ext = 'txt';
    if (contentType === ContentType.SUBTITLE_SRT) ext = 'srt';
    if (contentType === ContentType.LYRICS_LRC) ext = 'lrc';

    a.download = `${fileName}_${outputFormat}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    const content = generateFormattedContent();
    try {
      await navigator.clipboard.writeText(content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  // --- RENDER ---
  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
          <div className={`w-full max-w-lg rounded-2xl p-6 shadow-2xl transition-colors ${theme === 'dark' ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-slate-200'}`}>
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">API 设置</h2>
                <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             </div>

             <div className="space-y-6">
                {/* Provider Selector */}
                <div className="space-y-2">
                   <label className="text-sm font-medium opacity-70">模型服务商 (Provider)</label>
                   <div className="grid grid-cols-2 gap-2">
                     <button
                        onClick={() => setProvider(LLMProvider.GEMINI)}
                        className={`py-3 rounded-lg border-2 transition-all font-medium text-sm flex items-center justify-center gap-2
                           ${provider === LLMProvider.GEMINI 
                             ? 'border-indigo-500 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400' 
                             : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'}`}
                     >
                       Google Gemini
                     </button>
                     <button
                        onClick={() => setProvider(LLMProvider.CUSTOM)}
                        className={`py-3 rounded-lg border-2 transition-all font-medium text-sm flex items-center justify-center gap-2
                           ${provider === LLMProvider.CUSTOM 
                             ? 'border-indigo-500 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400' 
                             : 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'}`}
                     >
                       OpenAI 兼容接口
                     </button>
                   </div>
                </div>

                {/* Specific Configs */}
                {provider === LLMProvider.GEMINI ? (
                  <div className="space-y-3 p-4 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <p className="text-sm text-slate-500">使用内置 API Key (Google GenAI SDK)</p>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase opacity-60">Gemini 模型</label>
                      <select 
                        value={geminiModel} 
                        onChange={e => setGeminiModel(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 text-sm"
                      >
                         <option value={AppModel.FLASH}>Gemini 2.5 Flash (快速/稳定)</option>
                         <option value={AppModel.PRO}>Gemini 2.0 Pro (高智商)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 p-4 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase opacity-60">API Base URL</label>
                      <input 
                        type="text" 
                        value={customConfig.baseUrl}
                        onChange={e => setCustomConfig({...customConfig, baseUrl: e.target.value})}
                        placeholder="e.g. https://api.openai.com/v1"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase opacity-60">API Key</label>
                      <input 
                        type="password" 
                        value={customConfig.apiKey}
                        onChange={e => setCustomConfig({...customConfig, apiKey: e.target.value})}
                        placeholder="sk-..."
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase opacity-60">Model Name</label>
                      <input 
                        type="text" 
                        value={customConfig.modelName}
                        onChange={e => setCustomConfig({...customConfig, modelName: e.target.value})}
                        placeholder="e.g. gpt-4o, deepseek-chat"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}
             </div>

             <div className="mt-8 flex justify-end">
               <button 
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-indigo-500/20"
               >
                 保存并关闭
               </button>
             </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className={`border-b sticky top-0 z-50 backdrop-blur-md transition-colors ${theme === 'dark' ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-white/80'}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-500/20">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <div>
               <h1 className="text-lg font-bold tracking-tight">
                 Lumina <span className="text-indigo-500">Translate</span>
               </h1>
               <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider opacity-60">
                 <span>{provider === LLMProvider.GEMINI ? 'Gemini AI' : 'Custom API'}</span>
                 <span>•</span>
                 <span>{provider === LLMProvider.GEMINI ? geminiModel.replace('gemini-', '') : customConfig.modelName}</span>
               </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
             <button 
               onClick={() => setShowSettings(true)}
               className={`p-2 rounded-lg transition-all ${theme === 'dark' ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}`}
               title="API 设置"
             >
               <SettingsIcon className="w-5 h-5" />
             </button>
             
             <button 
               onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
               className={`p-2 rounded-lg transition-all ${theme === 'dark' ? 'hover:bg-slate-800 text-yellow-400' : 'hover:bg-slate-100 text-slate-600'}`}
               title="切换主题"
             >
               {theme === 'dark' ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
             </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col lg:flex-row gap-6">
        
        {/* Sidebar Controls */}
        <aside className="w-full lg:w-80 flex-shrink-0 space-y-6">
          
          {/* File Upload */}
          <div 
            className={`
              relative group rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer overflow-hidden
              ${dragActive 
                 ? 'border-indigo-500 bg-indigo-500/10' 
                 : theme === 'dark' 
                    ? 'border-slate-700 bg-slate-900 hover:border-slate-600' 
                    : 'border-slate-300 bg-white hover:border-slate-400'
              }
            `}
            onDragEnter={onDrag} 
            onDragLeave={onDrag} 
            onDragOver={onDrag} 
            onDrop={onDrop}
          >
            <input 
              type="file" 
              className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer" 
              onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            />
            <div className="p-8 text-center space-y-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}>
                <UploadIcon className="w-6 h-6 text-indigo-500" />
              </div>
              <div>
                <p className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>点击或拖拽文件上传</p>
                <p className="text-xs text-slate-500 mt-1">支持 SRT, LRC, TXT 格式</p>
              </div>
            </div>
          </div>

          {/* Configuration Panel */}
          <div className={`rounded-xl border p-5 space-y-5 shadow-sm ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            
            {/* Content Type Selector */}
            <div className="space-y-2">
               <label className="text-xs font-semibold uppercase tracking-wider opacity-60">文件类型 (Format)</label>
               <select 
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as ContentType)}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
               >
                 <option value={ContentType.PLAIN_TEXT}>纯文本 (Plain Text)</option>
                 <option value={ContentType.SUBTITLE_SRT}>字幕文件 (SRT Subtitle)</option>
                 <option value={ContentType.LYRICS_LRC}>歌词文件 (LRC Lyrics)</option>
               </select>
               <p className="text-[10px] opacity-50">如果时间轴丢失，请尝试手动切换格式</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-60">目标语言 (Target)</label>
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-60">翻译风格 (Tone)</label>
              <select 
                value={selectedTone}
                onChange={(e) => setSelectedTone(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
              >
                {TONES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-60">输出格式 (Output)</label>
              <select 
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
              >
                <option value={OutputFormat.ONLY_TRANSLATION}>仅译文 (Translation Only)</option>
                <option value={OutputFormat.DUAL_TRANS_SRC}>双语：上译文 下原文</option>
                <option value={OutputFormat.DUAL_SRC_TRANS}>双语：上原文 下译文</option>
              </select>
            </div>

            <button
              onClick={startTranslation}
              disabled={isProcessing || blocks.length === 0}
              className={`
                w-full py-3 rounded-lg flex items-center justify-center gap-2 font-medium transition-all
                ${isProcessing 
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:scale-95'}
              `}
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>翻译中 {progress}%</span>
                </>
              ) : (
                <>
                  <PlayIcon className="w-4 h-4" />
                  <span>开始翻译</span>
                </>
              )}
            </button>
          </div>
          
           {/* Export */}
           <div className={`rounded-xl border p-5 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <button 
                onClick={handleDownload}
                disabled={blocks.length === 0}
                className={`w-full flex items-center justify-center gap-2 text-sm py-2 border rounded-lg transition-colors disabled:opacity-50
                   ${theme === 'dark' 
                     ? 'border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800' 
                     : 'border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                   }`}
              >
                <DownloadIcon className="w-4 h-4" />
                导出文件 ({contentType === ContentType.SUBTITLE_SRT ? 'SRT' : (contentType === ContentType.LYRICS_LRC ? 'LRC' : 'TXT')})
              </button>
           </div>

        </aside>

        {/* Editor / Preview Area */}
        <section className={`flex-1 flex flex-col min-h-[600px] rounded-xl border overflow-hidden shadow-2xl relative transition-colors ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          
          {/* Editor Header */}
          <div className={`h-12 border-b flex items-center px-4 justify-between ${theme === 'dark' ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex gap-4 text-sm font-medium">
              <button 
                onClick={() => setPreviewMode('split')}
                className={`transition-colors border-b-2 py-3 px-1 ${previewMode === 'split' ? (theme === 'dark' ? 'text-indigo-400 border-indigo-500' : 'text-indigo-600 border-indigo-600') : 'border-transparent opacity-50 hover:opacity-100'}`}
              >
                对照编辑 (Editor)
              </button>
              <button 
                onClick={() => setPreviewMode('formatted')}
                className={`transition-colors border-b-2 py-3 px-1 ${previewMode === 'formatted' ? (theme === 'dark' ? 'text-indigo-400 border-indigo-500' : 'text-indigo-600 border-indigo-600') : 'border-transparent opacity-50 hover:opacity-100'}`}
              >
                结果预览 (Preview)
              </button>
            </div>
            
            <div className="flex items-center gap-3">
               {blocks.length > 0 && (
                 <>
                   <button 
                      onClick={handleCopy}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-all
                        ${copySuccess 
                          ? 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10' 
                          : theme === 'dark' 
                             ? 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800' 
                             : 'border-slate-300 text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                        }`}
                   >
                     {copySuccess ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <CopyIcon className="w-3.5 h-3.5" />}
                     {copySuccess ? '已复制' : '复制全文'}
                   </button>
                   <span className="text-xs opacity-50">|</span>
                   <span className="text-xs opacity-50">{blocks.length} 句</span>
                 </>
               )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 relative overflow-y-auto p-0 custom-scrollbar">
            {blocks.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
                 <FileTextIcon className="w-16 h-16 mb-4" />
                 <p>请先上传文件</p>
                 <textarea 
                    className={`mt-6 pointer-events-auto w-2/3 h-32 border rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none transition-all
                       ${theme === 'dark' ? 'bg-slate-800/50 border-slate-700 placeholder:text-slate-600' : 'bg-slate-50 border-slate-300 placeholder:text-slate-400'}`}
                    placeholder="或者直接在此粘贴 SRT / LRC / 文本内容..."
                    onChange={handleManualInput}
                 />
              </div>
            ) : (
              <>
                 {/* MODE 1: SPLIT VIEW (Editing) */}
                 {previewMode === 'split' && (
                    <div className="grid gap-px bg-slate-200 dark:bg-slate-800/50">
                       {blocks.map((block) => (
                         <div 
                          key={block.id} 
                          className={`grid grid-cols-1 md:grid-cols-2 gap-0 group
                            ${block.isTranslating 
                               ? 'bg-indigo-500/5' 
                               : theme === 'dark' ? 'bg-slate-900 hover:bg-slate-800/50' : 'bg-white hover:bg-slate-50'
                            }`}
                         >
                            {/* Source Column */}
                            <div className={`p-4 border-r ${theme === 'dark' ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500'}`}>
                                <div className="flex justify-between items-start mb-1">
                                   <span className="text-[10px] font-mono opacity-40 select-none">#{block.id}</span>
                                   {/* Timestamp display for SRT/LRC */}
                                   {(contentType === ContentType.SUBTITLE_SRT || contentType === ContentType.LYRICS_LRC) && (
                                      <span className="text-[10px] font-mono opacity-50 bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                         {block.startTime}
                                         {contentType === ContentType.SUBTITLE_SRT && ` --> ${block.endTime}`}
                                      </span>
                                   )}
                                </div>
                                <div className="text-sm leading-relaxed whitespace-pre-wrap">{block.originalText}</div>
                            </div>

                            {/* Target Column */}
                            <div className={`p-4 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}`}>
                              <div className="min-h-[1.5em]">
                                {block.isTranslating ? (
                                   <div className="flex gap-1 items-center h-full pt-1">
                                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></span>
                                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-75"></span>
                                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150"></span>
                                   </div>
                                ) : (
                                  <div className="text-sm leading-relaxed whitespace-pre-wrap animate-in fade-in duration-300">
                                    {block.translatedText || <span className="opacity-20 italic">等待翻译...</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                         </div>
                       ))}
                    </div>
                 )}

                 {/* MODE 2: FORMATTED PREVIEW (WYSIWYG) */}
                 {previewMode === 'formatted' && (
                    <div className="p-8">
                       <pre className={`font-mono text-sm whitespace-pre-wrap max-w-3xl mx-auto leading-relaxed
                          ${theme === 'dark' ? 'text-slate-300' : 'text-slate-800'}`}>
                          {generateFormattedContent()}
                       </pre>
                    </div>
                 )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;