/**
 * Shared helpers to translate AdvancedFilters URL params into Prisma `where` clauses
 * for the commercial lists (Leads, Contacts, Accounts).
 *
 * AdvancedFilters encodes each filter as `?key=val1,val2,!val3` where a leading `!`
 * means "exclude". These helpers parse that and push conditions onto a `where.AND` array.
 */

export function parseMultiParam(raw?: string): { include: string[]; exclude: string[] } {
    if (!raw) return { include: [], exclude: [] };
    const values = raw.split(',').map(v => v.trim()).filter(Boolean);
    return {
        include: values.filter(v => !v.startsWith('!')),
        exclude: values.filter(v => v.startsWith('!')).map(v => v.slice(1)),
    };
}

function ensureAnd(where: any): any[] {
    if (!where.AND) where.AND = [];
    return where.AND;
}

/** Scalar field equality multi-select (e.g. industry, source, owner-name via relation path). */
export function applyScalarFilter(where: any, dbField: string, raw?: string) {
    const { include, exclude } = parseMultiParam(raw);
    if (include.length) ensureAnd(where).push({ [dbField]: { in: include } });
    if (exclude.length) ensureAnd(where).push({ NOT: { [dbField]: { in: exclude } } });
}

/** Owner filter — owner is a relation; match by owner.name. */
export function applyOwnerFilter(where: any, raw?: string) {
    const { include, exclude } = parseMultiParam(raw);
    if (include.length) ensureAnd(where).push({ owner: { name: { in: include } } });
    if (exclude.length) ensureAnd(where).push({ NOT: { owner: { name: { in: exclude } } } });
}

/** Account (Company) name filter for Contacts — match by account.name relation. */
export function applyAccountNameFilter(where: any, raw?: string) {
    const { include, exclude } = parseMultiParam(raw);
    if (include.length) ensureAnd(where).push({ account: { name: { in: include } } });
    if (exclude.length) ensureAnd(where).push({ NOT: { account: { name: { in: exclude } } } });
}

/** Technologies — comma/dash separated free text; match by `contains` (OR across included tokens). */
export function applyTechnologiesFilter(where: any, raw?: string) {
    const { include, exclude } = parseMultiParam(raw);
    if (include.length) {
        ensureAnd(where).push({ OR: include.map(t => ({ technologies: { contains: t } })) });
    }
    for (const t of exclude) {
        ensureAnd(where).push({ NOT: { technologies: { contains: t } } });
    }
}

// Company size buckets (numberOfEmployees). Labels are the dropdown options.
export const COMPANY_SIZE_BUCKETS: Record<string, { gte?: number; lte?: number }> = {
    "1-10": { gte: 1, lte: 10 },
    "11-50": { gte: 11, lte: 50 },
    "51-200": { gte: 51, lte: 200 },
    "201-500": { gte: 201, lte: 500 },
    "500+": { gte: 501 },
};
export const COMPANY_SIZE_OPTIONS = Object.keys(COMPANY_SIZE_BUCKETS);

export function applyCompanySizeFilter(where: any, raw?: string) {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const ranges = include
        .map(label => COMPANY_SIZE_BUCKETS[label])
        .filter(Boolean)
        .map(r => ({ numberOfEmployees: r }));
    if (ranges.length) ensureAnd(where).push({ OR: ranges });
}

// Pipeline coverage for Accounts (relation to opportunities).
export const PIPELINE_COVERAGE_OPTIONS = ["Has open opportunity", "No open opportunity"];
const OPEN_OPP = { stage: { notIn: ['Closed Won', 'Closed Lost'] }, isArchived: false };

export function applyPipelineCoverageFilter(where: any, raw?: string) {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const conds: any[] = [];
    if (include.includes("Has open opportunity")) conds.push({ opportunities: { some: OPEN_OPP } });
    if (include.includes("No open opportunity")) conds.push({ opportunities: { none: OPEN_OPP } });
    if (conds.length === 1) ensureAnd(where).push(conds[0]);
    else if (conds.length > 1) ensureAnd(where).push({ OR: conds });
}

// FU status for Accounts (nextFu date).
export const FU_STATUS_OPTIONS = ["Overdue", "Upcoming", "No FU set"];

export function applyFuStatusFilter(where: any, raw?: string, field: string = 'nextFu') {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const now = new Date();
    const conds: any[] = [];
    if (include.includes("Overdue")) conds.push({ [field]: { lt: now } });
    if (include.includes("Upcoming")) conds.push({ [field]: { gte: now } });
    if (include.includes("No FU set")) conds.push({ [field]: null });
    if (conds.length === 1) ensureAnd(where).push(conds[0]);
    else if (conds.length > 1) ensureAnd(where).push({ OR: conds });
}

// Generic Yes/No presence filter for a relation count (e.g. Has Opportunity on Leads/Contacts).
export const HAS_OPP_OPTIONS = ["Has opportunity", "No opportunity"];
export function applyHasOpportunityFilter(where: any, raw?: string) {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const conds: any[] = [];
    if (include.includes("Has opportunity")) conds.push({ opportunities: { some: {} } });
    if (include.includes("No opportunity")) conds.push({ opportunities: { none: {} } });
    if (conds.length === 1) ensureAnd(where).push(conds[0]);
    else if (conds.length > 1) ensureAnd(where).push({ OR: conds });
}

// Has LinkedIn (linkedinUrl present).
export const HAS_LINKEDIN_OPTIONS = ["Has LinkedIn", "No LinkedIn"];
export function applyHasLinkedinFilter(where: any, raw?: string) {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const conds: any[] = [];
    if (include.includes("Has LinkedIn")) conds.push({ NOT: { linkedinUrl: null } }, { NOT: { linkedinUrl: '' } });
    if (include.includes("No LinkedIn")) conds.push({ OR: [{ linkedinUrl: null }, { linkedinUrl: '' }] });
    // "Has LinkedIn" needs both conds AND'd; "No LinkedIn" is a single OR. Handle simply:
    if (include.includes("Has LinkedIn") && !include.includes("No LinkedIn")) {
        ensureAnd(where).push({ NOT: { linkedinUrl: null } });
        ensureAnd(where).push({ NOT: { linkedinUrl: '' } });
    } else if (include.includes("No LinkedIn") && !include.includes("Has LinkedIn")) {
        ensureAnd(where).push({ OR: [{ linkedinUrl: null }, { linkedinUrl: '' }] });
    }
    // If both selected → no-op (matches everything).
}

// KDM (isKdm boolean) for Contacts.
export const KDM_OPTIONS = ["KDM", "Not KDM"];
export function applyKdmFilter(where: any, raw?: string) {
    const { include } = parseMultiParam(raw);
    if (!include.length) return;
    const wantsKdm = include.includes("KDM");
    const wantsNot = include.includes("Not KDM");
    if (wantsKdm && !wantsNot) ensureAnd(where).push({ isKdm: true });
    else if (wantsNot && !wantsKdm) ensureAnd(where).push({ isKdm: false });
}

/** Filter Accounts by their contacts' title (relation: contacts.some.title). */
export function applyContactTitleFilter(where: any, raw?: string) {
    const { include, exclude } = parseMultiParam(raw);
    if (include.length) ensureAnd(where).push({ contacts: { some: { title: { in: include } } } });
    if (exclude.length) ensureAnd(where).push({ contacts: { none: { title: { in: exclude } } } });
}

// ── Leads: single source of truth for the list's `where` clause ──────────────
// Used by BOTH the Leads list page and the export API so that filtering + export
// stay in sync (e.g. a Due Date range filters the list AND its filtered export).

import { buildCommercialSearchCondition } from "./commercialSearch";

export const LEAD_SEARCH_FIELDS = [
    "fullName", "firstName", "lastName", "email", "secondaryEmail",
    "phone", "linkedinUrl", "skype", "location",
    "title", "companyName", "account.name",
    "technologies", "description", "source",
    "industry", "website", "headquarters", "specialties",
    "companyDetails", "legacyHistory",
];

export interface LeadsFilterParams {
    q?: string;
    filters?: string;   // pill filters: "status:...,fu:..."
    status?: string;    // status pill: all | archived | New | Qualified | ...
    createdFrom?: string; createdTo?: string;
    modifiedFrom?: string; modifiedTo?: string;
    dueFrom?: string; dueTo?: string;
    rating?: string; leadSource?: string; outsourc?: string;
    industry?: string; location?: string; leadTitle?: string;
    owner?: string; fuOn?: string;
    hasLinkedin?: string; hasOpp?: string;
}

/**
 * Build the Prisma `where` clause for the Leads list from URL filter params.
 * Keep this in sync with searchParams handled by /commercial/leads and the export API.
 */
export function buildLeadsWhereClause(p: LeadsFilterParams): any {
    const statusFilter = p.status || "all";
    const activeFilters = p.filters
        ? p.filters.split(",").map(s => s.trim()).filter(Boolean)
        : [];

    const where: any = statusFilter === 'archived'
        ? { isArchived: true, type: 'LEAD' }
        : { isArchived: false, type: 'LEAD' };

    if (statusFilter && statusFilter !== 'all' && statusFilter !== 'archived') {
        where.status = statusFilter;
    }

    if (p.q) {
        const searchCondition = buildCommercialSearchCondition(p.q, LEAD_SEARCH_FIELDS);
        if (searchCondition) where.AND = [...(where.AND || []), searchCondition];
    }

    // Status/rating pills (status:VALUE)
    const statusFilters = activeFilters
        .filter(f => f.startsWith("status:"))
        .map(f => f.replace("status:", ""));
    if (statusFilters.length > 0) {
        where.OR = [
            ...(where.OR || []),
            { status: { in: statusFilters } },
            { rating: { in: statusFilters } },
        ];
    }

    // FU pill flags (legacy boolean fields)
    for (const f of activeFilters.filter(f => f.startsWith("fu:"))) {
        if (f === "fu:fuOnLeads") where.fuOnLeads = true;
        if (f === "fu:cycleComplete") where.fuCycleComplete = true;
    }

    // Date ranges
    if (p.createdFrom || p.createdTo) {
        where.createdAt = {};
        if (p.createdFrom) where.createdAt.gte = new Date(p.createdFrom + "T00:00:00");
        if (p.createdTo) where.createdAt.lte = new Date(p.createdTo + "T23:59:59");
    }
    if (p.modifiedFrom || p.modifiedTo) {
        where.updatedAt = {};
        if (p.modifiedFrom) where.updatedAt.gte = new Date(p.modifiedFrom + "T00:00:00");
        if (p.modifiedTo) where.updatedAt.lte = new Date(p.modifiedTo + "T23:59:59");
    }
    if (p.dueFrom || p.dueTo) {
        where.dueDate = {};
        if (p.dueFrom) where.dueDate.gte = new Date(p.dueFrom + "T00:00:00");
        if (p.dueTo) where.dueDate.lte = new Date(p.dueTo + "T23:59:59");
    }

    // Advanced scalar filters (multi-select with `!` exclusion)
    applyScalarFilter(where, 'rating', p.rating);
    applyScalarFilter(where, 'source', p.leadSource);
    applyScalarFilter(where, 'outsourcing', p.outsourc);
    applyScalarFilter(where, 'industry', p.industry);
    applyScalarFilter(where, 'location', p.location);
    applyScalarFilter(where, 'title', p.leadTitle);
    applyOwnerFilter(where, p.owner);

    // FU on Leads (campaign enrollment status)
    if (p.fuOn) {
        const values = p.fuOn.split(',');
        const conditions: any[] = [];
        if (values.includes('Enrolled')) conditions.push({ campaignEnrollments: { some: { isActive: true, isComplete: false } } });
        if (values.includes('Enrolled - Paused')) conditions.push({ campaignEnrollments: { some: { isActive: false, isComplete: false } } });
        if (values.includes("Didn't Enroll")) conditions.push({ campaignEnrollments: { none: {} } });
        if (values.includes('FU Cycle Complete')) conditions.push({ campaignEnrollments: { some: { isComplete: true } } });
        if (conditions.length > 0) where.AND = [...(where.AND || []), { OR: conditions }];
    }

    // Presence filters
    applyHasLinkedinFilter(where, p.hasLinkedin);
    applyHasOpportunityFilter(where, p.hasOpp);

    return where;
}
