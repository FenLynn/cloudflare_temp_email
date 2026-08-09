import { Context } from "hono";
import { commonParseMail, handleListQuery } from "../common";

type MailNotificationRow = {
    id: number;
    source: string | null;
    address: string | null;
    raw: string | null;
    metadata: string | null;
    created_at: string | null;
};

type AiExtractResult = {
    type?: string;
    result?: string;
};

const DEFAULT_NOTIFICATION_LIMIT = 8;
const MAX_NOTIFICATION_LIMIT = 20;
const MAX_SNIPPET_LENGTH = 180;

const normalizeWhitespace = (value: string): string => (
    String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
);

const decodeBasicHtmlEntities = (value: string): string => (
    String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
);

const htmlToText = (value: string): string => normalizeWhitespace(
    decodeBasicHtmlEntities(
        String(value || "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
    )
);

const normalizeSender = (parsedSender: string, fallback: string): string => {
    const value = normalizeWhitespace(parsedSender || fallback);
    const undefinedName = value.match(/^undefined\s*<([^>]+)>$/i);
    return undefinedName ? undefinedName[1] : value;
};

const readAiExtract = (metadata: string | null): AiExtractResult | null => {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata) as { ai_extract?: AiExtractResult };
        return parsed?.ai_extract || null;
    } catch {
        return null;
    }
};

const normalizeVerificationCode = (value: string, trusted = false): string => {
    const compact = String(value || "").trim().replace(/[\s-]+/g, "");
    if (!compact || compact.length > (trusted ? 32 : 8)) return "";
    if (trusted) return compact;
    return /^(?=.*\d)[a-z0-9]{4,8}$/i.test(compact) ? compact : "";
};

export const extractVerificationCode = (
    subject: string,
    content: string,
    metadata: string | null
): string => {
    const aiExtract = readAiExtract(metadata);
    if (aiExtract?.type === "auth_code") {
        const trustedCode = normalizeVerificationCode(aiExtract.result || "", true);
        if (trustedCode) return trustedCode;
    }

    const text = `${subject || ""}\n${content || ""}`.slice(0, 5000);
    const patterns = [
        /(?:临时验证码|验证码|校验码|认证码|动态码|安全码|确认码|激活码|登录码|登录代码|一次性密码)[\s\S]{0,32}?(\d{4,8})(?!\d)/i,
        /(?:验证码|校验码|认证码|动态码|安全码|确认码|激活码|登录码|一次性密码)\s*(?:是|为|[:：-])?\s*([a-z0-9][a-z0-9\s-]{2,14})/i,
        /(?:verification|security|authentication|confirmation|login|one[- ]time)\s*(?:code|password|pin)?\s*(?:is|[:：-])?\s*([a-z0-9][a-z0-9\s-]{2,14})/i,
        /(?:otp|passcode)\s*(?:is|[:：-])?\s*([a-z0-9][a-z0-9\s-]{2,14})/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        const code = normalizeVerificationCode(match?.[1] || "");
        if (code) return code;
    }
    return "";
};

const parseNotificationLimit = (value: unknown): number => {
    const parsed = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_NOTIFICATION_LIMIT;
    return Math.min(Math.max(parsed, 1), MAX_NOTIFICATION_LIMIT);
};

const buildNotification = async (row: MailNotificationRow) => {
    const parsed = row.raw
        ? await commonParseMail({ rawEmail: row.raw }).catch(() => undefined)
        : undefined;
    const text = normalizeWhitespace(parsed?.text || htmlToText(parsed?.html || ""));
    const subject = normalizeWhitespace(parsed?.subject || "") || "（无主题）";
    const hasAttachments = Boolean(parsed?.attachments?.length);
    const html = String(parsed?.html || "");
    const isComplex = hasAttachments
        || text.length > 1200
        || /<(?:table|img|style|video|audio)\b/i.test(html);

    return {
        id: row.id,
        sender: normalizeSender(parsed?.sender || "", row.source || "未知发件人"),
        recipient: normalizeWhitespace(row.address || ""),
        subject,
        snippet: text.slice(0, MAX_SNIPPET_LENGTH),
        receivedAt: row.created_at || "",
        verificationCode: extractVerificationCode(subject, text, row.metadata),
        hasAttachments,
        isComplex,
    };
};

export const getMailNotifications = async (
    env: Pick<Bindings, "DB">,
    requestedLimit: unknown = DEFAULT_NOTIFICATION_LIMIT
) => {
    const limit = parseNotificationLimit(requestedLimit);
    const [{ results }, countRow] = await Promise.all([
        env.DB.prepare(
            `SELECT id, source, address, raw, metadata, created_at
             FROM raw_mails ORDER BY id DESC LIMIT ?`
        ).bind(limit).all<MailNotificationRow>(),
        env.DB.prepare(`SELECT COUNT(*) AS count FROM raw_mails`).first<{ count: number }>(),
    ]);
    const items = await Promise.all((results || []).map(buildNotification));

    return {
        items,
        total: Number(countRow?.count || 0),
        latestId: items[0]?.id || null,
        generatedAt: new Date().toISOString(),
    };
};

export default {
    getMails: async (c: Context<HonoCustomType>) => {
        const { address, limit, offset } = c.req.query();
        const addressQuery = address ? `address = ?` : "";
        const addressParams = address ? [address] : [];
        const filterQuerys = [addressQuery].filter((item) => item).join(" and ");
        const finalQuery = filterQuerys.length > 0 ? `where ${filterQuerys}` : "";
        const filterParams = [...addressParams]
        return await handleListQuery(c,
            `SELECT * FROM raw_mails ${finalQuery}`,
            `SELECT count(*) as count FROM raw_mails ${finalQuery}`,
            filterParams, limit, offset
        );
    },
    getUnknowMails: async (c: Context<HonoCustomType>) => {
        const { limit, offset } = c.req.query();
        return await handleListQuery(c,
            `SELECT * FROM raw_mails where address NOT IN (select name from address) `,
            `SELECT count(*) as count FROM raw_mails`
            + ` where address NOT IN (select name from address) `,
            [], limit, offset
        );
    },
    getNotifications: async (c: Context<HonoCustomType>) => {
        const payload = await getMailNotifications(c.env, c.req.query("limit"));

        c.header("Cache-Control", "no-store");
        c.header("Pragma", "no-cache");
        return c.json(payload);
    },
    deleteMail: async (c: Context<HonoCustomType>) => {
        const { id } = c.req.param();
        const { success } = await c.env.DB.prepare(
            `DELETE FROM raw_mails WHERE id = ? `
        ).bind(id).run();
        return c.json({
            success: success
        })
    }
}
