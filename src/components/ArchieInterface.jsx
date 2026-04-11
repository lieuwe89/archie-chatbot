import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { Search, History, Book, Image as ImageIcon, User, ExternalLink, Loader2, Send } from 'lucide-react';

const ArchieInterface = () => {
    const [messages, setMessages] = useState([
        { 
            type: 'assistant', 
            content: "Hello! I'm Archie, your archive assistant. I can help you find people in AlleGroningers, photos in the Beeldbank, or historical collections in the Groningen Archives. What are you looking for today?",
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userQuery = input;
        setInput('');
        setMessages(prev => [...prev, { type: 'user', content: userQuery, timestamp: new Date() }]);
        setIsLoading(true);

        try {
            // 1. Fetch search results and summary from Archie API
            const response = await api.archie.search(userQuery);
            const { results, summary } = response;
            
            setMessages(prev => [...prev, { 
                type: 'assistant', 
                content: summary || `I've searched the archives for "${userQuery}". Here is what I found:`,
                results: results,
                timestamp: new Date()
            }]);
        } catch (error) {
            console.error('Archie Search Error:', error);
            setMessages(prev => [...prev, { 
                type: 'assistant', 
                content: "I'm sorry, I encountered an error while searching the archives. Please try again later.",
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                        <History className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none">Archie</h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Groningen Archive Assistant</p>
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] sm:max-w-2xl rounded-2xl p-4 shadow-sm ${
                            msg.type === 'user' 
                            ? 'bg-blue-600 text-white rounded-br-none' 
                            : 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800 rounded-bl-none'
                        }`}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            
                            {msg.results && (
                                <div className="mt-4 space-y-4">
                                    {/* Genealogy Results */}
                                    {msg.results.genealogy?.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center">
                                                <User className="w-3 h-3 mr-1" /> AlleGroningers
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {msg.results.genealogy.map((item, i) => (
                                                    <ResultCard key={i} item={item} icon={<User className="w-4 h-4" />} />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Beeldbank Results */}
                                    {msg.results.beeldbank?.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center">
                                                <ImageIcon className="w-3 h-3 mr-1" /> Beeldbank Groningen
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {msg.results.beeldbank.map((item, i) => (
                                                    <ResultCard key={i} item={item} icon={<ImageIcon className="w-4 h-4" />} isImage />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Inventory Results */}
                                    {msg.results.inventories?.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center">
                                                <Book className="w-3 h-3 mr-1" /> Archive Inventories
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {msg.results.inventories.map((item, i) => (
                                                    <ResultCard key={i} item={item} icon={<Book className="w-4 h-4" />} />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <p className="text-[10px] mt-2 opacity-50 text-right">
                                {msg.timestamp.toLocaleTimeString()}
                            </p>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-bl-none p-4 shadow-sm flex items-center space-x-2">
                            <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                            <span className="text-sm text-gray-500">Archie is searching the vaults...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
                <form onSubmit={handleSearch} className="max-w-4xl mx-auto relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Search for a name, place, or topic..."
                        className="w-full pl-4 pr-12 py-3 bg-gray-100 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-amber-500 dark:text-white"
                        disabled={isLoading}
                    />
                    <button 
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:hover:bg-amber-500 text-white rounded-lg transition-colors"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    </button>
                </form>
                <p className="text-[10px] text-center text-gray-400 mt-2">
                    Tip: Try searching for "Vismarkt", "Suikerfabriek", or a family name.
                </p>
            </div>
        </div>
    );
};

const ResultCard = ({ item, icon, isImage = false }) => (
    <div className="group bg-gray-50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 transition-all cursor-default">
        <div className="flex items-start space-x-3">
            <div className="mt-1 p-1.5 bg-white dark:bg-gray-700 rounded-md text-gray-400 group-hover:text-amber-500 transition-colors shadow-sm">
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate pr-4">{item.title}</h4>
                    <a 
                        href={item.handle} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-500 transition-colors"
                        title="View Original Record"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </a>
                </div>
                {item.date && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.date}</p>}
                {item.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1 italic">
                        {item.description}
                    </p>
                )}
                {isImage && item.thumbnail && (
                    <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 max-w-[200px]">
                        <img src={item.thumbnail} alt={item.title} className="w-full h-auto object-cover" />
                    </div>
                )}
            </div>
        </div>
    </div>
);

export default ArchieInterface;
