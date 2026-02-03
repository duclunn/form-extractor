import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, FileText, Image as ImageIcon, AlertCircle, X, Loader, Plus, Trash2, Save, Settings, Key, BarChart3, PieChart, FolderInput, RotateCcw, Eye, Cpu, Server, WifiOff, ListPlus, Eraser } from 'lucide-react';

const DEFAULT_LOCAL_URL = "http://localhost:8000/extract";

export default function VietnameseFormExtractor() {
  const [files, setFiles] = useState([]);
  const [extractedData, setExtractedData] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isXLSXLoaded, setIsXLSXLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  
  // Configuration
  const [serverUrl, setServerUrl] = useState(DEFAULT_LOCAL_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [isServerActive, setIsServerActive] = useState(false);
  
  // New State: Should we append data or clear it?
  const [appendMode, setAppendMode] = useState(true);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Load SheetJS
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setIsXLSXLoaded(true);
    document.body.appendChild(script);

    const savedUrl = localStorage.getItem('local_ocr_server_url');
    if (savedUrl) setServerUrl(savedUrl);

    checkServerHealth(savedUrl || DEFAULT_LOCAL_URL);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const saveServerUrl = (url) => {
    setServerUrl(url);
    localStorage.setItem('local_ocr_server_url', url);
    checkServerHealth(url);
  };

  const checkServerHealth = async (url) => {
      try {
          await fetch(url.replace('/extract', '/'), { method: 'GET' });
          setIsServerActive(true);
      } catch (e) {
          setIsServerActive(false);
      }
  };

  const columns = [
    { key: 'source_file', label: 'File Source', type: 'readonly', width: 'min-w-[160px]' },
    { key: 'doc_type', label: 'Type (Loại)', type: 'text', width: 'min-w-[100px]' },
    { key: 'date', label: 'Date (Ngày)', type: 'text', width: 'min-w-[110px]' },
    { key: 'id', label: 'ID (Số phiếu)', type: 'text', width: 'min-w-[120px]' },
    { key: 'name', label: 'Deliverer (Người giao)', type: 'text', width: 'min-w-[200px]' },
    { key: 'description', label: 'Item Name (Tên hàng)', type: 'text', width: 'min-w-[350px]' },
    { key: 'code', label: 'Code (Mã số)', type: 'text', width: 'min-w-[120px]' },
    { key: 'unit', label: 'Unit (ĐVT)', type: 'text', width: 'min-w-[80px]' },
    { key: 'quantity', label: 'Qty (SL)', type: 'number', width: 'min-w-[90px]' },
    { key: 'unitprice', label: 'Price (Đơn giá)', type: 'number', width: 'min-w-[130px]' },
    { key: 'totalprice', label: 'Total (Thành tiền)', type: 'number', width: 'min-w-[140px]' }
  ];

  const standardizeData = (rawData) => {
    return rawData.map(item => {
        const parseNumber = (val) => {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            let clean = val.toString().replace(/[^0-9.,]/g, '');
            if ((clean.match(/\./g) || []).length > 1) {
                clean = clean.replace(/\./g, '');
            } else if (clean.includes('.') && clean.includes(',')) {
                clean = clean.replace(/\./g, '').replace(',', '.');
            } else if (clean.includes(',')) {
                clean = clean.replace(',', '.');
            }
            return parseFloat(clean) || 0;
        };

        const formatUnit = (val) => {
            if (!val) return '';
            const s = val.toString().trim().toLowerCase();
            return s.charAt(0).toUpperCase() + s.slice(1);
        };

        return {
            ...item,
            quantity: parseNumber(item.quantity),
            unitprice: parseNumber(item.unitprice),
            totalprice: parseNumber(item.totalprice),
            unit: formatUnit(item.unit)
        };
    });
  };

  const validateAndSetFiles = (fileList) => {
    const uploadedFiles = Array.from(fileList);
    const validFiles = uploadedFiles.filter(file => 
      file.type === 'application/pdf' || file.type.startsWith('image/')
    );
    
    if (validFiles.length === 0 && uploadedFiles.length > 0) {
        setError('No valid files found. Only PDF and Images are allowed.');
    } else if (validFiles.length !== uploadedFiles.length) {
        setError('Some files were skipped. Only PDF and Images are allowed.');
    } else {
        setError('');
    }

    if (validFiles.length > 0) {
        setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleFileUpload = (e) => {
    validateAndSetFiles(e.target.files);
    e.target.value = null; 
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.items) {
        const droppedFiles = [];
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
            if (e.dataTransfer.items[i].kind === 'file') {
                const file = e.dataTransfer.items[i].getAsFile();
                if (file) droppedFiles.push(file);
            }
        }
        validateAndSetFiles(droppedFiles);
    } else {
        validateAndSetFiles(e.dataTransfer.files);
    }
  };

  const processFiles = async () => {
    if (files.length === 0) {
      setError('Please upload at least one file');
      return;
    }

    setIsProcessing(true);
    setError('');
    
    // Clear data immediately if NOT in append mode
    if (!appendMode) {
        setExtractedData([]);
    }

    setStatusMessage('Connecting to local server...');
    const currentBatchData = []; // Store only data from this run
    let hasErrorOccurred = false;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusMessage(`Sending file ${i + 1}/${files.length} to Local AI: ${file.name}...`);
        
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(serverUrl, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server Error (${response.status}): ${errText}`);
            }

            const result = await response.json();
            const parsedData = result.data || result;

            const injectFileInfo = (data) => data.map(item => ({ 
                ...item, 
                source_file: file.name, 
                file_ref: file 
            }));

            if (Array.isArray(parsedData)) {
                const standardized = standardizeData(parsedData);
                currentBatchData.push(...injectFileInfo(standardized));
            } else {
                const standardized = standardizeData([parsedData]);
                currentBatchData.push(...injectFileInfo(standardized));
            }

        } catch (e) {
            console.error("Processing failed for file", file.name, e);
            hasErrorOccurred = true;
            setError(prev => prev + `\nFailed to process ${file.name}: ${e.message}`);
            
            if (e.message.includes("Failed to fetch")) {
                setError("Could not connect to Local Server. Is 'server.py' running? Check Settings.");
                break; 
            }
        }
      }

      // Update state based on mode
      setExtractedData(prev => {
          if (appendMode) {
              return [...prev, ...currentBatchData];
          } else {
              // If we are in Replace mode, we already cleared at the start, 
              // but we set it here to be safe and ensure we only have the new batch
              return currentBatchData;
          }
      });
      
      if (currentBatchData.length === 0 && !hasErrorOccurred) {
         setError('No structured data returned by the server.');
      } else {
          setFiles([]);
      }

    } catch (err) {
      console.error('Global Processing error:', err);
      setError(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  const exportToExcel = () => {
    if (!isXLSXLoaded || !window.XLSX) {
      setError("Export library is still loading. Please try again in a moment.");
      return;
    }
    
    const wb = window.XLSX.utils.book_new();
    const cleanData = extractedData.map(({ file_ref, ...rest }) => rest);

    const invoices = cleanData.filter(i => i.doc_type === 'Invoice');
    const imports = cleanData.filter(i => i.doc_type === 'Import');
    const exports = cleanData.filter(i => i.doc_type === 'Export');
    const others = cleanData.filter(i => !['Invoice', 'Import', 'Export'].includes(i.doc_type));

    if (invoices.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(invoices), 'Invoices');
    if (imports.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(imports), 'Warehouse Imports');
    if (exports.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(exports), 'Warehouse Releases');
    if (others.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(others), 'Others');
    if (wb.SheetNames.length === 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(cleanData), 'All Data');

    window.XLSX.writeFile(wb, `extractor-data-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportToCSV = () => {
    if (!isXLSXLoaded || !window.XLSX) {
      setError("Export library is still loading. Please try again in a moment.");
      return;
    }
    const cleanData = extractedData.map(({ file_ref, ...rest }) => rest);
    const ws = window.XLSX.utils.json_to_sheet(cleanData);
    const csv = window.XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `extractor-data-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  const updateRow = (index, field, value) => {
    setExtractedData(prev => {
      const newData = [...prev];
      newData[index] = { ...newData[index], [field]: value };
      return newData;
    });
  };

  const deleteRow = (index) => {
    setExtractedData(prev => prev.filter((_, i) => i !== index));
  };

  const addRow = () => {
    const newRow = columns.reduce((acc, col) => ({ ...acc, [col.key]: '' }), {});
    setExtractedData(prev => [...prev, newRow]);
  };

  const clearAll = () => {
    if(window.confirm("Are you sure you want to clear all data?")) {
        setFiles([]);
        setExtractedData([]);
        setError('');
        setStatusMessage('');
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePreviewFile = (file) => {
    if (file) setPreviewFile(file);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-indigo-700 flex items-center gap-2">
              <FileText className="w-8 h-8" />
              Extractor (Local AI)
            </h1>
            <p className="text-slate-500 mt-1">Extract Vietnamese Forms using Local Server (Ollama)</p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-3 items-center">
             
             {/* Server Status Badge */}
             <div className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium shadow-sm ${isServerActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`} title={isServerActive ? "Local Server is connected" : "Cannot connect to Local Server"}>
                <div className={`w-2.5 h-2.5 rounded-full ${isServerActive ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span>{isServerActive ? "Server Active" : "Server Offline"}</span>
             </div>

             <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200`}
             >
                <Settings className="w-4 h-4" />
                Settings
             </button>
             {extractedData.length > 0 && (
                <button onClick={clearAll} className="px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium">
                    Reset All
                </button>
             )}
          </div>
        </div>

        {/* File Preview Modal */}
        {previewFile && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 sm:p-8 animate-in fade-in" onClick={() => setPreviewFile(null)}>
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                        <div className="flex items-center gap-2">
                            {previewFile.type.includes('pdf') ? <FileText className="w-5 h-5 text-red-500"/> : <ImageIcon className="w-5 h-5 text-blue-500"/>}
                            <span className="font-medium text-slate-700 truncate max-w-md">{previewFile.name}</span>
                        </div>
                        <button onClick={() => setPreviewFile(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex-grow bg-slate-100 p-4 overflow-auto flex items-center justify-center">
                        {previewFile.type.includes('pdf') ? (
                            <iframe 
                                src={URL.createObjectURL(previewFile)} 
                                className="w-full h-full rounded-lg border border-slate-200 shadow-sm"
                                title="PDF Preview"
                            ></iframe>
                        ) : (
                            <img 
                                src={URL.createObjectURL(previewFile)} 
                                className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                                alt="Preview"
                            />
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white p-6 rounded-xl shadow-lg border border-indigo-100 animate-in fade-in slide-in-from-top-4">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                   <Server className="w-5 h-5 text-indigo-500" /> Local Server Config
                </h3>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
                   <X className="w-5 h-5" />
                </button>
             </div>
             
             {/* Server URL Input */}
             <div className="space-y-3 mb-6">
                <label className="block text-sm font-medium text-slate-700">Python Server URL</label>
                <div className="flex gap-2">
                   <input 
                      type="text"
                      value={serverUrl}
                      onChange={(e) => saveServerUrl(e.target.value)}
                      placeholder="http://localhost:8000/extract"
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                   />
                   <button
                      onClick={() => checkServerHealth(serverUrl)}
                      className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-100 flex items-center gap-2"
                   >
                      <RotateCcw className="w-3 h-3" /> Test
                   </button>
                </div>
                <p className="text-xs text-slate-500">
                   Requires a running Python backend with Ollama.
                </p>
             </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Left Panel: Upload & Controls */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Upload Box */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="font-semibold text-slate-800 mb-4">1. Upload Documents</h3>
                <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all group
                        ${isDragging 
                            ? 'border-indigo-500 bg-indigo-50 shadow-md' 
                            : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-400'
                        }`}
                >
                    <Upload className={`w-10 h-10 mb-3 transition-colors ${isDragging ? 'text-indigo-600' : 'text-indigo-400 group-hover:text-indigo-600'}`} />
                    <div className="flex flex-col gap-2 items-center w-full">
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg font-medium hover:bg-indigo-50 transition shadow-sm w-full max-w-[200px] flex items-center justify-center gap-2"
                        >
                            <FileText className="w-4 h-4" /> Select Files
                        </button>
                        <div className="flex items-center gap-2 text-slate-400 text-xs w-full justify-center"><span className="h-px bg-slate-300 w-10"></span><span>or</span><span className="h-px bg-slate-300 w-10"></span></div>
                        <button 
                            onClick={() => folderInputRef.current?.click()}
                            className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg font-medium hover:bg-indigo-50 transition shadow-sm w-full max-w-[200px] flex items-center justify-center gap-2"
                        >
                            <FolderInput className="w-4 h-4" /> Select Folder
                        </button>
                    </div>
                    <span className="text-xs text-slate-400 mt-4 text-center">Drag & Drop files or folders here</span>
                </div>
                
                {/* Inputs */}
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,image/*" multiple onChange={handleFileUpload} />
                <input ref={folderInputRef} type="file" className="hidden" {...{ webkitdirectory: "", directory: "" }} multiple onChange={handleFileUpload} />

                {/* File List */}
                {files.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                        {files.map((file, idx) => (
                            <div key={idx} onClick={() => handlePreviewFile(file)} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100 text-sm cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-colors group">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {file.type.includes('pdf') ? <FileText className="w-4 h-4 text-red-500 flex-shrink-0"/> : <ImageIcon className="w-4 h-4 text-blue-500 flex-shrink-0"/>}
                                    <span className="truncate text-slate-600 group-hover:text-indigo-700">{file.name}</span>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="text-slate-400 hover:text-red-500 p-1 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    {appendMode ? <ListPlus className="w-4 h-4 text-blue-500" /> : <Eraser className="w-4 h-4 text-orange-500" />}
                    Result Mode:
                </span>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                        onClick={() => setAppendMode(true)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${appendMode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Append
                    </button>
                    <button 
                        onClick={() => setAppendMode(false)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${!appendMode ? 'bg-white text-orange-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Replace
                    </button>
                </div>
            </div>

            {/* Action Buttons */}
            <button
                onClick={processFiles}
                disabled={isProcessing || files.length === 0}
                className={`w-full py-3 px-4 rounded-xl shadow-sm font-semibold text-white flex items-center justify-center gap-2 transition-all
                    ${isProcessing || files.length === 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'}`}
            >
                {isProcessing ? <Loader className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {isProcessing ? 'Start Extraction' : 'Start Extraction'}
            </button>
            
            {statusMessage && <div className="text-xs text-center text-slate-500 animate-pulse">{statusMessage}</div>}
            {error && <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl text-sm flex items-start gap-2"><AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
          </div>

          {/* Right Panel: Data Table */}
          <div className="lg:col-span-3">
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full min-h-[500px]">
                
                {/* Table Header Controls */}
                <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50/50 rounded-t-xl">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">Results Table</span>
                        <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">{extractedData.length} items</span>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm transition"><Plus className="w-4 h-4" /> Add Row</button>
                        <button onClick={exportToCSV} disabled={extractedData.length === 0} className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 text-sm transition disabled:opacity-50"><FileText className="w-4 h-4" /> CSV</button>
                        <button onClick={exportToExcel} disabled={extractedData.length === 0} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm transition shadow-sm disabled:opacity-50 disabled:shadow-none"><Download className="w-4 h-4" /> Excel</button>
                    </div>
                </div>

                {/* Table Area */}
                <div className="flex-grow p-4 overflow-hidden flex flex-col">
                    {extractedData.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 min-h-[300px]">
                            {isServerActive ? <FileText className="w-8 h-8 text-slate-300" /> : <WifiOff className="w-10 h-10 text-red-200" />}
                            <p>{isServerActive ? "Ready to extract using Local AI." : "Local Server is offline. Please run 'server.py'."}</p>
                        </div>
                    ) : (
                        <div className="border rounded-lg overflow-auto flex-grow bg-white shadow-sm">
                            <table className="min-w-max w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="w-10 px-3 py-3"></th>
                                        {columns.map(col => (
                                            <th key={col.key} className={`px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50 ${col.width || ''}`}>{col.label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {extractedData.map((row, rowIndex) => (
                                        <tr key={rowIndex} className="hover:bg-indigo-50/30 transition-colors group">
                                            <td className="px-2 py-2 text-center">
                                                <button onClick={() => deleteRow(rowIndex)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                            </td>
                                            {columns.map(col => (
                                                <td key={col.key} className="px-2 py-1">
                                                    {col.key === 'source_file' ? (
                                                        <button onClick={() => handlePreviewFile(row.file_ref)} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium truncate max-w-[140px] hover:underline" title={row[col.key]}><Eye className="w-3 h-3 flex-shrink-0" /><span className="truncate">{row[col.key]}</span></button>
                                                    ) : (
                                                        <input type={col.type} value={row[col.key] || ''} onChange={(e) => updateRow(rowIndex, col.key, e.target.value)} className="w-full px-2 py-1.5 text-sm border-transparent bg-transparent rounded focus:bg-white focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200 transition-all outline-none text-slate-700 min-w-full" placeholder="..." />
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}