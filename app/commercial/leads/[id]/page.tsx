import { getContact } from "@/app/actions/commercial/contact";
import { getNotes } from "@/app/actions/commercial/note";
import { getActivities } from "@/app/actions/commercial/activity";
import { getUsers } from "@/app/actions/users";
import { getContactEnrollments } from "@/app/actions/commercial/campaignEnrollment";
import { getCampaigns } from "@/app/actions/commercial/campaign";
import LeadDetailClient from "./LeadDetailClient";
import { notFound } from "next/navigation";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
    // Await params for Next.js 15+ compatibility
    const resolvedParams = await params;

    // Fetch Lead Data
    const { data: lead, error } = await getContact(parseInt(resolvedParams.id));

    if (error || !lead) {
        notFound();
    }

    const contactIds = [lead.id, ...(lead.secondaryContacts || []).map((sc: any) => sc.id)];

    // Fetch Notes/History
    const { data: notes } = await getNotes({ contactIds });

    // Fetch Activities
    const { data: activities } = await getActivities({ contactIds });

    // Fetch Users for Owner assignment
    const { data: users } = await getUsers();

    // Fetch campaign enrollments for this contact
    const { data: enrollments } = await getContactEnrollments(lead.id);

    // Fetch all active campaigns to show enrollment options
    const { data: allCampaigns } = await getCampaigns();

    // Filter out campaigns the contact has ANY enrollment in (active, paused, or complete)
    const enrolledCampaignIds = new Set((enrollments || []).map((e: any) => e.campaignId));
    const availableCampaigns = (allCampaigns || []).filter((c: any) => !enrolledCampaignIds.has(c.id));

    // Attach enrollment data and available campaigns to lead object
    const leadWithCampaigns = {
        ...lead,
        campaignEnrollments: enrollments || [],
        availableCampaigns,
    };

    return <LeadDetailClient lead={leadWithCampaigns} notes={notes || []} users={users || []} activities={activities || []} />;
}
