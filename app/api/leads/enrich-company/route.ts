import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/app/lib/db";

const API_KEY = process.env.CRM_EXTENSION_API_KEY || "your-extension-api-key";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
    // Search leads by company name
    const authHeader = request.headers.get("X-API-Key");
    if (authHeader !== API_KEY) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const { searchParams } = new URL(request.url);
    const company = searchParams.get("company");

    if (!company) {
        return NextResponse.json({ error: "Missing company parameter" }, { status: 400, headers: corsHeaders });
    }

    try {
        const companyUrl = searchParams.get("companyUrl");

        // Build OR conditions: match by name OR by LinkedIn URL
        const orConditions: any[] = [
            { companyName: { contains: company } },
        ];
        if (companyUrl) {
            orConditions.push({ companyLinkedinUrl: companyUrl });
        }

        const leads = await (prisma as any).contact.findMany({
            where: {
                type: "LEAD",
                OR: orConditions,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                fullName: true,
                companyName: true,
                title: true,
            },
            take: 20,
        });

        return NextResponse.json({ leads }, { headers: corsHeaders });
    } catch (error: any) {
        console.error("Error searching leads:", error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }
}

export async function PATCH(request: NextRequest) {
    // Enrich a lead with company data
    const authHeader = request.headers.get("X-API-Key");
    if (authHeader !== API_KEY) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    try {
        const body = await request.json();
        const { leadId, accountIndex, companyDetails, industry, numberOfEmployees, website, companyName, headquarters, founded, specialties } = body;

        if (!leadId) {
            return NextResponse.json({ error: "Missing leadId" }, { status: 400, headers: corsHeaders });
        }

        // Build update data — use accountIndex to determine which fields to write
        const updateData: any = {
            lastModifiedBy: "LinkedIn Extension",
        };

        const idx = accountIndex || 1; // Default to primary account
        const suffix = idx === 1 ? "" : String(idx); // "" for account 1, "2" for account 2, "3" for account 3

        if (companyDetails) updateData[`companyDetails${suffix}`] = companyDetails;
        if (industry) updateData[`industry${suffix}`] = industry;
        if (numberOfEmployees) updateData[`numberOfEmployees${suffix}`] = numberOfEmployees;
        if (website) updateData[`website${suffix}`] = website;
        if (headquarters) updateData[`headquarters${suffix}`] = headquarters;
        if (founded) updateData[`founded${suffix}`] = founded;
        if (specialties !== undefined && specialties !== null) updateData[`specialties${suffix}`] = specialties;

        // For primary account (1), also update companyName
        if (idx === 1 && companyName) {
            updateData.companyName = companyName;
        }

        const updated = await (prisma as any).contact.update({
            where: { id: parseInt(leadId) },
            data: updateData,
        });

        return NextResponse.json({
            success: true,
            id: updated.id,
            message: `Lead enriched with company data (account ${idx})`,
        }, { headers: corsHeaders });
    } catch (error: any) {
        console.error("Error enriching lead:", error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }
}
