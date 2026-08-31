import { db } from "@/app/lib/db";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import LeadsSearchInput from "./LeadsSearchInput";
import LeadsFiltersDropdown from "./LeadsFiltersDropdown";
import { Suspense } from "react";
import SuccessToast from "@/app/components/SuccessToast";
import LeadListClient from "./LeadListClient";
import AdvancedFilters, { FilterConfig } from "@/app/components/AdvancedFilters";
import FilterPersistence from "@/app/components/FilterPersistence";
import { getLeadFilterOptions } from "@/app/lib/commercialFilterOptions";
import { HAS_OPP_OPTIONS, HAS_LINKEDIN_OPTIONS, buildLeadsWhereClause } from "@/app/lib/commercialFilters";

const PAGE_SIZE = 100;

const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'New', label: 'New' },
    { key: 'Qualified', label: 'Qualified' },
    { key: 'Unsubscribed', label: 'Unsubscribed' },
    { key: 'archived', label: 'Archived' },
];

export const dynamic = "force-dynamic";

export default async function LeadsPage({
    searchParams,
}: {
    searchParams: Promise<{
        q?: string; filters?: string;
        createdFrom?: string; createdTo?: string;
        modifiedFrom?: string; modifiedTo?: string;
        dueFrom?: string; dueTo?: string;
        sort?: string; order?: string;
        status?: string;
        page?: string;
        // Advanced filters
        rating?: string;
        leadSource?: string;
        owner?: string;
        outsourc?: string;
        industry?: string;
        fuOn?: string;
        fuCycle?: string;
        location?: string;
        hasLinkedin?: string;
        hasOpp?: string;
        leadTitle?: string;
    }>;
}) {
    const params = await searchParams;
    const query = params.q || "";
    const filtersRaw = params.filters || "";
    const statusFilter = params.status || "all";
    const page = Math.max(0, parseInt(params.page || "0", 10) || 0);

    // Build where clause — shared with the export API so list filters and the
    // filtered export stay in sync (Due Date, Created/Modified, advanced filters).
    const where: any = buildLeadsWhereClause({
        q: query,
        filters: filtersRaw,
        status: statusFilter,
        createdFrom: params.createdFrom, createdTo: params.createdTo,
        modifiedFrom: params.modifiedFrom, modifiedTo: params.modifiedTo,
        dueFrom: params.dueFrom, dueTo: params.dueTo,
        rating: params.rating, leadSource: params.leadSource,
        outsourc: params.outsourc, industry: params.industry,
        location: params.location, leadTitle: params.leadTitle,
        owner: params.owner, fuOn: params.fuOn,
        hasLinkedin: params.hasLinkedin, hasOpp: params.hasOpp,
    });

    // Sorting
    const sort = params.sort || "";
    const order = (params.order === "asc" || params.order === "desc") ? params.order : "desc";
    const SORT_FIELD_MAP: Record<string, string> = {
        name: "fullName", modified: "updatedAt", due: "dueDate",
        company: "companyName", status: "status", rating: "rating",
        source: "source", email: "email", phone: "phone",
        title: "title", createdAt: "createdAt",
    };
    const NON_NULLABLE = new Set(["fullName", "updatedAt", "createdAt"]);
    let orderBy: any = { updatedAt: "desc" };
    if (sort && SORT_FIELD_MAP[sort]) {
        const field = SORT_FIELD_MAP[sort];
        orderBy = NON_NULLABLE.has(field)
            ? { [field]: order }
            : { [field]: { sort: order, nulls: "last" } };
    }

    // Paginated query + filter options
    const [contacts, filteredCount, totalCount, filterOptions, campaigns] = await Promise.all([
        (db as any).contact.findMany({
            where,
            include: {
                account: { select: { id: true, name: true } },
                owner: { select: { name: true, image: true } },
                opportunities: {
                    select: { id: true, stage: true, title: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 1,
                },
                campaignEnrollments: {
                    select: { campaignId: true, isActive: true, isComplete: true, currentStep: true, campaign: { select: { id: true, name: true } } },
                },
            },
            orderBy,
            take: PAGE_SIZE,
            skip: page * PAGE_SIZE,
        }),
        (db as any).contact.count({ where }),
        (db as any).contact.count({ where: { isArchived: false, type: 'LEAD' } }),
        getLeadFilterOptions(),
        (db as any).campaign.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { createdAt: 'asc' },
        }),
    ]);

    const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
    const sortLabel = sort === 'name'
        ? `name ${order === 'asc' ? '↑' : '↓'}`
        : sort === 'due'
            ? `due date ${order === 'asc' ? '↑' : '↓'}`
            : 'last modified';

    // Build URL helpers
    const buildParams = (overrides: Record<string, string | undefined> = {}) => {
        const p = new URLSearchParams();
        if (params.q) p.set("q", params.q);
        if (params.filters) p.set("filters", params.filters);
        if (params.createdFrom) p.set("createdFrom", params.createdFrom);
        if (params.createdTo) p.set("createdTo", params.createdTo);
        if (params.modifiedFrom) p.set("modifiedFrom", params.modifiedFrom);
        if (params.modifiedTo) p.set("modifiedTo", params.modifiedTo);
        if (params.dueFrom) p.set("dueFrom", params.dueFrom);
        if (params.dueTo) p.set("dueTo", params.dueTo);
        if (params.status) p.set("status", params.status);
        if (params.sort) p.set("sort", params.sort);
        if (params.order) p.set("order", params.order);
        // Advanced filters
        if (params.rating) p.set("rating", params.rating);
        if (params.leadSource) p.set("leadSource", params.leadSource);
        if (params.owner) p.set("owner", params.owner);
        if (params.outsourc) p.set("outsourc", params.outsourc);
        if (params.industry) p.set("industry", params.industry);
        if (params.fuOn) p.set("fuOn", params.fuOn);
        if (params.fuCycle) p.set("fuCycle", params.fuCycle);
        if (params.location) p.set("location", params.location);
        if (params.hasOpp) p.set("hasOpp", params.hasOpp);
        if (params.hasLinkedin) p.set("hasLinkedin", params.hasLinkedin);
        if (params.leadTitle) p.set("leadTitle", params.leadTitle);
        Object.entries(overrides).forEach(([k, v]) => {
            if (v !== undefined) p.set(k, v); else p.delete(k);
        });
        return p.toString();
    };

    const buildSortUrl = (col: string) => {
        return `/commercial/leads?${buildParams({
            sort: col,
            order: sort === col && order === "asc" ? "desc" : "asc",
            page: undefined,
        })}`;
    };

    const buildStatusUrl = (status: string) => {
        const p = new URLSearchParams();
        if (params.q) p.set("q", params.q);
        if (params.filters) p.set("filters", params.filters);
        if (params.sort) p.set("sort", params.sort);
        if (params.order) p.set("order", params.order);
        if (status !== 'all') p.set("status", status);
        return `/commercial/leads?${p.toString()}`;
    };

    const buildPageUrl = (p: number) => `/commercial/leads?${buildParams({ page: p > 0 ? p.toString() : undefined })}`;

    // Filter params for export
    const filterParams = buildParams();

    // Status pills (New/Qualified/Unqualified/Archived) act as view tabs, not filters —
    // they don't trigger the Export Current View toolbar. Real filters: search, date, advanced.
    const isFiltered = !!(query || params.createdFrom || params.createdTo || params.modifiedFrom || params.modifiedTo || params.dueFrom || params.dueTo || params.rating || params.leadSource || params.owner || params.outsourc || params.industry || params.fuOn || params.location || params.hasOpp || params.hasLinkedin || params.leadTitle);

    // Build filter configs for AdvancedFilters component
    const leadFilterConfigs: FilterConfig[] = [
        { key: 'rating', label: 'Rating', options: [...new Set(['Hot', 'Warm', 'Cold', ...filterOptions.rating])], defaultVisible: false },
        { key: 'leadSource', label: 'Source', options: filterOptions.source.length > 0 ? filterOptions.source : ['Scraping-LinkedIn', 'LeadCandy', 'Web', 'Client Referral', 'MSP'], defaultVisible: false },
        { key: 'owner', label: 'Owner', options: filterOptions.owner, defaultVisible: false },
        { key: 'outsourc', label: 'Outsourcing', options: filterOptions.outsourcing.length > 0 ? filterOptions.outsourcing : ['Yes', 'No', 'N/A'], defaultVisible: false },
        { key: 'fuOn', label: 'FU on Leads', options: ['Enrolled', 'Enrolled - Paused', "Didn't Enroll", 'FU Cycle Complete'], defaultVisible: false },
        { key: 'location', label: 'Location', options: filterOptions.location, defaultVisible: false },
        { key: 'hasOpp', label: 'Opportunity', options: HAS_OPP_OPTIONS, defaultVisible: false },
        { key: 'hasLinkedin', label: 'LinkedIn', options: HAS_LINKEDIN_OPTIONS, defaultVisible: false },
        { key: 'leadTitle', label: 'Title', options: filterOptions.title, defaultVisible: false },
    ].filter(f => f.options.length > 0);

    return (
        <div className="flex-1 overflow-auto min-h-[calc(100vh-theme(spacing.24))]" style={{ backgroundColor: '#F8FAFC' }}>
            <Suspense><SuccessToast messages={{ lead: "Lead created successfully!" }} /></Suspense>
            <div className="p-4 max-w-7xl mx-auto space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600 border border-blue-100">
                            <Users size={18} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-600" style={{ fontFamily: 'var(--font-montserrat)' }}>
                                Leads
                            </h1>
                            <p className="text-gray-500 text-sm mt-0.5" style={{ fontFamily: 'var(--font-lato)' }}>
                                Track and manage your potential customers.
                            </p>
                        </div>
                    </div>
                    <Link
                        href="/commercial/leads/new"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-all mr-14"
                        style={{ fontFamily: 'var(--font-lato)' }}
                    >
                        <Plus className="w-4 h-4" />
                        New Lead
                    </Link>
                </div>

                <Suspense>
                    <FilterPersistence />
                    <LeadsSearchInput placeholder="Search by Name, Email, Company or any other term. Use AND/OR and parenthesis if needed" />
                </Suspense>

                <div className="space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {STATUS_FILTERS.map(f => {
                            const isActive = statusFilter === f.key;
                            const count = f.key === 'all' ? totalCount : null;
                            return (
                                <Link
                                    key={f.key}
                                    href={buildStatusUrl(f.key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                                        isActive
                                            ? 'bg-gray-800 text-white shadow-sm'
                                            : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700'
                                    }`}
                                >
                                    {f.label}{count !== null && isActive ? ` ${count}` : ''}
                                </Link>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <LeadsFiltersDropdown />
                        <AdvancedFilters configs={leadFilterConfigs} storageKey="crm-leads-adv-filters" hideSalaryFilters />
                    </div>
                </div>


                <LeadListClient
                    leads={contacts}
                    query={query}
                    sortUrls={Object.fromEntries(Object.keys(SORT_FIELD_MAP).map(k => [k, buildSortUrl(k)]))}
                    sort={sort}
                    order={order}
                    filterParams={filterParams}
                    page={page}
                    totalPages={totalPages}
                    totalCount={filteredCount}
                    isFiltered={isFiltered}
                    campaigns={campaigns}
                    pageUrls={{
                        prev: page > 0 ? buildPageUrl(page - 1) : null,
                        next: page < totalPages - 1 ? buildPageUrl(page + 1) : null,
                    }}
                />
            </div>
        </div>
    );
}
