import React, { useState, useEffect, useRef } from 'react';
import './SpeechToText.css';

const SpeechToText = () => {
    // UI State
    const [isListening, setIsListening] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isResultFinal, setIsResultFinal] = useState(false);
    
    // Data State
    const [liveTranscript, setLiveTranscript] = useState('');
    const [finalTranscript, setFinalTranscript] = useState(''); // Using a clearer name
    const [extractedData, setExtractedData] = useState(null);
    const [selectedLanguage, setSelectedLanguage] = useState('en');
    
    // History State
    const [history, setHistory] = useState([]);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);

    // Refs for Web APIs & State Flags
    const webSocketRef = useRef(null);
    const audioContextRef = useRef(null);
    const streamRef = useRef(null);
    const workletNodeRef = useRef(null);
    const hasCompletedSuccessfully = useRef(false);

    useEffect(() => {
        try {
            const savedHistory = localStorage.getItem('medicalHistory');
            if (savedHistory) setHistory(JSON.parse(savedHistory));
            localStorage.removeItem('medicalHistory');
        } catch (err) {
            setError("Failed to load history:" + err);
        }
        return () => { if (webSocketRef.current) webSocketRef.current.close(); };
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
        setFinalTranscript('');
        setLiveTranscript('');
        setExtractedData(null);
        setError('');
        setIsLoading(false);

        try {
            // --- CORRECTED & CRITICAL: This is how you format the WebSocket URL ---
            // For local development on your computer:
            const wsUrl = `ws://127.0.0.1:5000/speech/${selectedLanguage}`;
            
            // For your deployed cPanel server (replace with your actual domain):
            // const wsUrl = `wss://your-cpanel-domain.com/speech/${selectedLanguage}`;
            
            const ws = new WebSocket(wsUrl);
            webSocketRef.current = ws;

            ws.onopen = async () => {
                setIsListening(true);
                const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
                streamRef.current = stream;
                
                // --- UPGRADED: Modern AudioWorklet implementation for smooth performance ---
                const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                audioContextRef.current = context;
                
                await context.audioWorklet.addModule('audio-processor.js');
                const workletNode = new AudioWorkletNode(context, 'audio-data-processor');
                workletNodeRef.current = workletNode;

                workletNode.port.onmessage = (event) => {
                    const audioData = event.data;
                    const downsampledBuffer = new Int16Array(audioData.length);
                    for (let i = 0; i < audioData.length; i++) {
                        downsampledBuffer[i] = Math.max(-1, Math.min(1, audioData[i])) * 32767;
                    }
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(downsampledBuffer.buffer);
                    }
                };
                
                const source = context.createMediaStreamSource(stream);
                source.connect(workletNode).connect(context.destination);
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'transcript') {
                        if (message.is_final) {
                            setFinalTranscript(prev => prev + message.text + ' ');
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
                            const finalText = message.data.final_english_text || finalTranscript;
                            setFinalTranscript(finalText);
                            setExtractedData(message.data.extracted_terms || {});
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
                    setError("Connection to server failed. Please ensure the backend is running.");
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
        setIsListening(false);

        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        if (workletNodeRef.current) workletNodeRef.current.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
        
        if (finalTranscript.trim() || liveTranscript.trim()) setIsLoading(true);

        if (shouldSignalServer && webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({ type: 'end_stream' }));
        }
    };

    const handleMicClick = () => isListening ? stopStreaming() : startStreaming();
    
    const handleLoadHistory = (entry) => {
        setFinalTranscript(entry.text);
        setExtractedData(entry.terms);
        setSelectedLanguage(entry.language || 'en');
        setIsResultFinal(true);
        setIsHistoryVisible(false);
    };

    const handleDeleteHistory = (historyId) => {
        const updatedHistory = history.filter(item => item.id !== historyId);
        setHistory(updatedHistory);
        localStorage.setItem('medicalHistory', JSON.stringify(updatedHistory));
    };

    const handleAddItem = (category) => {
        const categoryName = category.replace(/_/g, ' ');
        const newItem = window.prompt(`Add new item to "${categoryName}"`);
        if (newItem && newItem.trim()) {
            setExtractedData(prevData => {
                const currentData = { ...(prevData || {}) };
                const currentItems = currentData[category] || [];
                return {
                    ...currentData,
                    [category]: [...currentItems, newItem.trim()]
                };
            });
        }
    };

    const handleRemoveTerm = (category, termToRemove) => {
        setExtractedData(prevData => {
            const newExtractedData = { ...prevData };
            newExtractedData[category] = newExtractedData[category].filter(term => term !== termToRemove);
            return newExtractedData;
        });
    };

    return (
        <div className="speech-container">
            <button className="history-toggle-btn" onClick={() => setIsHistoryVisible(!isHistoryVisible)}>
                History ({history.length})
            </button>
            <div className={`history-panel ${isHistoryVisible ? 'visible' : ''}`}>
                <div className="history-header">
                    <h2>History</h2>
                    <button className="history-clear-btn" onClick={() => {setHistory([]); localStorage.removeItem('medicalHistory');}} disabled={history.length === 0}>Clear All</button>
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
                                    <button onClick={() => handleLoadHistory(item)}>Load</button>
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
                <textarea className="transcript-box" value={finalTranscript + liveTranscript} readOnly placeholder="1. Select language. 2. Click the mic to start." />
                
                {isLoading && <div className="loading-spinner"></div>}
                {error && <p className="error-message">{error}</p>}
                
                {isResultFinal && extractedData && (
                    <div className="results-container">
                        <div className="result-section">
                            <h3>Extracted Medical Details</h3>
                            {(() => {
                                const allCategoryKeys = Object.keys(extractedData);
                                const populatedCategories = allCategoryKeys.filter(
                                    key => extractedData[key] && extractedData[key].length > 0
                                );
                                const emptyCategories = allCategoryKeys.filter(
                                    key => !extractedData[key] || extractedData[key].length === 0
                                );

                                if (populatedCategories.length === 0 && allCategoryKeys.length > 0) {
                                    return <p className="no-results-found">No specific medical terms were detected. You can add them manually below.</p>;
                                }

                                return (
                                    <>
                                        <div className="details-grid">
                                            {populatedCategories.map((category) => (
                                                <div key={category} className="category-card">
                                                    <div className="category-header">
                                                        <h4>{category.replace(/_/g, ' ')}</h4>
                                                        <button className="add-term-btn" onClick={() => handleAddItem(category)} title={`Add to ${category.replace(/_/g, ' ')}`}>+</button>
                                                    </div>
                                                    <ul>
                                                        {(extractedData[category] || []).map((item, index) => (
                                                            <li key={index}>
                                                                {item}
                                                                <button className="remove-term-btn" onClick={() => handleRemoveTerm(category, item)} title={`Remove ${item}`}>×</button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>

                                        {emptyCategories.length > 0 && (
                                            <div className="add-more-section">
                                                <h4>Add Missing Details</h4>
                                                <div className="add-more-buttons-container">
                                                    {emptyCategories.map(category => (
                                                        <button key={category} className="add-more-btn" onClick={() => handleAddItem(category)}>
                                                            + {category.replace(/_/g, ' ')}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}
            </div>

            <div className="controls-container">
                <div className={`wave-container ${isListening ? 'listening' : ''}`}>
                    {[...Array(5)].map((_, i) => <div key={i} className="wave-bar"></div>)}
                </div>
                <button className={`mic-button ${isListening ? 'listening' : ''}`} onClick={handleMicClick} disabled={isLoading}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24"  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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