import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { z } from "zod";
import { passwordMeetsPolicy } from "../src/lib/validation";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured before seeding.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const roleDefinitions = [
  { key: "REQUESTOR", name: "Requestor", description: "Access to the employee's own account and requestor workspace." },
  { key: "ACCOUNTS_PAYABLE", name: "Accounts Payable", description: "Access to AP workspace and permitted user administration." },
  { key: "APPROVER", name: "Approver", description: "Access to assigned approval workspace." },
] as const;

const permissionDefinitions = [
  { key: "profile:read", description: "View the signed-in employee's own profile." },
  { key: "profile:write", description: "Update the signed-in employee's own profile." },
  { key: "users:read", description: "View employee accounts and assigned roles." },
  { key: "users:invite", description: "Invite employees to activate an account." },
  { key: "users:assign_role", description: "Assign one of the three standard employee roles." },
  { key: "users:activate", description: "Activate or deactivate employee accounts." },
  { key: "ap:access", description: "Access the Accounts Payable workspace." },
  { key: "approvals:access", description: "Access the assigned approver workspace." },
  { key: "platform:admin", description: "Manage explicit platform-level user permissions." },
  { key: "payments:create", description: "Create, edit, and submit the employee's own payment requests." },
  { key: "payments:read_own", description: "View the employee's own payment requests and attached documents." },
  { key: "payments:read_all", description: "View submitted payment requests across the organization." },
  { key: "payments:manage_masters", description: "Manage payment entities, currencies, projects, cost centers, and exchange rates." },
  { key: "payments:correct", description: "Correct confirmed payment details with a reason and immutable audit record." },
  { key: "payments:read_payment_account", description: "View restricted bank and payment account details." },
  { key: "payments:read_payment_proof", description: "View uploaded payment proof documents." },
  { key: "reports:access", description: "Access the consolidated management dashboard and financial reports." },
] as const;

const rolePermissions: Record<string, string[]> = {
  REQUESTOR: ["profile:read", "profile:write", "payments:create", "payments:read_own"],
  ACCOUNTS_PAYABLE: [
    "profile:read",
    "profile:write",
    "users:read",
    "users:invite",
    "users:assign_role",
    "users:activate",
    "ap:access",
    "payments:read_all",
  ],
  APPROVER: ["profile:read", "profile:write", "approvals:access"],
};

async function seed() {
  const rawEmail = process.env.INITIAL_ADMIN_EMAIL;
  const rawPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const rawName = process.env.INITIAL_ADMIN_NAME ?? "PAYTRIVA Administrator";
  const parsedEmail = z.string().email().safeParse(rawEmail?.trim().toLowerCase());
  if (!parsedEmail.success || !rawPassword || !passwordMeetsPolicy(rawPassword)) {
    throw new Error(
      "Set INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD (12+ characters, no more than 72 UTF-8 bytes, with uppercase, lowercase, a number, and a symbol), and optionally INITIAL_ADMIN_NAME before seeding.",
    );
  }
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (allowedDomain && !parsedEmail.data.endsWith(`@${allowedDomain}`)) {
    throw new Error("INITIAL_ADMIN_EMAIL must use the configured ALLOWED_EMAIL_DOMAIN.");
  }

  const roles = new Map<string, string>();
  for (const definition of roleDefinitions) {
    const role = await db.role.upsert({
      where: { key: definition.key },
      create: definition,
      update: { name: definition.name, description: definition.description },
    });
    roles.set(role.key, role.id);
  }

  const permissions = new Map<string, string>();
  for (const definition of permissionDefinitions) {
    const permission = await db.permission.upsert({
      where: { key: definition.key },
      create: definition,
      update: { description: definition.description },
    });
    permissions.set(permission.key, permission.id);
  }

  for (const [roleKey, permissionKeys] of Object.entries(rolePermissions)) {
    await db.rolePermission.createMany({
      data: permissionKeys.map((key) => ({
        roleId: roles.get(roleKey)!,
        permissionId: permissions.get(key)!,
      })),
      skipDuplicates: true,
    });
  }

  const passwordHash = await bcrypt.hash(rawPassword, 12);
  const admin = await db.user.upsert({
    where: { email: parsedEmail.data },
    create: {
      fullName: rawName.trim(),
      email: parsedEmail.data,
      passwordHash,
      activatedAt: new Date(),
      isActive: true,
    },
    update: { fullName: rawName.trim() },
  });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roles.get("ACCOUNTS_PAYABLE")! } },
    create: {
      userId: admin.id,
      roleId: roles.get("ACCOUNTS_PAYABLE")!,
      assignedById: admin.id,
    },
    update: {},
  });
  await db.userPermission.upsert({
    where: { userId_permissionId: { userId: admin.id, permissionId: permissions.get("platform:admin")! } },
    create: {
      userId: admin.id,
      permissionId: permissions.get("platform:admin")!,
      grantedById: admin.id,
    },
    update: {},
  });
  for (const permissionKey of ["payments:correct", "payments:read_payment_account", "payments:read_payment_proof", "reports:access"]) {
    const permissionId = permissions.get(permissionKey);
    if (!permissionId) throw new Error(`Permission ${permissionKey} was not initialized.`);
    await db.userPermission.upsert({
      where: { userId_permissionId: { userId: admin.id, permissionId } },
      create: { userId: admin.id, permissionId, grantedById: admin.id },
      update: {},
    });
  }
  const paymentAdminPermission = permissions.get("payments:manage_masters");
  if (!paymentAdminPermission) throw new Error("Payment master permission was not initialized.");
  await db.userPermission.upsert({
    where: { userId_permissionId: { userId: admin.id, permissionId: paymentAdminPermission } },
    create: {
      userId: admin.id,
      permissionId: paymentAdminPermission,
      grantedById: admin.id,
    },
    update: {},
  });
  await db.paymentCurrency.upsert({
    where: { code: "USD" },
    create: { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
    update: { name: "US Dollar", symbol: "$", decimalPlaces: 2, isActive: true },
  });
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seeding failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
