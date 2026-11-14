import type { EmailMessage, Mailer } from './mailer.ts';

/** A mailer for tests: it keeps what it was asked to send, and can be told to fail. */
export function createMemoryMailer() {
  const sent: EmailMessage[] = [];
  const failures: Error[] = [];

  const mailer: Mailer = {
    send(message) {
      const failure = failures.shift();
      if (failure) return Promise.reject(failure);
      sent.push(message);
      return Promise.resolve({ messageId: `<${String(sent.length)}@memory.test>` });
    },
    verify() {
      return Promise.resolve();
    },
  };

  return {
    mailer,
    sent,
    /** The next `send` rejects with this error instead of sending. Call again to fail more. */
    failNext: (error = new Error('SMTP server unavailable')) => {
      failures.push(error);
    },
  };
}
