import fs from 'fs';
import path from 'path';
import { SetupDiagnostics, TelegramConfig } from '../types';

export interface EntryAlertPayload {
  symbol: string;
  timeframe: string;
  price: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  candleTimestamp?: number;
  diagnostics?: SetupDiagnostics | null;
}

export class TelegramNotifier {
  private config: TelegramConfig;
  private configPath: string;
  private lastAlertByKey = new Map<string, number>();

  constructor(dataDir = path.join(process.cwd(), 'data')) {
    this.configPath = path.join(dataDir, 'telegram_config.json');
    this.config = this.loadConfig();
  }

  private loadConfig(): TelegramConfig {
    const defaults: TelegramConfig = {
      enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      minScore: Number(process.env.TELEGRAM_MIN_SCORE || 75),
      cooldownMinutes: 15
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<TelegramConfig>;
        return {
          ...defaults,
          ...raw
        };
      }
    } catch {
      // Ignore corrupt config
    }

    return defaults;
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // Ignore disk write failure
    }
  }

  getPublicConfig() {
    const token = this.config.botToken;
    const maskedToken = token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : token ? '***' : '';
    return {
      enabled: this.config.enabled,
      configured: Boolean(this.config.botToken && this.config.chatId),
      maskedToken,
      chatId: this.config.chatId,
      minScore: this.config.minScore,
      cooldownMinutes: this.config.cooldownMinutes
    };
  }

  configure(partial: Partial<TelegramConfig>) {
    if (typeof partial.enabled === 'boolean') this.config.enabled = partial.enabled;
    if (partial.botToken && !partial.botToken.includes('...')) {
      this.config.botToken = partial.botToken.trim();
    }
    if (partial.chatId !== undefined) {
      this.config.chatId = String(partial.chatId).trim();
    }
    if (partial.minScore !== undefined) {
      this.config.minScore = Math.min(100, Math.max(20, Number(partial.minScore)));
    }
    if (partial.cooldownMinutes !== undefined) {
      this.config.cooldownMinutes = Math.max(1, Number(partial.cooldownMinutes));
    }

    // Auto-enable when user saves valid credentials explicitly
    if (partial.botToken && partial.chatId && partial.enabled === undefined) {
      this.config.enabled = true;
    }

    this.saveConfig();
    return this.getPublicConfig();
  }

  async sendRawMessage(text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.botToken || !this.config.chatId) {
      return { ok: false, error: 'Telegram Bot Token or Chat ID is not configured.' };
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const json = (await res.json()) as { ok?: boolean; description?: string };
      if (!res.ok || !json.ok) {
        return { ok: false, error: json.description || `Telegram HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Network error sending Telegram message' };
    }
  }

  formatEntryMessage(payload: EntryAlertPayload): string {
    const d = payload.diagnostics;
    const entry = payload.price;
    const sl = payload.stopLoss || d?.suggestedStopLoss || entry * 0.99;
    const tp = payload.takeProfit || d?.suggestedTakeProfit || entry * 1.025;
    const slPct = (((sl - entry) / entry) * 100).toFixed(2);
    const tpPct = (((tp - entry) / entry) * 100).toFixed(2);
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '2.50';

    const score = d?.score ?? 80;
    const quality = d?.entryQuality ?? 'A+ ENTRY';
    const structure = d?.structureState ?? 'SWEEP_RECLAIM';

    const checklistLines = d
      ? [
          `• EMA Structure: ${d.emaAligned ? '✅ PASS' : '⏳ WAIT'}`,
          `• VWAP Reaction: ${d.vwapReaction ? '✅ PASS' : '⏳ WAIT'} ($${d.vwap.toFixed(2)})`,
          `• Liquidity Sweep: ${d.liquiditySwept ? '✅ PASS' : '⏳ WAIT'} (SSL $${d.sellSideLiquidity.toFixed(2)})`,
          `• Rejection Wick: ${d.wickConfirmed ? '✅ PASS' : '⏳ WAIT'}`
        ].join('\n')
      : '• Structure Trigger Confirmed';

    return [
      `🚨 <b>AETHERQUANT — ${quality} DETECTED</b>`,
      ``,
      `<b>Asset:</b> ${payload.symbol} (${payload.timeframe})`,
      `<b>Structure:</b> ${structure} · <b>Score:</b> ${score}%`,
      ``,
      `📍 <b>Entry Price:</b> <code>$${entry.toFixed(2)}</code>`,
      `🛑 <b>Stop Loss (SL):</b> <code>$${sl.toFixed(2)}</code> (${slPct}%)`,
      `🎯 <b>Take Profit (TP):</b> <code>$${tp.toFixed(2)}</code> (+${tpPct}% | 1:${rr} R:R)`,
      ``,
      `<b>Confluence Checklist:</b>`,
      checklistLines,
      ``,
      `📝 <i>${payload.reason}</i>`
    ].join('\n');
  }

  async notifyEntrySetup(payload: EntryAlertPayload, force = false): Promise<{ sent: boolean; reason: string; preview: string }> {
    const preview = this.formatEntryMessage(payload);

    if (!force && !this.config.enabled) {
      return { sent: false, reason: 'Telegram alerts disabled', preview };
    }
    if (!this.config.botToken || !this.config.chatId) {
      return { sent: false, reason: 'Telegram credentials missing', preview };
    }

    const score = payload.diagnostics?.score ?? 100;
    if (!force && score < this.config.minScore) {
      return { sent: false, reason: `Score ${score}% below threshold ${this.config.minScore}%`, preview };
    }

    const dedupKey = `${payload.symbol}:${payload.timeframe}:${payload.candleTimestamp || 'manual'}`;
    const lastSent = this.lastAlertByKey.get(dedupKey);
    const cooldownMs = this.config.cooldownMinutes * 60 * 1000;

    if (!force && lastSent && Date.now() - lastSent < cooldownMs) {
      return { sent: false, reason: 'Cooldown active for this setup', preview };
    }

    const result = await this.sendRawMessage(preview);
    if (result.ok) {
      this.lastAlertByKey.set(dedupKey, Date.now());
      return { sent: true, reason: 'Telegram message delivered', preview };
    }
    return { sent: false, reason: result.error || 'Telegram delivery failed', preview };
  }

  async notifyTradeEvent(title: string, details: string): Promise<void> {
    if (!this.config.enabled || !this.config.botToken || !this.config.chatId) return;
    await this.sendRawMessage(`🤖 <b>${title}</b>\n${details}`);
  }

  async sendTestMessage(): Promise<{ ok: boolean; error?: string }> {
    return this.sendRawMessage(
      `✅ <b>AetherQuant Telegram Bridge Connected!</b>\n\nYou will receive automatic alerts with exact <b>Entry</b>, <b>Stop Loss (SL)</b>, and <b>Take Profit (TP)</b> levels whenever the market structure spots an A+ entry setup.`
    );
  }
}
