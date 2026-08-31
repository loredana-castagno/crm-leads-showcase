"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import SearchableSelect from "@/app/components/SearchableSelect";

interface LeadsFilterProps {
    companies: { id: number; name: string }[];
    owners: { id: string; name: string }[];
}

export default function LeadsFilter({ companies, owners }: LeadsFilterProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [status, setStatus] = useState(searchParams.get("status") || "");
    const [company, setCompany] = useState(searchParams.get("company") || "");
    const [owner, setOwner] = useState(searchParams.get("owner") || "");

    useEffect(() => {
        const params = new URLSearchParams(searchParams.toString());

        if (status) params.set("status", status);
        else params.delete("status");

        if (company) params.set("company", company);
        else params.delete("company");

        if (owner) params.set("owner", owner);
        else params.delete("owner");

        const newParams = params.toString();
        const currentParams = searchParams.toString();

        if (newParams !== currentParams) {
            router.push(`?${newParams}`);
        }
    }, [status, company, owner, router, searchParams]);

    return (
        <div className="flex gap-3 mb-3">
            <div className="w-full max-w-xs">
                <SearchableSelect
                    options={companies}
                    value={company}
                    onChange={(val) => setCompany(val)}
                    placeholder="All Companies"
                />
            </div>

            <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="block w-full max-w-xs rounded-lg border-0 py-2.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-[#0783FC] sm:text-sm sm:leading-6"
            >
                <option value="">All Statuses</option>
                <option value="New">New</option>
                <option value="Qualified">Qualified</option>
                <option value="Unsubscribed">Unsubscribed</option>
                <option value="Hot">Hot</option>
                <option value="Warm">Warm</option>
                <option value="Cold">Cold</option>
            </select>

            <select
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="block w-full max-w-xs rounded-lg border-0 py-2.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-[#0783FC] sm:text-sm sm:leading-6"
            >
                <option value="">All Owners</option>
                {owners.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                ))}
            </select>

            {(status || company || owner) && (
                <button
                    onClick={() => {
                        setStatus("");
                        setCompany("");
                        setOwner("");
                    }}
                    className="flex items-center text-sm text-gray-500 hover:text-gray-700"
                >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                </button>
            )}
        </div>
    );
}


