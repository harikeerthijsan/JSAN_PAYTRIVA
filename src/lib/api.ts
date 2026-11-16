import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Authentication required.", 401) } as const;
  return { user } as const;
}

export async function requirePermission(permission: string) {
  const result = await requireUser();
  if ("response" in result) return result;
  if (!result.user.permissions.includes(permission)) {
    return { response: jsonError("You do not have permission to perform this action.", 403) } as const;
  }
  return result;
}

export function validationError(): NextResponse {
  return jsonError("Please check the submitted information and try again.", 400);
}
