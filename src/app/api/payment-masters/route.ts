import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, requirePermission, requireUser } from "@/lib/api";
import { auditContext, recordAudit } from "@/lib/audit";

const masterType = z.enum(["entity", "currency", "costCenter", "project", "financialRule"]);
const masterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity"), name: z.string().trim().min(1).max(120), code: z.string().trim().max(20).optional() }),
  z.object({ type: z.literal("currency"), code: z.string().trim().toUpperCase().length(3), name: z.string().trim().min(1).max(80), symbol: z.string().trim().min(1).max(8), decimalPlaces: z.number().int().min(0).max(6) }),
  z.object({ type: z.literal("costCenter"), name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal("project"), name: z.string().trim().min(1).max(160), code: z.string().trim().max(40).optional() }),
  z.object({
    type: z.literal("financialRule"),
    name: z.string().trim().min(1).max(120),
    ruleKind: z.enum(["WITHHOLDING_TAX", "OTHER_DEDUCTION"]),
    calculation: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    value: z.string().regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/),
    currencyCode: z.string().trim().toUpperCase().length(3).optional().or(z.literal("")),
  }).superRefine((rule, context) => {
    if (Number(rule.value) <= 0) context.addIssue({ code: "custom", path: ["value"], message: "Rule value must be greater than zero." });
    if (rule.calculation === "PERCENTAGE" && Number(rule.value) > 100) {
      context.addIssue({ code: "custom", path: ["value"], message: "Percentage rules cannot exceed 100%." });
    }
    if (rule.calculation === "FIXED_AMOUNT" && !rule.currencyCode) {
      context.addIssue({ code: "custom", path: ["currencyCode"], message: "Select a currency for a fixed-amount rule." });
    }
  }),
]);
const rateSchema = z.object({
  type: z.literal("exchangeRate"),
  currencyCode: z.string().trim().toUpperCase().length(3),
  usdPerUnit: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/),
  effectiveAt: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1).max(120),
});

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!auth.user.permissions.includes("payments:create") && !auth.user.permissions.includes("payments:read_all")) {
    return jsonError("You do not have permission to view payment master data.", 403);
  }
  const canManage = auth.user.permissions.includes("payments:manage_masters");
  const [entities, currencies, costCenters, projects, rates, financialRules] = await Promise.all([
    db.paymentEntity.findMany({ where: canManage ? {} : { isActive: true }, orderBy: { name: "asc" } }),
    db.paymentCurrency.findMany({ where: canManage ? {} : { isActive: true }, orderBy: { name: "asc" } }),
    db.costCenter.findMany({ where: canManage ? {} : { isActive: true }, orderBy: { name: "asc" } }),
    db.paymentProject.findMany({ where: canManage ? {} : { isActive: true }, orderBy: { name: "asc" } }),
    db.currencyExchangeRate.findMany({
      where: { effectiveAt: { lte: new Date() } },
      orderBy: [{ currencyCode: "asc" }, { effectiveAt: "desc" }],
      include: { currency: { select: { decimalPlaces: true, symbol: true } } },
    }),
    canManage
      ? db.paymentFinancialRule.findMany({ include: { currency: { select: { code: true, symbol: true } } }, orderBy: [{ ruleKind: "asc" }, { name: "asc" }] })
      : Promise.resolve([]),
  ]);
  return NextResponse.json({ entities, currencies, costCenters, projects, rates, financialRules, canManage });
}

export async function POST(request: Request) {
  const access = await requirePermission("payments:manage_masters");
  if ("response" in access) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const rate = rateSchema.safeParse(body);
  const { ip, userAgent } = auditContext(request);
  if (rate.success) {
    if (Number(rate.data.usdPerUnit) <= 0) return jsonError("Exchange rate must be greater than zero.", 400);
    const currency = await db.paymentCurrency.findFirst({ where: { code: rate.data.currencyCode, isActive: true } });
    if (!currency) return jsonError("Select an active currency.", 400);
    if (currency.code === "USD" && rate.data.usdPerUnit !== "1" && Number(rate.data.usdPerUnit) !== 1) {
      return jsonError("USD converts to USD at a rate of 1.", 400);
    }
    try {
      const saved = await db.$transaction(async (tx) => {
        const created = await tx.currencyExchangeRate.create({
          data: {
            currencyCode: currency.code,
            usdPerUnit: rate.data.usdPerUnit,
            effectiveAt: new Date(rate.data.effectiveAt),
            source: rate.data.source,
          },
        });
        await recordAudit(tx, {
          actorId: access.user.id,
          actorName: access.user.fullName,
          action: "EXCHANGE_RATE_CREATED",
          entityType: "CURRENCY_EXCHANGE_RATE",
          entityId: created.id,
          newValue: {
            currencyCode: created.currencyCode,
            usdPerUnit: created.usdPerUnit.toString(),
            effectiveAt: created.effectiveAt.toISOString(),
          },
          ip,
          userAgent,
        });
        return created;
      });
      return NextResponse.json(saved, { status: 201 });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return jsonError("An exchange rate already exists for that source, currency, and effective date.", 409);
      throw error;
    }
  }
  const parsed = masterSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid master data.", 400);
  try {
    if (parsed.data.type === "entity") {
      const entity = parsed.data;
      const result = await db.$transaction(async (tx) => {
        const created = await tx.paymentEntity.create({ data: { name: entity.name, code: entity.code || null } });
        await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName, action: "PAYMENT_ENTITY_CREATED",
          entityType: "PAYMENT_ENTITY", entityId: created.id,
          newValue: { name: created.name, code: created.code }, ip, userAgent,
        });
        return created;
      });
      return NextResponse.json(result, { status: 201 });
    } else if (parsed.data.type === "currency") {
      const currencyData = parsed.data;
      const result = await db.$transaction(async (tx) => {
        const created = await tx.paymentCurrency.create({ data: {
          code: currencyData.code,
          name: currencyData.name,
          symbol: currencyData.symbol,
          decimalPlaces: currencyData.decimalPlaces,
        } });
        await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName, action: "PAYMENT_CURRENCY_CREATED",
          entityType: "PAYMENT_CURRENCY", entityId: created.code,
          newValue: { code: created.code, name: created.name, decimalPlaces: created.decimalPlaces, symbol: created.symbol },
          ip, userAgent,
        });
        return created;
      });
      return NextResponse.json(result, { status: 201 });
    } else if (parsed.data.type === "costCenter") {
      const costCenter = parsed.data;
      const result = await db.$transaction(async (tx) => {
        const created = await tx.costCenter.create({ data: { name: costCenter.name, code: costCenter.code } });
        await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName, action: "COST_CENTER_CREATED",
          entityType: "COST_CENTER", entityId: created.id,
          newValue: { name: created.name, code: created.code }, ip, userAgent,
        });
        return created;
      });
      return NextResponse.json(result, { status: 201 });
    } else if (parsed.data.type === "project") {
      const project = parsed.data;
      const result = await db.$transaction(async (tx) => {
        const created = await tx.paymentProject.create({ data: { name: project.name, code: project.code || null } });
        await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName, action: "PAYMENT_PROJECT_CREATED",
          entityType: "PAYMENT_PROJECT", entityId: created.id,
          newValue: { name: created.name, code: created.code }, ip, userAgent,
        });
        return created;
      });
      return NextResponse.json(result, { status: 201 });
    } else {
      const rule = parsed.data;
      if (rule.calculation === "FIXED_AMOUNT") {
        const currency = await db.paymentCurrency.findFirst({ where: { code: rule.currencyCode, isActive: true } });
        if (!currency) return jsonError("Select an active currency for this fixed-amount rule.", 400);
      }
      const result = await db.$transaction(async (tx) => {
        const created = await tx.paymentFinancialRule.create({
          data: {
            name: rule.name,
            ruleKind: rule.ruleKind,
            calculation: rule.calculation,
            value: rule.value,
            currencyCode: rule.calculation === "FIXED_AMOUNT" ? rule.currencyCode : null,
          },
        });
        await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName, action: "PAYMENT_FINANCIAL_RULE_CREATED",
          entityType: "PAYMENT_FINANCIAL_RULE", entityId: created.id,
          newValue: {
            name: created.name,
            ruleKind: created.ruleKind,
            calculation: created.calculation,
            value: created.value.toString(),
            currencyCode: created.currencyCode,
          },
          ip, userAgent,
        });
        return created;
      });
      return NextResponse.json(result, { status: 201 });
    }
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate?.code === "P2002") return jsonError("That master value already exists.", 409);
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requirePermission("payments:manage_masters");
  if ("response" in access) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  const parsed = z.object({ type: masterType, id: z.string().min(1), isActive: z.boolean() }).safeParse(body);
  if (!parsed.success) return jsonError("Invalid master data.", 400);
  const { type, id, isActive } = parsed.data;
  if (type === "currency" && id === "USD" && !isActive) return jsonError("USD cannot be deactivated.", 400);
  const { ip, userAgent } = auditContext(request);
  try {
    await db.$transaction(async (tx) => {
      if (type === "entity") {
        const previous = await tx.paymentEntity.findUnique({ where: { id }, select: { isActive: true } });
        if (!previous) throw Object.assign(new Error("Master value not found."), { code: "P2025" });
        await tx.paymentEntity.update({ where: { id }, data: { isActive } });
        if (previous.isActive !== isActive) await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName,
          action: isActive ? "PAYMENT_ENTITY_ACTIVATED" : "PAYMENT_ENTITY_DEACTIVATED",
          entityType: "PAYMENT_ENTITY", entityId: id,
          previousValue: { isActive: previous.isActive }, newValue: { isActive }, ip, userAgent,
        });
      } else if (type === "currency") {
        const previous = await tx.paymentCurrency.findUnique({ where: { code: id }, select: { isActive: true } });
        if (!previous) throw Object.assign(new Error("Master value not found."), { code: "P2025" });
        await tx.paymentCurrency.update({ where: { code: id }, data: { isActive } });
        if (previous.isActive !== isActive) await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName,
          action: isActive ? "PAYMENT_CURRENCY_ACTIVATED" : "PAYMENT_CURRENCY_DEACTIVATED",
          entityType: "PAYMENT_CURRENCY", entityId: id,
          previousValue: { isActive: previous.isActive }, newValue: { isActive }, ip, userAgent,
        });
      } else if (type === "costCenter") {
        const previous = await tx.costCenter.findUnique({ where: { id }, select: { isActive: true } });
        if (!previous) throw Object.assign(new Error("Master value not found."), { code: "P2025" });
        await tx.costCenter.update({ where: { id }, data: { isActive } });
        if (previous.isActive !== isActive) await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName,
          action: isActive ? "COST_CENTER_ACTIVATED" : "COST_CENTER_DEACTIVATED",
          entityType: "COST_CENTER", entityId: id,
          previousValue: { isActive: previous.isActive }, newValue: { isActive }, ip, userAgent,
        });
      } else if (type === "project") {
        const previous = await tx.paymentProject.findUnique({ where: { id }, select: { isActive: true } });
        if (!previous) throw Object.assign(new Error("Master value not found."), { code: "P2025" });
        await tx.paymentProject.update({ where: { id }, data: { isActive } });
        if (previous.isActive !== isActive) await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName,
          action: isActive ? "PAYMENT_PROJECT_ACTIVATED" : "PAYMENT_PROJECT_DEACTIVATED",
          entityType: "PAYMENT_PROJECT", entityId: id,
          previousValue: { isActive: previous.isActive }, newValue: { isActive }, ip, userAgent,
        });
      } else {
        const previous = await tx.paymentFinancialRule.findUnique({ where: { id }, select: { isActive: true } });
        if (!previous) throw Object.assign(new Error("Master value not found."), { code: "P2025" });
        await tx.paymentFinancialRule.update({ where: { id }, data: { isActive } });
        if (previous.isActive !== isActive) await recordAudit(tx, {
          actorId: access.user.id, actorName: access.user.fullName,
          action: isActive ? "PAYMENT_FINANCIAL_RULE_ACTIVATED" : "PAYMENT_FINANCIAL_RULE_DEACTIVATED",
          entityType: "PAYMENT_FINANCIAL_RULE", entityId: id,
          previousValue: { isActive: previous.isActive }, newValue: { isActive }, ip, userAgent,
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate?.code === "P2025") return jsonError("Master value not found.", 404);
    throw error;
  }
}
