import { Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import type { Notification, NotificationChannel, Recipient } from './notifications.service';

export class LogChannel implements NotificationChannel {
  readonly name = 'log';
  private readonly logger = new Logger('Notification');
  accepts(): boolean {
    return true;
  }
  async send(to: Recipient, n: Notification): Promise<void> {
    this.logger.log(`→ ${to.email} [${n.topic}] ${n.title}`);
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** SMTP e-mail for warning/critical notifications. */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly appUrl: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  accepts(n: Notification): boolean {
    return n.severity === 'warning' || n.severity === 'critical';
  }

  async send(to: Recipient, n: Notification): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: `"${to.fullName.replace(/"/g, '')}" <${to.email}>`,
      subject: `[FMS] ${n.title}`,
      text: `${n.body}\n\nOpen the Fleet Management console: ${this.appUrl}`,
      html: `<p>${escape(n.body)}</p><p><a href="${escape(this.appUrl)}">Open the Fleet Management console</a></p>`,
    });
  }
}
