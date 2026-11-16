import { NextRequest, NextResponse } from "next/server";
import { requirePermission, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { profileSchema } from "@/lib/validation";

export async function GET() {
  const access = await requirePermission("profile:read");
  if ("response" in access) return access.response;
  return NextResponse.json({ user: access.user });
}

export async function PATCH(request: NextRequest) {
  const access = await requirePermission("profile:write");
  if ("response" in access) return access.response;
  const body: unknown = await request.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return validationError();
  const user = await db.user.update({
    where: { id: access.user.id },
    data: { fullName: parsed.data.fullName, timeZone: parsed.data.timeZone },
  });
  return NextResponse.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      timeZone: user.timeZone,
    },
  });
}
