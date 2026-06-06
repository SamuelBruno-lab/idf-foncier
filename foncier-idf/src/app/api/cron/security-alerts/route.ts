/**
 * Cron quotidien : détection + notification des alertes de sécurité RGPD.
 *
 * Schedule : tous les jours à 8h UTC (configurer dans vercel.json).
 *
 * Workflow :
 *   1. Appelle public.detect_security_anomalies() (Supabase)
 *      → insère les nouvelles alertes dans security_alerts
 *   2. Récupère les alertes "open" non encore notifiées
 *   3. Pour chaque alerte, envoie un email Resend à Samuel
 *   4. Marque comme notified_admin_at
 *
 * Sécurité : protégé par CRON_SECRET (header x-cron-secret) ou par
 * le système d'auth Vercel cron natif (Authorization: Bearer xxx).
 *
 * Note RGPD article 33 :
 *   En cas d'alerte severity='BREACH', un email URGENT est envoyé
 *   à Samuel avec mention "NOTIFICATION CNIL <72H REQUISE".
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.SECURITY_ADMIN_EMAIL ?? "samuel@datamerry.com";
const FROM = "DATAMERRY Security <onboarding@resend.dev>";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

interface SecurityAlert {
  id: string;
  cabinet_slug: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL" | "BREACH";
  category: string;
  title: string;
  description: string | null;
  evidence: Record<string, unknown>;
  detected_at: string;
}

function severityBadge(s: SecurityAlert["severity"]): string {
  switch (s) {
    case "BREACH":
      return "🚨 BREACH RGPD";
    case "CRITICAL":
      return "🔴 CRITICAL";
    case "WARNING":
      return "🟡 WARNING";
    case "INFO":
      return "🔵 INFO";
  }
}

function severityColor(s: SecurityAlert["severity"]): string {
  switch (s) {
    case "BREACH":
      return "#7f1d1d";
    case "CRITICAL":
      return "#dc2626";
    case "WARNING":
      return "#d97706";
    case "INFO":
      return "#2563eb";
  }
}

function buildEmailHtml(alerts: SecurityAlert[]): string {
  const rows = alerts
    .map(
      (a) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
          <span style="color:${severityColor(a.severity)};font-weight:700;font-size:11px;text-transform:uppercase;">
            ${severityBadge(a.severity)}
          </span>
          <div style="font-weight:700;color:#0f172a;margin-top:4px;">${a.title}</div>
          <div style="color:#64748b;font-size:12px;margin-top:2px;">${a.description ?? ""}</div>
          <div style="color:#9ca3af;font-size:11px;margin-top:6px;">
            ${a.cabinet_slug ? `Cabinet : <strong>${a.cabinet_slug}</strong> · ` : ""}
            Détecté : ${new Date(a.detected_at).toLocaleString("fr-FR")}
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const breachCount = alerts.filter((a) => a.severity === "BREACH").length;
  const criticalCount = alerts.filter((a) => a.severity === "CRITICAL").length;

  const urgentBanner =
    breachCount > 0
      ? `<div style="background:#7f1d1d;color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:18px;">
          <strong>🚨 NOTIFICATION CNIL &lt; 72H REQUISE</strong><br>
          <span style="font-size:13px;">${breachCount} violation(s) RGPD détectée(s). Article 33 — notification obligatoire dans les 72h suivant la prise de connaissance.</span>
        </div>`
      : "";

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0;">
    <div style="font-size:11px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">
      Rapport quotidien de sécurité RGPD
    </div>
    <h1 style="font-size:22px;color:#064e3b;margin:0 0 16px 0;">
      ${alerts.length} alerte${alerts.length > 1 ? "s" : ""} de sécurité
    </h1>
    ${urgentBanner}
    <div style="color:#64748b;font-size:13px;line-height:1.5;margin-bottom:18px;">
      Le système de monitoring DATAMERRY a détecté
      <strong>${alerts.length}</strong> nouvelle${alerts.length > 1 ? "s" : ""} alerte${alerts.length > 1 ? "s" : ""}
      dans les dernières 24 heures
      ${breachCount > 0 ? `(${breachCount} BREACH, ` : "("}${criticalCount} CRITICAL).
    </div>

    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px;overflow:hidden;">
      ${rows}
    </table>

    <div style="margin-top:24px;padding:14px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;">
      <strong>📋 Actions recommandées :</strong>
      <ul style="margin:8px 0 0 18px;padding:0;line-height:1.6;">
        <li>Connecte-toi à Supabase Studio pour consulter la table <code>security_alerts</code></li>
        <li>Pour chaque alerte, change le <code>status</code> à <code>investigating</code> puis <code>resolved</code></li>
        <li>En cas de BREACH : déclencher la notification CNIL via <a href="https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles" style="color:#92400e;">cnil.fr</a></li>
      </ul>
    </div>

    <div style="margin-top:18px;font-size:10px;color:#9ca3af;text-align:center;">
      Cron quotidien — DATAMERRY Security Monitor<br>
      Eurealimmo SARL · SIREN 984 449 470
    </div>
  </div>
</body></html>`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ---- Auth : Vercel cron OR header x-cron-secret ----
  const isVercelCron = req.headers.get("user-agent")?.includes("vercel-cron");
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!isVercelCron) {
    if (!expectedSecret || cronSecret !== expectedSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const sb = getSupabase();

  // ---- 1. Lancer la détection des anomalies ----
  const { data: detectResult, error: detectErr } = await sb.rpc(
    "detect_security_anomalies",
  );
  if (detectErr) {
    console.error("[cron/security-alerts] detect failed:", detectErr);
    return NextResponse.json(
      { error: "detect_failed", message: detectErr.message },
      { status: 500 },
    );
  }
  const newAlerts =
    Array.isArray(detectResult) && detectResult[0]?.alerts_created
      ? Number(detectResult[0].alerts_created)
      : 0;

  // ---- 2. Récupérer les alertes non notifiées ----
  const { data: alertsToNotify, error: fetchErr } = await sb.rpc(
    "get_open_alerts_to_notify",
  );
  if (fetchErr) {
    console.error("[cron/security-alerts] fetch failed:", fetchErr);
    return NextResponse.json(
      { error: "fetch_failed", message: fetchErr.message },
      { status: 500 },
    );
  }

  const alerts = (alertsToNotify ?? []) as SecurityAlert[];

  if (alerts.length === 0) {
    return NextResponse.json({
      ok: true,
      detected: newAlerts,
      notified: 0,
      message: "Aucune alerte à notifier",
    });
  }

  // ---- 3. Envoyer email à Samuel via Resend ----
  let emailOk = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const breachCount = alerts.filter((a) => a.severity === "BREACH").length;
      const subject =
        breachCount > 0
          ? `🚨 [BREACH RGPD x${breachCount}] Notification CNIL <72h requise`
          : `🔒 ${alerts.length} alerte(s) de sécurité DATAMERRY`;

      const result = await resend.emails.send({
        from: FROM,
        to: ADMIN_EMAIL,
        subject,
        html: buildEmailHtml(alerts),
      });
      emailOk = !(result as { error?: unknown }).error;
      console.log(
        "[cron/security-alerts] Resend response:",
        JSON.stringify({
          to: ADMIN_EMAIL,
          subject,
          alert_count: alerts.length,
          ok: emailOk,
          error: (result as { error?: unknown }).error,
        }),
      );
    } catch (err) {
      console.error("[cron/security-alerts] Resend exception:", err);
    }
  } else {
    console.warn(
      "[cron/security-alerts] RESEND_API_KEY non configuré — pas d'email envoyé",
    );
  }

  // ---- 4. Marquer comme notifié (best-effort) ----
  if (emailOk) {
    for (const alert of alerts) {
      await sb.rpc("mark_alert_notified", { p_alert_id: alert.id });
    }
  }

  return NextResponse.json({
    ok: true,
    detected: newAlerts,
    fetched: alerts.length,
    email_sent: emailOk,
    notified: emailOk ? alerts.length : 0,
  });
}
