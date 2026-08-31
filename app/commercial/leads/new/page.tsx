'use client';

import { createContact } from "@/app/actions/commercial/contact";
import { getAccounts } from "@/app/actions/commercial/company";
import { getUsers } from "@/app/actions/users";
import { getCampaigns } from "@/app/actions/commercial/campaign";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Save, X, Calendar } from "lucide-react";
import AlertModal from "@/app/components/modals/AlertModal";

export default function NewContactPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [companies, setCompanies] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [submitError, setSubmitError] = useState<{ title: string; description: string } | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
    const [selectedOwnerId, setSelectedOwnerId] = useState<string>("");
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
    const [campaignStartMode, setCampaignStartMode] = useState<'immediate' | 'scheduled'>('immediate');
    const [scheduledStartDate, setScheduledStartDate] = useState<string>("");
    const { data: session } = useSession();

    // Load accounts for "Account" search/dropdown
    useEffect(() => {
        getAccounts().then(res => {
            if (res.success) setCompanies(res.data);
        });
        getUsers().then(res => {
            if (res.success && res.data) {
                setUsers(res.data);
                if (session?.user?.email) {
                    const currentUser = res.data.find((u: any) => u.email === session.user?.email);
                    if (currentUser) setSelectedOwnerId(currentUser.id);
                }
            }
        });
    }, [session]);

    // Load campaigns
    useEffect(() => {
        getCampaigns().then(res => {
            if (res.success && res.data) setCampaigns(res.data);
        });
    }, []);

    // Handle Company text input vs Account dropdown
    const [companyNameStr, setCompanyNameStr] = useState("");

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (isLoading) return; // Belt-and-suspenders against double-submit
        setSubmitError(null);
        setIsLoading(true);

        const formData = new FormData(event.currentTarget);

        const data = {
            firstName: formData.get("firstName") as string,
            fullName: formData.get("fullName") as string,
            email: formData.get("email") as string,
            phone: formData.get("phone") as string,
            companyId: selectedCompanyId,
            companyName: companyNameStr || formData.get("companyName") as string,
            title: formData.get("title") as string,
            status: formData.get("status") as string,
            secondaryEmail: formData.get("secondaryEmail") as string,
            rating: formData.get("rating") as string,
            linkedinUrl: formData.get("linkedinUrl") as string,
            fuCycleComplete: formData.get("fuCycleComplete") === "on",
            fuOnLeads: false,
            dueDate: formData.get("dueDate") as string,
            dueDateTimezone: formData.get("dueDateTimezone") as string,
            website: formData.get("website") as string,
            numberOfEmployees: formData.get("numberOfEmployees") as string,
            source: formData.get("source") as string,
            industry: formData.get("industry") as string,
            outsourcing: formData.get("outsourcing") as string,
            technologies: formData.get("technologies") as string,
            companyDetails: formData.get("companyDetails") as string,
            location: formData.get("location") as string,
            founded: formData.get("founded") as string,
            headquarters: formData.get("headquarters") as string,
            roleStartDate: formData.get("roleStartDate") as string,
            roleEndDate: formData.get("roleEndDate") as string,
            ownerId: selectedOwnerId,
            type: 'LEAD',
        };

        if (!data.firstName || !data.fullName) {
            setSubmitError({ title: "Required fields missing", description: "Please fill in both First Name and Full Name." });
            setIsLoading(false);
            return;
        }

        if (!data.companyName && !data.companyId) {
            setSubmitError({ title: "Required fields missing", description: "Please specify a Company (either select an existing Account or type a company name)." });
            setIsLoading(false);
            return;
        }

        const result = await createContact(data);

        if (result.success) {
            // Enroll in selected campaign if one was chosen
            if (selectedCampaignId && result.data?.id) {
                const { enrollContact } = await import('@/app/actions/commercial/campaignEnrollment');
                const startParam = campaignStartMode === 'scheduled' && scheduledStartDate ? scheduledStartDate : null;
                await enrollContact(result.data.id, parseInt(selectedCampaignId), startParam);
            }
            router.push("/commercial/leads?created=lead");
            router.refresh();
        } else {
            setSubmitError({ title: "Could not save lead", description: result.error as string });
            setIsLoading(false);
        }
    }

    return (
        <div className="px-8 pt-5 pb-8 max-w-3xl mx-auto space-y-8 min-h-screen bg-gray-50/50">
            <Link
                href="/commercial/leads"
                className="inline-flex items-center text-xs text-gray-400 hover:text-gray-500 transition-colors"
            >
                ← Leads
            </Link>

            <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                {/* Header */}
                <div className="px-8 pt-8 pb-4 border-b border-gray-50 bg-gray-50/50 flex justify-between items-start">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 font-montserrat">New Lead</h1>
                        <p className="text-gray-500 text-sm font-medium font-lato">Enter details to capture a new prospect.</p>
                    </div>
                </div>

                <form id="new-lead-form" onSubmit={onSubmit} className="px-8 pt-3 pb-8 space-y-6">
                    {/* ── MAIN INFO ── */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Main Info</span>
                            <div className="h-px bg-gray-100 flex-1"></div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Owner</label>
                                <select
                                    name="ownerId"
                                    value={selectedOwnerId}
                                    onChange={(e) => setSelectedOwnerId(e.target.value)}
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                >
                                    <option value="">-- Select Owner --</option>
                                    {users.map((user) => (
                                        <option key={user.id} value={user.id}>{user.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Status *</label>
                                <select name="status" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm">
                                    <option value="New">New</option>
                                    <option value="Unsubscribed">Unsubscribed</option>
                                    <option value="Qualified">Qualified</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">First Name *</label>
                                <input type="text" name="firstName" placeholder="First Name" required className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Full Name *</label>
                                <input type="text" name="fullName" placeholder="Full Name" required className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Company *</label>
                                <input
                                    type="text"
                                    name="companyName"
                                    value={companyNameStr}
                                    onChange={(e) => {
                                        setCompanyNameStr(e.target.value);
                                        if (selectedCompanyId && e.target.value !== companies.find(c => c.id.toString() === selectedCompanyId)?.name) {
                                            setSelectedCompanyId("");
                                        }
                                    }}
                                    required
                                    placeholder="Company Name"
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Title</label>
                                <input type="text" name="title" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Rating</label>
                                <select name="rating" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm">
                                    <option value="">--Select--</option>
                                    <option value="Hot">Hot</option>
                                    <option value="Warm">Warm</option>
                                    <option value="Cold">Cold</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Source</label>
                                <select name="source" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm">
                                    <option value="Sendy DB">Sendy DB</option>
                                    <option value="LeadCandy">LeadCandy</option>
                                    <option value="Scraping-LinkedIn">Scraping-LinkedIn</option>
                                    <option value="Client Referral">Client Referral</option>
                                    <option value="Web">Web</option>
                                    <option value="MSP">MSP</option>
                                    <option value="Scraping-Snov">Scraping-Snov</option>
                                    <option value="LinkedIn Extension">LinkedIn Extension</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* ── CONTACT & TRACKING ── */}
                    <div className="space-y-6 pt-6 border-t border-gray-50">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Contact & Tracking</span>
                            <div className="h-px bg-gray-100 flex-1"></div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Email</label>
                                <input type="email" name="email" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Phone</label>
                                <input type="tel" name="phone" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Secondary Email</label>
                                <input type="email" name="secondaryEmail" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">LinkedIn URL</label>
                                <input type="url" name="linkedinUrl" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Location</label>
                            <input type="text" name="location" placeholder="e.g. The Randstad, Netherlands" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                        </div>
                    </div>

                    {/* ── DESCRIPTION ── */}
                    <div className="space-y-6 pt-6 border-t border-gray-50">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Description</span>
                            <div className="h-px bg-gray-100 flex-1"></div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Outsourcing</label>
                                <select name="outsourcing" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm">
                                    <option value="N/A">N/A</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Lead Description</label>
                            <textarea name="description" rows={3} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm resize-none" />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Technologies</label>
                            <input type="text" name="technologies" placeholder="e.g. React, Node.js, Python" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                        </div>
                    </div>

                    {/* ── RELATED ACCOUNT ── */}
                    <div className="space-y-6 pt-6 border-t border-gray-50">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Related Account</span>
                            <div className="h-px bg-gray-100 flex-1"></div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Role Period</label>
                            <div className="flex items-center gap-2" style={{ maxWidth: '50%' }}>
                                <input type="text" name="roleStartDate" placeholder="Start (e.g. Feb 2024)" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                <span className="text-gray-300">→</span>
                                <input type="text" name="roleEndDate" placeholder="End" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Company Name</label>
                            <select
                                value={selectedCompanyId}
                                onChange={(e) => {
                                    setSelectedCompanyId(e.target.value);
                                    const selected = companies.find(c => c.id.toString() === e.target.value);
                                    if (selected) setCompanyNameStr(selected.name);
                                }}
                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm"
                            >
                                <option value="">Search Accounts...</option>
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Industry</label>
                                <select name="industry" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm">
                                    <option value="">--Select--</option>
                                    <option value="Agriculture">Agriculture</option>
                                    <option value="Automotive">Automotive</option>
                                    <option value="Construction">Construction</option>
                                    <option value="Consulting">Consulting</option>
                                    <option value="Education">Education</option>
                                    <option value="Energy & Utilities">Energy & Utilities</option>
                                    <option value="Entertainment">Entertainment</option>
                                    <option value="Finance & Banking">Finance & Banking</option>
                                    <option value="Food & Beverage">Food & Beverage</option>
                                    <option value="Government / Public Sector">Government / Public Sector</option>
                                    <option value="Healthcare">Healthcare</option>
                                    <option value="Manufacturing">Manufacturing</option>
                                    <option value="Marketing & Publicity">Marketing & Publicity</option>
                                    <option value="Real Estate">Real Estate</option>
                                    <option value="Retail">Retail</option>
                                    <option value="Technology / Software">Technology / Software</option>
                                    <option value="Telecommunications">Telecommunications</option>
                                    <option value="Transportation & Logistics">Transportation & Logistics</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Company Size</label>
                                <input type="text" name="numberOfEmployees" placeholder="e.g. 2-10 employees" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Founded</label>
                                <input type="text" name="founded" placeholder="e.g. 2020" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Headquarters</label>
                                <input type="text" name="headquarters" placeholder="e.g. Amsterdam, NL" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Website</label>
                            <input type="url" name="website" placeholder="https://..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Company Description</label>
                            <textarea name="companyDetails" rows={3} placeholder="About the company..." className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-sm resize-none" />
                        </div>
                    </div>

                    {/* ── CAMPAIGNS ── */}
                    <div className="flex flex-col gap-6 pt-6 border-t border-gray-50">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Campaigns</span>
                            <div className="h-px bg-gray-100 flex-1"></div>
                        </div>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Enroll in Campaign</label>
                                <select
                                    value={selectedCampaignId}
                                    onChange={(e) => { setSelectedCampaignId(e.target.value); setCampaignStartMode('immediate'); setScheduledStartDate(''); }}
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 focus:border-blue-500 outline-none cursor-pointer"
                                >
                                    <option value="">No campaign</option>
                                    {campaigns.map((c: any) => (
                                        <option key={c.id} value={c.id}>{c.name} ({c._count?.steps || 0} steps) — {c.isActive ? '✅ Active' : '⏸ Paused'}</option>
                                    ))}
                                </select>
                            </div>
                            {selectedCampaignId && (
                                <div className="space-y-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign Start</label>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="campaignStart"
                                                checked={campaignStartMode === 'immediate'}
                                                onChange={() => { setCampaignStartMode('immediate'); setScheduledStartDate(''); }}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm font-medium text-gray-700">Start Immediately</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="campaignStart"
                                                checked={campaignStartMode === 'scheduled'}
                                                onChange={() => setCampaignStartMode('scheduled')}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm font-medium text-gray-700">Schedule Start</span>
                                        </label>
                                    </div>
                                    {campaignStartMode === 'scheduled' && (
                                        <input
                                            type="date"
                                            value={scheduledStartDate}
                                            onChange={(e) => setScheduledStartDate(e.target.value)}
                                            min={new Date().toISOString().split('T')[0]}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 focus:border-blue-500 outline-none"
                                        />
                                    )}
                                </div>
                            )}
                            {/* ─── Follow Up ─── */}
                            <div className="bg-white rounded-lg border border-gray-100 overflow-hidden mt-6">
                                <div className="px-6 pt-5 pb-4">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Calendar className="h-3.5 w-3.5 text-blue-500" />
                                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Follow Up</span>
                                        <div className="h-px bg-gray-100 flex-1" />
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                                        <div>
                                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Next FU</dt>
                                            <dd>
                                                <input
                                                    type="datetime-local"
                                                    name="dueDate"
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm text-gray-700"
                                                />
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Timezone (GMT)</dt>
                                            <dd>
                                                <select
                                                    name="dueDateTimezone"
                                                    defaultValue="GMT-3"
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm text-gray-600"
                                                >
                                                    {['GMT-12','GMT-11','GMT-10','GMT-9','GMT-8','GMT-7','GMT-6','GMT-5','GMT-4','GMT-3','GMT-2','GMT-1','GMT+0','GMT+1','GMT+2','GMT+3','GMT+4','GMT+5','GMT+5:30','GMT+6','GMT+7','GMT+8','GMT+9','GMT+9:30','GMT+10','GMT+11','GMT+12','GMT+13','GMT+14'].map(tz => (
                                                        <option key={tz} value={tz}>{tz}</option>
                                                    ))}
                                                </select>
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Cycle Complete</dt>
                                            <dd className="flex items-center h-[38px]">
                                                <input
                                                    type="checkbox"
                                                    name="fuCycleComplete"
                                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                />
                                                <span className="ml-2 text-sm text-gray-700 font-medium">FU Cycle Complete</span>
                                            </dd>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex justify-end gap-3 pt-8 border-t border-gray-100">
                        <Link href="/commercial/leads" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all" style={{ fontFamily: 'var(--font-lato)' }}>
                            <X size={16} /> Cancel
                        </Link>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                            style={{ fontFamily: 'var(--font-lato)' }}
                        >
                            <Save size={16} /> {isLoading ? 'Saving...' : 'Save Lead'}
                        </button>
                    </div>
                </form >
            </div >

            {/* Submit error / validation popup — visible regardless of scroll position */}
            <AlertModal
                isOpen={submitError !== null}
                onClose={() => setSubmitError(null)}
                title={submitError?.title || ''}
                description={submitError?.description || ''}
                variant="danger"
            />
        </div >
    );
}



