import 'server-only';

import { WhatsAppAPI } from 'whatsapp-api-js';
import {
  Text,
  Template,
  Language,
  BodyComponent,
  BodyParameter,
  HeaderComponent,
  HeaderParameter,
  URLComponent,
  Image,
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
    // IMAGE-header templates (e.g. kalfa_event_invite_media_v1): the actual
    // per-event image, as a short-lived signed URL or a WhatsApp media id —
    // resolved upstream; this adapter never touches storage.
    headerImage?: { link: string } | { mediaId: string };
    // URL-button variable — the suffix Meta appends to the template's static
    // button URL (e.g. the event's gift_link_token for kalfa_event_gift_v1).
    urlButtonParam?: string;
  },
): Promise<{ providerId: string }> {
  // secure:false avoids requiring the appSecret for SENDING (the secret is only
  // needed to verify INBOUND webhooks, handled in B2).
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  // whatsapp-api-js 6.x: Template(name, language, ...components); a positional
  // body is one BodyComponent whose BodyParameter order is the {{i}} order;
  // button component indexes are assigned by constructor order.
  const components: (HeaderComponent | BodyComponent | URLComponent)[] = [];
  if (params.headerImage) {
    const image =
      'link' in params.headerImage
        ? new Image(params.headerImage.link)
        : new Image(params.headerImage.mediaId, true);
    components.push(new HeaderComponent(new HeaderParameter(image)));
  }
  if (params.bodyParams && params.bodyParams.length > 0) {
    components.push(
      new BodyComponent(
        new BodyParameter(params.bodyParams[0]),
        ...params.bodyParams.slice(1).map((p) => new BodyParameter(p)),
      ),
    );
  }
  if (params.urlButtonParam) {
    components.push(new URLComponent(params.urlButtonParam));
  }
  const message =
    components.length > 0
      ? new Template(
          params.templateName,
          new Language(params.language),
          ...(components as [HeaderComponent | BodyComponent | URLComponent]),
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

// Free-form session message — allowed ONLY inside the 24h customer-service
// window a guest opened by replying (e.g. the headcount question right after
// an RSVP button press). No template, no marketing cap. Same logging rules:
// never log token/recipient/body.
export async function sendWhatsAppText(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: { to: string; body: string },
): Promise<{ providerId: string }> {
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  let res: { messages?: Array<{ id?: string | null } | null> };
  try {
    res = (await api.sendMessage(
      cfg.phoneNumberId,
      params.to,
      new Text(params.body),
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
