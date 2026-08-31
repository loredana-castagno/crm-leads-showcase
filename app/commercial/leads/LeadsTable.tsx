'use native';
'use client';

import { useState } from 'react';
import Link from 'next/link';
import ClickableRow from '@/app/components/ClickableRow';
import { clsx } from 'clsx';
import {
    ChevronDown,
    ChevronUp,
    MoreHorizontal,
    Settings2,
    ArrowUpDown,
    Check,
    X,
    Search
} from 'lucide-react';

interface Contact {
    id: number;
    firstName: string;
    fullName: string;
    title?: string;
    companyName?: string;
    account?: { name: string };
    status?: string;
    rating?: string;
    owner?: { name: string; image?: string };
    updatedAt: string; // ISO String
    fuOnLeads?: boolean;
    fuCycleComplete?: boolean;
    type?: string;
}

interface LeadsTableProps {
    contacts: Contact[];
}

export default function LeadsTable({ contacts: initialContacts }: LeadsTableProps) {
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set([
        'name', 'title', 'company', 'status', 'rating', 'fu_process', 'owner', 'last_modified'
    ]));
    const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);

    // Filtering State
    const [filters, setFilters] = useState<Record<string, Set<string>>>({});
    const [searchFilters, setSearchFilters] = useState<Record<string, string>>({}); // New state for text searches
    const [openFilterHeader, setOpenFilterHeader] = useState<string | null>(null);
    const [tempSearch, setTempSearch] = useState(""); // Temporary search input state

    // Columns Definition
    const columns = [
        { key: 'name', label: 'Name', sortable: true },
        { key: 'title', label: 'Title', filterable: true, searchable: true },
        { key: 'company', label: 'Company', filterable: true, searchable: true },
        { key: 'status', label: 'Status', filterable: true },
        { key: 'rating', label: 'Rating', filterable: true },
        { key: 'fu_process', label: 'FU Process', filterable: true },
        { key: 'owner', label: 'Owner', filterable: true },
        { key: 'last_modified', label: 'Last Modified', sortable: true },
    ];

    // Helper: Get Unique Values for a Column
    const getUniqueValues = (key: string) => {
        // Predefined static options for enum-like fields
        if (key === 'status') return ['New', 'Qualified', 'Unsubscribed', 'Client', 'Hot', 'Warm', 'Cold'];
        if (key === 'rating') return ['Hot', 'Warm', 'Cold'];
        if (key === 'fu_process') return ['FU on Leads', 'Cycle Complete', 'None'];

        // Dynamic generation for others (Title, Company, Owner, Last Modified)
        const values = new Set<string>();
        initialContacts.forEach(contact => {
            let val = '';
            switch (key) {
                case 'title': val = contact.title || ''; break;
                case 'company': val = contact.account?.name || contact.companyName || ''; break;
                case 'owner': val = contact.owner?.name || ''; break;
                case 'last_modified': val = formatDate(contact.updatedAt); break;
            }
            if (val) values.add(val);
        });

        let uniqueValues = Array.from(values).sort();

        // Filter options if there is a temp search (only for searchable columns when menu is open)
        if (openFilterHeader === key && tempSearch) {
            uniqueValues = uniqueValues.filter(v => v.toLowerCase().includes(tempSearch.toLowerCase()));
        }

        return uniqueValues;
    };

    const toggleFilter = (key: string, value: string) => {
        setFilters(prev => {
            const currentSet = new Set(prev[key] || []);
            if (currentSet.has(value)) {
                currentSet.delete(value);
            } else {
                currentSet.add(value);
            }
            // If empty, remove the key entirely to clean up
            if (currentSet.size === 0) {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            }
            return { ...prev, [key]: currentSet };
        });
    };

    const clearFilter = (key: string) => {
        setFilters(prev => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
        setSearchFilters(prev => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
    };

    const applySearchFilter = (key: string, value: string) => {
        if (!value.trim()) {
            setSearchFilters(prev => {
                const copy = { ...prev };
                delete copy[key];
                return copy;
            });
        } else {
            setSearchFilters(prev => ({ ...prev, [key]: value }));
        }
        setOpenFilterHeader(null); // Close menu on enter
        setTempSearch("");
    };

    const removeSearchFilter = (key: string) => {
        setSearchFilters(prev => {
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
    };

    // Filter Logic
    const filteredContacts = initialContacts.filter(contact => {
        return Object.entries(filters).every(([key, selectedValues]) => {
            if (searchFilters[key]) return true; // managed by search filter check below
            if (selectedValues.size === 0) return true;

            let val = '';
            switch (key) {
                case 'title': val = contact.title || ''; break;
                case 'company': val = contact.account?.name || contact.companyName || ''; break;
                case 'status': val = (contact.status === 'Disqualified' ? 'Unsubscribed' : (contact.status || '')); break;
                case 'rating': val = contact.rating || ''; break;
                case 'owner': val = contact.owner?.name || ''; break;
                case 'last_modified': val = formatDate(contact.updatedAt); break;
                case 'fu_process':
                    const flags = [];
                    if (contact.fuOnLeads) flags.push('FU on Leads');
                    if (contact.fuCycleComplete) flags.push('Cycle Complete');
                    if (!contact.fuOnLeads && !contact.fuCycleComplete) flags.push('None');
                    return flags.some(f => selectedValues.has(f));
            }
            return selectedValues.has(val);
        }) && Object.entries(searchFilters).every(([key, searchValue]) => {
            if (!searchValue) return true;
            let val = '';
            switch (key) {
                case 'title': val = contact.title || ''; break;
                case 'company': val = contact.account?.name || contact.companyName || ''; break;
            }
            return val.toLowerCase().includes(searchValue.toLowerCase());
        });
    });

    // Sorting Logic (Applied to Filtered Contacts)
    const sortedContacts = [...filteredContacts].sort((a, b) => {
        if (!sortConfig) return 0;

        if (sortConfig.key === 'name') {
            const aValue = `${a.fullName}`.toLowerCase();
            const bValue = `${b.fullName}`.toLowerCase();
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        }

        if (sortConfig.key === 'last_modified') {
            const aDate = new Date(a.updatedAt).getTime();
            const bDate = new Date(b.updatedAt).getTime();
            if (aDate < bDate) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aDate > bDate) return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    const handleSort = (key: string) => {
        if (key !== 'name' && key !== 'last_modified') return;
        setSortConfig(current => {
            if (current?.key === key) {
                return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    const toggleColumn = (key: string) => {
        const newSet = new Set(visibleColumns);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        setVisibleColumns(newSet);
    };

    // Helper: Status Badges
    const getStatusBadge = (status: string) => {
        const displayStatus = status === 'Disqualified' ? 'Unsubscribed' : status;
        const styles: any = {
            'New': 'bg-blue-50 text-blue-700 ring-blue-600/20',
            'Qualified': 'bg-green-50 text-green-700 ring-green-600/20',
            'Unsubscribed': 'bg-gray-50 text-gray-600 ring-gray-500/10',
            'Disqualified': 'bg-orange-50 text-orange-700 ring-orange-600/20',
            'Client': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
            'Hot': 'bg-red-50 text-red-700 ring-red-600/10',
            'Warm': 'bg-yellow-50 text-yellow-800 ring-yellow-600/20',
            'Cold': 'bg-gray-50 text-gray-600 ring-gray-500/10',
        };
        const style = styles[displayStatus] || 'bg-gray-50 text-gray-600 ring-gray-500/10';

        return (
            <span className={clsx("inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset", style)}>
                {displayStatus}
            </span>
        );
    };

    // Helper: Date Format "15 JAN 2026"
    const formatDate = (dateString: string) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).toUpperCase();
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col min-h-[500px]">

            {/* Toolbar */}
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50 flex justify-end">
                <div className="relative">
                    <button
                        onClick={() => setIsColumnMenuOpen(!isColumnMenuOpen)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 shadow-sm"
                    >
                        <Settings2 className="h-4 w-4" />
                        Columns
                    </button>

                    {/* Columns Dropdown */}
                    {isColumnMenuOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setIsColumnMenuOpen(false)}
                            />
                            <div className="absolute right-0 mt-2 w-56 z-20 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 py-1">
                                {columns.map(col => (
                                    <button
                                        key={col.key}
                                        onClick={() => toggleColumn(col.key)}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between"
                                    >
                                        <span>{col.label}</span>
                                        {visibleColumns.has(col.key) && <Check className="h-4 w-4 text-blue-600" />}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                    <thead>
                        <tr className="bg-gray-50/50">
                            {columns.filter(col => visibleColumns.has(col.key)).map((col) => (
                                <th
                                    key={col.key}
                                    scope="col"
                                    className="px-3 py-3.5 text-left text-[10px] font-medium uppercase tracking-wider text-gray-400 bg-transparent group select-none whitespace-nowrap relative"
                                >
                                    <div className="flex flex-col gap-1 items-start">
                                        <div className="flex items-center gap-1">
                                            <span
                                                className={clsx(
                                                    "transition-colors",
                                                    col.sortable && "cursor-pointer hover:text-gray-700",
                                                    (filters[col.key]?.size > 0 || searchFilters[col.key]) ? "text-blue-600 font-semibold" : "text-gray-500"
                                                )}
                                                onClick={() => col.sortable && handleSort(col.key)}
                                            >
                                                {col.label}
                                            </span>

                                            {/* Sort Icon for Name */}
                                            {col.sortable && (
                                                <ArrowUpDown
                                                    className={clsx(
                                                        "h-3 w-3 cursor-pointer",
                                                        sortConfig?.key === col.key ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
                                                    )}
                                                    onClick={() => handleSort(col.key)}
                                                />
                                            )}

                                            {/* Filter Icon for Others */}
                                            {col.filterable && (
                                                <div className="relative">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenFilterHeader(openFilterHeader === col.key ? null : col.key);
                                                        }}
                                                        className={clsx(
                                                            "p-1 rounded-full hover:bg-gray-200 transition-colors",
                                                            (filters[col.key]?.size > 0 || openFilterHeader === col.key || searchFilters[col.key]) ? "text-blue-600 bg-blue-50" : "text-gray-400"
                                                        )}
                                                    >
                                                        <ChevronDown className="h-3 w-3" />
                                                    </button>

                                                    {/* Filter Dropdown */}
                                                    {openFilterHeader === col.key && (
                                                        <>
                                                            <div
                                                                className="fixed inset-0 z-10 cursor-default"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setOpenFilterHeader(null);
                                                                    setTempSearch("");
                                                                }}
                                                            />
                                                            <div className="absolute left-0 mt-2 w-72 z-20 bg-white rounded-lg shadow-2xl ring-1 ring-black/5 py-2 text-sm font-normal normal-case animate-in fade-in zoom-in-95 duration-100 min-w-min">
                                                                <div className="px-3 pb-3 border-b border-gray-100 flex flex-col gap-3">
                                                                    <div className="flex justify-between items-center px-1 pt-1">
                                                                        <span className="font-semibold text-gray-900 whitespace-nowrap">Filter by {col.label}</span>
                                                                        {(filters[col.key]?.size > 0 || searchFilters[col.key]) && (
                                                                            <button
                                                                                onClick={() => clearFilter(col.key)}
                                                                                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors whitespace-nowrap ml-2"
                                                                            >
                                                                                Clear all
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {/* Search Input for Searchable Columns */}
                                                                    {(col.key === 'title' || col.key === 'company') && (
                                                                        <div className="relative">
                                                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                                                <Search className="h-4 w-4 text-gray-400" />
                                                                            </div>
                                                                            <input
                                                                                type="text"
                                                                                autoFocus
                                                                                placeholder={`Search ${col.label}...`}
                                                                                className="block w-full rounded-lg border-gray-200 pl-9 pr-3 py-2 text-sm leading-5 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500 bg-gray-50/50"
                                                                                value={tempSearch}
                                                                                onChange={(e) => setTempSearch(e.target.value)}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter') {
                                                                                        applySearchFilter(col.key, tempSearch);
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="max-h-60 overflow-y-auto py-2 px-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                                                                    {getUniqueValues(col.key).length > 0 ? (
                                                                        getUniqueValues(col.key).map(val => (
                                                                            <label key={val} className="flex items-center px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer mx-1 transition-colors group">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    // Disable checkbox if text search is active for this column
                                                                                    disabled={!!searchFilters[col.key]}
                                                                                    checked={filters[col.key]?.has(val) || false}
                                                                                    onChange={() => {
                                                                                        toggleFilter(col.key, val);
                                                                                        // Auto-close dropdown on selection (User Request)
                                                                                        setOpenFilterHeader(null);
                                                                                        setTempSearch("");
                                                                                    }}
                                                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-3 disabled:opacity-50 transition-shadow"
                                                                                />
                                                                                <span className={clsx("text-gray-700 group-hover:text-gray-900 truncate flex-1", !!searchFilters[col.key] && "opacity-50")}>{val}</span>
                                                                            </label>
                                                                        ))
                                                                    ) : (
                                                                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                                                                            <p className="text-xs">No matching options found</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Active Filter Badges (Text Search + Checkbox Selections) */}
                                        <div className="flex flex-wrap gap-1 mt-1 max-w-[200px]">
                                            {/* Text Search Badge */}
                                            {searchFilters[col.key] && (
                                                <div className="inline-flex items-center bg-blue-50 text-blue-700 text-[10px] font-medium px-2 py-0.5 rounded-full border border-blue-100 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                                                    <Search className="w-3 h-3 mr-1 opacity-50" />
                                                    <span className="truncate max-w-[80px]" title={searchFilters[col.key]}>{searchFilters[col.key]}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeSearchFilter(col.key);
                                                        }}
                                                        className="ml-1.5 text-blue-400 hover:text-blue-600 focus:outline-none p-0.5 hover:bg-blue-100 rounded-full transition-colors"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Checkbox Selection Badges */}
                                            {filters[col.key]?.size > 0 && Array.from(filters[col.key]).slice(0, 2).map(val => (
                                                <div key={val} className="inline-flex items-center bg-blue-50 text-blue-700 text-[10px] font-medium px-2 py-0.5 rounded-full border border-blue-100 shadow-sm animate-in fade-in zoom-in-95 duration-200">
                                                    <span className="truncate max-w-[80px]" title={val}>{val}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleFilter(col.key, val);
                                                        }}
                                                        className="ml-1.5 text-blue-400 hover:text-blue-600 focus:outline-none p-0.5 hover:bg-blue-100 rounded-full transition-colors"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}

                                            {/* More... Badge */}
                                            {filters[col.key]?.size > 2 && (
                                                <div className="inline-flex items-center bg-gray-100 text-gray-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-gray-200" title={Array.from(filters[col.key]).slice(2).join(', ')}>
                                                    +{filters[col.key].size - 2}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </th>
                            ))}
                            {/* Removed the extra TH for Edit/View column */}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                        {sortedContacts.length > 0 ? (
                            sortedContacts.map((contact) => (
                                <ClickableRow
                                    key={contact.id}
                                    destination={`/commercial/leads/${contact.id}`}
                                >
                                    {visibleColumns.has('name') && (
                                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 flex-none rounded-full bg-blue-50 text-[#0783FC] flex items-center justify-center font-bold text-xs">
                                                    {contact.firstName ? contact.firstName[0].toUpperCase() : 'U'}
                                                    {contact.fullName ? contact.fullName[0].toUpperCase() : ''}
                                                </div>
                                                <Link href={`/commercial/leads/${contact.id}`} className="text-gray-900 hover:text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                                                    {contact.fullName}
                                                </Link>
                                            </div>
                                        </td>
                                    )}
                                    {visibleColumns.has('title') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                            {contact.title || '-'}
                                        </td>
                                    )}
                                    {visibleColumns.has('company') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                            {contact.account?.name || contact.companyName || '-'}
                                        </td>
                                    )}
                                    {visibleColumns.has('status') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            {contact.status ? getStatusBadge(contact.status) : '-'}
                                        </td>
                                    )}
                                    {visibleColumns.has('rating') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            {contact.rating ? getStatusBadge(contact.rating) : '-'}
                                        </td>
                                    )}
                                    {visibleColumns.has('fu_process') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                            <div className="flex flex-col gap-1">
                                                {contact.fuOnLeads && (
                                                    <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20 w-fit">
                                                        FU on Leads
                                                    </span>
                                                )}
                                                {contact.fuCycleComplete && (
                                                    <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20 w-fit">
                                                        Cycle Complete
                                                    </span>
                                                )}
                                                {!contact.fuOnLeads && !contact.fuCycleComplete && (
                                                    <span className="text-gray-400 text-xs">-</span>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                    {visibleColumns.has('owner') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                            {contact.owner?.name || '-'}
                                        </td>
                                    )}
                                    {visibleColumns.has('last_modified') && (
                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 tabular-nums">
                                            {formatDate(contact.updatedAt)}
                                        </td>
                                    )}
                                    {/* Removed the extra View/Edit TD */}
                                </ClickableRow>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={columns.length} className="py-10 text-center text-sm text-gray-500">
                                    No contacts found matching your criteria.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


