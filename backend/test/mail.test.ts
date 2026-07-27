import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the Resend send spy so we can assert the send path runs.
const sendSpy = vi.fn().mockResolvedValue({ error: null });
vi.mock("resend", () => ({
  // A real class so `new Resend(key)` in mail.ts works as a constructor.
  Resend: class {
    emails = { send: sendSpy };
  },
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>hi</html>"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("mail.sendWelcomeEmail", () => {
  it("no-ops gracefully when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { sendWelcomeEmail } = await import("../src/mail");
    await expect(sendWelcomeEmail("to@x", "erik")).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("renders and sends the welcome email when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const { sendWelcomeEmail } = await import("../src/mail");
    await sendWelcomeEmail("to@x", "erik");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0][0];
    expect(arg).toMatchObject({ to: "to@x", subject: expect.stringContaining("Welcome") });
    expect(arg.html).toBe("<html>hi</html>");
  });

  it("swallows a Resend error instead of throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    sendSpy.mockResolvedValueOnce({ error: { message: "boom" } });
    const { sendWelcomeEmail } = await import("../src/mail");
    await expect(sendWelcomeEmail("to@x", "erik")).resolves.toBeUndefined();
  });
});
