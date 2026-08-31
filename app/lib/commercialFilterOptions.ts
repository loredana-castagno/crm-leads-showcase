import { db } from "@/app/lib/db";

export async function getLeadFilterOptions() {
    const leads = await (db as any).contact.findMany({
        where: { type: "LEAD", isArchived: false },
        select: {
            rating: true,
            source: true,
            outsourcing: true,
            industry: true,
            title: true,
            owner: { select: { name: true } },
        },
    });

    const distinct = (arr: (string | null | undefined)[]) =>
        [...new Set(arr.filter((v): v is string => !!v && v.trim() !== ''))].sort();

    return {
        rating: distinct(leads.map((l: any) => l.rating)),
        source: distinct(leads.map((l: any) => l.source)),
        owner: distinct(leads.map((l: any) => l.owner?.name)),
        outsourcing: distinct(leads.map((l: any) => l.outsourcing)),
        industry: distinct(leads.map((l: any) => l.industry)),
        location: distinct(leads.map((l: any) => l.location)),
        title: distinct(leads.map((l: any) => l.title)),
    };
}

function distinctSorted(arr: (string | null | undefined)[]) {
    return [...new Set(arr.filter((v): v is string => !!v && v.trim() !== ''))].sort();
}

// Split comma/dash-separated tech strings into distinct individual tokens.
function distinctTokens(arr: (string | null | undefined)[]) {
    const tokens = new Set<string>();
    for (const v of arr) {
        if (!v) continue;
        v.split(/[,\-]+/).forEach(t => {
            const trimmed = t.trim();
            if (trimmed) tokens.add(trimmed);
        });
    }
    return [...tokens].sort();
}

export async function getAccountFilterOptions() {
    const accounts = await (db as any).company.findMany({
        where: { isArchived: false },
        select: {
            source: true,
            outsourcing: true,
            industry: true,
            technologies: true,
            billingCountry: true,
            owner: { select: { name: true } },
            contacts: { select: { title: true } },
        },
    });
    return {
        owner: distinctSorted(accounts.map((a: any) => a.owner?.name)),
        industry: distinctSorted(accounts.map((a: any) => a.industry)),
        source: distinctSorted(accounts.map((a: any) => a.source)),
        outsourcing: distinctSorted(accounts.map((a: any) => a.outsourcing)),
        country: distinctSorted(accounts.map((a: any) => a.billingCountry)),
        technologies: distinctTokens(accounts.map((a: any) => a.technologies)),
        title: distinctSorted(accounts.flatMap((a: any) => (a.contacts || []).map((c: any) => c.title))),
    };
}

export async function getContactFilterOptions() {
    const contacts = await (db as any).contact.findMany({
        where: { type: "CLIENT_CONTACT", isArchived: false },
        select: {
            industry: true,
            owner: { select: { name: true } },
            account: { select: { name: true } },
        },
    });
    return {
        owner: distinctSorted(contacts.map((c: any) => c.owner?.name)),
        industry: distinctSorted(contacts.map((c: any) => c.industry)),
        account: distinctSorted(contacts.map((c: any) => c.account?.name)),
    };
}
