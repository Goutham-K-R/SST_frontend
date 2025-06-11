import React, { useState, useEffect, useRef } from 'react';
import './SpeechToText.css';

const SpeechToText = () => {
    const [isListening, setIsListening] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [editableTranscript, setEditableTranscript] = useState('');
    const [isResultFinal, setIsResultFinal] = useState(false);
    const [extractedData, setExtractedData] = useState(null);
    const [selectedLanguage, setSelectedLanguage] = useState('en');
    const [history, setHistory] = useState([]);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);

    const webSocketRef = useRef(null);
    const audioContextRef = useRef(null);
    const scriptProcessorRef = useRef(null);
    const streamRef = useRef(null);
    const hasCompletedSuccessfully = useRef(false);

    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem('medicalHistory');
            if (savedHistory) setHistory(JSON.parse(savedHistory));
        } catch (err) {
            console.error("Failed to load history:", err);
            localStorage.removeItem('medicalHistory');
        }

        return () => {
            if (webSocketRef.current) {
                webSocketRef.current.close();
            }
        };
    }, []);

    const saveToHistory = (newEntry) => {
        setHistory(prevHistory => {
            const updatedHistory = [newEntry, ...prevHistory.slice(0, 49)];
            localStorage.setItem('medicalHistory', JSON.stringify(updatedHistory));
            return updatedHistory;
        });
    };
    
    const startStreaming = async () => {
        if (isListening) return;
        hasCompletedSuccessfully.current = false;
        setIsResultFinal(false);
        setEditableTranscript('');
        setLiveTranscript('');
        setExtractedData(null);
        setError('');
        setIsLoading(false);
        try {
            // NOTE: Ensure this IP address is correct for your local network.
            const wsUrl = `ws://192.168.29.241:5000/speech/${selectedLanguage}`;
            const ws = new WebSocket(wsUrl);
            webSocketRef.current = ws;
            ws.onopen = async () => {
                setIsListening(true);
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
                    streamRef.current = stream;
                    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                    const source = audioContextRef.current.createMediaStreamSource(stream);
                    scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current.onaudioprocess = (event) => {
                        const inputData = event.inputBuffer.getChannelData(0);
                        const downsampledBuffer = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                            downsampledBuffer[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                        }
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(downsampledBuffer.buffer);
                        }
                    };
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(audioContextRef.current.destination);
                } catch (err) {
                    setError('Microphone access was denied. Please allow microphone access.');
                    stopStreaming();
                }
            };
            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'transcript') {
                        if(message.is_final) {
                            setEditableTranscript(prev => prev + message.text + ' ');
                            setLiveTranscript('');
                        } else {
                            setLiveTranscript(message.text);
                        }
                    } else if (message.type === 'entities') {
                        hasCompletedSuccessfully.current = true;
                        setIsLoading(false);
                        setIsResultFinal(true);
                        setError('');
                        if (message.data.error) {
                            setError(`Processing Error: ${message.data.error}`);
                            setExtractedData(message.data.extracted_terms || {});
                        } else {
                            setExtractedData(message.data.extracted_terms || {});
                            const finalText = message.data.final_english_text || editableTranscript;
                            setEditableTranscript(finalText);
                            setSelectedLanguage(message.data.source_language || 'en');
                            saveToHistory({
                                id: Date.now(), text: finalText,
                                terms: message.data.extracted_terms || {},
                                language: message.data.source_language || 'en',
                                timestamp: new Date().toISOString()
                            });
                        }
                    } else if (message.type === 'error') {
                        setError(message.message);
                        setIsLoading(false);
                        setIsListening(false);
                    }
                } catch (e) {
                    setError("Failed to process server response");
                }
            };
            ws.onerror = () => {
                if (!hasCompletedSuccessfully.current) {
                    setError("Connection to server failed. Please ensure the backend is running and the IP address is correct.");
                }
                setIsLoading(false);
                setIsListening(false);
            };
            ws.onclose = () => {
                if (isListening) {
                   stopStreaming(false);
                }
            };
        } catch (err) {
            setError("Failed to establish connection");
        }
    };

    const stopStreaming = (shouldSignalServer = true) => {
        if (!isListening && !isLoading) return;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setIsListening(false);
        if (editableTranscript.trim() && !liveTranscript.trim()) {
           setIsLoading(true); 
        }
        if (shouldSignalServer && webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({ type: 'end_stream' }));
        }
    };

    const handleMicClick = () => isListening ? stopStreaming() : startStreaming();
    const handleLoadHistory = (historyId) => {
        const entry = history.find(item => item.id === historyId);
        if (entry) {
            setEditableTranscript(entry.text);
            setExtractedData(entry.terms);
            setSelectedLanguage(entry.language || 'en');
            setIsResultFinal(true);
            setIsHistoryVisible(false);
        }
    };
    const handleDeleteHistory = (historyId) => {
        const updatedHistory = history.filter(item => item.id !== historyId);
        setHistory(updatedHistory);
        localStorage.setItem('medicalHistory', JSON.stringify(updatedHistory));
    };
    const handleClearHistory = () => {
        setHistory([]);
        localStorage.removeItem('medicalHistory');
    };
    const handleTextChange = (e) => setEditableTranscript(e.target.value);
    const handleRemoveTerm = (category, termToRemove) => {
        setExtractedData(prevData => {
            const newExtractedData = { ...prevData };
            newExtractedData[category] = newExtractedData[category].filter(term => term !== termToRemove);
            return newExtractedData;
        });
    };

    const handleAddItem = (category) => {
        const categoryName = category.replace(/_/g, ' ');
        const newItem = window.prompt(`Add new item to "${categoryName}"`);

        if (newItem && newItem.trim()) {
            setExtractedData(prevData => {
                // --- CORRECTED: Ensure prevData is not null before spreading ---
                const currentData = prevData ? { ...prevData } : {};
                const currentItems = currentData[category] || [];
                
                return {
                    ...currentData,
                    [category]: [...currentItems, newItem.trim()]
                };
            });
        }
    };

    return (
        <div className="speech-container">
            <button className="history-toggle-btn" onClick={() => setIsHistoryVisible(!isHistoryVisible)}>
                History ({history.length})
            </button>
            <div className={`history-panel ${isHistoryVisible ? 'visible' : ''}`}>
                <div className="history-header">
                    <h2>History</h2>
                    <button className="history-clear-btn" onClick={handleClearHistory} disabled={history.length === 0}>Clear All</button>
                    <button className="history-close-btn" onClick={() => setIsHistoryVisible(false)}>×</button>
                </div>
                <ul className="history-list">
                    {history.length > 0 ? (
                        history.map(item => (
                            <li key={item.id} className="history-item">
                                <p className="history-item-text">
                                    {new Date(item.timestamp || item.id).toLocaleString()} - 
                                    "{item.text?.substring(0, 40)}..."
                                </p>
                                <div className="history-item-controls">
                                    <button onClick={() => handleLoadHistory(item.id)}>Load</button>
                                    <button onClick={() => handleDeleteHistory(item.id)} className="delete">Delete</button>
                                </div>
                            </li>
                        ))
                    ) : <p className="history-empty">No history found.</p>}
                </ul>
            </div>

            <div className="main-content">
                <div className="language-selector-container">
                    <label>Recording Language:</label>
                    <div className="language-selector">
                        <button className={selectedLanguage === 'en' ? 'active' : ''} onClick={() => setSelectedLanguage('en')} disabled={isListening}>English</button>
                        <button className={selectedLanguage === 'ml' ? 'active' : ''} onClick={() => setSelectedLanguage('ml')} disabled={isListening}>Malayalam</button>
                    </div>
                </div>
                <textarea className="transcript-box" value={editableTranscript + liveTranscript} onChange={handleTextChange} readOnly={!isResultFinal || isLoading || isListening} placeholder="1. Select language. 2. Click the mic to start." />
                
                {isLoading && <div className="loading-spinner"></div>}
                {error && <p className="error-message">{error}</p>}
                
                {extractedData && (
                    <div className="results-container">
                        <div className="result-section">
                            <h3>Extracted Medical Details</h3>
                            <div className="details-grid">
                                {Object.entries(extractedData).map(([category, items]) => (
                                    Array.isArray(items) && items.length > 0 && (
                                        <div key={category} className="category-card">
                                            <div className="category-header">
                                                <h4>{category.replace(/_/g, ' ')}</h4>
                                                <button className="add-term-btn" onClick={() => handleAddItem(category)} title={`Add to ${category.replace(/_/g, ' ')}`}>
                                                    +
                                                </button>
                                            </div>
                                            <ul>
                                                {items.map((item, index) => (
                                                    <li key={index}>
                                                        {item}
                                                        <button className="remove-term-btn" onClick={() => handleRemoveTerm(category, item)} title={`Remove ${item}`}>×</button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="controls-container">
                <div className={`wave-container ${isListening ? 'listening' : ''}`}>
                    {[...Array(5)].map((_, i) => <div key={i} className="wave-bar"></div>)}
                </div>
                <button className={`mic-button ${isListening ? 'listening' : ''}`} onClick={handleMicClick} disabled={isLoading}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default SpeechToText;