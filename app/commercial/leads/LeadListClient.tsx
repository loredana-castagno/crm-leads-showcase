"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { User, ChevronLeft, ChevronRight } from "lucide-react";
import ClickableRow from "@/app/components/ClickableRow";
import ExportToolbar from "@/app/components/ExportToolbar";
import ColumnSelector, { useColumnVisibility, ColumnDef } from "@/app/components/ColumnSelector";
import ConfirmModal from "@/app/components/modals/ConfirmModal";
import AlertModal from "@/app/components/modals/AlertModal";

// Deterministic avatar color palette based on name hash — using inline styles
// to guarantee rendering (consistent with Accounts page)
const AVATAR_COLORS = [
    { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
    { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' },
    { bg: '#f5f3ff', color: '#7c3aed', border: '#c4b5fd' },
    { bg: '#fffbeb', color: '#d97706', border: '#fcd34d' },
    { bg: '#fff1f2', color: '#e11d48', border: '#fda4af' },
    { bg: '#ecfeff', color: '#0891b2', border: '#a5f3fc' },
    { bg: '#fdf4ff', color: '#c026d3', border: '#e879f9' },
    { bg: '#fff7ed', color: '#ea580c', border: '#fdba74' },
    { bg: '#f0fdfa', color: '#0d9488', border: '#5eead4' },
    { bg: '#eef2ff', color: '#4f46e5', border: '#a5b4fc' },
];
function getAvatarColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const RATING_STYLES: Record<string, string> = {
    Hot: 'bg-red-50 text-red-600 border border-red-200',
    Warm: 'bg-orange-50 text-orange-600 border border-orange-200',
    Cold: 'bg-blue-50 text-blue-600 border border-blue-200',
};

const STATUS_STYLES: Record<string, string> = {
    New: 'bg-blue-50 text-blue-700 border border-blue-200',
    Working: 'bg-amber-50 text-amber-700 border border-amber-200',
    Qualified: 'bg-green-50 text-green-700 border border-green-200',
    Unsubscribed: 'bg-gray-100 text-gray-500 border border-gray-200',
};

function getSourceDisplay(source: string | null | undefined) {
    if (!source) return { label: 'Manual', color: 'bg-gray-400' };
    const s = source.toLowerCase();
    if (s.includes('linkedin') || s.includes('scraping')) return { label: 'LinkedIn', color: 'bg-blue-500' };
    if (s.includes('referral')) return { label: 'Referral', color: 'bg-green-500' };
    if (s.includes('web') || s.includes('website')) return { label: 'Website', color: 'bg-purple-500' };
    return { label: source.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), color: 'bg-gray-400' };
}

const LEAD_COLUMNS: ColumnDef[] = [
    { key: "name", label: "Lead", locked: true },
    { key: "company", label: "Company" },
    { key: "status", label: "Status" },
    { key: "rating", label: "Rating" },
    { key: "source", label: "Source" },
    { key: "owner", label: "Owner" },
    { key: "dueDate", label: "Due Date" },
    { key: "email", label: "Email", defaultVisible: false },
    { key: "phone", label: "Phone", defaultVisible: false },
    { key: "location", label: "Location", defaultVisible: false },
    { key: "title", label: "Title", defaultVisible: false },
    { key: "createdAt", label: "Created", defaultVisible: false },
    { key: "lastModified", label: "Last Modified", defaultVisible: false },
];

interface LeadListClientProps {
    leads: any[];
    query: string;
    sortUrls: Record<string, string>;
    sort: string;
    order: string;
    filterParams: string;
    page: number;
    totalPages: number;
    totalCount: number;
    isFiltered?: boolean;
    campaigns?: { id: number; name: string }[];
    pageUrls: { prev: string | null; next: string | null };
}

export default function LeadListClient({
    leads,
    query,
    sortUrls,
    sort,
    order,
    filterParams,
    page,
    totalPages,
    totalCount,
    isFiltered,
    campaigns = [],
    pageUrls,
}: LeadListClientProps) {
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // Column visibility — merge static + dynamic campaign columns
    const allColumns: ColumnDef[] = useMemo(() => {
        const campaignCols: ColumnDef[] = campaigns.map((c, i) => ({
            key: `campaign_${c.id}`,
            label: c.name,
            defaultVisible: false,
            ...(i === 0 ? { group: 'Campaigns' } : {}),
        }));
        return [...LEAD_COLUMNS, ...campaignCols];
    }, [campaigns]);

    const { visibleColumns, toggle, isVisible } = useColumnVisibility("crm-leads-columns", allColumns);
    const [allGlobalSelected, setAllGlobalSelected] = useState(false);

    const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setAllGlobalSelected(false);
    }, []);

    const toggleSelectAll = useCallback(() => {
        if (selectedIds.size === leads.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(leads.map((l) => l.id)));
        }
    }, [leads, selectedIds.size]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
        setAllGlobalSelected(false);
    }, []);

    const selectAllGlobal = useCallback(() => setAllGlobalSelected(true), []);
    const deselectAllGlobal = useCallback(() => {
        setSelectedIds(new Set());
        setAllGlobalSelected(false);
    }, []);

    const [cloneModalOpen, setCloneModalOpen] = useState(false);
    const [cloneModalLoading, setCloneModalLoading] = useState(false);
    const [alertModalOpen, setAlertModalOpen] = useState(false);
    const [alertModalConfig, setAlertModalConfig] = useState({ title: "", description: "", variant: "success" as "success" | "danger" | "info" });

    const handleCloneSelected = useCallback(() => {
        if (selectedIds.size === 0) return;
        setCloneModalOpen(true);
    }, [selectedIds.size]);

    const handleCloneConfirm = useCallback(async () => {
        setCloneModalLoading(true);
        try {
            const ids = Array.from(selectedIds);
            const { cloneLeads } = await import("@/app/actions/commercial/contact");
            const res = await cloneLeads(ids);
            setCloneModalOpen(false);
            if (res.success) {
                setSelectedIds(new Set());
                setAllGlobalSelected(false);
                setAlertModalConfig({
                    title: "Success",
                    description: `Successfully cloned ${res.count} lead(s). The cloned leads have "(CLONED)" added to their names.`,
                    variant: "success"
                });
                setAlertModalOpen(true);
            } else {
                setAlertModalConfig({
                    title: "Error",
                    description: `Failed to clone leads: ${res.error}`,
                    variant: "danger"
                });
                setAlertModalOpen(true);
            }
        } catch (err: any) {
            console.error("Cloning error:", err);
            setCloneModalOpen(false);
            setAlertModalConfig({
                title: "Error",
                description: `An error occurred: ${err.message || err}`,
                variant: "danger"
            });
            setAlertModalOpen(true);
        } finally {
            setCloneModalLoading(false);
        }
    }, [selectedIds]);

    const handleAlertModalClose = useCallback(() => {
        setAlertModalOpen(false);
        if (alertModalConfig.variant === "success") {
            window.location.reload();
        }
    }, [alertModalConfig.variant]);

    const allSelected = leads.length > 0 && selectedIds.size === leads.length;
    const someSelected = selectedIds.size > 0 && selectedIds.size < leads.length;

    // Count visible columns for colSpan
    const visibleCount = allColumns.filter(c => isVisible(c.key)).length + 1;

    const tableRef = useRef<HTMLDivElement>(null);
    const scrollTable = useCallback((dir: 'left' | 'right') => {
        tableRef.current?.scrollBy({ left: dir === 'right' ? 300 : -300, behavior: 'smooth' });
    }, []);

    return (
        <>
            {/* Count + Column selector */}
            <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-gray-400" style={{ fontFamily: 'var(--font-lato)' }}>
                    <span className="font-semibold text-gray-500">{page * 100 + 1}–{Math.min((page + 1) * 100, totalCount)}</span>{' '}
                    of <span className="font-semibold text-gray-500">{totalCount}</span> lead{totalCount !== 1 ? 's' : ''}
                    {isFiltered && <span className="text-gray-400"> (filtered)</span>}
                </p>
                <div className="flex items-center gap-1.5">
                    <button onClick={() => scrollTable('left')} className="p-1 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all">
                        <ChevronLeft size={14} />
                    </button>
                    <button onClick={() => scrollTable('right')} className="p-1 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all">
                        <ChevronRight size={14} />
                    </button>
                    <ColumnSelector
                        columns={allColumns}
                        storageKey="crm-leads-columns"
                        visibleColumns={visibleColumns}
                        onToggle={toggle}
                    />
                </div>
            </div>

            <div ref={tableRef} className="bg-white rounded-lg border border-gray-100 overflow-x-auto scrollbar-hide">
                <table className="w-full table-auto divide-y divide-gray-100">
                    <thead>
                        <tr className="border-b border-gray-200">
                            {/* Checkbox header */}
                            <th className="w-[36px] px-2 py-2.5">
                                <div
                                    onClick={toggleSelectAll}
                                    className={`w-4 h-4 rounded border-2 cursor-pointer transition-all flex items-center justify-center ${
                                        allSelected
                                            ? "bg-blue-600 border-blue-600"
                                            : someSelected
                                            ? "bg-blue-600 border-blue-600"
                                            : "border-gray-300 hover:border-blue-400"
                                    }`}
                                >
                                    {allSelected && (
                                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                    {someSelected && !allSelected && (
                                        <div className="w-2 h-0.5 bg-white rounded" />
                                    )}
                                </div>
                            </th>
                            {/* Name — always visible, sortable */}
                            <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                                <Link href={sortUrls.name} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
                                    Name
                                    <span className={`text-[8px] ${sort === 'name' ? 'text-blue-600' : 'text-gray-300'}`}>{sort === 'name' && order === 'asc' ? '▲' : '▼'}</span>
                                </Link>
                            </th>
                            {/* Sortable group: Company, Status, Rating, Source */}
                            {([
                                { key: "company", label: "Company", sortKey: "company" },
                                { key: "status", label: "Status", sortKey: "status" },
                                { key: "rating", label: "Rating", sortKey: "rating" },
                                { key: "source", label: "Source", sortKey: "source" },
                            ] as const).map(col => isVisible(col.key) && (
                                <th key={col.key} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                                    <Link href={sortUrls[col.sortKey]} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
                                        {col.label}
                                        <span className={`text-[8px] ${sort === col.sortKey ? 'text-blue-600' : 'text-gray-300'}`}>
                                            {sort === col.sortKey && order === 'asc' ? '▲' : '▼'}
                                        </span>
                                    </Link>
                                </th>
                            ))}
                            {/* Owner — not sortable (relation) */}
                            {isVisible('owner') && (
                                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                                    Owner
                                </th>
                            )}
                            {/* Due Date — sortable */}
                            {isVisible('dueDate') && (
                                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                                    <Link href={sortUrls.due} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
                                        Due Date
                                        <span className={`text-[8px] ${sort === 'due' ? 'text-blue-600' : 'text-gray-300'}`}>{sort === 'due' && order === 'asc' ? '▲' : '▼'}</span>
                                    </Link>
                                </th>
                            )}
                            {/* Sortable group: Email, Phone */}
                            {([
                                { key: "email", label: "Email", sortKey: "email" },
                                { key: "phone", label: "Phone", sortKey: "phone" },
                            ] as const).map(col => isVisible(col.key) && (
                                <th key={col.key} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    <Link href={sortUrls[col.sortKey]} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
                                        {col.label}
                                        <span className={`text-[8px] ${sort === col.sortKey ? 'text-blue-600' : 'text-gray-300'}`}>
                                            {sort === col.sortKey && order === 'asc' ? '▲' : '▼'}
                                        </span>
                                    </Link>
                                </th>
                            ))}
                            {/* Location — not sortable (computed) */}
                            {isVisible('location') && (
                                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    Location
                                </th>
                            )}
                            {/* Sortable group: Title, Created, Last Modified */}
                            {([
                                { key: "title", label: "Title", sortKey: "title" },
                                { key: "createdAt", label: "Created", sortKey: "createdAt" },
                                { key: "lastModified", label: "Last Modified", sortKey: "modified" },
                            ] as const).map(col => isVisible(col.key) && (
                                <th key={col.key} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    <Link href={sortUrls[col.sortKey]} className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors">
                                        {col.label}
                                        <span className={`text-[8px] ${sort === col.sortKey ? 'text-blue-600' : 'text-gray-300'}`}>
                                            {sort === col.sortKey && order === 'asc' ? '▲' : '▼'}
                                        </span>
                                    </Link>
                                </th>
                            ))}
                            {/* Campaign columns — dynamic */}
                            {campaigns.map(c => isVisible(`campaign_${c.id}`) && (
                                <th key={`campaign_${c.id}`} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                                    {c.name}
                                </th>
                            ))}
                            <th className="w-full"></th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-50">
                        {leads.length === 0 ? (
                            <tr>
                                <td colSpan={visibleCount} className="px-3 py-20 text-center">
                                    <div className="flex flex-col items-center gap-2 text-gray-400">
                                        <div className="p-4 bg-gray-50 rounded-full">
                                            <User size={40} className="text-gray-200" />
                                        </div>
                                        <p className="font-medium text-gray-500" style={{ fontFamily: 'var(--font-lato)' }}>No leads found matching your criteria.</p>
                                        <p className="text-sm text-gray-400" style={{ fontFamily: 'var(--font-lato)' }}>Try adjusting your filters or search term.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            leads.map((lead: any) => {
                                const isSelected = selectedIds.has(lead.id);
                                const avatarColor = getAvatarColor(lead.fullName || lead.firstName || "U");
                                const initials = (lead.fullName || lead.firstName || "U").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
                                const sourceInfo = getSourceDisplay(lead.source);
                                const ownerName = lead.owner?.name;
                                const ownerFirst = ownerName ? ownerName.split(' ')[0] : null;
                                const ownerInitials = ownerName ? ownerName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) : null;
                                const ownerColor = ownerName ? getAvatarColor(ownerName) : null;

                                return (
                                    <ClickableRow
                                        key={lead.id}
                                        destination={`/commercial/leads/${lead.id}${query ? `?q=${query}` : ""}`}
                                    >
                                        {/* Checkbox cell */}
                                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <div
                                                onClick={(e) => toggleSelect(lead.id, e)}
                                                className={`w-4 h-4 rounded border-2 cursor-pointer transition-all flex items-center justify-center ${
                                                    isSelected
                                                        ? "bg-blue-600 border-blue-600"
                                                        : "border-gray-300 hover:border-blue-400"
                                                }`}
                                            >
                                                {isSelected && (
                                                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                )}
                                            </div>
                                        </td>
                                        {/* Name + Title */}
                                        <td className="px-3 py-2.5 overflow-hidden">
                                            <div className="flex items-center gap-2.5">
                                                <div
                                                    className="h-8 w-8 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                                    style={{ backgroundColor: avatarColor.bg, color: avatarColor.color, border: `1px solid ${avatarColor.border}` }}
                                                >
                                                    {initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[13px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                                                        <Link href={`/commercial/leads/${lead.id}${query ? `?q=${query}` : ""}`} className="truncate hover:underline" onClick={(e) => e.stopPropagation()}>{lead.fullName || lead.firstName}</Link>
                                                    </p>
                                                    <p className="text-[11px] text-gray-400 truncate mt-0.5">
                                                        {lead.title || '—'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        {/* Company */}
                                        {isVisible('company') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-600 truncate block">
                                                    {(lead.companyId || lead.account?.id) ? (
                                                        <a href={`/commercial/accounts/${lead.companyId || lead.account?.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline text-blue-600 font-medium truncate block">
                                                            {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                                        </a>
                                                    ) : (lead.companyName || lead.account?.name) ? (
                                                        <a href={`/commercial/accounts?query=${encodeURIComponent((lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline text-blue-600 font-medium truncate block">
                                                            {(lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, '')}
                                                        </a>
                                                    ) : (
                                                        <span className="italic text-gray-300">—</span>
                                                    )}
                                                </span>
                                            </td>
                                        )}
                                        {/* Status */}
                                        {isVisible('status') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <div className="flex flex-col gap-0.5">
                                                    {lead.isArchived ? (
                                                        <span title={lead.archiveReason || 'Archived'} className="inline-flex w-fit px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 border border-gray-200">
                                                            Archived
                                                        </span>
                                                    ) : lead.status ? (
                                                        <span className={`inline-flex w-fit px-2 py-0.5 rounded-md text-[10px] font-bold ${STATUS_STYLES[lead.status] || 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                                                            {lead.status}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-300 text-[12px]">—</span>
                                                    )}
                                                    {/* Opp result badge */}
                                                    {lead.opportunities?.[0]?.stage === 'Closed Won' && (
                                                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-green-600">
                                                            🏆 Won
                                                        </span>
                                                    )}
                                                    {lead.opportunities?.[0]?.stage === 'Closed Lost' && (
                                                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-500">
                                                            ❌ Lost
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                        {/* Rating */}
                                        {isVisible('rating') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                {lead.rating ? (
                                                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold ${RATING_STYLES[lead.rating] || 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                                                        {lead.rating}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300 text-[12px]">—</span>
                                                )}
                                            </td>
                                        )}
                                        {/* Source */}
                                        {isVisible('source') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`w-1.5 h-1.5 rounded-full ${sourceInfo.color} flex-shrink-0`} />
                                                    <span className="text-[12px] text-gray-500 truncate">{sourceInfo.label}</span>
                                                </div>
                                            </td>
                                        )}
                                        {/* Owner */}
                                        {isVisible('owner') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                {ownerName ? (
                                                    <span className="text-[12px] text-gray-600 truncate">{ownerFirst}</span>
                                                ) : (
                                                    <span className="text-gray-300 text-[12px]">—</span>
                                                )}
                                            </td>
                                        )}
                                        {/* Due Date */}
                                        {isVisible('dueDate') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                {lead.dueDate ? (
                                                    (() => {
                                                        const dd = new Date(lead.dueDate);
                                                        const today = new Date();
                                                        today.setHours(0, 0, 0, 0);
                                                        const isOverdue = dd < today;
                                                        return (
                                                            <span className={`text-[12px] tabular-nums ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                                                {dd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                            </span>
                                                        );
                                                    })()
                                                ) : (
                                                    <span className="text-gray-300 text-[12px]">—</span>
                                                )}
                                            </td>
                                        )}
                                        {/* Email */}
                                        {isVisible('email') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500 truncate block">{lead.email || '—'}</span>
                                            </td>
                                        )}
                                        {/* Phone */}
                                        {isVisible('phone') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500 truncate block">{lead.phone || '—'}</span>
                                            </td>
                                        )}
                                        {/* Location */}
                                        {isVisible('location') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500 truncate block">{lead.city || lead.state || lead.country || '—'}</span>
                                            </td>
                                        )}
                                        {/* Title */}
                                        {isVisible('title') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500 truncate block">{lead.title || '—'}</span>
                                            </td>
                                        )}
                                        {/* Created */}
                                        {isVisible('createdAt') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500">{new Date(lead.createdAt).toLocaleDateString()}</span>
                                            </td>
                                        )}
                                        {/* Last Modified */}
                                        {isVisible('lastModified') && (
                                            <td className="px-3 py-2.5 overflow-hidden">
                                                <span className="text-[12px] text-gray-500">{new Date(lead.updatedAt).toLocaleDateString()}</span>
                                            </td>
                                        )}
                                        {/* Campaign enrollment status — dynamic */}
                                        {campaigns.map(c => isVisible(`campaign_${c.id}`) && (
                                            <td key={`campaign_${c.id}`} className="px-3 py-2.5 overflow-hidden">
                                                {(() => {
                                                    const enrollment = lead.campaignEnrollments?.find((e: any) => e.campaignId === c.id);
                                                    if (!enrollment) return <span className="text-gray-300 text-[12px]">—</span>;
                                                    if (enrollment.isComplete) return <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-green-50 text-green-600 border border-green-100">Complete</span>;
                                                    if (enrollment.isActive) return <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100">Active ({enrollment.currentStep})</span>;
                                                    return <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-200">Paused</span>;
                                                })()}
                                            </td>
                                        ))}
                                        <td className="w-full"></td>
                                    </ClickableRow>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Export toolbar */}
            <ExportToolbar
                selectedCount={selectedIds.size}
                totalCount={leads.length}
                globalTotalCount={totalCount}
                entityType="leads"
                selectedIds={Array.from(selectedIds)}
                filterParams={filterParams}
                onSelectAll={toggleSelectAll}
                onDeselectAll={deselectAll}
                allGlobalSelected={allGlobalSelected}
                onSelectAllGlobal={selectAllGlobal}
                onDeselectAllGlobal={deselectAllGlobal}
                visibleColumns={visibleColumns}
                isFiltered={isFiltered}
                onClone={handleCloneSelected}
            />

            {/* Pagination controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-3">
                    {pageUrls.prev ? (
                        <Link href={pageUrls.prev} className="inline-flex items-center text-xs text-gray-400 hover:text-gray-500 transition-colors">
                            ← Previous
                        </Link>
                    ) : (
                        <span className="text-xs text-gray-300">← Previous</span>
                    )}
                    <span className="text-xs text-gray-400">
                        Page {page + 1} of {totalPages}
                    </span>
                    {pageUrls.next ? (
                        <Link href={pageUrls.next} className="inline-flex items-center text-xs text-gray-400 hover:text-gray-500 transition-colors">
                            Next →
                        </Link>
                    ) : (
                        <span className="text-xs text-gray-300">Next →</span>
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={cloneModalOpen}
                onClose={() => setCloneModalOpen(false)}
                onConfirm={handleCloneConfirm}
                title="Clone Leads"
                description={`Are you sure you want to clone the ${selectedIds.size} selected lead(s)? This will duplicate their information with "(CLONED)" added to their names.`}
                confirmLabel="Clone"
                cancelLabel="Cancel"
                isLoading={cloneModalLoading}
                variant="info"
            />

            <AlertModal
                isOpen={alertModalOpen}
                onClose={handleAlertModalClose}
                title={alertModalConfig.title}
                description={alertModalConfig.description}
                variant={alertModalConfig.variant}
                dismissLabel="OK"
            />
        </>
    );
}
