"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, ExternalLink } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── Main LeadsSearchInput ──────────────────────────────────────────────────

export default function LeadsSearchInput({ placeholder, children }: { placeholder: string; children?: React.ReactNode }) {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();

    const handleSearch = useCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        if (term) params.set("q", term);
        else params.delete("q");
        replace(`${pathname}?${params.toString()}`);
    }, [searchParams, pathname, replace]);

    const debouncedSearch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const onInputChange = (term: string) => {
        clearTimeout(debouncedSearch.current);
        debouncedSearch.current = setTimeout(() => handleSearch(term), 300);
    };

    const [searchValue, setSearchValue] = useState(searchParams.get("q") || "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setSearchValue(searchParams.get("q") || "");
    }, [searchParams]);

    // ── Predictive autocomplete ──────────────────────────────────────────────
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const suggestDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const fetchSuggestions = useCallback(async (term: string) => {
        if (term.length < 2) { setSuggestions([]); return; }
        try {
            const { searchLeadSuggestions } = await import('@/app/actions/searchSuggestions');
            const results = await searchLeadSuggestions(term);
            setSuggestions(results);
            setHighlightIdx(-1);
        } catch { setSuggestions([]); }
    }, []);

    const handleSuggestionInput = (term: string) => {
        clearTimeout(suggestDebounce.current);
        if (term.length >= 2) {
            suggestDebounce.current = setTimeout(() => fetchSuggestions(term), 200);
            setShowSuggestions(true);
        } else {
            setSuggestions([]);
            setShowSuggestions(false);
        }
    };

    useEffect(() => {
        function outside(e: MouseEvent) {
            if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
                inputRef.current && !inputRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        }
        document.addEventListener("mousedown", outside);
        return () => document.removeEventListener("mousedown", outside);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter' && highlightIdx >= 0) {
            e.preventDefault();
            const s = suggestions[highlightIdx];
            if (s?.href) { setShowSuggestions(false); window.location.href = s.href; }
        }
        else if (e.key === 'Escape') { setShowSuggestions(false); }
    };

    return (
        <div className="space-y-2.5">
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input
                    ref={inputRef}
                    name="q"
                    value={searchValue}
                    onChange={(e) => { setSearchValue(e.target.value); onInputChange(e.target.value); handleSuggestionInput(e.target.value); }}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className="w-full pl-12 pr-10 py-2.5 bg-white border border-gray-200 rounded-lg focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-sm font-medium"
                    style={{ fontFamily: 'var(--font-lato)' }}
                    autoComplete="off"
                />
                {searchValue && (
                    <button
                        type="button"
                        onClick={() => { setSearchValue(""); handleSearch(""); setSuggestions([]); setShowSuggestions(false); inputRef.current?.focus(); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-300 hover:text-gray-500 transition-colors"
                        title="Clear search"
                    >
                        <X size={16} />
                    </button>
                )}

                {showSuggestions && suggestions.length > 0 && (
                    <div
                        ref={suggestionsRef}
                        className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                        style={{ animation: 'fadeInDown 0.12s ease-out' }}
                    >
                        <div className="px-3 py-1.5 border-b border-gray-50 bg-gray-50/60">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Quick results · {suggestions.length}</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {suggestions.map((s, idx) => {
                                const parts = (s.label || '?').split(' ');
                                const initials = parts.length >= 2
                                    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                                    : parts[0].slice(0, 2).toUpperCase();
                                return (
                                <a
                                    key={s.id}
                                    href={s.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                                        idx === highlightIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
                                    }`}
                                    onMouseEnter={() => setHighlightIdx(idx)}
                                    onClick={() => setShowSuggestions(false)}
                                >
                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shrink-0">
                                        <span className="text-[10px] font-bold text-white">
                                            {initials}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-blue-600 hover:text-blue-700 truncate flex items-center gap-1">
                                            {s.label}
                                            <ExternalLink size={11} className="shrink-0 text-gray-300" />
                                        </p>
                                        {s.sublabel && (
                                            <p className="text-[11px] text-gray-400 truncate">{s.sublabel}</p>
                                        )}
                                    </div>
                                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                                        Lead
                                    </span>
                                </a>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Filter pills row */}
            {children && (
                <div className="flex items-center gap-2 flex-wrap">
                    {children}
                </div>
            )}
        </div>
    );
}
