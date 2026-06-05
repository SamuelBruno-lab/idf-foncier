/**
 * Couche e-signature provider-agnostique pour les contrats de mandat.
 *
 * Le DOCX rempli est envoyé tel quel au prestataire eIDAS, qui produit le PDF
 * signé (couche juridiquement probante, cf. Art. 16 du contrat). Aucune
 * conversion PDF côté serveur n'est nécessaire.
 *
 * Provider sélectionné via ESIGN_PROVIDER = "yousign" | "docusign" (défaut yousign).
 *
 * ⚠️ SCAFFOLD : l'appel réseau réel reste à finaliser une fois le prestataire
 *    choisi et les clés API fournies (voir variables d'env ci-dessous).
 *    Tant que ce n'est pas configuré, isEsignConfigured() renvoie false et les
 *    routes n'envoient pas (génération du DOCX inchangée).
 *
 * Variables d'environnement attendues :
 *   ESIGN_PROVIDER          yousign | docusign
 *   YOUSIGN_API_KEY         (si yousign)  — https://developers.yousign.com
 *   YOUSIGN_BASE_URL        défaut https://api.yousign.com (prod) / sandbox
 *   DOCUSIGN_*              (si docusign) — à compléter selon l'intégration JWT
 */

export type EsignRequest = {
  docxBuffer: Buffer;
  filename: string;
  signerEmail: string;
  signerFirstName: string;
  signerLastName: string;
  /** Optionnel — requis si signature_authentication_mode = "otp_sms". */
  signerPhone?: string;
  subject: string;
};

export type EsignResult = {
  ok: boolean;
  provider: string;
  /** Identifiant de la demande de signature chez le prestataire. */
  request_id?: string;
  /** Lien de signature à transmettre au signataire (si applicable). */
  signature_url?: string;
  error?: string;
};

export function esignProvider(): string {
  return (process.env.ESIGN_PROVIDER || "yousign").toLowerCase();
}

/** True si le prestataire est configuré (clés présentes). */
export function isEsignConfigured(): boolean {
  switch (esignProvider()) {
    case "yousign":
      return Boolean(process.env.YOUSIGN_API_KEY);
    case "docusign":
      return Boolean(process.env.DOCUSIGN_INTEGRATION_KEY);
    default:
      return false;
  }
}

/**
 * Envoie le DOCX au prestataire pour signature.
 * @throws si le provider n'est pas configuré.
 */
export async function sendForSignature(req: EsignRequest): Promise<EsignResult> {
  const provider = esignProvider();
  if (!isEsignConfigured()) {
    throw new Error(`e-signature non configurée (provider=${provider})`);
  }
  switch (provider) {
    case "yousign":
      return sendYousign(req);
    case "docusign":
      return sendDocusign(req);
    default:
      throw new Error(`provider e-signature inconnu : ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Yousign — API v3 (procédure : créer une signature request → ajouter document
// → ajouter signataire → activer). Squelette à finaliser avec les endpoints.
// Docs : https://developers.yousign.com/reference
// ───────────────────────────────────────────────────────────────────────────
async function sendYousign(req: EsignRequest): Promise<EsignResult> {
  const apiKey = process.env.YOUSIGN_API_KEY!;
  const baseUrl = (process.env.YOUSIGN_BASE_URL || "https://api.yousign.com").replace(/\/$/, "");

  // Niveau de signature + mode d'authentification (configurables).
  // "electronic_signature" = SES (suffisant pour ce contrat). OTP par email
  // par défaut (pas besoin du téléphone). Passer à "otp_sms" si souhaité.
  const signatureLevel = process.env.YOUSIGN_SIGNATURE_LEVEL || "electronic_signature";
  const authMode = process.env.YOUSIGN_AUTH_MODE || "otp_email";

  // Position du champ de signature dans le PDF rendu par Yousign.
  // ⚠️ À calibrer une fois sur le rendu réel (page du bloc « Pour le Mandataire »).
  const signPage = Number(process.env.YOUSIGN_SIGN_PAGE || "1");
  const signX = Number(process.env.YOUSIGN_SIGN_X || "320");
  const signY = Number(process.env.YOUSIGN_SIGN_Y || "680");
  const signW = Number(process.env.YOUSIGN_SIGN_WIDTH || "180");
  const signH = Number(process.env.YOUSIGN_SIGN_HEIGHT || "60");

  const jsonHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // 1) Créer la signature request (état draft)
  const created = await fetch(`${baseUrl}/v3/signature_requests`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: req.subject, delivery_mode: "email" }),
  });
  if (!created.ok) {
    return { ok: false, provider: "yousign", error: `create ${created.status}: ${await safeText(created)}` };
  }
  const sr = (await created.json()) as { id: string };

  // 2) Uploader le document
  const form = new FormData();
  form.append("nature", "signable_document");
  form.append(
    "file",
    new Blob([new Uint8Array(req.docxBuffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    req.filename,
  );
  const docRes = await fetch(`${baseUrl}/v3/signature_requests/${sr.id}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!docRes.ok) {
    return { ok: false, provider: "yousign", request_id: sr.id, error: `document ${docRes.status}: ${await safeText(docRes)}` };
  }
  const document = (await docRes.json()) as { id: string };

  // 3) Ajouter le signataire + son champ de signature
  const signerRes = await fetch(`${baseUrl}/v3/signature_requests/${sr.id}/signers`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      info: {
        first_name: req.signerFirstName,
        last_name: req.signerLastName,
        email: req.signerEmail,
        locale: "fr",
        ...(req.signerPhone ? { phone_number: req.signerPhone } : {}),
      },
      signature_level: signatureLevel,
      signature_authentication_mode: authMode,
      fields: [
        {
          document_id: document.id,
          type: "signature",
          page: signPage,
          x: signX,
          y: signY,
          width: signW,
          height: signH,
        },
      ],
    }),
  });
  if (!signerRes.ok) {
    return { ok: false, provider: "yousign", request_id: sr.id, error: `signer ${signerRes.status}: ${await safeText(signerRes)}` };
  }

  // 4) Activer la signature request (déclenche l'envoi de l'email au signataire)
  const activated = await fetch(`${baseUrl}/v3/signature_requests/${sr.id}/activate`, {
    method: "POST",
    headers: jsonHeaders,
  });
  if (!activated.ok) {
    return { ok: false, provider: "yousign", request_id: sr.id, error: `activate ${activated.status}: ${await safeText(activated)}` };
  }

  return { ok: true, provider: "yousign", request_id: sr.id };
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 300);
  } catch {
    return "";
  }
}

// ───────────────────────────────────────────────────────────────────────────
// DocuSign — eSignature REST API (JWT grant). À implémenter si retenu.
// ───────────────────────────────────────────────────────────────────────────
async function sendDocusign(_req: EsignRequest): Promise<EsignResult> {
  throw new Error("Intégration DocuSign non implémentée (scaffold).");
}
