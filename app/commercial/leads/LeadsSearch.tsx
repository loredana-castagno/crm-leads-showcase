'use client';

import { Search } from 'lucide-react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function LeadsSearch() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();

    // Local state for immediate feedback
    const [term, setTerm] = useState(searchParams.get('q')?.toString() || '');

    useEffect(() => {
        // Sync local state if URL changes (e.g. back button)
        setTerm(searchParams.get('q')?.toString() || '');
    }, [searchParams]);

    useEffect(() => {
        const handler = setTimeout(() => {
            const params = new URLSearchParams(searchParams);
            if (term) {
                params.set('q', term);
            } else {
                params.delete('q');
            }
            // Use replace to prevent stacking history
            replace(`${pathname}?${params.toString()}`);
        }, 300);

        return () => {
            clearTimeout(handler);
        };
    }, [term]);

    return (
        <div className="relative flex-1 max-w-md">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </div>
            <input
                type="text"
                className="block w-full rounded-lg border-0 py-2.5 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-[#0783FC] sm:text-sm sm:leading-6"
                placeholder="Search Leads..."
                onChange={(e) => setTerm(e.target.value)}
                value={term}
            />
        </div>
    );
}

