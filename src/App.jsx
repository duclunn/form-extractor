import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, FileText, Image as ImageIcon, AlertCircle, X, Loader, Plus, Trash2, Save, Settings, Layers, ClipboardList, Columns, FileDown, FolderInput, ListPlus, Eraser, WifiOff, Eye, Server } from 'lucide-react';

const DEFAULT_LOCAL_URL = "https://unoratorical-geophysical-jarrod.ngrok-free.dev/extract";

export default function App() {
  const [files, setFiles] = useState([]);
  const [extractedData, setExtractedData] = useState([]);
  const [materialHistory, setMaterialHistory] = useState([]); // History state for material list
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isXLSXLoaded, setIsXLSXLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [compareItem, setCompareItem] = useState(null); // Side-by-side Modal State
  
  // Resizing state for Compare Modal - Default to 1:2 ratio (33.33%)
  const [splitPercentage, setSplitPercentage] = useState(33.33);
  const [isResizing, setIsResizing] = useState(false);
  const compareContainerRef = useRef(null);

  // State to track which Material List order number cell is being edited
  const [editingCodeIdx, setEditingCodeIdx] = useState(null);

  const [serverUrl, setServerUrl] = useState(DEFAULT_LOCAL_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [isServerActive, setIsServerActive] = useState(false);
  
  const [extractionMode, setExtractionMode] = useState('standard');
  const [appendMode, setAppendMode] = useState(true);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => setIsXLSXLoaded(true);
    document.body.appendChild(script);

    const savedUrl = localStorage.getItem('local_ocr_server_url');
    const urlToUse = savedUrl || DEFAULT_LOCAL_URL;
    
    setServerUrl(urlToUse);
    checkServerHealth(urlToUse);

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

  // Resizing logic effect
  useEffect(() => {
    const handleMouseMove = (e) => {
        if (!isResizing || !compareContainerRef.current) return;
        const containerRect = compareContainerRef.current.getBoundingClientRect();
        // Calculate new percentage based on mouse position relative to container
        const newPercentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        // Keep the drag bounds between 20% and 80% to avoid crushing either pane
        if (newPercentage >= 20 && newPercentage <= 80) { 
            setSplitPercentage(newPercentage);
        }
    };

    const handleMouseUp = () => {
        if (isResizing) setIsResizing(false);
    };

    if (isResizing) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const startResizing = (e) => {
      e.preventDefault(); // Prevent text selection while dragging
      setIsResizing(true);
  };

  const formatNumber = (num) => {
      if (num === null || num === undefined || num === '') return '';
      if (typeof num === 'string' && (num.includes('.') || num.includes(','))) return num;
      const val = parseFloat(num);
      if (isNaN(val)) return '';
      return new Intl.NumberFormat('vi-VN').format(val);
  };

  const parseNumber = (str) => {
      if (typeof str === 'number') return str;
      if (!str) return 0;
      const clean = str.toString().replace(/\./g, '').replace(/,/g, '.');
      return parseFloat(clean) || 0;
  };

  // Standard Mode Column Definition
  const columns = [
    { key: 'stt', label: 'STT', type: 'readonly', width: 'w-[50px] text-center' },
    { key: 'source_file', label: 'Tệp nguồn', type: 'readonly', width: 'min-w-[160px]' },
    { key: 'doc_type', label: 'Loại chứng từ', type: 'text', width: 'min-w-[100px]' },
    { key: 'date', label: 'Ngày', type: 'text', width: 'min-w-[110px]' },
    { key: 'id', label: 'Số phiếu', type: 'text', width: 'min-w-[120px]' },
    { key: 'name', label: 'Người giao/Đơn vị', type: 'text', width: 'min-w-[200px]' },
    { key: 'description', label: 'Tên', type: 'text', width: 'min-w-[350px]' },
    { key: 'order_numbers', label: 'Mã Code', type: 'text', width: 'min-w-[150px]' },
    { key: 'code', label: 'Mã hàng', type: 'text', width: 'min-w-[120px]' },
    { key: 'unit', label: 'ĐVT', type: 'text', width: 'min-w-[80px]' },
    { key: 'quantity_doc', label: 'SL CTừ', type: 'text', width: 'min-w-[90px]', isNumeric: true },
    { key: 'quantity_actual', label: 'SL Thực', type: 'text', width: 'min-w-[90px]', isNumeric: true },
    { key: 'unitprice', label: 'Đơn giá', type: 'text', width: 'min-w-[130px]', isNumeric: true },
    { key: 'totalprice', label: 'Thành tiền', type: 'text', width: 'min-w-[140px]', isNumeric: true }
  ];

  // Specific widths for the Compare Modal columns (Percentage based to fit exactly in container)
  const compareColumnWidths = {
    'STT': 'w-[5%]',
    'Tên vật tư': 'w-[25%]',
    'Quy cách': 'w-[15%]',
    'ĐVT': 'w-[7%]',
    'Định mức': 'w-[10%]',
    'Thực lĩnh': 'w-[10%]',
    'Chênh lệch': 'w-[10%]',
    'Ghi chú': 'w-[18%]'
  };

  const standardizeData = (rawData) => {
    return rawData.map(item => {
        const cleanVal = (val) => {
            if (val === null || val === undefined || val === '') return '';
            if (typeof val === 'number') return val;
            let clean = val.toString().replace(/[^0-9.,]/g, '');
            if ((clean.match(/\./g) || []).length > 1) { clean = clean.replace(/\./g, ''); } 
            else if (clean.includes('.') && clean.includes(',')) { clean = clean.replace(/\./g, '').replace(',', '.'); } 
            else if (clean.includes(',')) { clean = clean.replace(',', '.'); }
            return parseFloat(clean) || 0;
        };

        const formatUnit = (val) => {
            if (!val) return '';
            const s = val.toString().trim().toLowerCase();
            return s.charAt(0).toUpperCase() + s.slice(1);
        };

        const translateDocType = (type) => {
            if (!type) return '';
            const t = type.toString().toLowerCase();
            if (t.includes('export')) return 'Phiếu xuất kho';
            if (t.includes('import')) return 'Phiếu nhập kho';
            if (t.includes('invoice')) return 'Hoá đơn';
            return type;
        };

        return {
            ...item,
            doc_type: translateDocType(item.doc_type),
            quantity_doc: formatNumber(cleanVal(item.quantity_doc)),
            quantity_actual: formatNumber(cleanVal(item.quantity_actual)),
            unitprice: formatNumber(cleanVal(item.unitprice)),
            totalprice: formatNumber(cleanVal(item.totalprice)),
            unit: formatUnit(item.unit)
        };
    });
  };

  const validateAndSetFiles = (fileList) => {
    const uploadedFiles = Array.from(fileList);
    const validFiles = uploadedFiles.filter(file => 
      file.type === 'application/pdf' || file.type.startsWith('image/')
    );
    if (validFiles.length > 0) {
        setFiles(prev => [...prev, ...validFiles]);
        setError('');
    } else {
        setError('Không tìm thấy tệp hợp lệ. Chỉ chấp nhận PDF và Hình ảnh.');
    }
  };

  const handleFileUpload = (e) => validateAndSetFiles(e.target.files);
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = async (e) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.items) {
        const droppedFiles = [];
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
            if (e.dataTransfer.items[i].kind === 'file') droppedFiles.push(e.dataTransfer.items[i].getAsFile());
        }
        validateAndSetFiles(droppedFiles);
    } else {
        validateAndSetFiles(e.dataTransfer.files);
    }
  };

  const processFiles = async () => {
    if (files.length === 0) { setError('Vui lòng tải lên ít nhất một tệp tin'); return; }

    setIsProcessing(true);
    setError('');
    if (!appendMode && extractionMode === 'standard') setExtractedData([]);
    if (!appendMode && extractionMode === 'material_list') setMaterialHistory([]);

    setStatusMessage('Đang kết nối máy chủ...');
    const currentBatchData = []; 
    const currentHistoryBatch = [];
    let hasErrorOccurred = false;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusMessage(`Đang xử lý tệp ${i + 1}/${files.length}: ${file.name}...`);
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', extractionMode);

        try {
            const response = await fetch(serverUrl, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Lỗi máy chủ (${response.status}): ${await response.text()}`);

            const result = await response.json();
            const parsedData = result.data || [];

            if (extractionMode === 'material_list') {
                // Determine if backend returned the new grouped format
                const isMultiList = Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].hasOwnProperty('list_name');
                
                if (isMultiList) {
                    parsedData.forEach(listObj => {
                        currentHistoryBatch.push({
                            id: crypto.randomUUID(),
                            file: file,
                            fileName: file.name,
                            listName: listObj.list_name || 'Bảng kê không tên',
                            orderNumber: listObj.order_number || 'N/A',
                            data: listObj.data 
                        });
                    });
                } else {
                    // Fallback for older single-array format
                    currentHistoryBatch.push({
                        id: crypto.randomUUID(),
                        file: file,
                        fileName: file.name,
                        listName: 'Bảng kê',
                        orderNumber: '',
                        data: parsedData 
                    });
                }
            } else {
                 const flattenAndInjectInfo = (data) => {
                    return data.flatMap(item => {
                        const orderNums = item.order_numbers;
                        if (Array.isArray(orderNums) && orderNums.length > 0) {
                            const valActual = item.quantity_actual === '' ? null : parseNumber(item.quantity_actual);
                            const valDoc = item.quantity_doc === '' ? null : parseNumber(item.quantity_doc);
                            const targetQty = valActual !== null ? valActual : valDoc;
                            const isCountMatch = typeof targetQty === 'number' && targetQty === orderNums.length;

                            return orderNums.map(orderNum => ({
                                ...item,
                                source_file: file.name,
                                file_ref: file,
                                order_numbers: orderNum, 
                                quantity_doc: (isCountMatch && valDoc !== null) ? "1" : item.quantity_doc,
                                quantity_actual: (isCountMatch && valActual !== null) ? "1" : item.quantity_actual,
                                totalprice: isCountMatch ? item.unitprice : item.totalprice
                            }));
                        }
                        return [{
                            ...item,
                            source_file: file.name,
                            file_ref: file,
                            order_numbers: Array.isArray(item.order_numbers) ? item.order_numbers.join(", ") : item.order_numbers
                        }];
                    });
                };
                
                const rawArray = Array.isArray(parsedData) ? parsedData : [parsedData];
                const processedItems = flattenAndInjectInfo(rawArray);
                currentBatchData.push(...standardizeData(processedItems));
            }
        } catch (e) {
            console.error("Xử lý thất bại cho tệp", file.name, e);
            hasErrorOccurred = true;
            setError(prev => prev + `\nLỗi khi xử lý ${file.name}: ${e.message}`);
        }
      }

      if (extractionMode === 'material_list') {
          setMaterialHistory(prev => appendMode ? [...prev, ...currentHistoryBatch] : currentHistoryBatch);
      } else {
          setExtractedData(prev => appendMode ? [...prev, ...currentBatchData] : currentBatchData);
      }
      
      setFiles([]);

    } catch (err) {
      console.error('Lỗi tổng:', err);
      setError(`Lỗi: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  // STANDARD EXPORT
  const exportToExcel = () => {
    if (!window.XLSX) return;
    const wb = window.XLSX.utils.book_new();
    const cleanData = extractedData.map(({ file_ref, ...rest }) => {
        const item = { ...rest };
        columns.forEach(col => { if (col.isNumeric) item[col.key] = parseNumber(item[col.key]); });
        return item;
    });
    
    const dataWithStt = cleanData.map((item, index) => ({ stt: index + 1, ...item }));
    const groups = { 'Hoá đơn': [], 'Phiếu nhập kho': [], 'Phiếu xuất kho': [], 'Khác': [] };
    dataWithStt.forEach((item) => {
        if (item.doc_type === 'Hoá đơn') groups['Hoá đơn'].push(item);
        else if (item.doc_type === 'Phiếu nhập kho') groups['Phiếu nhập kho'].push(item);
        else if (item.doc_type === 'Phiếu xuất kho') groups['Phiếu xuất kho'].push(item);
        else groups['Khác'].push(item);
    });
    Object.entries(groups).forEach(([name, data]) => {
        if (data.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), name);
    });
    if (wb.SheetNames.length === 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(dataWithStt), 'Tất cả');
    window.XLSX.writeFile(wb, `trich-xuat-hoa-don-chung-tu.xlsx`);
  };

  // MATERIAL EXPORT
  const downloadMaterialExcel = (item) => {
    if (!window.XLSX) return;
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(item.data);
    window.XLSX.utils.book_append_sheet(wb, ws, 'Bảng kê vật tư');
    
    let baseName = item.fileName.replace(/\.[^/.]+$/, "");
    let addon = item.orderNumber && item.orderNumber !== 'N/A' ? `_${item.orderNumber}` : '';
    addon = addon.replace(/[/\\?%*:|"<>]/g, '-'); // Sanitize filename
    
    window.XLSX.writeFile(wb, `${baseName}${addon}.xlsx`);
  };

  const exportToCSV = () => {
    if (!window.XLSX) return;
    const cleanData = extractedData.map(({ file_ref, ...rest }, index) => {
        const item = { stt: index + 1, ...rest };
        columns.forEach(col => { if (col.isNumeric) item[col.key] = parseNumber(item[col.key]); });
        return item;
    });
    const ws = window.XLSX.utils.json_to_sheet(cleanData);
    const csv = window.XLSX.utils.sheet_to_csv(ws);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `ket-qua-trich-xuat.csv`;
    link.click();
  };

  const updateRow = (index, field, value) => setExtractedData(prev => {
      const newData = [...prev]; newData[index] = { ...newData[index], [field]: value }; return newData;
  });

  // Handle Editing Material History Info fields (listName, orderNumber)
  const updateMaterialHistoryItem = (index, field, value) => {
      setMaterialHistory(prev => {
          const newData = [...prev];
          newData[index] = { ...newData[index], [field]: value };
          return newData;
      });
  };

  // Handle Editing inside the Compare Modal
  const handleCompareItemChange = (rowIndex, key, newValue) => {
      if (!compareItem) return;
      
      const updatedData = [...compareItem.data];
      updatedData[rowIndex] = { ...updatedData[rowIndex], [key]: newValue };
      
      const updatedCompareItem = { ...compareItem, data: updatedData };
      
      setCompareItem(updatedCompareItem);
      
      setMaterialHistory(prevHistory => 
          prevHistory.map(item => 
              item.id === compareItem.id ? updatedCompareItem : item
          )
      );
  };

  const deleteRow = (index) => setExtractedData(prev => prev.filter((_, i) => i !== index));
  const addRow = () => setExtractedData(prev => [...prev, columns.reduce((acc, col) => ({ ...acc, [col.key]: '' }), {})]);
  const clearAll = () => {
    if(window.confirm("Bạn có chắc muốn xóa toàn bộ dữ liệu?")) {
        setFiles([]); setExtractedData([]); setMaterialHistory([]); setError(''); setStatusMessage('');
    }
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePreviewFile = (file) => {
    if (file) setPreviewFile(file);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-6 font-sans text-slate-900">
      <div className="w-full mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold text-indigo-700 flex items-center gap-2">
              <FileText className="w-8 h-8" />
              Trích xuất Hóa đơn & Chứng từ
            </h1>
            <p className="text-slate-500 mt-1">Hỗ trợ Hóa đơn, Phiếu Kho & Bảng kê vật tư</p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-3 items-center">
             <div className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium shadow-sm ${isServerActive ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                <div className={`w-2.5 h-2.5 rounded-full ${isServerActive ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span>{isServerActive ? "Server Online" : "Server Offline"}</span>
             </div>
             <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-slate-100 text-slate-700 hover:bg-slate-200">
                <Settings className="w-4 h-4" /> Cài đặt
             </button>
             {(extractedData.length > 0 || materialHistory.length > 0) && (
                <button onClick={clearAll} className="px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors font-medium">
                    Xóa tất cả
                </button>
             )}
          </div>
        </div>

        {/* Cấu hình & Chế độ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                        {extractionMode === 'standard' ? <Layers className="w-6 h-6"/> : <ClipboardList className="w-6 h-6"/>}
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-800">Chế độ Trích xuất</h3>
                        <p className="text-xs text-slate-500">
                            {extractionMode === 'standard' ? "Hóa đơn, Phiếu Nhập/Xuất kho" : "Bảng kê vật tư"}
                        </p>
                    </div>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
                    <button onClick={() => setExtractionMode('standard')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${extractionMode === 'standard' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        Hóa đơn / Phiếu kho
                    </button>
                    <button onClick={() => setExtractionMode('material_list')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${extractionMode === 'material_list' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        Bảng kê vật tư
                    </button>
                </div>
            </div>

            {showSettings && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-indigo-100 animate-in fade-in">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Server className="w-4 h-4 text-indigo-500" /> Cấu hình Server</h3>
                    <button onClick={() => setShowSettings(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex gap-2">
                    <input type="text" value={serverUrl} onChange={(e) => saveServerUrl(e.target.value)} className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm outline-none" />
                    <button onClick={() => checkServerHealth(serverUrl)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded text-sm font-medium">Check</button>
                </div>
            </div>
            )}
        </div>

        {/* Modal: Compare / Preview */}
        {compareItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 p-4 sm:p-8 animate-in fade-in" onClick={() => setCompareItem(null)}>
                <div className="bg-white rounded-xl shadow-2xl w-full h-full flex flex-col overflow-hidden relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 shrink-0">
                        <div className="flex items-center gap-2">
                            <Columns className="w-5 h-5 text-indigo-500"/>
                            <span className="font-semibold text-slate-700 text-lg">So sánh: {compareItem.listName || compareItem.fileName} {compareItem.orderNumber && compareItem.orderNumber !== 'N/A' ? `(${compareItem.orderNumber})` : ''}</span>
                        </div>
                        <button onClick={() => setCompareItem(null)} className="p-2 hover:bg-slate-200 rounded-full"><X className="w-6 h-6" /></button>
                    </div>
                    
                    {/* Resizable Container */}
                    <div className="flex-grow flex flex-col md:flex-row overflow-hidden relative" ref={compareContainerRef}>
                        
                        {/* Cột trái - File Đầu vào */}
                        <div 
                            className="w-full md:w-auto h-1/2 md:h-full border-b md:border-b-0 md:border-r border-slate-200 bg-slate-100 p-2 flex flex-col relative shrink-0 transition-[flex-basis] duration-75 ease-linear"
                            style={{ flexBasis: `${splitPercentage}%` }}
                        >
                           <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 text-center">Tệp gốc</span>
                           <iframe src={URL.createObjectURL(compareItem.file)} className="w-full flex-grow rounded border border-slate-300 shadow-inner" title="PDF Preview" />
                           {/* Invisible overlay while dragging to prevent iframe from intercepting mouse events */}
                           {isResizing && <div className="absolute inset-0 z-10 cursor-col-resize" />} 
                        </div>

                        {/* Dragger / Resizer (Visible only on desktop md+) */}
                        <div 
                            className="hidden md:flex w-2 cursor-col-resize bg-slate-200 hover:bg-indigo-400 shrink-0 items-center justify-center transition-colors z-20"
                            onMouseDown={startResizing}
                        >
                            <div className="w-0.5 h-8 bg-slate-400 rounded-full" />
                        </div>

                        {/* Cột phải - Bảng Dữ liệu */}
                        <div className="flex-1 p-2 overflow-auto bg-white flex flex-col min-w-0">
                           <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 text-center">Dữ liệu trích xuất (CÓ THỂ CHỈNH SỬA)</span>
                           <div className="border border-slate-200 rounded overflow-auto flex-grow relative shadow-sm">
                               <table className="w-full table-fixed divide-y divide-slate-200 text-sm">
                                   <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                       <tr className="divide-x divide-slate-200">
                                            {compareItem.data.length > 0 && Object.keys(compareItem.data[0]).map(key => (
                                                <th 
                                                    key={key} 
                                                    className={`px-1 py-3 text-center text-[10px] sm:text-xs font-semibold text-slate-700 uppercase overflow-hidden ${compareColumnWidths[key] || 'w-[10%]'}`}
                                                >
                                                    {key}
                                                </th>
                                            ))}
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-x divide-slate-200">
                                       {compareItem.data.map((row, i) => (
                                           <tr key={i} className="divide-x divide-slate-200 hover:bg-indigo-50/30">
                                                {Object.keys(compareItem.data[0]).map(key => (
                                                    <td key={key} className="px-0 py-1 overflow-hidden">
                                                        <input 
                                                            type="text"
                                                            value={row[key] || ''}
                                                            onChange={(e) => handleCompareItemChange(i, key, e.target.value)}
                                                            className="w-full px-1 py-1 text-xs sm:text-sm border-transparent bg-transparent rounded focus:bg-white focus:border-indigo-300 outline-none text-slate-700 text-center truncate"
                                                            title={row[key] || ''}
                                                        />
                                                    </td>
                                                ))}
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Modal: Standalone Preview */}
        {previewFile && !compareItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 sm:p-8 animate-in fade-in" onClick={() => setPreviewFile(null)}>
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden relative" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 shrink-0">
                        <div className="flex items-center gap-2">
                            {previewFile.type.includes('pdf') ? <FileText className="w-5 h-5 text-red-500"/> : <ImageIcon className="w-5 h-5 text-blue-500"/>}
                            <span className="font-medium text-slate-700 truncate max-w-md">{previewFile.name}</span>
                        </div>
                        <button onClick={() => setPreviewFile(null)} className="p-2 hover:bg-slate-200 rounded-full"><X className="w-6 h-6" /></button>
                    </div>
                    <div className="flex-grow bg-slate-100 p-4 overflow-auto flex items-center justify-center">
                        {previewFile.type.includes('pdf') ? (
                            <iframe src={URL.createObjectURL(previewFile)} className="w-full h-full rounded border" />
                        ) : (
                            <img src={URL.createObjectURL(previewFile)} className="max-w-full max-h-full object-contain rounded" />
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Khu vực thao tác chính */}
        <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6">
          
          {/* Cột trái: Upload */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="font-semibold text-slate-800 mb-4">1. Tải lên tài liệu</h3>
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all group ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50'}`}>
                    <Upload className={`w-10 h-10 mb-3 ${isDragging ? 'text-indigo-600' : 'text-indigo-400 group-hover:text-indigo-600'}`} />
                    <div className="flex flex-col gap-2 items-center w-full">
                        <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg font-medium shadow-sm w-full">Chọn Tệp tin</button>
                        <div className="flex items-center gap-2 text-slate-400 text-xs w-full justify-center">
                            <span className="h-px bg-slate-300 w-10"></span><span>hoặc</span><span className="h-px bg-slate-300 w-10"></span>
                        </div>
                        <button onClick={() => folderInputRef.current?.click()} className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg font-medium shadow-sm w-full flex justify-center"><FolderInput className="w-4 h-4 mr-2"/> Chọn Thư mục</button>
                    </div>
                </div>
                
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,image/*" multiple onChange={handleFileUpload} />
                <input ref={folderInputRef} type="file" className="hidden" {...{ webkitdirectory: "", directory: "" }} multiple onChange={handleFileUpload} />

                {files.length > 0 && (
                    <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                        {files.map((file, idx) => (
                            <div key={idx} onClick={() => setPreviewFile(file)} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100 text-sm cursor-pointer hover:bg-indigo-50 transition-colors">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <FileText className="w-4 h-4 text-slate-500 flex-shrink-0"/>
                                    <span className="truncate text-slate-600">{file.name}</span>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} className="text-slate-400 hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    {appendMode ? <ListPlus className="w-4 h-4 text-blue-500" /> : <Eraser className="w-4 h-4 text-orange-500" />} Ghi dữ liệu:
                </span>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button onClick={() => setAppendMode(true)} className={`px-3 py-1 text-xs font-medium rounded-md ${appendMode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Nối tiếp</button>
                    <button onClick={() => setAppendMode(false)} className={`px-3 py-1 text-xs font-medium rounded-md ${!appendMode ? 'bg-white text-orange-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Thay thế</button>
                </div>
            </div>

            <button onClick={processFiles} disabled={isProcessing || files.length === 0} className={`w-full py-3 px-4 rounded-xl shadow-sm font-semibold text-white flex items-center justify-center gap-2 transition-all ${isProcessing || files.length === 0 ? 'bg-slate-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                {isProcessing ? <Loader className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {isProcessing ? 'Đang trích xuất...' : 'Bắt đầu Trích xuất'}
            </button>
            
            {statusMessage && <div className="text-xs text-center text-slate-500 animate-pulse">{statusMessage}</div>}
            {error && <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl text-sm flex items-start gap-2"><AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
          </div>

          {/* Cột phải: Bảng kết quả (Render dựa trên Mode) */}
          <div className="min-w-0">
             <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full min-h-[500px]">
                
                {extractionMode === 'standard' ? (
                    /* ----- STANDARD MODE RENDER ----- */
                    <>
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700">Bảng kết quả</span>
                                <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">{extractedData.length} mục</span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm transition">
                                    <Plus className="w-4 h-4" /> Thêm
                                </button>
                                <button onClick={exportToCSV} disabled={extractedData.length === 0} className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 text-sm">
                                    <FileText className="w-4 h-4" /> CSV
                                </button>
                                <button onClick={exportToExcel} disabled={extractedData.length === 0} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm shadow-sm">
                                    <Download className="w-4 h-4" /> Excel
                                </button>
                            </div>
                        </div>

                        <div className="flex-grow p-4 overflow-hidden flex flex-col">
                            {extractedData.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 min-h-[300px]">
                                    <FileText className="w-8 h-8 text-slate-300" />
                                    <p>Sẵn sàng trích xuất Hóa đơn / Chứng từ</p>
                                </div>
                            ) : (
                                <div className="border border-slate-200 rounded-lg overflow-auto flex-grow shadow-sm max-h-[75vh]">
                                    <table className="min-w-max w-full divide-y divide-slate-200 text-sm relative">
                                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                            <tr className="divide-x divide-slate-200">
                                                <th className="w-10 px-3 py-3 border-b border-slate-200"></th>
                                                {columns.map(col => (
                                                    <th key={col.key} className={`px-3 py-3 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider whitespace-nowrap bg-slate-50 border-b border-slate-200 ${col.width || ''}`}>
                                                        {col.label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {extractedData.map((row, idx) => (
                                                <tr key={idx} className="divide-x divide-slate-200 hover:bg-indigo-50/30 transition-colors group">
                                                    <td className="px-2 py-2 text-center">
                                                        <button onClick={() => deleteRow(idx)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                                    </td>
                                                    {columns.map(col => (
                                                        <td key={col.key} className="px-2 py-1">
                                                            {col.key === 'stt' ? (
                                                                <div className="text-center text-slate-500 font-medium text-xs">{idx + 1}</div>
                                                            ) : col.key === 'source_file' ? (
                                                                <button onClick={() => setPreviewFile(row.file_ref)} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium truncate max-w-[140px] hover:underline" title={row[col.key]}>
                                                                    <Eye className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{row[col.key]}</span>
                                                                </button>
                                                            ) : (
                                                                <input type={col.type} value={row[col.key] || ''} onChange={(e) => updateRow(idx, col.key, e.target.value)} className={`w-full px-2 py-1.5 text-sm border-transparent bg-transparent rounded focus:bg-white focus:border-indigo-300 outline-none text-slate-700 min-w-full ${col.isNumeric ? 'text-right' : ''}`} placeholder="..." />
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
                    </>
                ) : (
                    /* ----- MATERIAL LIST MODE RENDER ----- */
                    <>
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-700">Lịch sử trích xuất Bảng kê vật tư</span>
                                <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">{materialHistory.length} tệp</span>
                            </div>
                        </div>

                        <div className="flex-grow p-4 overflow-hidden flex flex-col">
                            {materialHistory.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 min-h-[300px]">
                                    <ClipboardList className="w-10 h-10 text-slate-300" />
                                    <p>Sẵn sàng trích xuất Bảng kê vật tư</p>
                                </div>
                            ) : (
                                <div className="border border-slate-200 rounded-lg overflow-auto shadow-sm max-h-[75vh]">
                                    <table className="w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 text-left font-semibold text-slate-700 uppercase tracking-wider text-xs w-48">Tệp đầu vào (PDF)</th>
                                                <th className="px-4 py-3 text-left font-semibold text-slate-700 uppercase tracking-wider text-xs w-64">Tên bảng</th>
                                                <th className="px-4 py-3 text-left font-semibold text-slate-700 uppercase tracking-wider text-xs">Mã code</th>
                                                <th className="px-4 py-3 text-center font-semibold text-slate-700 uppercase tracking-wider text-xs w-32">So sánh</th>
                                                <th className="px-4 py-3 text-center font-semibold text-slate-700 uppercase tracking-wider text-xs w-40">Tải về</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-slate-200">
                                            {materialHistory.map((item, idx) => (
                                                <tr key={item.id || idx} className="hover:bg-indigo-50/30 transition-colors">
                                                    <td className="px-4 py-4 font-medium text-slate-700 flex items-center gap-3">
                                                        <div className="p-2 bg-red-50 text-red-500 rounded flex-shrink-0"><FileText className="w-5 h-5" /></div>
                                                        <span className="truncate max-w-[120px] lg:max-w-[150px]" title={item.fileName}>{item.fileName}</span>
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        <input 
                                                            type="text" 
                                                            value={item.listName || ''} 
                                                            onChange={(e) => updateMaterialHistoryItem(idx, 'listName', e.target.value)}
                                                            className="w-full px-3 py-2 text-sm font-medium border border-transparent hover:border-slate-300 focus:border-indigo-400 focus:bg-white focus:shadow-sm bg-transparent rounded outline-none text-slate-700 transition-all placeholder:text-slate-300"
                                                            placeholder="Nhập tên bảng..."
                                                        />
                                                    </td>
                                                    <td className="px-2 py-2 align-middle">
                                                        {editingCodeIdx === idx ? (
                                                            <input 
                                                                autoFocus
                                                                type="text" 
                                                                value={item.orderNumber === 'N/A' ? '' : (item.orderNumber || '')} 
                                                                onChange={(e) => updateMaterialHistoryItem(idx, 'orderNumber', e.target.value)}
                                                                onBlur={() => setEditingCodeIdx(null)}
                                                                onKeyDown={(e) => e.key === 'Enter' && setEditingCodeIdx(null)}
                                                                className="w-full px-3 py-2 text-sm font-semibold border border-indigo-400 focus:border-indigo-500 bg-white shadow-sm rounded outline-none text-indigo-700 placeholder:text-slate-400 placeholder:font-normal transition-all"
                                                                placeholder="Nhập mã, cách nhau dấu phẩy..."
                                                            />
                                                        ) : (
                                                            <div 
                                                                onClick={() => setEditingCodeIdx(idx)}
                                                                className="w-full min-h-[36px] flex flex-wrap gap-1.5 p-2 rounded cursor-text border border-transparent hover:border-slate-300 hover:bg-white transition-colors items-center"
                                                                title="Nhấp để chỉnh sửa"
                                                            >
                                                                {!item.orderNumber || item.orderNumber === 'N/A' || item.orderNumber.trim() === '' ? (
                                                                    <span className="text-slate-400 text-sm italic">Không có mã...</span>
                                                                ) : (
                                                                    item.orderNumber.split(',').map((tag, tIdx) => {
                                                                        const trimmed = tag.trim();
                                                                        if (!trimmed) return null;
                                                                        return (
                                                                            <span key={tIdx} className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap shadow-sm">
                                                                                {trimmed}
                                                                            </span>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <button 
                                                            onClick={() => setCompareItem(item)} 
                                                            className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg font-medium hover:bg-indigo-100 flex items-center justify-center gap-1 mx-auto transition shadow-sm border border-indigo-100"
                                                        >
                                                            <Columns className="w-4 h-4" /> So sánh
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <button 
                                                            onClick={() => downloadMaterialExcel(item)} 
                                                            className="px-3 py-2 bg-green-50 text-green-700 rounded-lg font-medium hover:bg-green-100 flex items-center justify-center gap-1 mx-auto transition shadow-sm border border-green-100"
                                                        >
                                                            <FileDown className="w-4 h-4" /> Excel
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}

             </div>
          </div>
        </div>
      </div>
    </div>
  );
}