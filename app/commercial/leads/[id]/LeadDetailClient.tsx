'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { User, Users, Building2, Mail, Phone, Calendar, CalendarCheck, CalendarOff, Globe, MapPin, Tag, ArrowLeft, Trash2, Save, Edit, ArrowUpRight, X, Plus, FileText, ExternalLink, Sparkles, CheckSquare, MessageSquare, ChevronUp, ChevronDown } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";
import { createNote, updateNote, deleteNote } from "@/app/actions/commercial/note";
import { generateContactHistoryBrief } from "@/app/actions/commercial/history";
import RichTextEditor from "@/app/components/ui/RichTextEditor";
import { updateContact, convertLeadToAccount, revertContactToLead, searchReportsToCandidates, addSecondaryContact, updateSecondaryContact, deleteSecondaryContact, swapPrimaryLeadContact } from "@/app/actions/commercial/contact";
import AutocompleteInput from "@/app/components/ui/AutocompleteInput";
import { archiveContactWithCascade, restoreContact, permanentlyDeleteContact } from "@/app/actions/commercial/archive";
import DeleteReasonModal from "@/app/components/modals/DeleteReasonModal";
import ConfirmModal from "@/app/components/modals/ConfirmModal";
import CascadeWarningModal from "@/app/components/modals/CascadeWarningModal";
import ActivityTimeline from "@/app/components/commercial/ActivityTimeline";
import ArchivedBanner from "@/app/components/commercial/ArchivedBanner";
import PreviouslyArchivedNote from "@/app/components/commercial/PreviouslyArchivedNote";
import SystemLogTimeline from "@/app/components/SystemLogTimeline";
import CollapsibleComment from "@/app/components/ui/CollapsibleComment";
import FileDropzone from "@/app/components/FileDropzone";
import { useEditLock, type OtherEditor } from "@/app/lib/useEditLock";
import EditLockModal from "@/app/components/EditLockModal";
import { COMMUNICATION_STATUS_OPTIONS } from "@/app/lib/communicationStatus";

interface Note {
    id: number;
    content: string;
    createdAt: Date;
    author: { name: string; image: string | null } | null;
}

interface AttachedFile {
    url: string;
    name: string;
    date?: string;
}

function parseAttachedFiles(dbValue: string | null | undefined, defaultName: string): AttachedFile[] {
    if (!dbValue) return [];
    const trimmed = dbValue.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            // fallback
        }
    }
    return [{ url: trimmed, name: defaultName }];
}

interface LeadDetailClientProps {
    lead: any;
    notes: any[];
    users: any[];
    activities: any[];
    source?: string;
}

export default function LeadDetailClient({ lead, notes: initialNotes, users, activities, source = 'leads' }: LeadDetailClientProps) {
    const router = useRouter();
    const [notes, setNotes] = useState(initialNotes);
    // AI History Brief — generated from the contact's real notes via GPT (server action).
    const [briefPeriods, setBriefPeriods] = useState<{ label: string; summary: string }[]>([]);
    const [briefLoading, setBriefLoading] = useState(false);
    const [briefLoaded, setBriefLoaded] = useState(false);
    const [newNote, setNewNote] = useState("");
    const [isSubmittingNote, setIsSubmittingNote] = useState(false);
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
    const [editNoteContent, setEditNoteContent] = useState("");
    const [confirmDeleteNote, setConfirmDeleteNote] = useState<number | null>(null);
    const [isLoggingActivity, setIsLoggingActivity] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [showUnenrollModal, setShowUnenrollModal] = useState(false);
    const [unenrollTarget, setUnenrollTarget] = useState<{ campaignId: number; campaignName: string } | null>(null);
    // `force` bypasses the server-side brief cache — the Refresh button passes it so
    // the user always gets a freshly generated brief, not the stored one.
    const loadHistoryBrief = async (force = false) => {
        if (briefLoading) return;
        setBriefLoading(true);
        try {
            const res = await generateContactHistoryBrief(lead.id, force);
            setBriefPeriods(res?.periods || []);
        } catch {
            setBriefPeriods([]);
        } finally {
            setBriefLoading(false);
            setBriefLoaded(true);
        }
    };

    useEffect(() => {
        if (notes && notes.length > 0) {
            loadHistoryBrief();
        } else {
            setBriefLoaded(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lead.id]);

    const [showResumeModal, setShowResumeModal] = useState(false);
    const [resumeTarget, setResumeTarget] = useState<{ campaignId: number; campaignName: string } | null>(null);
    const [enrollCampaignId, setEnrollCampaignId] = useState<string>("");
    const [enrollStartMode, setEnrollStartMode] = useState<'immediate' | 'scheduled'>('immediate');
    const [enrollScheduledDate, setEnrollScheduledDate] = useState<string>("");
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<{ campaignId: number; campaignName: string } | null>(null);
    const [editingStartEnrollmentId, setEditingStartEnrollmentId] = useState<number | null>(null);

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    // Advisory concurrent-edit warning. Derive the lock entity type from the record itself
    // (not the route `source`) so the same record always keys the same lock.
    const lockEntityType: 'lead' | 'contact' =
        (lead.type === 'CLIENT_CONTACT' || lead.type === 'FORMER_CLIENT_CONTACT' || lead.type === 'CONTACT')
            ? 'contact' : 'lead';
    const [lockEditors, setLockEditors] = useState<OtherEditor[] | null>(null);
    const [pendingEditOpen, setPendingEditOpen] = useState<(() => void) | null>(null);
    // Presence covers the record edit plus the note sub-editors (add / edit note).
    const isEditingAnything = isEditing || isAddingNote || editingNoteId !== null;
    const { acquire: acquireEditLock, release: releaseEditLock } = useEditLock(lockEntityType, lead.id, isEditingAnything);
    const guardEdit = async (open: () => void) => {
        const others = await acquireEditLock();
        if (others.length > 0) { setPendingEditOpen(() => open); setLockEditors(others); }
        else open();
    };
    const requestEdit = () => guardEdit(() => setIsEditing(true));
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        firstName: lead.firstName || "",
        fullName: lead.fullName || "",
        title: lead.title || "",
        email: lead.email || "",
        phone: lead.phone || "",
        companyName: lead.companyName || (lead as any).account?.name || "",
        ownerId: lead.ownerId || "",
        type: lead.type || "LEAD",
        source: lead.source || "",
        dueDate: lead.dueDate ? new Date(lead.dueDate).toISOString().slice(0, 16) : "",
        communicationStatus: (lead as any).communicationStatus || "",

        // Account / Company Fields
        numberOfEmployees: lead.numberOfEmployees || ((lead as any).account?.numberOfEmployees ? String((lead as any).account.numberOfEmployees) : ""),
        industry: lead.industry || (lead as any).account?.industry || "",
        website: lead.website || (lead as any).account?.website || "",
        companyDetails: lead.companyDetails || (lead as any).account?.companyDetails || "",
        description: lead.description || "",
        headquarters: lead.headquarters || (lead as any).account?.address || "",
        founded: lead.founded || "",
        specialties: lead.specialties || "",
        companyLinkedinUrl: (lead as any).companyLinkedinUrl || "",

        // Employment dates (Account 1)
        roleStartDate: (lead as any).roleStartDate || "",
        roleEndDate: (lead as any).roleEndDate || "",

        // Related Account 2
        companyName2: (lead as any).companyName2 || "",
        title2: (lead as any).title2 || "",
        companyLinkedinUrl2: (lead as any).companyLinkedinUrl2 || "",
        roleStartDate2: (lead as any).roleStartDate2 || "",
        roleEndDate2: (lead as any).roleEndDate2 || "",
        industry2: (lead as any).industry2 || "",
        numberOfEmployees2: (lead as any).numberOfEmployees2 || "",
        website2: (lead as any).website2 || "",
        headquarters2: (lead as any).headquarters2 || "",
        founded2: (lead as any).founded2 || "",
        companyDetails2: (lead as any).companyDetails2 || "",
        specialties2: (lead as any).specialties2 || "",

        // Related Account 3
        companyName3: (lead as any).companyName3 || "",
        title3: (lead as any).title3 || "",
        companyLinkedinUrl3: (lead as any).companyLinkedinUrl3 || "",
        roleStartDate3: (lead as any).roleStartDate3 || "",
        roleEndDate3: (lead as any).roleEndDate3 || "",
        industry3: (lead as any).industry3 || "",
        numberOfEmployees3: (lead as any).numberOfEmployees3 || "",
        website3: (lead as any).website3 || "",
        headquarters3: (lead as any).headquarters3 || "",
        founded3: (lead as any).founded3 || "",
        companyDetails3: (lead as any).companyDetails3 || "",
        specialties3: (lead as any).specialties3 || "",

        // Missing Fields
        status: lead.status === "Disqualified" ? "Unsubscribed" : (lead.status || "New"),
        rating: lead.rating || "",
        secondaryEmail: lead.secondaryEmail || "",
        linkedinUrl: lead.linkedinUrl || "",
        location: (lead as any).location || "",
        // skype removed
        outsourcing: lead.outsourcing || "N/A",
        technologies: lead.technologies || "",
        fuCycleComplete: lead.fuCycleComplete || false,
        fuOnLeads: lead.fuOnLeads || false,
        dueDateTimezone: (lead as any).dueDateTimezone || "GMT-3",
        disqualificationReason: (lead as any).disqualificationReason || "",

        // Client-contact org fields (SF parity)
        isKdm: (lead as any).isKdm || false,
        buyerRole: (lead as any).buyerRole || "",
        reportsToId: (lead as any).reportsToId ? String((lead as any).reportsToId) : "",
        reportsToId2: (lead as any).reportsToId2 ? String((lead as any).reportsToId2) : "",
        reportsToId3: (lead as any).reportsToId3 ? String((lead as any).reportsToId3) : "",
        reportsToId4: (lead as any).reportsToId4 ? String((lead as any).reportsToId4) : "",
        reportsToId5: (lead as any).reportsToId5 ? String((lead as any).reportsToId5) : "",

        // Document fields
        ndaUrl: (lead as any).ndaUrl || "",
        ndaDate: (lead as any).ndaDate ? new Date((lead as any).ndaDate).toISOString() : "",
        msaUrl: (lead as any).msaUrl || "",
        msaDate: (lead as any).msaDate ? new Date((lead as any).msaDate).toISOString() : "",
        otherUrl: (lead as any).otherUrl || "",
        otherDate: (lead as any).otherDate ? new Date((lead as any).otherDate).toISOString() : "",
    });

    // Sync specific fields that might change from external actions (like campaign enrollment)
    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            fuCycleComplete: lead.fuCycleComplete || false,
            dueDate: lead.dueDate ? new Date(lead.dueDate).toISOString().slice(0, 16) : "",
            dueDateTimezone: (lead as any).dueDateTimezone || "GMT-3"
        }));
    }, [lead.fuCycleComplete, lead.dueDate, (lead as any).dueDateTimezone]);

    // Reports To selected displays (for autocompletes 1..5)
    const [reportsToName, setReportsToName] = useState<string>((lead as any).reportsTo?.fullName || "");
    const [reportsToName2, setReportsToName2] = useState<string>((lead as any).reportsTo2?.fullName || "");
    const [reportsToName3, setReportsToName3] = useState<string>((lead as any).reportsTo3?.fullName || "");
    const [reportsToName4, setReportsToName4] = useState<string>((lead as any).reportsTo4?.fullName || "");
    const [reportsToName5, setReportsToName5] = useState<string>((lead as any).reportsTo5?.fullName || "");

    // Track how many Related Account sections are visible
    const [visibleAccounts, setVisibleAccounts] = useState(() => {
        if ((lead as any).companyName3) return 3;
        if ((lead as any).companyName2) return 2;
        return 1;
    });

    // Document Upload and Removal States
    const [ndaUploading, setNdaUploading] = useState(false);
    const [msaUploading, setMsaUploading] = useState(false);
    const [otherUploading, setOtherUploading] = useState(false);

    const [showNdaRemoveConfirm, setShowNdaRemoveConfirm] = useState(false);
    const [showMsaRemoveConfirm, setShowMsaRemoveConfirm] = useState(false);
    const [showOtherRemoveConfirm, setShowOtherRemoveConfirm] = useState(false);

    const [ndaDeleteIndex, setNdaDeleteIndex] = useState<number | null>(null);
    const [msaDeleteIndex, setMsaDeleteIndex] = useState<number | null>(null);
    const [otherDeleteIndex, setOtherDeleteIndex] = useState<number | null>(null);
    const [isSecContactsExpanded, setIsSecContactsExpanded] = useState(false);

    const handleDocumentUpload = async (file: File, type: 'nda' | 'msa' | 'other') => {
        const setUploading = type === 'nda' ? setNdaUploading : type === 'msa' ? setMsaUploading : setOtherUploading;
        setUploading(true);
        const data = new FormData();
        data.append('file', file);
        try {
            const res = await fetch('/api/opportunities/upload-doc', { method: 'POST', body: data });
            const result = await res.json();
            if (result.url) {
                const defaultName = type === 'nda' ? 'NDA Document' : type === 'msa' ? 'MSA Document' : 'Other Document';
                const currentFiles = parseAttachedFiles(formData[`${type}Url`], defaultName);
                const newFile = { url: result.url, name: result.name || file.name, date: new Date().toISOString() };
                const updatedFiles = [...currentFiles, newFile];
                const newUrlStr = JSON.stringify(updatedFiles);
                const newDate = new Date().toISOString();
                
                // Construct the updated form data object
                const updatedFormData = {
                    ...formData,
                    [`${type}Url`]: newUrlStr,
                    [`${type}Date`]: newDate
                };

                // Update local state first
                setFormData(updatedFormData);

                // Instantly save to database
                const saveRes = await updateContact(lead.id, updatedFormData);
                if (saveRes.success) {
                    router.refresh();
                } else {
                    console.error("Failed to save document immediately:", saveRes.error);
                }
            }
        } catch (error) {
            console.error(`Error uploading ${type} document:`, error);
        }
        setUploading(false);
    };

    function getViewableUrl(url: string): string {
        return url || '';
    }

    function handleDocClick(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
        // No-op — let default <a href target=_blank> handle it
    }

    // Description expand state for each Related Account
    const [descExpanded1, setDescExpanded1] = useState(false);
    const [descExpanded2, setDescExpanded2] = useState(false);
    const [descExpanded3, setDescExpanded3] = useState(false);
    // History comments expand state
    const [expandedNotes, setExpandedNotes] = useState<Record<number, boolean>>({});
    // Specialty tag input state
    const [specInput1, setSpecInput1] = useState('');
    const [specInput2, setSpecInput2] = useState('');
    const [specInput3, setSpecInput3] = useState('');

    // Secondary Contacts state
    const [showAddSecModal, setShowAddSecModal] = useState(false);
    const [showEditSecModal, setShowEditSecModal] = useState(false);
    const [editSecTarget, setEditSecTarget] = useState<any>(null);
    const [showDeleteSecModal, setShowDeleteSecModal] = useState(false);
    const [deleteSecTarget, setDeleteSecTarget] = useState<any>(null);
    const [showPromoteSecModal, setShowPromoteSecModal] = useState(false);
    const [promoteSecTarget, setPromoteSecTarget] = useState<any>(null);

    const [secFirstName, setSecFirstName] = useState('');
    const [secLastName, setSecLastName] = useState('');
    const [secTitle, setSecTitle] = useState('');
    const [secEmail, setSecEmail] = useState('');
    const [secPhone, setSecPhone] = useState('');
    const [secLinkedinUrl, setSecLinkedinUrl] = useState('');
    const [secDescription, setSecDescription] = useState('');
    const [secError, setSecError] = useState<string | null>(null);
    const [isSubmittingSec, setIsSubmittingSec] = useState(false);

    // Helper: parse specialties string to array of chips
    const parseSpecialties = (val: string) => val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    // Helper: add specialty chip
    const addSpecialty = (key: string, inputVal: string, setInput: (v: string) => void) => {
        const trimmed = inputVal.trim();
        if (!trimmed) return;
        const current = formData[key as keyof typeof formData] as string || '';
        const chips = parseSpecialties(current);
        if (!chips.includes(trimmed)) {
            setFormData({ ...formData, [key]: [...chips, trimmed].join(', ') });
        }
        setInput('');
    };
    // Helper: remove specialty chip
    const removeSpecialty = (key: string, index: number) => {
        const current = formData[key as keyof typeof formData] as string || '';
        const chips = parseSpecialties(current);
        chips.splice(index, 1);
        setFormData({ ...formData, [key]: chips.join(', ') });
    };

    async function handleAddNote() {
        if (!newNote.replace(/<[^>]*>/g, '').trim()) return;
        setIsSubmittingNote(true);
        const res = await createNote({ content: newNote, contactId: lead.id });
        if (res.success) {
            setNotes([res.data, ...notes]);
            setNewNote("");
            setIsAddingNote(false);
        }
        setIsSubmittingNote(false);
    }

    async function handleUpdateNote(id: number) {
        if (!editNoteContent.replace(/<[^>]*>/g, '').trim()) return;
        const res = await updateNote({ id, content: editNoteContent, contactId: lead.id });
        if (res.success && res.data) {
            setNotes(notes.map((n: any) => n.id === id ? { ...n, content: res.data.content, updatedAt: res.data.updatedAt } : n));
            setEditingNoteId(null);
            setEditNoteContent('');
        }
    }

    async function handleDeleteNote(id: number) {
        const res = await deleteNote({ id, contactId: lead.id });
        if (res.success) {
            setNotes(notes.filter((n: any) => n.id !== id));
        }
    }

    async function handleSaveLead() {
        setIsSaving(true);
        setSaveError(null);
        const updatedFormData = {
            ...formData,
            isKdm: formData.buyerRole === "key_decision_maker"
        };
        const res = await updateContact(lead.id, updatedFormData);
        if (res.success) {
            setIsEditing(false);
            router.refresh();
        } else {
            setSaveError(res.error || "Failed to save changes. Please try again.");
        }
        setIsSaving(false);
    }

    // Delete Logic
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    // Cascade confirm modal state
    const [cascadeConfirm, setCascadeConfirm] = useState<{ open: boolean; reason: string; count: number; titles: string[] }>({ open: false, reason: '', count: 0, titles: [] });
    const [isCascading, setIsCascading] = useState(false);
    // Convert to account confirm modal
    const [isConvertConfirmOpen, setIsConvertConfirmOpen] = useState(false);
    const [isRevertToLeadConfirmOpen, setIsRevertToLeadConfirmOpen] = useState(false);
    const [isRevertingToLead, setIsRevertingToLead] = useState(false);

    async function handleDeleteLead(reason: string) {
        setIsDeleting(true);

        const probe = await archiveContactWithCascade(lead.id, reason, { cascadeOpps: false });
        if (!probe.success) {
            setIsDeleting(false);
            return;
        }

        // Lead is now archived. If it had open Opps, ask whether to also archive those.
        if (probe.openOppsCount && probe.openOppsCount > 0) {
            setIsDeleteModalOpen(false);
            setIsDeleting(false);
            setCascadeConfirm({
                open: true,
                reason,
                count: probe.openOppsCount,
                titles: (probe as any).openOppTitles || [],
            });
            return;
        }

        // No cascade decision needed — straight to list
        router.push('/commercial/leads');
        router.refresh();
    }

    // User clicked "Archive them too"
    async function handleCascadeConfirm() {
        setIsCascading(true);
        await archiveContactWithCascade(lead.id, cascadeConfirm.reason, { cascadeOpps: true });
        setCascadeConfirm({ open: false, reason: '', count: 0, titles: [] });
        setIsCascading(false);
        router.push('/commercial/leads');
        router.refresh();
    }

    // User clicked "Keep them open" — Lead stays archived, Opps remain open
    function handleCascadeKeep() {
        setCascadeConfirm({ open: false, reason: '', count: 0, titles: [] });
        router.push('/commercial/leads');
        router.refresh();
    }

    // User closed the modal entirely (X / Cancel) — Lead is already archived,
    // we just close. Behaviour is identical to "Keep them open" — the prior
    // archive call has already committed.
    function handleCascadeCancel() {
        handleCascadeKeep();
    }

    // Check for changes
    const hasChanges =
        (formData.firstName !== (lead.firstName || "")) ||
        (formData.fullName !== (lead.fullName || "")) ||
        (formData.title !== (lead.title || "")) ||
        (formData.email !== (lead.email || "")) ||
        (formData.phone !== (lead.phone || "")) ||
        (formData.companyName !== (lead.companyName || "")) ||
        (formData.ownerId !== (lead.ownerId || "")) ||
        (formData.type !== (lead.type || "LEAD")) ||
        (formData.source !== (lead.source || "")) ||
        (formData.status !== (lead.status === "Disqualified" ? "Unsubscribed" : (lead.status || "New"))) ||
        (formData.rating !== (lead.rating || "")) ||
        (formData.secondaryEmail !== (lead.secondaryEmail || "")) ||
        (formData.linkedinUrl !== (lead.linkedinUrl || "")) ||
        (formData.location !== ((lead as any).location || "")) ||
        // skype removed
        (formData.outsourcing !== (lead.outsourcing || "N/A")) ||
        (formData.technologies !== (lead.technologies || "")) ||
        (formData.fuCycleComplete !== (lead.fuCycleComplete || false)) ||
        (formData.fuOnLeads !== (lead.fuOnLeads || false)) ||
        (formData.dueDate !== (lead.dueDate ? new Date(lead.dueDate).toISOString().slice(0, 16) : "")) ||
        (formData.dueDateTimezone !== ((lead as any).dueDateTimezone || "GMT-3")) ||
        (formData.communicationStatus !== ((lead as any).communicationStatus || "")) ||
        // Account Fields
        (formData.numberOfEmployees !== (lead.numberOfEmployees || "")) ||
        (formData.industry !== (lead.industry || "")) ||
        (formData.website !== (lead.website || "")) ||
        (formData.companyDetails !== (lead.companyDetails || "")) ||
        (formData.description !== (lead.description || "")) ||
        (formData.headquarters !== ((lead as any).headquarters || "")) ||
        (formData.founded !== ((lead as any).founded || "")) ||
        (formData.specialties !== (lead.specialties || "")) ||
        (formData.companyLinkedinUrl !== ((lead as any).companyLinkedinUrl || "")) ||
        // Employment dates
        (formData.roleStartDate !== ((lead as any).roleStartDate || "")) ||
        (formData.roleEndDate !== ((lead as any).roleEndDate || "")) ||
        // Related Account 2
        (formData.companyName2 !== ((lead as any).companyName2 || "")) ||
        (formData.title2 !== ((lead as any).title2 || "")) ||
        (formData.companyLinkedinUrl2 !== ((lead as any).companyLinkedinUrl2 || "")) ||
        (formData.roleStartDate2 !== ((lead as any).roleStartDate2 || "")) ||
        (formData.roleEndDate2 !== ((lead as any).roleEndDate2 || "")) ||
        (formData.industry2 !== ((lead as any).industry2 || "")) ||
        (formData.numberOfEmployees2 !== ((lead as any).numberOfEmployees2 || "")) ||
        (formData.website2 !== ((lead as any).website2 || "")) ||
        (formData.headquarters2 !== ((lead as any).headquarters2 || "")) ||
        (formData.founded2 !== ((lead as any).founded2 || "")) ||
        (formData.companyDetails2 !== ((lead as any).companyDetails2 || "")) ||
        (formData.specialties2 !== ((lead as any).specialties2 || "")) ||
        // Related Account 3
        (formData.companyName3 !== ((lead as any).companyName3 || "")) ||
        (formData.title3 !== ((lead as any).title3 || "")) ||
        (formData.companyLinkedinUrl3 !== ((lead as any).companyLinkedinUrl3 || "")) ||
        (formData.roleStartDate3 !== ((lead as any).roleStartDate3 || "")) ||
        (formData.roleEndDate3 !== ((lead as any).roleEndDate3 || "")) ||
        (formData.industry3 !== ((lead as any).industry3 || "")) ||
        (formData.numberOfEmployees3 !== ((lead as any).numberOfEmployees3 || "")) ||
        (formData.website3 !== ((lead as any).website3 || "")) ||
        (formData.headquarters3 !== ((lead as any).headquarters3 || "")) ||
        (formData.founded3 !== ((lead as any).founded3 || "")) ||
        (formData.companyDetails3 !== ((lead as any).companyDetails3 || "")) ||
        (formData.specialties3 !== ((lead as any).specialties3 || "")) ||
        // Client-contact org fields
        (formData.isKdm !== ((lead as any).isKdm || false)) ||
        (formData.buyerRole !== ((lead as any).buyerRole || "")) ||
        (formData.reportsToId !== ((lead as any).reportsToId ? String((lead as any).reportsToId) : "")) ||
        (formData.reportsToId2 !== ((lead as any).reportsToId2 ? String((lead as any).reportsToId2) : "")) ||
        (formData.reportsToId3 !== ((lead as any).reportsToId3 ? String((lead as any).reportsToId3) : "")) ||
        (formData.reportsToId4 !== ((lead as any).reportsToId4 ? String((lead as any).reportsToId4) : "")) ||
        (formData.reportsToId5 !== ((lead as any).reportsToId5 ? String((lead as any).reportsToId5) : "")) ||
        // Documents
        (formData.ndaUrl !== ((lead as any).ndaUrl || "")) ||
        (formData.ndaDate !== ((lead as any).ndaDate ? new Date((lead as any).ndaDate).toISOString() : "")) ||
        (formData.msaUrl !== ((lead as any).msaUrl || "")) ||
        (formData.msaDate !== ((lead as any).msaDate ? new Date((lead as any).msaDate).toISOString() : "")) ||
        (formData.otherUrl !== ((lead as any).otherUrl || "")) ||
        (formData.otherDate !== ((lead as any).otherDate ? new Date((lead as any).otherDate).toISOString() : ""));

    function handleCancelEdit() {
        setFormData({
            firstName: lead.firstName || "",
            fullName: lead.fullName || "",
            title: lead.title || "",
            email: lead.email || "",
            phone: lead.phone || "",
            communicationStatus: (lead as any).communicationStatus || "",
            companyName: lead.companyName || "",
            ownerId: lead.ownerId || "",
            type: lead.type || "LEAD",
            source: lead.source || "",
            // Account
            numberOfEmployees: lead.numberOfEmployees || "",
            industry: lead.industry || "",
            website: lead.website || "",
            companyDetails: lead.companyDetails || "",
            headquarters: lead.headquarters || "",
            founded: lead.founded || "",
            specialties: lead.specialties || "",
            companyLinkedinUrl: (lead as any).companyLinkedinUrl || "",

            status: lead.status === "Disqualified" ? "Unsubscribed" : (lead.status || "New"),
            rating: lead.rating || "",
            secondaryEmail: lead.secondaryEmail || "",
            linkedinUrl: lead.linkedinUrl || "",
            location: (lead as any).location || "",
            // skype removed
            outsourcing: lead.outsourcing || "N/A",
            technologies: lead.technologies || "",
            fuCycleComplete: lead.fuCycleComplete || false,
            fuOnLeads: lead.fuOnLeads || false,
            dueDate: lead.dueDate ? new Date(lead.dueDate).toISOString().slice(0, 16) : "",
            description: lead.description || "",

            // Multi-account fields
            roleStartDate: (lead as any).roleStartDate || "",
            roleEndDate: (lead as any).roleEndDate || "",
            companyName2: (lead as any).companyName2 || "",
            title2: (lead as any).title2 || "",
            companyLinkedinUrl2: (lead as any).companyLinkedinUrl2 || "",
            roleStartDate2: (lead as any).roleStartDate2 || "",
            roleEndDate2: (lead as any).roleEndDate2 || "",
            industry2: (lead as any).industry2 || "",
            numberOfEmployees2: (lead as any).numberOfEmployees2 || "",
            website2: (lead as any).website2 || "",
            headquarters2: (lead as any).headquarters2 || "",
            founded2: (lead as any).founded2 || "",
            companyDetails2: (lead as any).companyDetails2 || "",
            specialties2: (lead as any).specialties2 || "",
            companyName3: (lead as any).companyName3 || "",
            title3: (lead as any).title3 || "",
            companyLinkedinUrl3: (lead as any).companyLinkedinUrl3 || "",
            roleStartDate3: (lead as any).roleStartDate3 || "",
            roleEndDate3: (lead as any).roleEndDate3 || "",
            industry3: (lead as any).industry3 || "",
            numberOfEmployees3: (lead as any).numberOfEmployees3 || "",
            website3: (lead as any).website3 || "",
            headquarters3: (lead as any).headquarters3 || "",
            founded3: (lead as any).founded3 || "",
            companyDetails3: (lead as any).companyDetails3 || "",
            specialties3: (lead as any).specialties3 || "",
            disqualificationReason: (lead as any).disqualificationReason || "",
            isKdm: (lead as any).isKdm || false,
            buyerRole: (lead as any).buyerRole || "",
            reportsToId: (lead as any).reportsToId ? String((lead as any).reportsToId) : "",
            dueDateTimezone: (lead as any).dueDateTimezone || "GMT-3",
            ndaUrl: (lead as any).ndaUrl || "",
            ndaDate: (lead as any).ndaDate ? new Date((lead as any).ndaDate).toISOString() : "",
            msaUrl: (lead as any).msaUrl || "",
            msaDate: (lead as any).msaDate ? new Date((lead as any).msaDate).toISOString() : "",
            otherUrl: (lead as any).otherUrl || "",
            otherDate: (lead as any).otherDate ? new Date((lead as any).otherDate).toISOString() : "",
        });
        setIsEditing(false);
    }


    async function handleRestoreLead() {
        const res = await restoreContact(lead.id);
        if (res.success) {
            router.refresh();
        }
    }

    async function handlePermanentDeleteLead() {
        const res = await permanentlyDeleteContact(lead.id);
        if (res.success) {
            router.push('/commercial/leads');
            router.refresh();
        }
    }


    const srcStr = source as unknown as string;

    const isRedesignedActive = typeof window !== 'undefined' && 
        (srcStr === 'leads' || srcStr === 'contacts');

    const [activeTab, setActiveTab] = useState<string>('contact');

    // ─── MODULAR JSX SECTIONS (Redesign & Production Parity) ───
    const relatedAccountsSection = (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <div>
                    <div className="px-6 pt-5 pb-4">
                        <div className="flex items-center gap-2 mb-4">
                            <Building2 className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">
                                Related Account {lead.companyName ? `· ${lead.companyName}` : ''}
                            </span>
                            <div className="h-px bg-gray-100 flex-1" />
                        </div>
                        {/* Role Period - standalone row */}
                        <div className="mb-4">
                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role Period</dt>
                            <dd className="mt-1 text-sm text-gray-900" style={{ maxWidth: '33%' }}>
                                {isEditing ? (
                                    <div className="flex items-center gap-2">
                                        <input type="text" value={formData.roleStartDate} onChange={(e) => setFormData({ ...formData, roleStartDate: e.target.value })} placeholder="Start (e.g. Feb 2024)" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                        <span className="text-gray-300">→</span>
                                        <input type="text" value={formData.roleEndDate} onChange={(e) => setFormData({ ...formData, roleEndDate: e.target.value })} placeholder="End" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    </div>
                                ) : (
                                    ((lead as any).roleStartDate || (lead as any).roleEndDate)
                                        ? `${(lead as any).roleStartDate || '?'} → ${(lead as any).roleEndDate || '?'}`
                                        : 'Not specified'
                                )}
                            </dd>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                            {/* Row 1: Company Name, Industry, Company Size */}
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Name</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="text" value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} placeholder="Company name" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : (lead.companyId || lead.account?.id) ? (
                                        <a href={`/commercial/accounts/${lead.companyId || lead.account?.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1">
                                            {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                        </a>
                                    ) : lead.companyName ? (
                                        <a href={`/commercial/accounts?query=${encodeURIComponent(lead.companyName.replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1">
                                            {lead.companyName.replace(/^View company:\s*/i, '')}
                                        </a>
                                    ) : '-'}
                                </dd>
                            </div>
                            {/* Industry, Company Size, Founded */}
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Industry</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="text" value={formData.industry} onChange={(e) => setFormData({ ...formData, industry: e.target.value })} placeholder="e.g. Marketing Services" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : lead.industry || '-'}
                                </dd>
                            </div>
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Size</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="text" value={formData.numberOfEmployees} onChange={(e) => setFormData({ ...formData, numberOfEmployees: e.target.value })} placeholder="e.g. 11-50 employees" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : lead.numberOfEmployees || '-'}
                                </dd>
                            </div>
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Founded</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="text" value={formData.founded} onChange={(e) => setFormData({ ...formData, founded: e.target.value })} placeholder="e.g. 2020" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : lead.founded || '-'}
                                </dd>
                            </div>
                            {/* Row 3: Headquarters, Website */}
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Headquarters</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="text" value={formData.headquarters} onChange={(e) => setFormData({ ...formData, headquarters: e.target.value })} placeholder="e.g. Chicago, Illinois US" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : lead.headquarters || '-'}
                                </dd>
                            </div>
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Website</dt>
                                <dd className="mt-1 text-sm text-blue-600">
                                    {isEditing ? (
                                        <input type="url" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} placeholder="https://..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : lead.website ? <a href={lead.website} target="_blank" className="hover:underline inline-flex items-center gap-1">Visit Web</a> : <span className="text-gray-900">-</span>}
                                </dd>
                            </div>
                            {/* LinkedIn URL - full width */}
                            <div className="sm:col-span-3">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">LinkedIn URL</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input type="url" value={formData.companyLinkedinUrl || ''} onChange={(e) => setFormData({ ...formData, companyLinkedinUrl: e.target.value })} placeholder="https://www.linkedin.com/company/..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />
                                    ) : (lead as any).companyLinkedinUrl ? (
                                        <a href={(lead as any).companyLinkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                            View company LinkedIn
                                        </a>
                                    ) : '-'}
                                </dd>
                            </div>
                            {/* Description - collapsible in read mode */}
                            <div className="sm:col-span-3">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <textarea value={formData.companyDetails} onChange={(e) => { setFormData({ ...formData, companyDetails: e.target.value }); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm resize-none overflow-hidden" style={{ minHeight: '80px' }} />
                                    ) : lead.companyDetails ? (
                                        <div>
                                            <p className={`whitespace-pre-wrap ${!descExpanded1 ? 'line-clamp-3' : ''}`}>{lead.companyDetails}</p>
                                            {lead.companyDetails.length > 200 && (
                                                <button type="button" onClick={() => setDescExpanded1(!descExpanded1)} className="mt-2 px-3 py-1 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
                                                    {descExpanded1 ? 'Show less' : 'Show more'}
                                                </button>
                                            )}
                                        </div>
                                    ) : '-'}
                                </dd>
                            </div>
                            {/* Specialties */}
                            <div className="sm:col-span-3">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Specialties</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <div className="flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-lg border border-gray-200 bg-white min-h-[42px]">
                                            {parseSpecialties(formData.specialties || '').map((chip, i) => (
                                                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/10">
                                                    {chip}
                                                    <button type="button" onClick={() => removeSpecialty('specialties', i)} className="text-cyan-500 hover:text-cyan-700 ml-0.5">×</button>
                                                </span>
                                            ))}
                                            <input type="text" value={specInput1} onChange={(e) => setSpecInput1(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSpecialty('specialties', specInput1, setSpecInput1); } }} placeholder="Add..." className="flex-1 min-w-[60px] outline-none bg-transparent text-sm" />
                                        </div>
                                    ) : lead.specialties ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {parseSpecialties(lead.specialties).map((spec, i) => (
                                                <span key={i} className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{spec}</span>
                                            ))}
                                        </div>
                                    ) : '-'}
                                </dd>
                            </div>
                        </div>
                    </div>

                    {/* ── RELATED ACCOUNT 2 ── */}
                    {visibleAccounts >= 2 && (
                        <div className="px-6 pt-5 pb-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Building2 className="h-3.5 w-3.5 text-blue-500" />
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">
                                    Related Account {(lead as any).companyName2 ? `· ${(lead as any).companyName2}` : '2'}
                                </span>
                                <div className="h-px bg-gray-100 flex-1" />
                            </div>
                            <div className="mb-4"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role Period</dt><dd className="mt-1 text-sm text-gray-900" style={{ maxWidth: '33%' }}>{isEditing ? (<div className="flex items-center gap-2"><input type="text" value={formData.roleStartDate2} onChange={(e) => setFormData({ ...formData, roleStartDate2: e.target.value })} placeholder="Start" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" /><span className="text-gray-300">→</span><input type="text" value={formData.roleEndDate2} onChange={(e) => setFormData({ ...formData, roleEndDate2: e.target.value })} placeholder="End" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" /></div>) : ((lead as any).roleStartDate2 || (lead as any).roleEndDate2) ? `${(lead as any).roleStartDate2 || '?'} → ${(lead as any).roleEndDate2 || '?'}` : 'Not specified'}</dd></div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Name</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.companyName2} onChange={(e) => setFormData({ ...formData, companyName2: e.target.value })} placeholder="Company name" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).companyName2 ? (<a href={`/commercial/accounts?query=${encodeURIComponent(((lead as any).companyName2 || '').replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1">{((lead as any).companyName2 || '').replace(/^View company:\s*/i, '')}</a>) : '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Industry</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.industry2} onChange={(e) => setFormData({ ...formData, industry2: e.target.value })} placeholder="e.g. Software Development" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).industry2 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Size</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.numberOfEmployees2} onChange={(e) => setFormData({ ...formData, numberOfEmployees2: e.target.value })} placeholder="e.g. 51-200 employees" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).numberOfEmployees2 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Founded</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.founded2} onChange={(e) => setFormData({ ...formData, founded2: e.target.value })} placeholder="e.g. 2011" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).founded2 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Headquarters</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.headquarters2} onChange={(e) => setFormData({ ...formData, headquarters2: e.target.value })} placeholder="e.g. San Francisco, CA" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).headquarters2 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Website</dt><dd className="mt-1 text-sm text-blue-600">{isEditing ? (<input type="url" value={formData.website2} onChange={(e) => setFormData({ ...formData, website2: e.target.value })} placeholder="https://..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).website2 ? <a href={(lead as any).website2} target="_blank" className="hover:underline inline-flex items-center gap-1">Visit Web</a> : <span className="text-gray-900">-</span>}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">LinkedIn URL</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="url" value={formData.companyLinkedinUrl2} onChange={(e) => setFormData({ ...formData, companyLinkedinUrl2: e.target.value })} placeholder="https://www.linkedin.com/company/..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).companyLinkedinUrl2 ? (<a href={(lead as any).companyLinkedinUrl2} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">View company LinkedIn</a>) : '-'}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description</dt><dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{isEditing ? (<textarea value={formData.companyDetails2} onChange={(e) => { setFormData({ ...formData, companyDetails2: e.target.value }); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm resize-none overflow-hidden" style={{ minHeight: '80px' }} />) : (lead as any).companyDetails2 ? (<div><p className={!descExpanded2 ? 'line-clamp-3' : ''}>{(lead as any).companyDetails2}</p>{(lead as any).companyDetails2.length > 200 && (<button type="button" onClick={() => setDescExpanded2(!descExpanded2)} className="mt-2 px-3 py-1 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">{descExpanded2 ? 'Show less' : 'Show more'}</button>)}</div>) : '-'}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Specialties</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<div className="flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-lg border border-gray-200 bg-white min-h-[42px]">{parseSpecialties(formData.specialties2 || '').map((chip, i) => (<span key={i} className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/10">{chip}<button type="button" onClick={() => removeSpecialty('specialties2', i)} className="text-cyan-500 hover:text-cyan-700 ml-0.5">×</button></span>))}<input type="text" value={specInput2} onChange={(e) => setSpecInput2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSpecialty('specialties2', specInput2, setSpecInput2); } }} placeholder="Add..." className="flex-1 min-w-[60px] outline-none bg-transparent text-sm" /></div>) : (lead as any).specialties2 ? (<div className="flex flex-wrap gap-1.5">{parseSpecialties((lead as any).specialties2).map((spec, i) => (<span key={i} className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{spec}</span>))}</div>) : '-'}</dd></div>

                            </div>
                        </div>
                    )}

                    {/* ── RELATED ACCOUNT 3 ── */}
                    {visibleAccounts >= 3 && (
                        <div className="px-6 pt-5 pb-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Building2 className="h-3.5 w-3.5 text-blue-500" />
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">
                                    Related Account {(lead as any).companyName3 ? `· ${(lead as any).companyName3}` : '3'}
                                </span>
                                <div className="h-px bg-gray-100 flex-1" />
                            </div>
                            <div className="mb-4"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role Period</dt><dd className="mt-1 text-sm text-gray-900" style={{ maxWidth: '33%' }}>{isEditing ? (<div className="flex items-center gap-2"><input type="text" value={formData.roleStartDate3} onChange={(e) => setFormData({ ...formData, roleStartDate3: e.target.value })} placeholder="Start" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" /><span className="text-gray-300">→</span><input type="text" value={formData.roleEndDate3} onChange={(e) => setFormData({ ...formData, roleEndDate3: e.target.value })} placeholder="End" className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" /></div>) : ((lead as any).roleStartDate3 || (lead as any).roleEndDate3) ? `${(lead as any).roleStartDate3 || '?'} → ${(lead as any).roleEndDate3 || '?'}` : 'Not specified'}</dd></div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Name</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.companyName3} onChange={(e) => setFormData({ ...formData, companyName3: e.target.value })} placeholder="Company name" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).companyName3 ? (<a href={`/commercial/accounts?query=${encodeURIComponent(((lead as any).companyName3 || '').replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold inline-flex items-center gap-1">{((lead as any).companyName3 || '').replace(/^View company:\s*/i, '')}</a>) : '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Industry</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.industry3} onChange={(e) => setFormData({ ...formData, industry3: e.target.value })} placeholder="e.g. Software Development" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).industry3 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company Size</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.numberOfEmployees3} onChange={(e) => setFormData({ ...formData, numberOfEmployees3: e.target.value })} placeholder="e.g. 51-200 employees" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).numberOfEmployees3 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Founded</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.founded3} onChange={(e) => setFormData({ ...formData, founded3: e.target.value })} placeholder="e.g. 2011" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).founded3 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Headquarters</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="text" value={formData.headquarters3} onChange={(e) => setFormData({ ...formData, headquarters3: e.target.value })} placeholder="e.g. San Francisco, CA" className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).headquarters3 || '-'}</dd></div>
                                <div className="sm:col-span-1"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Website</dt><dd className="mt-1 text-sm text-blue-600">{isEditing ? (<input type="url" value={formData.website3} onChange={(e) => setFormData({ ...formData, website3: e.target.value })} placeholder="https://..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).website3 ? <a href={(lead as any).website3} target="_blank" className="hover:underline inline-flex items-center gap-1">Visit Web</a> : <span className="text-gray-900">-</span>}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">LinkedIn URL</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<input type="url" value={formData.companyLinkedinUrl3} onChange={(e) => setFormData({ ...formData, companyLinkedinUrl3: e.target.value })} placeholder="https://www.linkedin.com/company/..." className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm" />) : (lead as any).companyLinkedinUrl3 ? (<a href={(lead as any).companyLinkedinUrl3} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">View company LinkedIn</a>) : '-'}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description</dt><dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{isEditing ? (<textarea value={formData.companyDetails3} onChange={(e) => { setFormData({ ...formData, companyDetails3: e.target.value }); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm resize-none overflow-hidden" style={{ minHeight: '80px' }} />) : (lead as any).companyDetails3 ? (<div><p className={!descExpanded3 ? 'line-clamp-3' : ''}>{(lead as any).companyDetails3}</p>{(lead as any).companyDetails3.length > 200 && (<button type="button" onClick={() => setDescExpanded3(!descExpanded3)} className="mt-2 px-3 py-1 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">{descExpanded3 ? 'Show less' : 'Show more'}</button>)}</div>) : '-'}</dd></div>
                                <div className="sm:col-span-3"><dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Specialties</dt><dd className="mt-1 text-sm text-gray-900">{isEditing ? (<div className="flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-lg border border-gray-200 bg-white min-h-[42px]">{parseSpecialties(formData.specialties3 || '').map((chip, i) => (<span key={i} className="inline-flex items-center gap-1 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/10">{chip}<button type="button" onClick={() => removeSpecialty('specialties3', i)} className="text-cyan-500 hover:text-cyan-700 ml-0.5">×</button></span>))}<input type="text" value={specInput3} onChange={(e) => setSpecInput3(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSpecialty('specialties3', specInput3, setSpecInput3); } }} placeholder="Add..." className="flex-1 min-w-[60px] outline-none bg-transparent text-sm" /></div>) : (lead as any).specialties3 ? (<div className="flex flex-wrap gap-1.5">{parseSpecialties((lead as any).specialties3).map((spec, i) => (<span key={i} className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{spec}</span>))}</div>) : '-'}</dd></div>
                            </div>
                        </div>
                    )}

                    {/* + Add Related Account button - right aligned */}
                    {isEditing && visibleAccounts < 3 && (
                        <div className="px-6 pb-4 flex justify-end">
                            <button type="button" onClick={() => setVisibleAccounts(visibleAccounts + 1)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-gray-500 bg-white hover:bg-gray-50 border border-gray-200 transition-all">
                                + Add Related Account
                            </button>
                        </div>
                    )}
            </div>
        </div>
    );

    const documentsSection = (
        <>
        {/* ─── Documents (full width) ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-6 pb-5">
                    <div className="flex items-center gap-2 mb-4">
                        <FileText className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Documents</span>
                        <div className="h-px bg-gray-100 flex-1" />
                    </div>
                    
                    <p className="text-[11px] text-gray-400 mb-4 font-semibold uppercase tracking-wider">
                        Supported file formats: <span className="text-gray-500">.PDF & .DOC</span>
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* NDA BADGE */}
                        <div className="flex flex-col">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                NDA
                            </label>
                            <div className="space-y-2">
                                {parseAttachedFiles(formData.ndaUrl, "NDA Document").map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 transition-all hover:bg-blue-100/50">
                                        <FileText size={18} className="text-blue-500 flex-shrink-0" />
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors truncate">
                                                {file.name}
                                            </a>
                                            {file.date && (
                                                <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Uploaded {new Date(file.date).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNdaDeleteIndex(idx);
                                                setShowNdaRemoveConfirm(true);
                                            }}
                                            className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}

                                {parseAttachedFiles(formData.ndaUrl, "NDA Document").length < 4 && (
                                    <FileDropzone
                                        onFileSelect={(file) => handleDocumentUpload(file, 'nda')}
                                        isUploading={ndaUploading}
                                        label="Attach NDA"
                                        compact
                                        accept=".pdf,.doc,.docx"
                                    />
                                )}
                            </div>
                        </div>

                        {/* MSA BADGE */}
                        <div className="flex flex-col">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                MSA
                            </label>
                            <div className="space-y-2">
                                {parseAttachedFiles(formData.msaUrl, "MSA Document").map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 transition-all hover:bg-blue-100/50">
                                        <FileText size={18} className="text-blue-500 flex-shrink-0" />
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors truncate">
                                                {file.name}
                                            </a>
                                            {file.date && (
                                                <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Uploaded {new Date(file.date).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setMsaDeleteIndex(idx);
                                                setShowMsaRemoveConfirm(true);
                                            }}
                                            className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}

                                {parseAttachedFiles(formData.msaUrl, "MSA Document").length < 4 && (
                                    <FileDropzone
                                        onFileSelect={(file) => handleDocumentUpload(file, 'msa')}
                                        isUploading={msaUploading}
                                        label="Attach MSA"
                                        compact
                                        accept=".pdf,.doc,.docx"
                                    />
                                )}
                            </div>
                        </div>

                        {/* OTHER BADGE */}
                        <div className="flex flex-col">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                OTHER
                            </label>
                            <div className="space-y-2">
                                {parseAttachedFiles(formData.otherUrl, "Other Document").map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 transition-all hover:bg-blue-100/50">
                                        <FileText size={18} className="text-blue-500 flex-shrink-0" />
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors truncate">
                                                {file.name}
                                            </a>
                                            {file.date && (
                                                <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Uploaded {new Date(file.date).toLocaleDateString()}</span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOtherDeleteIndex(idx);
                                                setShowOtherRemoveConfirm(true);
                                            }}
                                            className="p-1.5 rounded-full hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}

                                {parseAttachedFiles(formData.otherUrl, "Other Document").length < 4 && (
                                    <FileDropzone
                                        onFileSelect={(file) => handleDocumentUpload(file, 'other')}
                                        isUploading={otherUploading}
                                        label="Attach Document"
                                        compact
                                        accept=".pdf,.doc,.docx"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );

    const followUpSection = (
        <>
            {/* Beautiful Follow Up Status Banners */}
            {formData.dueDate ? (
                <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3.5 shadow-sm transition-all duration-300">
                    <div className="p-2 bg-emerald-500 rounded-xl text-white shadow-sm shrink-0">
                        <CalendarCheck size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider" style={{ fontFamily: 'var(--font-montserrat)' }}>SCHEDULED FOLLOW-UP</h4>
                        <p className="text-[11px] text-emerald-700 font-medium mt-1 leading-normal" style={{ fontFamily: 'var(--font-lato)' }}>
                            Next contact scheduled for <span className="font-bold text-emerald-900">{new Date(formData.dueDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> ({formData.dueDateTimezone || 'GMT-3'}).
                        </p>
                    </div>
                </div>
            ) : (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3.5 shadow-sm transition-all duration-300">
                    <div className="p-2 bg-amber-500 rounded-xl text-white shadow-sm shrink-0">
                        <CalendarOff size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider" style={{ fontFamily: 'var(--font-montserrat)' }}>NO SCHEDULED FOLLOW-UP</h4>
                        <p className="text-[11px] text-amber-700 font-medium mt-1 leading-normal" style={{ fontFamily: 'var(--font-lato)' }}>
                            No upcoming contact scheduled for this record. Please select a date and time below to schedule the follow-up.
                        </p>
                    </div>
                </div>
            )}

        {/* ─── Follow Up ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-5 pb-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Calendar className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Follow Up</span>
                        <div className="h-px bg-gray-100 flex-1" />
                        {isEditing && isSaving && <span className="text-xs text-blue-600 animate-pulse">Saving...</span>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                        <div>
                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Next FU</dt>
                            <dd>
                                {isEditing ? (
                                    <input
                                        id="fu-date-input"
                                        type="datetime-local"
                                        value={formData.dueDate}
                                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                    />
                                ) : (
                                    <span className="text-sm text-gray-900 font-medium">
                                        {formData.dueDate ? new Date(formData.dueDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                    </span>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Timezone (GMT)</dt>
                            <dd>
                                {isEditing ? (
                                    <select
                                        value={formData.dueDateTimezone || "GMT-3"}
                                        onChange={(e) => setFormData({ ...formData, dueDateTimezone: e.target.value })}
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                    >
                                        {['GMT-12','GMT-11','GMT-10','GMT-9','GMT-8','GMT-7','GMT-6','GMT-5','GMT-4','GMT-3','GMT-2','GMT-1','GMT+0','GMT+1','GMT+2','GMT+3','GMT+4','GMT+5','GMT+5:30','GMT+6','GMT+7','GMT+8','GMT+9','GMT+9:30','GMT+10','GMT+11','GMT+12','GMT+13','GMT+14'].map(tz => (
                                            <option key={tz} value={tz}>{tz}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-sm text-gray-900 font-medium">{formData.dueDateTimezone || 'GMT-3'}</span>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Cycle Complete</dt>
                            <dd className="flex items-center h-[38px]">
                                {isEditing ? (
                                    <>
                                        <input
                                            type="checkbox"
                                            checked={formData.fuCycleComplete}
                                            onChange={(e) => setFormData({ ...formData, fuCycleComplete: e.target.checked })}
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                        <span className="ml-2 text-sm text-gray-700 font-medium">FU Cycle Complete</span>
                                    </>
                                ) : (
                                    <span className="text-sm text-gray-900 font-medium">{formData.fuCycleComplete ? 'Yes' : 'No'}</span>
                                )}
                            </dd>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );

    const communicationStatusSection = (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 pt-5 pb-4">
                <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Communication Status</span>
                    <div className="h-px bg-gray-100 flex-1" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                    <div className="col-span-2">
                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Rating</dt>
                        <dd>
                            {isEditing ? (
                                <select
                                    value={formData.communicationStatus || ""}
                                    onChange={(e) => setFormData({ ...formData, communicationStatus: e.target.value })}
                                    className="w-full max-w-md px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                >
                                    <option value="">— Select —</option>
                                    {COMMUNICATION_STATUS_OPTIONS.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-sm text-gray-900 font-medium">{formData.communicationStatus || '—'}</span>
                            )}
                        </dd>
                    </div>
                </div>
            </div>
        </div>
    );

    const campaignsSection = (
        <>
        {/* ─── Campaigns (full width) ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-6 pb-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Mail className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Campaigns</span>
                        {isSaving && <span className="text-xs text-blue-600 animate-pulse">Saving...</span>}
                    </div>

                    {/* Active Enrollments */}
                    {(lead.campaignEnrollments && lead.campaignEnrollments.length > 0) ? (
                        <div className="space-y-3">
                            {lead.campaignEnrollments.map((enrollment: any) => {
                                const totalSteps = enrollment.campaign?.steps?.length || 0;
                                return (
                                    <div key={enrollment.id} className={`rounded-lg border ${enrollment.isArchived ? 'border-dashed border-gray-200 bg-gray-50/50 opacity-80' : enrollment.isComplete ? 'border-green-200 bg-green-50/30' : enrollment.isActive ? 'border-blue-200 bg-blue-50/20' : 'border-gray-200 bg-gray-50/30'} p-4`}>
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-bold text-gray-800">{enrollment.campaign?.name}</span>
                                                {enrollment.isArchived ? (
                                                    enrollment.replyDetectedAt ? (
                                                        <span className="text-[10px] px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full font-bold border border-orange-100">Archived (Replied)</span>
                                                    ) : (
                                                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-bold border border-gray-200">Archived</span>
                                                    )
                                                ) : (
                                                    <>
                                                        {enrollment.campaign && !enrollment.campaign.isActive && !enrollment.isComplete && <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full font-bold border border-amber-200">Campaign Paused</span>}
                                                        {enrollment.isComplete && <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">Complete</span>}
                                                        {!enrollment.isActive && !enrollment.isComplete && enrollment.replyDetectedAt && <span className="text-[10px] px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full font-bold border border-orange-100">Auto-unenrolled</span>}
                                                        {!enrollment.isActive && !enrollment.isComplete && !enrollment.replyDetectedAt && <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-bold">Lead Paused</span>}
                                                    </>
                                                )}
                                            </div>
                                            {/* ─── Action Buttons (top-right) ─── */}
                                            <div className="flex items-center gap-2 ml-2 shrink-0">
                                                {!enrollment.isArchived && !enrollment.isComplete && (
                                                    <>

                                                    {/* Pause / Resume */}
                                                    {enrollment.isActive ? (
                                                        <button
                                                            onClick={async () => {
                                                                setIsSaving(true);
                                                                const { unenrollContact } = await import('@/app/actions/commercial/campaignEnrollment');
                                                                await unenrollContact(lead.id, enrollment.campaignId);
                                                                setIsSaving(false);
                                                                router.refresh();
                                                            }}
                                                            disabled={isSaving}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-orange-100 text-gray-500 hover:text-orange-700 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                                                            title="Pause campaign"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                                            Pause
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={async () => {
                                                                if (enrollment.replyDetectedAt) {
                                                                    setResumeTarget({ campaignId: enrollment.campaignId, campaignName: enrollment.campaign?.name || 'this campaign' });
                                                                    setShowResumeModal(true);
                                                                } else {
                                                                    setIsSaving(true);
                                                                    const { resumeEnrollment } = await import('@/app/actions/commercial/campaignEnrollment');
                                                                    await resumeEnrollment(lead.id, enrollment.campaignId);
                                                                    setIsSaving(false);
                                                                    router.refresh();
                                                                }
                                                            }}
                                                            disabled={isSaving}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-emerald-100 text-gray-500 hover:text-emerald-700 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
                                                            title="Resume campaign"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                                            Resume
                                                        </button>
                                                    )}
                                                    {/* Edit (only if no emails sent) */}
                                                    {enrollment.currentStep === 0 && enrollment.startDate && !enrollment.isComplete && (
                                                        <button
                                                            onClick={() => setEditingStartEnrollmentId(editingStartEnrollmentId === enrollment.id ? null : enrollment.id)}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${editingStartEnrollmentId === enrollment.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-700'}`}
                                                            title="Edit start date"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
                                                            Edit
                                                        </button>
                                                    )}
                                                    {/* Archive (if paused and not complete) */}
                                                    {!enrollment.isActive && !enrollment.isComplete && (
                                                        <button
                                                            onClick={() => {
                                                                setDeleteTarget({ campaignId: enrollment.campaignId, campaignName: enrollment.campaign?.name || 'this campaign' });
                                                                setShowDeleteModal(true);
                                                            }}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-orange-100 text-gray-500 hover:text-orange-700 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                                            title="Archive enrollment"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25-3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                                            Archive
                                                        </button>
                                                    )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {/* Horizontal Step Timeline */}
                                        {(() => {
                                            const stepsArr = enrollment.campaign?.steps || [];
                                            let currentProjDate = enrollment.startDate ? new Date(enrollment.startDate) : new Date();
                                            if (enrollment.currentStep > 0) {
                                                const lastLog = (enrollment.stepLogs || []).find((l: any) => l.step === enrollment.currentStep);
                                                if (lastLog?.sentAt) currentProjDate = new Date(lastLog.sentAt);
                                            }
                                            const projectedDates = new Map<number, Date>();
                                            for (let s = 1; s <= totalSteps; s++) {
                                                if (s <= enrollment.currentStep) continue;
                                                if (s === enrollment.currentStep + 1 && enrollment.isActive && enrollment.nextDueDate) {
                                                    currentProjDate = new Date(enrollment.nextDueDate);
                                                    projectedDates.set(s, currentProjDate);
                                                    continue;
                                                }
                                                const stepDef = stepsArr.find((cs: any) => cs.stepOrder === s);
                                                if (s > 1 && stepDef) {
                                                    const d = new Date(currentProjDate);
                                                    d.setDate(d.getDate() + (stepDef.delayDays || 0));
                                                    currentProjDate = d;
                                                }
                                                projectedDates.set(s, currentProjDate);
                                            }

                                            return (
                                                <div className="flex items-start gap-0 mt-2">
                                                    {Array.from({ length: totalSteps }, (_, i) => {
                                                        const stepNum = i + 1;
                                                        const isSent = stepNum <= enrollment.currentStep;
                                                        const isNext = stepNum === enrollment.currentStep + 1 && enrollment.isActive && !enrollment.isComplete;
                                                        const stepLog = (enrollment.stepLogs || []).find((l: any) => l.step === stepNum);
                                                        const sentDate = stepLog?.sentAt ? new Date(stepLog.sentAt) : null;
                                                        const projDate = projectedDates.get(stepNum);
                                                        return (
                                                            <div key={i} className="flex items-start">
                                                                <div className="flex flex-col items-center" style={{ minWidth: 64 }}>
                                                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                                                        isSent
                                                                            ? enrollment.isComplete ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'
                                                                            : isNext
                                                                                ? 'bg-blue-100 text-blue-600 border-2 border-blue-400'
                                                                                : 'bg-gray-100 text-gray-400'
                                                                    }`}>
                                                                        {isSent ? '✓' : `S${stepNum}`}
                                                                    </div>
                                                                    <span className={`text-[10px] mt-1.5 font-bold uppercase tracking-wider ${isSent ? 'text-blue-600' : isNext ? 'text-blue-500' : 'text-gray-400'}`}>
                                                                        Step {stepNum}
                                                                    </span>
                                                                    {isSent && sentDate && (
                                                                        <span className="text-[10px] text-gray-500 font-medium mt-0.5">
                                                                            {sentDate.toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                                                                        </span>
                                                                    )}
                                                                    {!isSent && projDate && (
                                                                        <span className={`text-[10px] font-medium mt-0.5 ${isNext ? 'text-blue-500' : 'text-gray-400'}`}>
                                                                            {projDate.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {i < totalSteps - 1 && (
                                                                    <div className={`w-8 h-0.5 mt-6 ${stepNum < enrollment.currentStep ? (enrollment.isComplete ? 'bg-green-400' : 'bg-blue-400') : 'bg-gray-200'}`} />
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                        {/* Start date: read-only text or editable date picker */}
                                        {enrollment.currentStep === 0 && enrollment.startDate && !enrollment.isComplete && (
                                            <div className="flex items-center gap-2 mt-4">
                                                {editingStartEnrollmentId === enrollment.id ? (
                                                    <>
                                                        <span className="text-sm text-gray-500 font-bold">📅 Starts:</span>
                                                        <input
                                                            type="date"
                                                            defaultValue={new Date(enrollment.startDate).toISOString().split('T')[0]}
                                                            min={new Date().toISOString().split('T')[0]}
                                                            onChange={async (e) => {
                                                                if (!e.target.value) return;
                                                                setIsSaving(true);
                                                                const { updateEnrollmentStartDate } = await import('@/app/actions/commercial/campaignEnrollment');
                                                                await updateEnrollmentStartDate(lead.id, enrollment.campaignId, e.target.value);
                                                                setIsSaving(false);
                                                                setEditingStartEnrollmentId(null);
                                                                router.refresh();
                                                            }}
                                                            className="text-sm px-2 py-1 border border-blue-300 rounded-md text-gray-700 font-bold bg-white focus:border-blue-500 outline-none cursor-pointer"
                                                            autoFocus
                                                        />
                                                    </>
                                                ) : (
                                                    <span className="text-sm text-gray-500 font-medium">
                                                        📅 Scheduled: {new Date(enrollment.startDate).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {enrollment.replyDetectedAt && (
                                            <p className="text-[10px] text-orange-500 mt-1 font-medium">
                                                Auto-unenrolled & archived on {new Date(enrollment.replyDetectedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })} — lead replied
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400">No campaigns enrolled.</p>
                    )}

                    {/* Enroll Button / Disabled Status Banner */}
                    {(lead.status === 'Unsubscribed' || lead.status === 'Disqualified') ? (
                        <div className="mt-4 p-3.5 bg-gray-100/80 border border-gray-200 rounded-lg flex items-center gap-3 text-xs text-gray-500 font-medium">
                            <CalendarOff className="w-4 h-4 text-gray-400 shrink-0" />
                            <span>Cannot enroll in campaigns because this contact is <strong className="text-gray-700">{lead.status}</strong>.</span>
                        </div>
                    ) : lead.availableCampaigns && lead.availableCampaigns.length > 0 && (
                        <div className="mt-4 space-y-3">
                            <select
                                className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 focus:border-blue-500 outline-none cursor-pointer"
                                value={enrollCampaignId}
                                onChange={(e) => { setEnrollCampaignId(e.target.value); setEnrollStartMode('immediate'); setEnrollScheduledDate(''); }}
                            >
                                <option value="">+ Enroll in Campaign...</option>
                                {lead.availableCampaigns.map((c: any) => (
                                    <option key={c.id} value={c.id}>{c.name} ({c._count?.steps || 0} steps) — {c.isActive ? '✅ Active' : '⏸ Paused'}</option>
                                ))}
                            </select>
                            {enrollCampaignId && (
                                <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 space-y-3">
                                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign Start</label>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                checked={enrollStartMode === 'immediate'}
                                                onChange={() => { setEnrollStartMode('immediate'); setEnrollScheduledDate(''); }}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm font-medium text-gray-700">Start Immediately</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                checked={enrollStartMode === 'scheduled'}
                                                onChange={() => setEnrollStartMode('scheduled')}
                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm font-medium text-gray-700">Schedule Start</span>
                                        </label>
                                    </div>
                                    {enrollStartMode === 'scheduled' && (
                                        <input
                                            type="date"
                                            value={enrollScheduledDate}
                                            onChange={(e) => setEnrollScheduledDate(e.target.value)}
                                            min={new Date().toISOString().split('T')[0]}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 focus:border-blue-500 outline-none"
                                        />
                                    )}
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setEnrollCampaignId(''); setEnrollStartMode('immediate'); setEnrollScheduledDate(''); }}
                                            className="px-3 py-1.5 bg-white text-gray-500 text-xs font-bold rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isSaving || (enrollStartMode === 'scheduled' && !enrollScheduledDate)}
                                            onClick={async () => {
                                                const campaignId = parseInt(enrollCampaignId);
                                                if (!campaignId) return;
                                                setIsSaving(true);
                                                setSaveError(null);

                                                // Auto-save form if currently editing to ensure campaigns use latest values
                                                if (isEditing) {
                                                    const saveRes = await updateContact(lead.id, formData);
                                                    if (!saveRes.success) {
                                                        setSaveError(saveRes.error || "Failed to auto-save changes before enrollment.");
                                                        setIsSaving(false);
                                                        return;
                                                    }
                                                    setIsEditing(false);
                                                }

                                                const { enrollContact } = await import('@/app/actions/commercial/campaignEnrollment');
                                                const startParam = enrollStartMode === 'scheduled' && enrollScheduledDate ? enrollScheduledDate : null;
                                                const res = await enrollContact(lead.id, campaignId, startParam);
                                                if (!res.success) {
                                                    setSaveError(res.error || "Failed to enroll contact into campaign.");
                                                    setIsSaving(false);
                                                    return;
                                                }
                                                setEnrollCampaignId('');
                                                setEnrollStartMode('immediate');
                                                setEnrollScheduledDate('');
                                                setIsSaving(false);
                                                router.refresh();
                                            }}
                                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                                        >
                                            {isSaving ? 'Enrolling...' : 'Confirm'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <ConfirmModal
                        isOpen={showResumeModal}
                        onClose={() => { setShowResumeModal(false); setResumeTarget(null); }}
                        onConfirm={async () => {
                            if (!resumeTarget) return;
                            setIsSaving(true);
                            setShowResumeModal(false);
                            const { resumeEnrollment } = await import('@/app/actions/commercial/campaignEnrollment');
                            await resumeEnrollment(lead.id, resumeTarget.campaignId);
                            setResumeTarget(null);
                            setIsSaving(false);
                            router.refresh();
                        }}
                        title="Resume Campaign"
                        description={`This lead already replied to an email from "${resumeTarget?.campaignName || 'this campaign'}". Are you sure you want to resume sending automated follow-ups?`}
                        confirmLabel="Resume anyway"
                        cancelLabel="Cancel"
                        variant="warning"
                        isLoading={isSaving}
                    />
                    <ConfirmModal
                        isOpen={showDeleteModal}
                        onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
                        onConfirm={async () => {
                            if (!deleteTarget) return;
                            setIsSaving(true);
                            setShowDeleteModal(false);
                            const { archiveEnrollment } = await import('@/app/actions/commercial/campaignEnrollment');
                            await archiveEnrollment(lead.id, deleteTarget.campaignId);
                            setDeleteTarget(null);
                            setIsSaving(false);
                            router.refresh();
                        }}
                        title="Archive Campaign Enrollment"
                        description={`Are you sure you want to archive the enrollment in "${deleteTarget?.campaignName || 'this campaign'}"?`}
                        confirmLabel="Archive"
                        cancelLabel="Cancel"
                        variant="warning"
                        isLoading={isSaving}
                    />
                </div>
            </div>
        </>
    );

    // Related Opportunities = this Lead/Contact's own Opps (where they are the
    // source contact) PLUS the Opps of their Secondary Contacts. De-duplicated by id.
    const relatedOpportunities = (() => {
        const oppMap = new Map<number, any>();
        for (const o of (lead.opportunities || [])) {
            if (o) oppMap.set(o.id, o);
        }
        for (const sc of (lead.secondaryContacts || [])) {
            for (const o of (sc?.opportunities || [])) {
                if (o && !oppMap.has(o.id)) oppMap.set(o.id, o);
            }
        }
        return Array.from(oppMap.values());
    })();

    const opportunitiesSection = (
        <>
        {/* ─── Related Opportunities (#10/#11 + G6) ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-5 pb-4">
                    <div className="flex items-center gap-2 mb-4">
                        <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Related Opportunities</span>
                        {relatedOpportunities.length > 0 && (
                            <span className="text-[10px] font-bold text-gray-400 ml-1">({relatedOpportunities.length})</span>
                        )}
                    </div>
                    {relatedOpportunities.length > 0 ? (
                        <div className="divide-y divide-gray-50">
                            {[...relatedOpportunities]
                                .sort((a: any, b: any) => {
                                    // Archived go last; within each group preserve createdAt order
                                    const aArch = a.isArchived ? 1 : 0;
                                    const bArch = b.isArchived ? 1 : 0;
                                    return aArch - bArch;
                                })
                                .map((opp: any) => {
                                const isWon = opp.stage === 'Closed Won';
                                const isLost = opp.stage === 'Closed Lost';
                                const isClosed = isWon || isLost;
                                const isOppArchived = opp.isArchived === true;
                                const stageBadgeClass = isWon
                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                                    : isLost
                                        ? 'bg-red-50 text-red-700 ring-red-600/20'
                                        : 'bg-blue-50 text-blue-700 ring-blue-700/10';
                                return (
                                    <div key={opp.id} className={clsx("py-2.5", isOppArchived && "opacity-60")}>
                                        <div className="flex justify-between items-start">
                                            <div className="min-w-0">
                                                <Link href={`/commercial/opportunities/${opp.id}`} className="text-sm font-bold text-gray-800 hover:text-blue-600 transition-colors">{opp.title}</Link>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${stageBadgeClass}`}>
                                                        {isWon && '🏆 '}{isLost && '❌ '}{opp.stage}
                                                    </span>
                                                    {isOppArchived && (
                                                        <span title={opp.archiveReason || 'Archived'} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 border border-gray-200">
                                                            Archived
                                                        </span>
                                                    )}
                                                    {opp.closeDate && (
                                                        <span className="text-[10px] text-gray-400">
                                                            {new Date(opp.closeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right ml-3 flex-shrink-0">
                                                <p className="text-sm font-semibold text-gray-900">{opp.amount ? `$${Number(opp.amount).toLocaleString()}` : '-'}</p>
                                            </div>
                                        </div>
                                        {/* G6: Show lostReason for lost deals */}
                                        {isLost && opp.lostReason && (
                                            <div className="mt-1.5 ml-0.5 text-xs text-red-600 flex items-start gap-1">
                                                <span className="font-semibold flex-shrink-0">Razón:</span>
                                                <span className="text-red-500">{opp.lostReason}</span>
                                            </div>
                                        )}
                                        {/* Show archive reason if archived */}
                                        {isOppArchived && opp.archiveReason && (
                                            <div className="mt-1.5 ml-0.5 text-xs text-gray-500 flex items-start gap-1">
                                                <span className="font-semibold flex-shrink-0">Archived:</span>
                                                <span className="text-gray-400 italic">{opp.archiveReason}</span>
                                            </div>
                                        )}
                                        {/* Show closedComments for any closed deal */}
                                        {isClosed && opp.closedComments && (
                                            <div className="mt-1 ml-0.5 text-xs text-gray-400 italic truncate" title={opp.closedComments}>
                                                {opp.closedComments}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center text-xs text-gray-400 py-4 border-2 border-dashed border-gray-200 rounded-lg">
                            No opportunities for this contact or its secondary contacts.
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    const leadAiSummaryText = (() => {
        const isContact = source === 'contacts' || lead.type === 'CONTACT';
        const personType = isContact ? 'Contact' : 'Lead';
        const name = formData.fullName || lead.fullName || `${formData.firstName || ''} ${lead.lastName || ''}`.trim() || 'This key contact';
        const title = formData.title || lead.title;
        const company = (lead.account?.name || lead.companyName || formData.companyName || '').replace(/^View company:\s*/i, '');
        const status = formData.status || lead.status || 'New';
        const rating = lead.rating || formData.rating;
        const ownerName = users.find((u: any) => u.id === (formData.ownerId || lead.ownerId))?.name || lead.owner?.name;
        const leadSource = lead.source || formData.source;
        const leadDesc = lead.description || formData.companyDetails || lead.companyDetails;

        // 1. Person Overview
        let text = `**${name}** is a **${status}** ${personType.toLowerCase()}${title ? ` acting as **${title}**` : ''}${company ? ` at **${company}**` : ''}. `;
        
        if (ownerName) {
            text += `Managed directly by **${ownerName}**${rating ? ` with a **${rating}** engagement rating` : ''}${leadSource ? ` (sourced via ${leadSource})` : ''}. `;
        } else if (leadSource) {
            text += `Sourced via **${leadSource}**${rating ? ` with a **${rating}** rating` : ''}. `;
        }

        // 2. Key Context / Background
        if (leadDesc && leadDesc.trim().length > 5) {
            let cleanDesc = leadDesc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanDesc.length > 180) {
                cleanDesc = cleanDesc.substring(0, 180) + '...';
            }
            text += `**Context:** "${cleanDesc}". `;
        }

        // 3. Related Opportunities
        const opps = lead.opportunities || lead.account?.opportunities || [];
        const activeOpps = opps.filter((o: any) => !o.isArchived && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
        if (activeOpps.length > 0) {
            const topOpp = activeOpps[0];
            const formattedValue = (topOpp.amount || topOpp.value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(topOpp.amount || topOpp.value)) : '';
            text += `Associated with active opportunity **"${topOpp.title || topOpp.name}"** (${topOpp.stage || 'In Progress'}${formattedValue ? `, ${formattedValue}` : ''}). `;
        }

        // 4. Latest Touchpoint / Comment History
        const latestComment = notes && notes.length > 0 ? notes[0] : null;
        if (latestComment) {
            const cleanText = (latestComment.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const author = latestComment.author?.name || 'System';
            const date = new Date(latestComment.createdAt).toLocaleDateString();
            
            const cleanLower = cleanText.toLowerCase();
            let actions: string[] = [];
            
            if (cleanLower.includes('fu') || cleanLower.includes('follow up') || cleanLower.includes('follow-up')) {
                actions.push('commercial follow-up touchpoint');
            }
            if (cleanLower.includes('rate') || cleanLower.includes('pricing') || cleanLower.includes('fee')) {
                actions.push('pricing & rate discussions');
            }
            if (cleanLower.includes('contact') || cleanLower.includes('meeting') || cleanLower.includes('call')) {
                actions.push('direct stakeholder alignment call');
            }
            if (cleanLower.includes('candidate') || cleanLower.includes('profile') || cleanLower.includes('cv') || cleanLower.includes('recruit')) {
                actions.push('candidate profiles review');
            }
            if (cleanLower.includes('contract') || cleanLower.includes('nda') || cleanLower.includes('msa') || cleanLower.includes('agreement')) {
                actions.push('contractual / agreement terms review');
            }
            
            let commentSummary = "";
            if (actions.length > 0) {
                commentSummary = `**Latest Activity (${date} by ${author}):** Focus was on ${actions.join(' and ')}.`;
            } else if (cleanText) {
                let trimmedText = cleanText;
                if (trimmedText.length > 120) {
                    trimmedText = trimmedText.substring(0, 120) + '...';
                }
                commentSummary = `**Latest Activity (${date} by ${author}):** "${trimmedText}".`;
            }
            text += commentSummary;
        } else {
            text += "No recent comments or meeting notes recorded in history.";
        }

        // 5. Follow-up Status
        const fuDate = formData.dueDate || lead.dueDate;
        if (fuDate) {
            text += ` Next follow-up is scheduled for **${new Date(fuDate).toLocaleDateString()}**.`;
        }

        return text;
    })();

    const accountAiSummaryText = (() => {
        const accountName = (lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '') || 'Account';
        const accountType = lead.account?.type || 'Standard';
        const accountIndustry = lead.account?.industry || lead.industry || formData.industry || 'Technology / Software';

        let summaryText = `**${accountName}** is currently classified as a **${accountType}** account in the **${accountIndustry}** sector. `;

        const opps = lead.opportunities || lead.account?.opportunities || [];
        const activeOpps = opps.filter((o: any) => !o.isArchived && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
        const wonOpps = opps.filter((o: any) => !o.isArchived && o.stage === 'Closed Won');

        if (activeOpps.length > 0) {
            const topOpp = activeOpps[0];
            const formattedValue = (topOpp.amount || topOpp.value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(topOpp.amount || topOpp.value)) : 'undisclosed value';
            summaryText += `There is high commercial momentum with **${activeOpps.length} active opportunities** in progress. Most notably, **"${topOpp.title || topOpp.name}"** is in the **${topOpp.stage || 'Negotiation'}** stage with a pipeline value of **${formattedValue}**, representing a high-potential deal. `;
        } else {
            summaryText += "There are currently no active deals in the sales pipeline. ";
        }

        if (wonOpps.length > 0) {
            const topWon = wonOpps[0];
            const totalWonValue = wonOpps.reduce((sum: number, o: any) => sum + (Number(o.amount || o.value) || 0), 0);
            const formattedTotal = totalWonValue > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalWonValue) : '';
            summaryText += `The relationship has a strong foundation of success, with **${wonOpps.length} closed-won deals**${formattedTotal ? ` totaling **${formattedTotal}**` : ''}, including the **"${topWon.title || topWon.name}"** opportunity. `;
        }

        const latestComment = notes && notes.length > 0 ? notes[0] : null;
        if (latestComment) {
            const cleanText = (latestComment.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const author = latestComment.author?.name || 'System';
            const date = new Date(latestComment.createdAt).toLocaleDateString();
            
            const cleanLower = cleanText.toLowerCase();
            let actions: string[] = [];
            
            if (cleanLower.includes('fu') || cleanLower.includes('follow up') || cleanLower.includes('follow-up')) {
                actions.push('conducting a commercial follow-up');
            }
            if (cleanLower.includes('rate') || cleanLower.includes('pricing') || cleanLower.includes('fee')) {
                actions.push('adjusting staffing rates to be more competitive');
            }
            if (cleanLower.includes('contact') || cleanLower.includes('meeting') || cleanLower.includes('call')) {
                actions.push('aligning with key stakeholders');
            }
            if (cleanLower.includes('candidate') || cleanLower.includes('profile') || cleanLower.includes('cv') || cleanLower.includes('recruit')) {
                actions.push('evaluating strategic consultant profiles');
            }
            if (cleanLower.includes('onboard') || cleanLower.includes('start')) {
                actions.push('coordinating technical onboarding procedures');
            }
            if (cleanLower.includes('contract') || cleanLower.includes('nda') || cleanLower.includes('msa') || cleanLower.includes('agreement')) {
                actions.push('reviewing master service agreements and contract status');
            }
            
            let commentSummary = "";
            if (actions.length > 0) {
                if (actions.length === 1) {
                    commentSummary = `The latest account update (logged on ${date} by ${author}) indicates focus is currently on ${actions[0]}.`;
                } else if (actions.length === 2) {
                    commentSummary = `The latest update on ${date} by ${author} covers ${actions[0]} and ${actions[1]}.`;
                } else {
                    commentSummary = `On ${date}, ${author} logged an update covering ${actions[0]}, ${actions[1]}, as well as ${actions[2]}.`;
                }
            } else if (cleanText) {
                let trimmedText = cleanText.replace(/[\s\.\…]+$/, '').trim();
                const sentenceEnd = trimmedText.search(/[\.\!\?]/);
                if (sentenceEnd > 15 && sentenceEnd < 120) {
                    trimmedText = trimmedText.substring(0, sentenceEnd + 1);
                } else {
                    if (trimmedText.length > 100) {
                        let truncated = trimmedText.substring(0, 100);
                        const lastSpace = truncated.lastIndexOf(' ');
                        if (lastSpace > 50) {
                            truncated = truncated.substring(0, lastSpace);
                        }
                        trimmedText = truncated + " and related operational details";
                    }
                    if (!trimmedText.endsWith('.')) {
                        trimmedText += ".";
                    }
                }
                commentSummary = `The latest update on ${date} by ${author} notes that: ${trimmedText}`;
            }
            
            summaryText += commentSummary;
        } else {
            summaryText += "No general comments or meeting minutes have been recorded recently.";
        }

        return summaryText;
    })();

    const aiRecommendations = (() => {
        const recs = [];
        if (!formData.dueDate && !lead.dueDate) {
            recs.push({
                icon: "⚠️",
                title: "Next touch missing",
                desc: "This record has no upcoming follow-up planned. It is highly recommended to schedule a follow-up touchpoint."
            });
        } else {
            const dateVal = formData.dueDate || lead.dueDate;
            recs.push({
                icon: "📅",
                title: "Upcoming touchpoint",
                desc: `A follow-up is scheduled for ${new Date(dateVal).toLocaleDateString()}. Ensure discussion agendas are prepared.`
            });
        }

        const opps = lead.opportunities || lead.account?.opportunities || [];
        const activeOpps = opps.filter((o: any) => !o.isArchived && o.stage !== 'Closed Won' && o.stage !== 'Closed Lost');
        if (activeOpps.length > 0) {
            recs.push({
                icon: "🚀",
                title: "Deal acceleration",
                desc: "Focus on driving active pipeline opportunities to the next stage by verifying decision-makers and next steps."
            });
        }
        return recs;
    })();

    const widgetTitle = activeTab === 'account' 
        ? 'Account AI Resume' 
        : (source === 'contacts' || lead.type === 'CONTACT' ? 'Contact AI Resume' : 'Lead AI Resume');

    const summaryTextToRender = activeTab === 'account' ? accountAiSummaryText : leadAiSummaryText;

    const accountAiResumeWidget = (
        <div className="bg-white rounded-lg border border-gray-100 overflow-hidden relative shadow-sm">
            <div className="h-1 bg-gradient-to-r from-sky-400 to-blue-500" />
            
            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-50 text-blue-500 rounded-lg animate-pulse">
                            <Sparkles size={14} />
                        </div>
                        <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest" style={{ fontFamily: 'var(--font-lato)' }}>{widgetTitle}</span>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="text-xs text-gray-600 leading-relaxed font-medium" style={{ fontFamily: 'var(--font-lato)' }}>
                        {summaryTextToRender.split('**').map((chunk, i) => {
                            if (i % 2 === 1) {
                                return <strong key={i} className="font-bold text-gray-900">{chunk}</strong>;
                            }
                            if (chunk.startsWith(' *') || chunk.startsWith('*') || chunk.includes('*"')) {
                                return <em key={i} className="italic text-gray-800">{chunk.replace(/\*/g, '')}</em>;
                            }
                            return chunk;
                        })}
                    </div>

                    {activeTab === 'account' && (
                        <>
                            <div className="h-px bg-gray-50" />
                            <div>
                                <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest block mb-3" style={{ fontFamily: 'var(--font-lato)' }}>AI Strategic Insights</span>
                                <div className="space-y-3">
                                    {aiRecommendations.map((rec, i) => (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <span className="text-sm select-none mt-0.5">{rec.icon}</span>
                                            <div className="min-w-0 flex-1">
                                                <h5 className="text-[10px] font-bold text-gray-800 uppercase tracking-wider leading-none" style={{ fontFamily: 'var(--font-lato)' }}>{rec.title}</h5>
                                                <p className="text-[11px] text-gray-500 mt-1 leading-normal" style={{ fontFamily: 'var(--font-lato)' }}>{rec.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    <div className="pt-2 text-[9px] text-gray-400 font-bold uppercase tracking-widest border-t border-gray-50 flex items-center justify-between" style={{ fontFamily: 'var(--font-lato)' }}>
                        <span>AI Engine v2.4</span>
                        <span>Refreshed Real-Time</span>
                    </div>
                </div>
            </div>
        </div>
    );

    // Hide entirely when there is nothing to summarize (no notes / empty brief).
    const historyBriefSection = (briefLoaded && !briefLoading && briefPeriods.length === 0) ? null : (
        <div className="bg-gradient-to-br from-indigo-50/50 to-purple-50/30 rounded-lg border border-indigo-100/80 overflow-hidden mb-6 shadow-sm">
            <div className="px-6 pt-5 pb-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className={clsx("h-4 w-4 text-indigo-500", briefLoading && "animate-pulse")} />
                        <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">AI History Brief</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider border border-indigo-100/50 flex items-center gap-1">
                            <Sparkles size={10} /> Auto-generated
                        </span>
                        {!briefLoading && (
                            <button
                                type="button"
                                onClick={() => loadHistoryBrief(true)}
                                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600 uppercase tracking-wider"
                                title="Regenerate from latest notes"
                            >
                                ↻ Refresh
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-xs text-gray-500 mb-4 leading-relaxed font-semibold">
                    Here is a chronological executive summary of all comments and notes logged for this contact:
                </p>

                {briefLoading ? (
                    <div className="space-y-3 animate-pulse">
                        <div className="h-3 w-1/3 bg-indigo-100 rounded" />
                        <div className="h-3 w-5/6 bg-indigo-50 rounded" />
                        <div className="h-3 w-2/3 bg-indigo-50 rounded" />
                    </div>
                ) : (
                    <div className="relative pl-6 border-l border-indigo-100 space-y-4">
                        {briefPeriods.map((period, i) => (
                            <div className="relative" key={i}>
                                <div className="absolute -left-[29px] top-1 w-2 h-2 rounded-full bg-indigo-400 border border-white"></div>
                                {period.label && (
                                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{period.label}</span>
                                )}
                                <p className="text-xs text-gray-600 mt-1 font-medium leading-relaxed">{period.summary}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );


    const activitySection = (
        <>
        {/* ─── Activity ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-6 pb-5">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded bg-blue-50 text-blue-500 flex items-center justify-center">
                            <CheckSquare size={12} />
                        </div>
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Activity</span>
                        <div className="h-px bg-gray-100 flex-1" />
                    </div>
                    <div>
                        <ActivityTimeline
                            activities={activities}
                            entityId={lead.id}
                            entityType="contact"
                            isLoggingProp={isLoggingActivity}
                            onSetLogging={setIsLoggingActivity}
                        />
                    </div>
                </div>
            </div>
        </>
    );

    const historySection = (
        <>
        {/* ─── History (full width) ─── */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 pt-6 pb-5">
                    <div className="flex items-center gap-2 mb-4">
                        <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">History</span>
                        <div className="h-px bg-gray-100 flex-1" />
                    </div>

                    {/* Add new comment */}
                    <div className="mb-4">
                        <RichTextEditor value={newNote} onChange={setNewNote} placeholder="Add a note..." minHeight="60px" />
                        <div className="flex justify-end items-center gap-3 mt-2">
                            {newNote.trim() && newNote !== '<br>' && newNote.replace(/<[^>]*>/g, '').trim() && (
                                <button onClick={() => setNewNote('')} className="px-4 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-all">Cancel</button>
                            )}
                            <button onClick={handleAddNote} disabled={!newNote.replace(/<[^>]*>/g, '').trim() || isSubmittingNote} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed">Save Comment</button>
                        </div>
                    </div>

                    {/* Comments list - timeline style (editable, mirrors HR General Comments + Accounts) */}
                    {notes.length > 0 && (
                        <div className="relative pl-6 border-l border-blue-100 space-y-6 mt-4">
                            {notes.map((note: any) => {
                                return (
                                    <div key={note.id} className="relative group">
                                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full bg-blue-400 border border-white"></div>
                                        {editingNoteId === note.id ? (
                                            <div className="pb-2 space-y-3">
                                                <RichTextEditor value={editNoteContent} onChange={setEditNoteContent} placeholder="Edit comment..." minHeight="60px" />
                                                <div className="flex justify-end gap-2">
                                                    <button type="button" onClick={() => { setEditingNoteId(null); setEditNoteContent(''); }} className="px-4 py-1.5 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">Cancel</button>
                                                    <button type="button" onClick={() => handleUpdateNote(note.id)} className="px-4 py-1.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Save</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-montserrat)' }}>
                                                        <span className="text-sky-500 font-bold">
                                                            {new Date(note.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()}
                                                        </span>
                                                        <span className="text-gray-400"> • </span>
                                                        <span className="text-gray-900 font-bold">
                                                            BY {note.author?.name || (note.source === 'LinkedIn Extension' ? 'MyCompany Extension' : 'System')}
                                                        </span>
                                                    </span>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button
                                                            type="button"
                                                            onClick={() => guardEdit(() => { setEditingNoteId(note.id); setEditNoteContent(note.content); })}
                                                            className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                                                            title="Edit comment"
                                                        ><Edit size={13} /></button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteNote(note.id)}
                                                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                            title="Delete comment"
                                                        ><Trash2 size={13} /></button>
                                                    </div>
                                                </div>
                                                <CollapsibleComment
                                                    content={note.content}
                                                    className="text-xs text-gray-600 mt-1 leading-relaxed max-w-full"
                                                    style={{ fontFamily: 'var(--font-lato)' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                </div>
            </div>
        </>
    );

    const systemTimelineSection = (
        <>
        {/* ─── Timeline: System Information ─── */}
            <SystemLogTimeline entityType={lead.type === 'CLIENT_CONTACT' || lead.type === 'FORMER_CLIENT_CONTACT' ? 'contact' : 'lead'} entityId={lead.id} additionalEntityTypes={['lead', 'contact']} />
            <div className="bg-white rounded-lg border border-gray-200 px-6 py-4 mb-6 -mt-2">
                <div className="grid grid-cols-2 gap-x-6">
                    <div>
                        <dt className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Created By</dt>
                        <dd className="mt-1 text-sm text-gray-900">{lead.owner?.name || (lead.source === 'LinkedIn Extension' ? 'MyCompany Extension' : 'System')}, {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</dd>
                    </div>
                    <div>
                        <dt className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Last Modified By</dt>
                        <dd className="mt-1 text-sm text-gray-900">{lead.lastModifiedBy || 'System'}, {new Date(lead.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</dd>
                    </div>
                </div>
            </div>
        </>
    );

    const deleteButtonSection = (
        <div className="bg-red-50/30 border border-red-100 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-8">
            <div className="min-w-0">
                <p className="text-xs text-red-600/80 font-semibold leading-relaxed" style={{ fontFamily: 'var(--font-lato)' }}>
                    This will permanently remove <span className="font-bold">{lead.fullName}</span> and all associated activities. Cannot be undone.
                </p>
            </div>
            <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex-shrink-0"
                style={{ fontFamily: 'var(--font-lato)' }}
            >
                <Trash2 size={13} /> Delete {srcStr === 'contacts' ? 'Contact' : 'Lead'}
            </button>
        </div>
    );


    return (
        <div className="flex-1 overflow-auto bg-gray-50/50 min-h-screen">
            <div className={clsx("mx-auto px-4 py-4 transition-all", isRedesignedActive ? "max-w-[1280px]" : "max-w-4xl")}>

                {isRedesignedActive ? (
                    /* Redesigned Integrated White Header and Navigation */
                    <div className="bg-white border-b border-gray-200 -mx-4 -mt-4 px-6 pt-5 pb-0 mb-6">
                        {/* Back Link */}
                        <div className="mb-3">
                            <Link
                                href={(srcStr as any) === 'contacts' ? '/commercial/contacts' : '/commercial/leads'}
                                className="inline-flex items-center text-xs text-gray-400 hover:text-gray-500 transition-colors font-semibold"
                            >
                                ← {(srcStr as any) === 'contacts' ? 'Contacts' : 'Leads'}
                            </Link>
                        </div>

                        {lead.isArchived && (
                            <ArchivedBanner
                                reason={lead.archiveReason}
                                archivedAt={lead.archivedAt}
                                archivedBy={lead.archivedBy}
                                onRestore={handleRestoreLead}
                                onPermanentDelete={handlePermanentDeleteLead}
                            />
                        )}

                        {!lead.isArchived && (
                            <PreviouslyArchivedNote archiveReason={lead.archiveReason} />
                        )}

                        {isEditing && saveError && (
                            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{saveError}</div>
                        )}

                        {/* Main Header Content */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 gap-4">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-bold border border-blue-100 uppercase flex-shrink-0">
                                    {(lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'L').split(' ').filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2)}
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-gray-800 tracking-tight flex items-center gap-2 flex-wrap" style={{ fontFamily: 'var(--font-montserrat)' }}>
                                        <span>{lead.fullName || lead.firstName || 'Unknown Lead'}</span>
                                        {(lead.type === 'FORMER_CLIENT_CONTACT' || lead.type === 'FORMER_LEAD') && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide bg-slate-100 text-slate-600 border border-slate-300 flex-shrink-0">
                                                Former
                                            </span>
                                        )}
                                    </h1>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 font-medium">
                                        {lead.title && <span>{lead.title}</span>}
                                        {lead.title && (lead.companyName || lead.account?.name) && <span className="text-gray-300">•</span>}
                                        {(lead.companyName || lead.account?.name) && (
                                            <a
                                                href={(lead.companyId || lead.account?.id) ? `/commercial/accounts/${lead.companyId || lead.account?.id}` : `/commercial/accounts?query=${encodeURIComponent((lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, ''))}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline inline-flex items-center gap-1 font-semibold"
                                            >
                                                {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                            </a>
                                        )}
                                        {(lead.title || lead.companyName || lead.account?.name) && <span className="text-gray-300">•</span>}
                                        <span>Owner: {lead.owner?.name || 'System'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {isEditing ? (
                                    <>
                                        <button
                                            onClick={handleCancelEdit}
                                            disabled={isSaving}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 transition-all"
                                            style={{ fontFamily: 'var(--font-lato)' }}
                                        >
                                            <X size={14} /> Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveLead}
                                            disabled={isSaving || !hasChanges}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                                            style={{ fontFamily: 'var(--font-lato)' }}
                                        >
                                            <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {(srcStr as any) !== 'contacts' && (
                                            <button
                                                onClick={() => setIsConvertConfirmOpen(true)}
                                                disabled={isConverting}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-all"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <ArrowUpRight size={14} /> Convert to Account
                                            </button>
                                        )}
                                        <Link
                                            href={`/commercial/opportunities/new?sourceContactId=${lead.id}&contactName=${encodeURIComponent(lead.fullName || '')}&companyName=${encodeURIComponent(lead.companyName || '')}`}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-all"
                                            style={{ fontFamily: 'var(--font-lato)' }}
                                        >
                                            <Plus size={14} /> Create Opportunity
                                        </Link>
                                        <button
                                            onClick={requestEdit}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all"
                                            style={{ fontFamily: 'var(--font-lato)' }}
                                        >
                                            <Edit size={14} /> Edit Profile
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Simple Left-Aligned Text Tabs */}
                        <div className="flex gap-8 border-t border-gray-100 mt-2">
                            {[
                                { id: 'contact', label: 'Contact & Details' },
                                { id: 'followup', label: 'Follow-up' },
                                { id: 'activity', label: 'Activity & History' },
                                { id: 'account', label: 'Related Account' },
                                { id: 'docs', label: 'Documents' },
                            ].map((tab) => {
                                const isActive = activeTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTab(tab.id)}
                                        className={clsx(
                                            "py-3.5 text-xs font-bold transition-all relative border-b-2 -mb-[2px]",
                                            isActive 
                                                ? "text-blue-600 border-blue-600 font-bold" 
                                                : "text-gray-500 hover:text-gray-900 border-transparent hover:border-gray-200"
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    /* Original Layout Header */
                    <>
                        {/* Back Link */}
                        <div className="mb-0.5">
                            <Link
                                href={srcStr === 'contacts' ? '/commercial/contacts' : '/commercial/leads'}
                                className="inline-flex items-center text-xs text-gray-400 hover:text-gray-500 transition-colors"
                            >
                                ← {srcStr === 'contacts' ? 'Contacts' : 'Leads'}
                            </Link>
                        </div>

                        {lead.isArchived && (
                            <ArchivedBanner
                                reason={lead.archiveReason}
                                archivedAt={lead.archivedAt}
                                archivedBy={lead.archivedBy}
                                onRestore={handleRestoreLead}
                                onPermanentDelete={handlePermanentDeleteLead}
                            />
                        )}

                        {!lead.isArchived && (
                            <PreviouslyArchivedNote archiveReason={lead.archiveReason} />
                        )}

                        {/* ─── Header ─── */}
                        <div className="pb-3 mb-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h1 className="text-xl font-bold text-gray-800 tracking-tight" style={{ fontFamily: 'var(--font-montserrat)' }}>
                                        {lead.fullName || lead.firstName || 'Unknown Lead'}
                                    </h1>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        {(lead.companyName || lead.account?.name) && (
                                            <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
                                                <Building2 className="h-3.5 w-3.5 text-blue-400" />
                                                <a
                                                    href={(lead.companyId || lead.account?.id) ? `/commercial/accounts/${lead.companyId || lead.account?.id}` : `/commercial/accounts?query=${encodeURIComponent((lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, ''))}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 hover:text-blue-700 hover:underline font-medium inline-flex items-center gap-1"
                                                >
                                                    {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                                </a>
                                            </span>
                                        )}
                                        {lead.owner?.name && (
                                            <span className="text-xs text-gray-400">Owner: {lead.owner.name}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                    {isEditing ? (
                                        <>
                                            <button
                                                onClick={handleCancelEdit}
                                                disabled={isSaving}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <X size={16} /> Cancel
                                            </button>
                                            <button
                                                onClick={handleSaveLead}
                                                disabled={isSaving || !hasChanges}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all disabled:opacity-50"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            {source !== 'contacts' && (
                                            <button
                                                onClick={() => setIsConvertConfirmOpen(true)}
                                                disabled={isConverting}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-all disabled:opacity-50"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <ArrowUpRight size={16} /> {isConverting ? 'Converting...' : 'Convert to Account'}
                                            </button>
                                            )}
                                            {source === 'contacts' && (
                                            <button
                                                onClick={() => setIsRevertToLeadConfirmOpen(true)}
                                                disabled={isRevertingToLead}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all disabled:opacity-50"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <ArrowLeft size={16} /> {isRevertingToLead ? 'Converting...' : 'Convert to Lead'}
                                            </button>
                                            )}
                                            <Link
                                                href={`/commercial/opportunities/new?sourceContactId=${lead.id}&contactName=${encodeURIComponent(lead.fullName || '')}&companyName=${encodeURIComponent(lead.companyName || '')}`}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                Create Opportunity
                                            </Link>
                                            <button
                                                onClick={requestEdit}
                                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all bg-blue-600 text-white hover:bg-blue-700"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                <Edit size={16} /> Edit Profile
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}
                {isRedesignedActive ? (
                    <div className={`grid gap-6 items-start mt-4 ${activeTab === 'activity' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_340px]'}`}>
                        
                        {/* ══════════ MAIN COLUMN (col-main) ══════════ */}
                        <div className={`space-y-6 ${activeTab === 'activity' ? 'col-span-full' : 'col-start-1 col-end-2'}`}>
                            {activeTab === 'followup' && (
                                <div className="space-y-6">
                                    {followUpSection}
                                    {communicationStatusSection}
                                    {campaignsSection}
                                </div>
                            )}
                            {activeTab === 'contact' && (
                                <div className="space-y-6">
                                    {/* ── MAIN INFO ── */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <User className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Main Info</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">


                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Owner
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900 flex items-center gap-2">
                                    {isEditing ? (
                                        <select
                                            value={formData.ownerId}
                                            onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="">Select Owner</option>
                                            {users.map((user: any) => (
                                                <option key={user.id} value={user.id}>
                                                    {user.name}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        lead.owner ? lead.owner.name : '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</dt>
                                <dd className="mt-1">
                                    {isEditing ? (
                                        <>
                                        <select
                                            value={formData.status}
                                            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="New">New</option>
                                            <option value="Unsubscribed">Unsubscribed</option>
                                            <option value="Qualified">Qualified</option>
                                        </select>
                                        {/* G13: Disqualification reason */}
                                        {formData.status === 'Unsubscribed' && (
                                            <input
                                                type="text"
                                                value={formData.disqualificationReason || ''}
                                                onChange={(e) => setFormData({ ...formData, disqualificationReason: e.target.value })}
                                                className="w-full px-3 py-2 mt-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                                placeholder="Reason for unsubscribing..."
                                            />
                                        )}
                                        </>
                                    ) : (
                                        <span className="text-sm text-gray-900 font-sans">
                                            {(lead.status === 'Unsubscribed' || lead.status === 'Disqualified') ? 'Unsubscribed' : (lead.status || 'New')}
                                            {(lead.status === 'Unsubscribed' || lead.status === 'Disqualified') && lead.disqualificationReason && (
                                                <span className="ml-1 text-gray-400 font-normal">— {lead.disqualificationReason}</span>
                                            )}
                                        </span>
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Type</dt>
                                <dd className="mt-1">
                                    {isEditing ? (
                                        <select
                                            value={formData.type}
                                            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="LEAD">Lead</option>
                                            <option value="CLIENT_CONTACT">Client Contact</option>
                                            <option value="FORMER_CLIENT_CONTACT">Former Client Contact</option>
                                        </select>
                                    ) : (
                                        <span className="text-sm text-gray-900 font-sans">
                                            {lead.type === 'CLIENT_CONTACT' ? 'Client Contact' : lead.type === 'FORMER_CLIENT_CONTACT' ? 'Former Client Contact' : 'Lead'}
                                        </span>
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">First Name</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.firstName}
                                            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.firstName
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Full Name</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.fullName}
                                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.fullName
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.companyName}
                                            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                                            placeholder={lead.account ? "Linked to Account (Read Only)" : "Company Name"}
                                            disabled={!!lead.account}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm disabled:bg-gray-100 disabled:text-gray-500"
                                        />
                                    ) : (lead.companyId || lead.account?.id) ? (
                                        <a href={`/commercial/accounts/${lead.companyId || lead.account?.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 hover:underline font-medium inline-flex items-center gap-1">
                                            {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                        </a>
                                    ) : (lead.companyName || lead.account?.name) ? (
                                        <a href={`/commercial/accounts?query=${encodeURIComponent((lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 hover:underline font-medium inline-flex items-center gap-1">
                                            {(lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, '')}
                                        </a>
                                    ) : '-'}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Title</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.title || '-'
                                    )}
                                </dd>
                            </div>

                            {/* Rating + Source: Lead-only concepts, hidden in the Contact view (data preserved). */}
                            {source !== 'contacts' && (
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rating</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <select
                                            value={formData.rating}
                                            onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="">-- None --</option>
                                            <option value="Hot">Hot</option>
                                            <option value="Warm">Warm</option>
                                            <option value="Cold">Cold</option>
                                        </select>
                                    ) : (
                                        lead.rating || '-'
                                    )}
                                </dd>
                            </div>
                            )}


                            {source !== 'contacts' && (
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Source</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <select
                                            value={formData.source}
                                            onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="Sendy DB">Sendy DB</option>
                                            <option value="LeadCandy">LeadCandy</option>
                                            <option value="Scraping-LinkedIn">Scraping-LinkedIn</option>
                                            <option value="Client Referral">Client Referral</option>
                                            <option value="Web">Web</option>
                                            <option value="MSP">MSP</option>
                                            <option value="Scraping-Snov">Scraping-Snov</option>
                                            <option value="LinkedIn Extension">LinkedIn Extension</option>
                                        </select>
                                    ) : (
                                        lead.source || '-'
                                    )}
                                </dd>
                            </div>
                            )}

                        </div>
                    </div>


                    {/* ── CONTACT & TRACKING ── */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Mail className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Contact & Tracking</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Email
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.email || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Phone
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.phone || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Secondary Email</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="email"
                                            value={formData.secondaryEmail}
                                            onChange={(e) => setFormData({ ...formData, secondaryEmail: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.secondaryEmail || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">LinkedIn URL</dt>
                                <dd className="mt-1 text-sm text-blue-600">
                                    {isEditing ? (
                                        <input
                                            type="url"
                                            value={formData.linkedinUrl}
                                            onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.linkedinUrl ? <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">LinkedIn Profile</a> : '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-2">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Location</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="e.g. San Francisco, California"
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        (lead as any).location || '-'
                                    )}
                                </dd>
                            </div>
                        </div>
                    </div>

                    {/* ── SECONDARY CONTACTS (Leads only) ── */}
                    {source !== 'contacts' && (lead.type === 'LEAD' || !lead.type) && (
                        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                            <div className="px-6 pt-5 pb-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-blue-500" />
                                        <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Secondary Contacts</span>
                                        {lead.secondaryContacts && lead.secondaryContacts.length > 0 && (
                                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                                                {lead.secondaryContacts.length}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSecFirstName('');
                                            setSecLastName('');
                                            setSecTitle('');
                                            setSecEmail('');
                                            setSecPhone('');
                                            setSecLinkedinUrl('');
                                            setSecDescription('');
                                            setSecError(null);
                                            setShowAddSecModal(true);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-bold transition-all shadow-sm"
                                        style={{ fontFamily: 'var(--font-lato)' }}
                                    >
                                        <Plus size={14} /> Add Secondary Contact
                                    </button>
                                </div>

                                {/* Secondary Contacts List */}
                                {!lead.secondaryContacts || lead.secondaryContacts.length === 0 ? (
                                    <div className="text-center py-6 px-4 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                                        <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                        <p className="text-xs font-semibold text-gray-600">No secondary contacts registered</p>
                                        <p className="text-[11px] text-gray-400 mt-0.5">Add team members or extra contacts from the same company to keep a shared history.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {(isSecContactsExpanded ? lead.secondaryContacts : lead.secondaryContacts.slice(0, 5)).map((sec: any) => (
                                                <div key={sec.id} className="p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-200 hover:shadow-sm transition-all flex items-start gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 font-bold text-xs flex items-center justify-center shrink-0 border border-indigo-100">
                                                        {(sec.firstName?.[0] || sec.fullName?.[0] || 'S').toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        {/* Actions float right: name/title wrap around them and the contact
                                                            rows (clear-right) drop to full width underneath the buttons. */}
                                                        <div className="float-right ml-2 flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                title="Promote to Primary Contact"
                                                                onClick={() => {
                                                                    setPromoteSecTarget(sec);
                                                                    setShowPromoteSecModal(true);
                                                                }}
                                                                className="p-1.5 text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                                            >
                                                                <Sparkles size={14} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Edit Contact"
                                                                onClick={() => {
                                                                    setEditSecTarget(sec);
                                                                    setSecFirstName(sec.firstName || '');
                                                                    setSecLastName(sec.lastName || '');
                                                                    setSecTitle(sec.title || '');
                                                                    setSecEmail(sec.email || '');
                                                                    setSecPhone(sec.phone || '');
                                                                    setSecLinkedinUrl(sec.linkedinUrl || '');
                                                                    setSecDescription(sec.description || '');
                                                                    setSecError(null);
                                                                    setShowEditSecModal(true);
                                                                }}
                                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                            >
                                                                <Edit size={14} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                title="Delete Contact"
                                                                onClick={() => {
                                                                    setDeleteSecTarget(sec);
                                                                    setShowDeleteSecModal(true);
                                                                }}
                                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                        <div className="text-sm font-bold text-gray-900 break-words">{sec.fullName || sec.firstName}</div>
                                                        {/* clear-right: title starts below the floated buttons so it uses the
                                                            full width on one line instead of wrapping early around them. */}
                                                        {sec.title && <p className="text-xs text-gray-600 font-medium break-words mt-0.5 clear-right">{sec.title}</p>}
                                                        <div className="mt-2 space-y-1 text-xs text-gray-500 clear-right">
                                                            {sec.email && (
                                                                <div className="flex items-start gap-1.5">
                                                                    <Mail size={12} className="text-gray-400 shrink-0 mt-0.5" />
                                                                    <a href={`mailto:${sec.email}`} className="text-blue-600 hover:underline break-all">{sec.email}</a>
                                                                </div>
                                                            )}
                                                            {sec.phone && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Phone size={12} className="text-gray-400 shrink-0" />
                                                                    <span className="break-all">{sec.phone}</span>
                                                                </div>
                                                            )}
                                                            {sec.linkedinUrl && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Globe size={12} className="text-gray-400 shrink-0" />
                                                                    <a href={sec.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-0.5 text-[11px]">
                                                                        LinkedIn Profile <ExternalLink size={10} />
                                                                    </a>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {lead.secondaryContacts.length > 5 && (
                                            <button
                                                type="button"
                                                onClick={() => setIsSecContactsExpanded(!isSecContactsExpanded)}
                                                className="w-full py-2.5 px-4 text-xs font-semibold text-blue-500 hover:text-blue-700 hover:bg-blue-50/50 transition-colors flex items-center justify-center gap-1 rounded-lg border border-gray-100 shadow-sm"
                                                style={{ fontFamily: 'var(--font-lato)' }}
                                            >
                                                {isSecContactsExpanded ? (
                                                    <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
                                                ) : (
                                                    <><ChevronDown className="w-3.5 h-3.5" /> See all ({lead.secondaryContacts.length})</>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── UNIFIED CONTACT DESCRIPTION OR LEAD DESCRIPTION ── */}
                    {source === 'contacts' ? (
                        <div className="bg-white rounded-lg border border-gray-200 p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Description</span>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Left/Middle Columns: Fields */}
                                <div className={clsx("grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4", isEditing ? "lg:col-span-2" : "lg:col-span-3")}>
                                    <div>
                                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Buyer Role</dt>
                                        <dd className="mt-1 text-sm text-gray-900">
                                            {isEditing && (
                                                <select
                                                    value={formData.buyerRole}
                                                    onChange={(e) => setFormData({ ...formData, buyerRole: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm text-gray-700 font-semibold"
                                                >
                                                    <option value="">No Role Set</option>
                                                    <option value="champion">Champion</option>
                                                    <option value="influencer">Influencer</option>
                                                    <option value="key_decision_maker">Key Decision Maker</option>
                                                    <option value="blocker">Blocker</option>
                                                </select>
                                            )}
                                            {!isEditing && !formData.buyerRole && (
                                                <span className="text-gray-400">Not Set</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'champion' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20">🏆 Champion</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'influencer' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-purple-50 text-purple-700 ring-purple-600/20">🗣️ Influencer</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'key_decision_maker' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20">✍️ Key Decision Maker</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'blocker' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-red-50 text-red-700 ring-red-600/20">🛑 Blocker</span>
                                            )}
                                        </dd>
                                    </div>

                                    <div className="space-y-3">
                                        {/* Reports To 1 */}
                                        <div>
                                            <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                                Reports To {formData.reportsToId || (lead as any).reportsTo2 || formData.reportsToId2 ? '(Primary)' : ''}
                                            </dt>
                                            <dd className="mt-1 text-sm text-gray-900">
                                                {isEditing ? (
                                                    <AutocompleteInput
                                                        value={formData.reportsToId || null}
                                                        displayValue={reportsToName}
                                                        placeholder="Search primary superior..."
                                                        onSearch={async (q) => {
                                                            const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                            if (!res.success) return [];
                                                            return (res.data || []).map((c: any) => ({
                                                                id: c.id,
                                                                label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                                sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                            }));
                                                        }}
                                                        onSelect={(opt) => {
                                                            if (opt) {
                                                                setFormData({ ...formData, reportsToId: String(opt.id) });
                                                                setReportsToName(opt.label || '');
                                                            } else {
                                                                setFormData({ ...formData, reportsToId: '' });
                                                                setReportsToName('');
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    (lead as any).reportsTo ? (
                                                        <Link href={`/commercial/contacts/${(lead as any).reportsTo.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                            {(lead as any).reportsTo.fullName || `${(lead as any).reportsTo.firstName} ${(lead as any).reportsTo.lastName}`}
                                                            {(lead as any).reportsTo.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo.title}</span> : null}
                                                        </Link>
                                                    ) : '-'
                                                )}
                                            </dd>
                                        </div>

                                        {/* Reports To 2 */}
                                        {(isEditing ? (formData.reportsToId || formData.reportsToId2) : !!(lead as any).reportsTo2) && (
                                            <div>
                                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports To 2</dt>
                                                <dd className="mt-1 text-sm text-gray-900">
                                                    {isEditing ? (
                                                        <AutocompleteInput
                                                            value={formData.reportsToId2 || null}
                                                            displayValue={reportsToName2}
                                                            placeholder="Search second superior..."
                                                            onSearch={async (q) => {
                                                                const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                                if (!res.success) return [];
                                                                return (res.data || []).map((c: any) => ({
                                                                    id: c.id,
                                                                    label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                                    sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                                }));
                                                            }}
                                                            onSelect={(opt) => {
                                                                if (opt) {
                                                                    setFormData({ ...formData, reportsToId2: String(opt.id) });
                                                                    setReportsToName2(opt.label || '');
                                                                } else {
                                                                    setFormData({ ...formData, reportsToId2: '' });
                                                                    setReportsToName2('');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        (lead as any).reportsTo2 ? (
                                                            <Link href={`/commercial/contacts/${(lead as any).reportsTo2.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                                {(lead as any).reportsTo2.fullName || `${(lead as any).reportsTo2.firstName} ${(lead as any).reportsTo2.lastName}`}
                                                                {(lead as any).reportsTo2.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo2.title}</span> : null}
                                                            </Link>
                                                        ) : null
                                                    )}
                                                </dd>
                                            </div>
                                        )}

                                        {/* Reports To 3 */}
                                        {(isEditing ? (formData.reportsToId2 || formData.reportsToId3) : !!(lead as any).reportsTo3) && (
                                            <div>
                                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports To 3</dt>
                                                <dd className="mt-1 text-sm text-gray-900">
                                                    {isEditing ? (
                                                        <AutocompleteInput
                                                            value={formData.reportsToId3 || null}
                                                            displayValue={reportsToName3}
                                                            placeholder="Search third superior..."
                                                            onSearch={async (q) => {
                                                                const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                                if (!res.success) return [];
                                                                return (res.data || []).map((c: any) => ({
                                                                    id: c.id,
                                                                    label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                                    sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                                }));
                                                            }}
                                                            onSelect={(opt) => {
                                                                if (opt) {
                                                                    setFormData({ ...formData, reportsToId3: String(opt.id) });
                                                                    setReportsToName3(opt.label || '');
                                                                } else {
                                                                    setFormData({ ...formData, reportsToId3: '' });
                                                                    setReportsToName3('');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        (lead as any).reportsTo3 ? (
                                                            <Link href={`/commercial/contacts/${(lead as any).reportsTo3.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                                {(lead as any).reportsTo3.fullName || `${(lead as any).reportsTo3.firstName} ${(lead as any).reportsTo3.lastName}`}
                                                                {(lead as any).reportsTo3.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo3.title}</span> : null}
                                                            </Link>
                                                        ) : null
                                                    )}
                                                </dd>
                                            </div>
                                        )}

                                        {/* Reports To 4 */}
                                        {(isEditing ? (formData.reportsToId3 || formData.reportsToId4) : !!(lead as any).reportsTo4) && (
                                            <div>
                                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports To 4</dt>
                                                <dd className="mt-1 text-sm text-gray-900">
                                                    {isEditing ? (
                                                        <AutocompleteInput
                                                            value={formData.reportsToId4 || null}
                                                            displayValue={reportsToName4}
                                                            placeholder="Search fourth superior..."
                                                            onSearch={async (q) => {
                                                                const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                                if (!res.success) return [];
                                                                return (res.data || []).map((c: any) => ({
                                                                    id: c.id,
                                                                    label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                                    sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                                }));
                                                            }}
                                                            onSelect={(opt) => {
                                                                if (opt) {
                                                                    setFormData({ ...formData, reportsToId4: String(opt.id) });
                                                                    setReportsToName4(opt.label || '');
                                                                } else {
                                                                    setFormData({ ...formData, reportsToId4: '' });
                                                                    setReportsToName4('');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        (lead as any).reportsTo4 ? (
                                                            <Link href={`/commercial/contacts/${(lead as any).reportsTo4.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                                {(lead as any).reportsTo4.fullName || `${(lead as any).reportsTo4.firstName} ${(lead as any).reportsTo4.lastName}`}
                                                                {(lead as any).reportsTo4.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo4.title}</span> : null}
                                                            </Link>
                                                        ) : null
                                                    )}
                                                </dd>
                                            </div>
                                        )}

                                        {/* Reports To 5 */}
                                        {(isEditing ? (formData.reportsToId4 || formData.reportsToId5) : !!(lead as any).reportsTo5) && (
                                            <div>
                                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports To 5</dt>
                                                <dd className="mt-1 text-sm text-gray-900">
                                                    {isEditing ? (
                                                        <AutocompleteInput
                                                            value={formData.reportsToId5 || null}
                                                            displayValue={reportsToName5}
                                                            placeholder="Search fifth superior..."
                                                            onSearch={async (q) => {
                                                                const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                                if (!res.success) return [];
                                                                return (res.data || []).map((c: any) => ({
                                                                    id: c.id,
                                                                    label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                                    sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                                }));
                                                            }}
                                                            onSelect={(opt) => {
                                                                if (opt) {
                                                                    setFormData({ ...formData, reportsToId5: String(opt.id) });
                                                                    setReportsToName5(opt.label || '');
                                                                } else {
                                                                    setFormData({ ...formData, reportsToId5: '' });
                                                                    setReportsToName5('');
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        (lead as any).reportsTo5 ? (
                                                            <Link href={`/commercial/contacts/${(lead as any).reportsTo5.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                                {(lead as any).reportsTo5.fullName || `${(lead as any).reportsTo5.firstName} ${(lead as any).reportsTo5.lastName}`}
                                                                {(lead as any).reportsTo5.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo5.title}</span> : null}
                                                            </Link>
                                                        ) : null
                                                    )}
                                                </dd>
                                            </div>
                                        )}
                                    </div>

                                    <div className="col-span-1 sm:col-span-2">
                                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact Description</dt>
                                        <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                                            {isEditing ? (
                                                <textarea
                                                    value={formData.description}
                                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                    rows={4}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                                />
                                            ) : (
                                                lead.description || '-'
                                            )}
                                        </dd>
                                    </div>
                                </div>

                                {/* Right Column: Info Card (Shown only in Edit Mode) */}
                                {isEditing && (
                                    <div className="lg:col-span-1">
                                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3.5 text-xs">
                                            <h4 className="font-bold text-slate-800 tracking-wider uppercase text-[10px]">Buyer Personas</h4>
                                            <div className="space-y-3">
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-amber-700 text-xs font-bold">🏆</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Champion</p>
                                                        <p className="text-slate-500 mt-0.5">Pushes the deal internally and acts as an internal advocate.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-purple-100 text-purple-700 text-xs font-bold">🗣️</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Influencer</p>
                                                        <p className="text-slate-500 mt-0.5">Has a valued opinion but does not hold final decision power.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-green-100 text-green-700 text-xs font-bold">✍️</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Key Decision Maker</p>
                                                        <p className="text-slate-500 mt-0.5">Approves budget and signs the contract/purchase.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-100 text-red-700 text-xs font-bold">🛑</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Blocker</p>
                                                        <p className="text-slate-500 mt-0.5">Stops, slows down, or hinders the deal progress.</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg border border-gray-200 p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Description</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">

                                {/* Outsourcing: hidden in Contact view (intended to live on the Account per request). */}
                                <div className="sm:col-span-1">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outsourcing</dt>
                                    <dd className="mt-1 text-sm text-gray-900">
                                        {isEditing ? (
                                            <select
                                                value={formData.outsourcing}
                                                onChange={(e) => setFormData({ ...formData, outsourcing: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            >
                                                <option value="N/A">N/A</option>
                                                <option value="Yes">Yes</option>
                                                <option value="No">No</option>
                                            </select>
                                        ) : (
                                            lead.outsourcing || 'N/A'
                                        )}
                                    </dd>
                                </div>

                                <div className="col-span-2 md:col-span-3">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lead Description</dt>
                                    <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                                        {isEditing ? (
                                            <textarea
                                                value={formData.description}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                rows={3}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            />
                                        ) : (
                                            lead.description || '-'
                                        )}
                                    </dd>
                                </div>


                                {/* Technologies: hidden in Contact view (intended to live on the Account per request). */}
                                <div className="sm:col-span-1">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Technologies</dt>
                                    <dd className="mt-1 text-sm text-gray-900">
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={formData.technologies}
                                                onChange={(e) => setFormData({ ...formData, technologies: e.target.value })}
                                                placeholder="e.g. React, Node.js"
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            />
                                        ) : (
                                            lead.technologies ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {lead.technologies.split(/[,-]+/).map((tech: string, index: number) => {
                                                        const trimmed = tech.trim();
                                                        if (!trimmed) return null;
                                                        return (
                                                            <span key={index} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                                {trimmed}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            ) : '-'
                                        )}
                                    </dd>
                                </div>

                            </div>
                        </div>
                    )}

                    {/* ── RELATED ACCOUNT 1/2/3 + Add button ──
                        Hidden in the Contact view: company details already live on the Account profile.
                        Lead view keeps it visible to enrich the prospecting record. */}
                                </div>
                            )}
                            {activeTab === 'activity' && (
                                <div className="space-y-6">
                                    {historyBriefSection}
                                    {activitySection}
                                    {historySection}
                                    {systemTimelineSection}
                                </div>
                            )}
                            {activeTab === 'account' && relatedAccountsSection}
                            {activeTab === 'docs' && documentsSection}
                            
                            {/* Delete Button at the bottom of the main column */}
                            {activeTab === 'contact' && deleteButtonSection}
                        </div>

                        {/* ══════════ SIDE COLUMN (col-side) ══════════ */}
                        {activeTab !== 'activity' && (
                            <div className="space-y-6 sticky top-16 col-start-2 col-end-3">
                                {/* Lead / Contact / Account AI Resume Card at the VERY TOP */}
                                {(activeTab === 'contact' || activeTab === 'account') && accountAiResumeWidget}

                                {/* Compact Related Account card */}
                                {(lead.companyName || lead.account?.name) && activeTab !== 'account' && (
                                    <div className="bg-white rounded-lg border border-gray-200 p-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="h-4 w-4 text-blue-500" />
                                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Related Account</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <div>
                                                {(lead.companyId || lead.account?.id) ? (
                                                    <a href={`/commercial/accounts/${lead.companyId || lead.account?.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600 hover:underline inline-flex items-center gap-1.5 font-sans">
                                                        {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                                    </a>
                                                ) : (
                                                    <a href={`/commercial/accounts?query=${encodeURIComponent((lead.companyName || lead.account?.name || '').replace(/^View company:\s*/i, ''))}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600 hover:underline inline-flex items-center gap-1.5 font-sans">
                                                        {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                                    </a>
                                                )}
                                            </div>
                                            {formData.website && (
                                                <div>
                                                    <a href={formData.website.startsWith('http') ? formData.website : `https://${formData.website}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 font-medium font-sans">
                                                        {formData.website}
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {lead.campaignEnrollments && lead.campaignEnrollments.length > 0 && activeTab !== 'followup' && (
                                    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Mail className="h-4 w-4 text-blue-500" />
                                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Active Campaigns</span>
                                        </div>
                                        <div className="space-y-2">
                                            {lead.campaignEnrollments.map((e: any) => (
                                                <div key={e.id} className="p-2.5 bg-blue-50/50 rounded-lg border border-blue-100 flex items-center justify-between">
                                                    <div>
                                                        <p className="text-xs font-bold text-gray-800">{e.campaign?.name || 'Campaign'}</p>
                                                        <p className="text-[10px] text-gray-500 font-medium">
                                                            Step {e.currentStep} of {e.campaign?.steps?.length || 0} • {e.isComplete ? 'Complete' : e.isActive ? 'Active' : 'Paused'}
                                                        </p>
                                                    </div>
                                                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                                        e.isComplete ? 'bg-green-100 text-green-700' : e.isActive ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                                                    }`}>
                                                        {e.isComplete ? 'Finished' : e.isActive ? 'Running' : 'Paused'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {opportunitiesSection}
                            </div>
                        )}

                    </div>
                ) : (
                    <div className="space-y-6 mt-4">
                        {/* Original Sequential Layout */}
                        <div className="space-y-6 mb-6">
                            {/* ── MAIN INFO ── */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <User className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Main Info</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">


                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Owner
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900 flex items-center gap-2">
                                    {isEditing ? (
                                        <select
                                            value={formData.ownerId}
                                            onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="">Select Owner</option>
                                            {users.map((user: any) => (
                                                <option key={user.id} value={user.id}>
                                                    {user.name}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        lead.owner ? lead.owner.name : '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</dt>
                                <dd className="mt-1">
                                    {isEditing ? (
                                        <>
                                        <select
                                            value={formData.status}
                                            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="New">New</option>
                                            <option value="Unsubscribed">Unsubscribed</option>
                                            <option value="Qualified">Qualified</option>
                                        </select>
                                        {/* G13: Disqualification reason */}
                                        {formData.status === 'Unsubscribed' && (
                                            <input
                                                type="text"
                                                value={formData.disqualificationReason || ''}
                                                onChange={(e) => setFormData({ ...formData, disqualificationReason: e.target.value })}
                                                className="w-full px-3 py-2 mt-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                                placeholder="Reason for unsubscribing..."
                                            />
                                        )}
                                        </>
                                    ) : (
                                        <span className="text-sm text-gray-900 font-sans">
                                            {(lead.status === 'Unsubscribed' || lead.status === 'Disqualified') ? 'Unsubscribed' : (lead.status || 'New')}
                                            {(lead.status === 'Unsubscribed' || lead.status === 'Disqualified') && lead.disqualificationReason && (
                                                <span className="ml-1 text-gray-400 font-normal">— {lead.disqualificationReason}</span>
                                            )}
                                        </span>
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Type</dt>
                                <dd className="mt-1">
                                    {isEditing ? (
                                        <select
                                            value={formData.type}
                                            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="LEAD">Lead</option>
                                            <option value="CLIENT_CONTACT">Client Contact</option>
                                            <option value="FORMER_CLIENT_CONTACT">Former Client Contact</option>
                                        </select>
                                    ) : (
                                        <span className="text-sm text-gray-900 font-sans">
                                            {lead.type === 'CLIENT_CONTACT' ? 'Client Contact' : lead.type === 'FORMER_CLIENT_CONTACT' ? 'Former Client Contact' : 'Lead'}
                                        </span>
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">First Name</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.firstName}
                                            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.firstName
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Full Name</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.fullName}
                                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.fullName
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Company</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.companyName}
                                            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                                            placeholder={lead.account ? "Linked to Account (Read Only)" : "Company Name"}
                                            disabled={!!lead.account}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm disabled:bg-gray-100 disabled:text-gray-500"
                                        />
                                    ) : (
                                        (lead as any).companyLinkedinUrl ? (
                                            <a href={(lead as any).companyLinkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1">
                                                {(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '')}
                                            </a>
                                        ) : (
                                            <span>{(lead.account?.name || lead.companyName || '').replace(/^View company:\s*/i, '') || '-'}</span>
                                        )
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Title</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.title || '-'
                                    )}
                                </dd>
                            </div>

                            {/* Rating + Source: Lead-only concepts, hidden in the Contact view (data preserved). */}
                            {source !== 'contacts' && (
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Rating</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <select
                                            value={formData.rating}
                                            onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="">-- None --</option>
                                            <option value="Hot">Hot</option>
                                            <option value="Warm">Warm</option>
                                            <option value="Cold">Cold</option>
                                        </select>
                                    ) : (
                                        lead.rating || '-'
                                    )}
                                </dd>
                            </div>
                            )}


                            {source !== 'contacts' && (
                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Source</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <select
                                            value={formData.source}
                                            onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        >
                                            <option value="Sendy DB">Sendy DB</option>
                                            <option value="LeadCandy">LeadCandy</option>
                                            <option value="Scraping-LinkedIn">Scraping-LinkedIn</option>
                                            <option value="Client Referral">Client Referral</option>
                                            <option value="Web">Web</option>
                                            <option value="MSP">MSP</option>
                                            <option value="Scraping-Snov">Scraping-Snov</option>
                                            <option value="LinkedIn Extension">LinkedIn Extension</option>
                                        </select>
                                    ) : (
                                        lead.source || '-'
                                    )}
                                </dd>
                            </div>
                            )}

                        </div>
                    </div>


                    {/* ── CONTACT & TRACKING ── */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <Mail className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Contact & Tracking</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Email
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.email || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                    Phone
                                </dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.phone || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Secondary Email</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="email"
                                            value={formData.secondaryEmail}
                                            onChange={(e) => setFormData({ ...formData, secondaryEmail: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.secondaryEmail || '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-1">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">LinkedIn URL</dt>
                                <dd className="mt-1 text-sm text-blue-600">
                                    {isEditing ? (
                                        <input
                                            type="url"
                                            value={formData.linkedinUrl}
                                            onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        lead.linkedinUrl ? <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">LinkedIn Profile</a> : '-'
                                    )}
                                </dd>
                            </div>

                            <div className="sm:col-span-2">
                                <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Location</dt>
                                <dd className="mt-1 text-sm text-gray-900">
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="e.g. San Francisco, California"
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                        />
                                    ) : (
                                        (lead as any).location || '-'
                                    )}
                                </dd>
                            </div>
                        </div>
                    </div>

                    {/* ── UNIFIED CONTACT DESCRIPTION OR LEAD DESCRIPTION ── */}
                    {source === 'contacts' ? (
                        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Description</span>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Left/Middle Columns: Fields */}
                                <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                                    <div>
                                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Buyer Role</dt>
                                        <dd className="mt-1 text-sm text-gray-900">
                                            {isEditing && (
                                                <select
                                                    value={formData.buyerRole}
                                                    onChange={(e) => setFormData({ ...formData, buyerRole: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm text-gray-700 font-semibold"
                                                >
                                                    <option value="">No Role Set</option>
                                                    <option value="champion">Champion</option>
                                                    <option value="influencer">Influencer</option>
                                                    <option value="key_decision_maker">Key Decision Maker</option>
                                                    <option value="blocker">Blocker</option>
                                                </select>
                                            )}
                                            {!isEditing && !formData.buyerRole && (
                                                <span className="text-gray-400">Not Set</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'champion' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-600/20">🏆 Champion</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'influencer' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-purple-50 text-purple-700 ring-purple-600/20">🗣️ Influencer</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'key_decision_maker' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20">✍️ Key Decision Maker</span>
                                            )}
                                            {!isEditing && formData.buyerRole === 'blocker' && (
                                                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset bg-red-50 text-red-700 ring-red-600/20">🛑 Blocker</span>
                                            )}
                                        </dd>
                                    </div>

                                    <div>
                                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports To</dt>
                                        <dd className="mt-1 text-sm text-gray-900">
                                            {isEditing ? (
                                                <AutocompleteInput
                                                    value={formData.reportsToId || null}
                                                    displayValue={reportsToName}
                                                    placeholder="Search contacts..."
                                                    onSearch={async (q) => {
                                                        const res = await searchReportsToCandidates(lead.id, q, lead.companyId ?? null);
                                                        if (!res.success) return [];
                                                        return (res.data || []).map((c: any) => ({
                                                            id: c.id,
                                                            label: c.fullName || `${c.firstName} ${c.lastName}`,
                                                            sublabel: [c.title, c.account?.name || c.companyName].filter(Boolean).join(' · '),
                                                        }));
                                                    }}
                                                    onSelect={(opt) => {
                                                        if (opt) {
                                                            setFormData({ ...formData, reportsToId: String(opt.id) });
                                                            setReportsToName(opt.label || '');
                                                        } else {
                                                            setFormData({ ...formData, reportsToId: '' });
                                                            setReportsToName('');
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                (lead as any).reportsTo ? (
                                                    <Link href={`/commercial/contacts/${(lead as any).reportsTo.id}`} className="text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1 font-semibold">
                                                        {(lead as any).reportsTo.fullName || `${(lead as any).reportsTo.firstName} ${(lead as any).reportsTo.lastName}`}
                                                        {(lead as any).reportsTo.title ? <span className="text-gray-400 font-normal">· {(lead as any).reportsTo.title}</span> : null}
                                                    </Link>
                                                ) : '-'
                                            )}
                                        </dd>
                                    </div>

                                    <div className="col-span-1 sm:col-span-2">
                                        <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Contact Description</dt>
                                        <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                                            {isEditing ? (
                                                <textarea
                                                    value={formData.description}
                                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                    rows={4}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                                />
                                            ) : (
                                                lead.description || '-'
                                            )}
                                        </dd>
                                    </div>
                                </div>

                                {/* Right Column: Info Card (Shown only in Edit Mode) */}
                                {isEditing && (
                                    <div className="lg:col-span-1">
                                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3.5 text-xs">
                                            <h4 className="font-bold text-slate-800 tracking-wider uppercase text-[10px]">Buyer Personas</h4>
                                            <div className="space-y-3">
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-amber-700 text-xs font-bold">🏆</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Champion</p>
                                                        <p className="text-slate-500 mt-0.5">Pushes the deal internally and acts as an internal advocate.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-purple-100 text-purple-700 text-xs font-bold">🗣️</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Influencer</p>
                                                        <p className="text-slate-500 mt-0.5">Has a valued opinion but does not hold final decision power.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-green-100 text-green-700 text-xs font-bold">✍️</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Key Decision Maker</p>
                                                        <p className="text-slate-500 mt-0.5">Approves budget and signs the contract/purchase.</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 items-start">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-100 text-red-700 text-xs font-bold">🛑</span>
                                                    <div>
                                                        <p className="font-bold text-slate-700">Blocker</p>
                                                        <p className="text-slate-500 mt-0.5">Stops, slows down, or hinders the deal progress.</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <svg className="h-3.5 w-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                                <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Description</span>
                                <div className="h-px bg-gray-100 flex-1" />
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">

                                {/* Outsourcing: hidden in Contact view (intended to live on the Account per request). */}
                                <div className="sm:col-span-1">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outsourcing</dt>
                                    <dd className="mt-1 text-sm text-gray-900">
                                        {isEditing ? (
                                            <select
                                                value={formData.outsourcing}
                                                onChange={(e) => setFormData({ ...formData, outsourcing: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            >
                                                <option value="N/A">N/A</option>
                                                <option value="Yes">Yes</option>
                                                <option value="No">No</option>
                                            </select>
                                        ) : (
                                            lead.outsourcing || 'N/A'
                                        )}
                                    </dd>
                                </div>

                                <div className="col-span-2 md:col-span-3">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lead Description</dt>
                                    <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                                        {isEditing ? (
                                            <textarea
                                                value={formData.description}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                rows={3}
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            />
                                        ) : (
                                            lead.description || '-'
                                        )}
                                    </dd>
                                </div>


                                {/* Technologies: hidden in Contact view (intended to live on the Account per request). */}
                                <div className="sm:col-span-1">
                                    <dt className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Technologies</dt>
                                    <dd className="mt-1 text-sm text-gray-900">
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={formData.technologies}
                                                onChange={(e) => setFormData({ ...formData, technologies: e.target.value })}
                                                placeholder="e.g. React, Node.js"
                                                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg focus:border-blue-500 outline-none transition-all font-medium text-sm"
                                            />
                                        ) : (
                                            lead.technologies ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {lead.technologies.split(/[,-]+/).map((tech: string, index: number) => {
                                                        const trimmed = tech.trim();
                                                        if (!trimmed) return null;
                                                        return (
                                                            <span key={index} className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                                {trimmed}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            ) : '-'
                                        )}
                                    </dd>
                                </div>

                            </div>
                        </div>
                    )}

                    {/* ── RELATED ACCOUNT 1/2/3 + Add button ──
                        Hidden in the Contact view: company details already live on the Account profile.
                        Lead view keeps it visible to enrich the prospecting record. */}
                            {relatedAccountsSection}
                        </div>
                        {documentsSection}
                        {followUpSection}
                        {communicationStatusSection}
                        {campaignsSection}
                        {opportunitiesSection}
                        {activitySection}
                        {historySection}
                        {systemTimelineSection}
                        {deleteButtonSection}
                    </div>
                )}

            </div>

            {/* Modals & Dialogs */}
            {/* Delete Reason Modal */}
            <EditLockModal
                editors={lockEditors}
                recordLabel={lockEntityType}
                onEditAnyway={() => { const open = pendingEditOpen; setLockEditors(null); setPendingEditOpen(null); open?.(); }}
                onCancel={() => { setLockEditors(null); setPendingEditOpen(null); if (!isEditingAnything) releaseEditLock(); }}
            />

            <DeleteReasonModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={handleDeleteLead}
                title={`Delete ${source === 'contacts' ? 'Contact' : 'Lead'}`}
                description={`Are you sure you want to delete this ${source === 'contacts' ? 'contact' : 'lead'}? It will be moved to archives.`}
                isLoading={isDeleting}
                entityType="lead"
            />

            {/* Confirm Delete Comment Modal */}
            <ConfirmModal
                isOpen={confirmDeleteNote !== null}
                onClose={() => setConfirmDeleteNote(null)}
                onConfirm={async () => {
                    if (confirmDeleteNote !== null) await handleDeleteNote(confirmDeleteNote);
                    setConfirmDeleteNote(null);
                }}
                title="Delete comment"
                description="Are you sure you want to delete this comment? This action cannot be undone."
                confirmLabel="Delete"
                cancelLabel="Cancel"
                variant="danger"
            />

            {/* Cascade Opportunities — three-button decision modal */}
            <CascadeWarningModal
                isOpen={cascadeConfirm.open}
                onClose={handleCascadeCancel}
                onKeep={handleCascadeKeep}
                onCascade={handleCascadeConfirm}
                title={`Archive ${cascadeConfirm.count} open opportunit${cascadeConfirm.count > 1 ? 'ies' : 'y'} too?`}
                description={`The Lead has been archived. The opportunities below originated from this Lead and are still open. They keep working as-is unless you cascade.`}
                keepLabel="Keep them open"
                cascadeLabel="Archive them too"
                isLoading={isCascading}
                itemPreview={cascadeConfirm.titles}
            />

            {/* Convert to Account Confirm */}
            <ConfirmModal
                isOpen={isConvertConfirmOpen}
                onClose={() => setIsConvertConfirmOpen(false)}
                onConfirm={async () => {
                    setIsConvertConfirmOpen(false);
                    setIsConverting(true);
                    const res = await convertLeadToAccount(lead.id);
                    if (res.success) {
                        router.push(`/commercial/accounts/${res.data?.accountId}?created=converted`);
                    } else {
                        setIsConverting(false);
                    }
                }}
                title="Convert to Account"
                description="This will create an Account from this Lead's company data and link them. This action cannot be undone."
                confirmLabel="Convert"
                variant="info"
                isLoading={isConverting}
            />

            {/* Revert Contact to Lead Confirm */}
            <ConfirmModal
                isOpen={isRevertToLeadConfirmOpen}
                onClose={() => setIsRevertToLeadConfirmOpen(false)}
                onConfirm={async () => {
                    setIsRevertToLeadConfirmOpen(false);
                    setIsRevertingToLead(true);
                    const res = await revertContactToLead(lead.id);
                    if (res.success) {
                        router.push(`/commercial/leads/${lead.id}`);
                    } else {
                        setIsRevertingToLead(false);
                    }
                }}
                title="Convert to Lead"
                description={`This will unlink ${lead.fullName || 'this contact'} from their Account and convert them back to a Lead. All personal information will be preserved. You can then update their new company details.`}
                confirmLabel="Convert to Lead"
                variant="warning"
                isLoading={isRevertingToLead}
            />

            {/* Confirm Delete NDA Modal */}
            <ConfirmModal
                isOpen={showNdaRemoveConfirm}
                onClose={() => {
                    setShowNdaRemoveConfirm(false);
                    setNdaDeleteIndex(null);
                }}
                onConfirm={async () => {
                    setShowNdaRemoveConfirm(false);
                    const current = parseAttachedFiles(formData.ndaUrl, "NDA Document");
                    const updated = current.filter((_, i) => i !== ndaDeleteIndex);
                    const newUrlStr = updated.length === 0 ? "" : JSON.stringify(updated);
                    const updatedFormData = {
                        ...formData,
                        ndaUrl: newUrlStr,
                        ndaDate: updated.length === 0 ? "" : formData.ndaDate
                    };
                    setNdaDeleteIndex(null);
                    setFormData(updatedFormData);
                    const saveRes = await updateContact(lead.id, updatedFormData);
                    if (saveRes.success) {
                        router.refresh();
                    } else {
                        console.error("Failed to save changes after document deletion:", saveRes.error);
                    }
                }}
                title="Remove NDA Document"
                description="Are you sure you want to remove this NDA document? This action takes effect immediately."
                confirmLabel="Remove"
                cancelLabel="Cancel"
                variant="danger"
            />

            {/* Confirm Delete MSA Modal */}
            <ConfirmModal
                isOpen={showMsaRemoveConfirm}
                onClose={() => {
                    setShowMsaRemoveConfirm(false);
                    setMsaDeleteIndex(null);
                }}
                onConfirm={async () => {
                    setShowMsaRemoveConfirm(false);
                    const current = parseAttachedFiles(formData.msaUrl, "MSA Document");
                    const updated = current.filter((_, i) => i !== msaDeleteIndex);
                    const newUrlStr = updated.length === 0 ? "" : JSON.stringify(updated);
                    const updatedFormData = {
                        ...formData,
                        msaUrl: newUrlStr,
                        msaDate: updated.length === 0 ? "" : formData.msaDate
                    };
                    setMsaDeleteIndex(null);
                    setFormData(updatedFormData);
                    const saveRes = await updateContact(lead.id, updatedFormData);
                    if (saveRes.success) {
                        router.refresh();
                    } else {
                        console.error("Failed to save changes after document deletion:", saveRes.error);
                    }
                }}
                title="Remove MSA Document"
                description="Are you sure you want to remove this MSA document? This action takes effect immediately."
                confirmLabel="Remove"
                cancelLabel="Cancel"
                variant="danger"
            />

            {/* Confirm Delete Other Modal */}
            <ConfirmModal
                isOpen={showOtherRemoveConfirm}
                onClose={() => {
                    setShowOtherRemoveConfirm(false);
                    setOtherDeleteIndex(null);
                }}
                onConfirm={async () => {
                    setShowOtherRemoveConfirm(false);
                    const current = parseAttachedFiles(formData.otherUrl, "Other Document");
                    const updated = current.filter((_, i) => i !== otherDeleteIndex);
                    const newUrlStr = updated.length === 0 ? "" : JSON.stringify(updated);
                    const updatedFormData = {
                        ...formData,
                        otherUrl: newUrlStr,
                        otherDate: updated.length === 0 ? "" : formData.otherDate
                    };
                    setOtherDeleteIndex(null);
                    setFormData(updatedFormData);
                    const saveRes = await updateContact(lead.id, updatedFormData);
                    if (saveRes.success) {
                        router.refresh();
                    } else {
                        console.error("Failed to save changes after document deletion:", saveRes.error);
                    }
                }}
                title="Remove Document"
                description="Are you sure you want to remove this document? This action takes effect immediately."
                confirmLabel="Remove"
                cancelLabel="Cancel"
                variant="danger"
            />

            {/* ── ADD SECONDARY CONTACT MODAL ── */}
            {showAddSecModal && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-blue-600" />
                                <h3 className="text-base font-bold text-gray-900">Add Secondary Contact</h3>
                            </div>
                            <button onClick={() => setShowAddSecModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>

                        {secError && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
                                {secError}
                            </div>
                        )}

                        <div className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">First Name *</label>
                                    <input
                                        type="text"
                                        required
                                        value={secFirstName}
                                        onChange={(e) => setSecFirstName(e.target.value)}
                                        placeholder="John"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Last Name</label>
                                    <input
                                        type="text"
                                        value={secLastName}
                                        onChange={(e) => setSecLastName(e.target.value)}
                                        placeholder="Doe"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">Job Title</label>
                                <input
                                    type="text"
                                    value={secTitle}
                                    onChange={(e) => setSecTitle(e.target.value)}
                                    placeholder="e.g. Engineering Manager"
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={secEmail}
                                        onChange={(e) => setSecEmail(e.target.value)}
                                        placeholder="john@company.com"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Phone</label>
                                    <input
                                        type="tel"
                                        value={secPhone}
                                        onChange={(e) => setSecPhone(e.target.value)}
                                        placeholder="+1 555-0199"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">LinkedIn URL</label>
                                <input
                                    type="url"
                                    value={secLinkedinUrl}
                                    onChange={(e) => setSecLinkedinUrl(e.target.value)}
                                    placeholder="https://linkedin.com/in/..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                />
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">Notes / Description</label>
                                <textarea
                                    value={secDescription}
                                    onChange={(e) => setSecDescription(e.target.value)}
                                    placeholder="Additional details about this contact..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium resize-none h-20"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={() => setShowAddSecModal(false)}
                                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isSubmittingSec || !secFirstName.trim()}
                                onClick={async () => {
                                    setIsSubmittingSec(true);
                                    setSecError(null);
                                    const { addSecondaryContact } = await import('@/app/actions/commercial/contact');
                                    const res = await addSecondaryContact(lead.id, {
                                        firstName: secFirstName.trim(),
                                        lastName: secLastName.trim(),
                                        title: secTitle.trim(),
                                        email: secEmail.trim(),
                                        phone: secPhone.trim(),
                                        linkedinUrl: secLinkedinUrl.trim(),
                                        description: secDescription.trim(),
                                    });
                                    if (res.success) {
                                        setShowAddSecModal(false);
                                        router.refresh();
                                    } else {
                                        setSecError(res.error || 'Failed to add secondary contact.');
                                    }
                                    setIsSubmittingSec(false);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {isSubmittingSec ? 'Saving...' : 'Add Contact'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── EDIT SECONDARY CONTACT MODAL ── */}
            {showEditSecModal && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-blue-600" />
                                <h3 className="text-base font-bold text-gray-900">Edit Secondary Contact</h3>
                            </div>
                            <button onClick={() => { setShowEditSecModal(false); setEditSecTarget(null); }} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>

                        {secError && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
                                {secError}
                            </div>
                        )}

                        <div className="space-y-3 text-xs">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">First Name *</label>
                                    <input
                                        type="text"
                                        required
                                        value={secFirstName}
                                        onChange={(e) => setSecFirstName(e.target.value)}
                                        placeholder="John"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Last Name</label>
                                    <input
                                        type="text"
                                        value={secLastName}
                                        onChange={(e) => setSecLastName(e.target.value)}
                                        placeholder="Doe"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">Job Title</label>
                                <input
                                    type="text"
                                    value={secTitle}
                                    onChange={(e) => setSecTitle(e.target.value)}
                                    placeholder="e.g. Engineering Manager"
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={secEmail}
                                        onChange={(e) => setSecEmail(e.target.value)}
                                        placeholder="john@company.com"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="font-bold text-gray-700 block mb-1">Phone</label>
                                    <input
                                        type="tel"
                                        value={secPhone}
                                        onChange={(e) => setSecPhone(e.target.value)}
                                        placeholder="+1 555-0199"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">LinkedIn URL</label>
                                <input
                                    type="url"
                                    value={secLinkedinUrl}
                                    onChange={(e) => setSecLinkedinUrl(e.target.value)}
                                    placeholder="https://linkedin.com/in/..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium"
                                />
                            </div>

                            <div>
                                <label className="font-bold text-gray-700 block mb-1">Notes / Description</label>
                                <textarea
                                    value={secDescription}
                                    onChange={(e) => setSecDescription(e.target.value)}
                                    placeholder="Additional details about this contact..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 outline-none text-sm font-medium resize-none h-20"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={() => { setShowEditSecModal(false); setEditSecTarget(null); }}
                                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={isSubmittingSec || !secFirstName.trim() || !editSecTarget}
                                onClick={async () => {
                                    if (!editSecTarget) return;
                                    setIsSubmittingSec(true);
                                    setSecError(null);
                                    const { updateSecondaryContact } = await import('@/app/actions/commercial/contact');
                                    const res = await updateSecondaryContact(editSecTarget.id, {
                                        firstName: secFirstName.trim(),
                                        lastName: secLastName.trim(),
                                        title: secTitle.trim(),
                                        email: secEmail.trim(),
                                        phone: secPhone.trim(),
                                        linkedinUrl: secLinkedinUrl.trim(),
                                        description: secDescription.trim(),
                                    });
                                    if (res.success) {
                                        setShowEditSecModal(false);
                                        setEditSecTarget(null);
                                        router.refresh();
                                    } else {
                                        setSecError(res.error || 'Failed to update secondary contact.');
                                    }
                                    setIsSubmittingSec(false);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {isSubmittingSec ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── PROMOTE SECONDARY CONTACT CONFIRM MODAL ── */}
            <ConfirmModal
                isOpen={showPromoteSecModal}
                onClose={() => { setShowPromoteSecModal(false); setPromoteSecTarget(null); }}
                onConfirm={async () => {
                    if (!promoteSecTarget) return;
                    setIsSubmittingSec(true);
                    setShowPromoteSecModal(false);
                    const { swapPrimaryLeadContact } = await import('@/app/actions/commercial/contact');
                    const res = await swapPrimaryLeadContact(lead.id, promoteSecTarget.id);
                    setPromoteSecTarget(null);
                    setIsSubmittingSec(false);
                    if (res.success) {
                        router.refresh();
                    } else {
                        alert(res.error || 'Failed to promote contact to primary.');
                    }
                }}
                title="Promote to Primary Contact?"
                description={`Are you sure you want to promote ${promoteSecTarget?.fullName || promoteSecTarget?.firstName} to Primary Contact? The current primary contact (${lead.fullName || lead.firstName}) will become a secondary contact.`}
                confirmLabel="Promote to Primary"
                cancelLabel="Cancel"
                variant="warning"
                isLoading={isSubmittingSec}
            />

            {/* ── DELETE SECONDARY CONTACT CONFIRM MODAL ── */}
            <ConfirmModal
                isOpen={showDeleteSecModal}
                onClose={() => { setShowDeleteSecModal(false); setDeleteSecTarget(null); }}
                onConfirm={async () => {
                    if (!deleteSecTarget) return;
                    setIsSubmittingSec(true);
                    setShowDeleteSecModal(false);
                    const { deleteSecondaryContact } = await import('@/app/actions/commercial/contact');
                    const res = await deleteSecondaryContact(deleteSecTarget.id);
                    setDeleteSecTarget(null);
                    setIsSubmittingSec(false);
                    if (res.success) {
                        router.refresh();
                    } else {
                        alert(res.error || 'Failed to remove secondary contact.');
                    }
                }}
                title="Remove Secondary Contact"
                description={`Are you sure you want to remove ${deleteSecTarget?.fullName || deleteSecTarget?.firstName} as a secondary contact?`}
                confirmLabel="Remove Contact"
                cancelLabel="Cancel"
                variant="danger"
                isLoading={isSubmittingSec}
            />

        </div>
    );
}






