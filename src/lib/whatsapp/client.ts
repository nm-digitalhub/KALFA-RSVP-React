import 'server-only';

import { WhatsAppAPI } from 'whatsapp-api-js';
import {
  Template,
  Language,
  BodyComponent,
  BodyParameter,
} from 'whatsapp-api-js/messages';

// WhatsApp Cloud API send adapter (approved templates only — free text is only
// allowed inside the 24h customer-service window). Thin wrapper over
// whatsapp-api-js. Never log the access token, recipient, or message body.

export class WhatsAppSendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WhatsAppSendError';
  }
}

export async function sendWhatsAppTemplate(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: {
    to: string;
    templateName: string;
    language: string;
    // Positional body parameters ({{1}}..{{n}}, in order) for templates that
    // declare body variables — built upstream by buildTemplateParams
    // (template-spec.ts), which guarantees none is empty. Omitted → the
    // template is sent bare, exactly as before (templates with no variables).
    bodyParams?: readonly string[];
  },
): Promise<{ providerId: string }> {
  // secure:false avoids requiring the appSecret for SENDING (the secret is only
  // needed to verify INBOUND webhooks, handled in B2).
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  // whatsapp-api-js 6.x: Template(name, language, ...components); a positional
  // body is one BodyComponent whose BodyParameter order is the {{i}} order.
  const message =
    params.bodyParams && params.bodyParams.length > 0
      ? new Template(
          params.templateName,
          new Language(params.language),
          new BodyComponent(
            new BodyParameter(params.bodyParams[0]),
            ...params.bodyParams.slice(1).map((p) => new BodyParameter(p)),
          ),
        )
      : new Template(params.templateName, new Language(params.language));

  let res: { messages?: Array<{ id?: string | null } | null> };
  try {
    res = (await api.sendMessage(
      cfg.phoneNumberId,
      params.to,
      message,
    )) as typeof res;
  } catch {
    throw new WhatsAppSendError('שליחת הודעת וואטסאפ נכשלה');
  }

  const providerId = res?.messages?.[0]?.id;
  if (!providerId) {
    throw new WhatsAppSendError('לא התקבל מזהה הודעה מוואטסאפ');
  }
  return { providerId };
}
