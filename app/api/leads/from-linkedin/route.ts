import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/app/lib/db";
import { revalidatePath } from "next/cache";
import { addSystemLog } from "@/app/actions/systemLog";

const API_KEY = process.env.CRM_EXTENSION_API_KEY || "your-extension-api-key";

// CORS headers for Chrome extension
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

// Handle preflight CORS requests
export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

// Check if a lead exists by LinkedIn URL
export async function GET(request: NextRequest) {
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== API_KEY) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
        );
    }

    const { searchParams } = new URL(request.url);
    const linkedinUrl = searchParams.get("linkedinUrl");

    if (!linkedinUrl) {
        return NextResponse.json(
            { exists: false },
            { headers: corsHeaders }
        );
    }

    try {
        const existing = await (prisma as any).contact.findFirst({
            where: { linkedinUrl: { contains: linkedinUrl.replace("https://www.linkedin.com", "") } },
            select: { id: true, fullName: true, email: true, title: true, companyName: true, companyLinkedinUrl: true, companyName2: true, companyLinkedinUrl2: true, companyName3: true, companyLinkedinUrl3: true, isArchived: true, archiveReason: true },
        });

        if (existing) {
            return NextResponse.json(
                { exists: true, id: existing.id, name: existing.fullName, email: existing.email, title: existing.title, companyName: existing.companyName, companyLinkedinUrl: existing.companyLinkedinUrl, companyName2: existing.companyName2, companyLinkedinUrl2: existing.companyLinkedinUrl2, companyName3: existing.companyName3, companyLinkedinUrl3: existing.companyLinkedinUrl3, archived: Boolean(existing.isArchived), archiveReason: existing.archiveReason || null },
                { headers: corsHeaders }
            );
        }

        return NextResponse.json(
            { exists: false },
            { headers: corsHeaders }
        );
    } catch (error: any) {
        return NextResponse.json(
            { exists: false, error: error.message },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function POST(request: NextRequest) {
    // Verify API key
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== API_KEY) {
        return NextResponse.json(
            { error: "Unauthorized - Invalid API key" },
            { status: 401, headers: corsHeaders }
        );
    }

    try {
        const body = await request.json();
        const {
            firstName,
            fullName,
            title,
            companyName,
            companyLinkedinUrl,
            email,
            secondaryEmail,
            phone,
            linkedinUrl,
            location,
            about,
            experience,
            education,
            skills,
            source,
        } = body;

        if (!fullName && !firstName) {
            return NextResponse.json(
                { error: "Name is required" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Check for duplicate by LinkedIn URL
        if (linkedinUrl) {
            const existing = await (prisma as any).contact.findFirst({
                where: { linkedinUrl: { contains: linkedinUrl.replace("https://www.linkedin.com", "") } },
            });
            if (existing) {
                // Archived lead → restore it instead of blocking with a 409.
                if (existing.isArchived) {
                    await (prisma as any).contact.update({
                        where: { id: existing.id },
                        data: { isArchived: false, archiveReason: null, archivedAt: null, archivedBy: null, lastModifiedBy: "LinkedIn Extension" },
                    });
                    try {
                        await addSystemLog({
                            entityType: existing.type === "CLIENT_CONTACT" ? "contact" : "lead",
                            entityId: existing.id,
                            action: "restored",
                            description: "Restored via LinkedIn Extension",
                            changedBy: "LinkedIn Extension",
                        });
                    } catch {}
                    revalidatePath("/commercial/leads");
                    revalidatePath(`/commercial/leads/${existing.id}`);
                    return NextResponse.json(
                        { success: true, restored: true, id: existing.id, message: `Lead "${existing.fullName || existing.firstName}" restored from archive` },
                        { headers: corsHeaders }
                    );
                }
                return NextResponse.json(
                    {
                        error: `Lead "${existing.fullName || existing.firstName}" already exists with this LinkedIn URL`,
                        id: existing.id,
                        duplicate: true,
                        archived: false,
                    },
                    { status: 409, headers: corsHeaders }
                );
            }
        }

        // Build experience summary for the initial note
        let noteParts: string[] = [];




        if (about) {
            noteParts.push(`**About:**\n${about}`);
        }

        if (experience && experience.length > 0) {
            const expLines = experience
                .slice(0, 5)
                .map((e: any) => `• ${e.role || "Role"} at ${e.company || "Company"} ${e.dates ? `(${e.dates})` : ""}`)
                .join("\n");
            noteParts.push(`**Experience:**\n${expLines}`);
        }

        if (education && education.length > 0) {
            const eduLines = education
                .slice(0, 3)
                .map((e: any) => `• ${e.school || "School"} ${e.degree ? `- ${e.degree}` : ""}`)
                .join("\n");
            noteParts.push(`**Education:**\n${eduLines}`);
        }

        if (skills && skills.length > 0) {
            noteParts.push(`**Skills:** ${skills.join(", ")}`);
        }

        const initialNote = noteParts.length > 0
            ? `Imported from LinkedIn (${linkedinUrl || ""})\n\n${noteParts.join("\n\n")}`
            : `Imported from LinkedIn (${linkedinUrl || ""})`;

        // Create the lead (Contact with type LEAD)
        const nameParts = (fullName || "").split(" ");
        const derivedFirstName = firstName || nameParts[0] || "";
        const derivedLastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

        const contactData: any = {
            firstName: derivedFirstName,
            lastName: derivedLastName,
            fullName: fullName || `${derivedFirstName} ${derivedLastName}`.trim(),
            email: email || null,
            secondaryEmail: secondaryEmail || null,
            title: title || null,
            phone: phone || null,
            linkedinUrl: linkedinUrl || null,
            location: body.location || null,
            companyName: companyName || null,
            companyLinkedinUrl: companyLinkedinUrl || null,
            roleStartDate: body.roleStartDate || null,
            roleEndDate: body.roleEndDate || null,
            companyName2: body.companyName2 || null,
            title2: body.title2 || null,
            companyLinkedinUrl2: body.companyLinkedinUrl2 || null,
            roleStartDate2: body.roleStartDate2 || null,
            roleEndDate2: body.roleEndDate2 || null,
            companyName3: body.companyName3 || null,
            title3: body.title3 || null,
            companyLinkedinUrl3: body.companyLinkedinUrl3 || null,
            roleStartDate3: body.roleStartDate3 || null,
            roleEndDate3: body.roleEndDate3 || null,
            type: "LEAD",
            status: "New",
            source: source || "LinkedIn Extension",
            lastModifiedBy: "LinkedIn Extension",
        };

        const contact = await (prisma as any).contact.create({
            data: contactData,
        });

        // Create the initial note with LinkedIn data
        if (initialNote) {
            await (prisma as any).note.create({
                data: {
                    content: initialNote,
                    contact: { connect: { id: contact.id } },
                },
            });
        }

        // Record creation in the contact's System Information timeline
        try {
            const finalType = contact.type || "LEAD";
            await addSystemLog({
                entityType: finalType === "CLIENT_CONTACT" ? "contact" : "lead",
                entityId: contact.id,
                action: "created",
                description: "Created via LinkedIn Extension",
                changedBy: "LinkedIn Extension",
            });
        } catch {}

        revalidatePath("/commercial/leads");

        return NextResponse.json({
            success: true,
            id: contact.id,
            message: `Lead "${fullName}" created successfully`,
        }, { headers: corsHeaders });
    } catch (error: any) {
        console.error("LinkedIn import error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to create lead" },
            { status: 500, headers: corsHeaders }
        );
    }
}

// UPDATE existing lead from extension
export async function PUT(request: NextRequest) {
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== API_KEY) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
        );
    }

    try {
        const body = await request.json();
        const { id, title, companyName, companyLinkedinUrl, email, secondaryEmail, phone } = body;

        if (!id) {
            return NextResponse.json(
                { error: "Lead ID is required" },
                { status: 400, headers: corsHeaders }
            );
        }

        // Build update payload — only update fields that have values
        const updateData: any = {
            lastModifiedBy: "LinkedIn Extension",
        };
        if (title) updateData.title = title;
        if (companyName) updateData.companyName = companyName;
        if (companyLinkedinUrl) updateData.companyLinkedinUrl = companyLinkedinUrl;
        if (email) updateData.email = email;
        if (secondaryEmail) updateData.secondaryEmail = secondaryEmail;
        if (phone) updateData.phone = phone;
        if (body.roleStartDate) updateData.roleStartDate = body.roleStartDate;
        if (body.roleEndDate) updateData.roleEndDate = body.roleEndDate;
        if (body.companyName2) updateData.companyName2 = body.companyName2;
        if (body.title2) updateData.title2 = body.title2;
        if (body.companyLinkedinUrl2) updateData.companyLinkedinUrl2 = body.companyLinkedinUrl2;
        if (body.roleStartDate2) updateData.roleStartDate2 = body.roleStartDate2;
        if (body.roleEndDate2) updateData.roleEndDate2 = body.roleEndDate2;
        if (body.companyName3) updateData.companyName3 = body.companyName3;
        if (body.title3) updateData.title3 = body.title3;
        if (body.companyLinkedinUrl3) updateData.companyLinkedinUrl3 = body.companyLinkedinUrl3;
        if (body.roleStartDate3) updateData.roleStartDate3 = body.roleStartDate3;
        if (body.roleEndDate3) updateData.roleEndDate3 = body.roleEndDate3;

        // Verify the contact still exists before updating
        const existing = await (prisma as any).contact.findUnique({
            where: { id: parseInt(id) },
            select: { id: true, isArchived: true, type: true },
        });
        if (!existing) {
            return NextResponse.json(
                { error: "Lead no longer exists in CRM (it may have been permanently deleted)", deleted: true },
                { status: 404, headers: corsHeaders }
            );
        }

        // If archived, restore it as part of the update (re-engagement via extension)
        const wasArchived = Boolean(existing.isArchived);
        if (wasArchived) {
            updateData.isArchived = false;
            updateData.archiveReason = null;
            updateData.archivedAt = null;
            updateData.archivedBy = null;
        }

        const contact = await (prisma as any).contact.update({
            where: { id: parseInt(id) },
            data: updateData,
        });

        if (wasArchived) {
            try {
                await addSystemLog({
                    entityType: existing.type === "CLIENT_CONTACT" ? "contact" : "lead",
                    entityId: contact.id,
                    action: "restored",
                    description: "Restored via LinkedIn Extension",
                    changedBy: "LinkedIn Extension",
                });
            } catch {}
        }

        revalidatePath("/commercial/leads");
        revalidatePath(`/commercial/leads/${id}`);

        return NextResponse.json({
            success: true,
            id: contact.id,
            restored: wasArchived,
            message: wasArchived ? `Lead restored successfully` : `Lead updated successfully`,
        }, { headers: corsHeaders });
    } catch (error: any) {
        console.error("LinkedIn update error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to update lead" },
            { status: 500, headers: corsHeaders }
        );
    }
}
