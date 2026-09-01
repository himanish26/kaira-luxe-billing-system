const nodemailer = require("nodemailer");

let integrationConfigService = null;

function setIntegrationConfigService(service) { integrationConfigService = service; }

async function getSmtpSettings() {
    if (!integrationConfigService) throw new Error("Email configuration service is unavailable.");
    const settings = integrationConfigService.resolveEmailRuntime();
    if (!settings.host || !settings.user || !settings.password || !settings.from) {
        throw new Error("Email configuration is incomplete.");
    }
    return settings;
}

async function createTransporter() {
    const smtp = await getSmtpSettings();
    return nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS,
        auth: { user: smtp.user, pass: smtp.password }
    });
}

async function sendEmail({ to, subject, text, html, attachments }) {
    const transporter = await createTransporter();
    const smtp = await getSmtpSettings();
    const info = await transporter.sendMail({ from: smtp.from, to, subject, text, html, attachments });
    return { success: true, messageId: info.messageId };
}

function classifyEmailError(error) {
    const code = String(error && error.code || "").toUpperCase();
    const message = String(error && error.message || "");
    if (/auth|credential|login/i.test(message) || code === "EAUTH") return "AUTHENTICATION FAILED";
    if (/timed?\s*out/i.test(message) || code === "ETIMEDOUT") return "CONNECTION TIMED OUT";
    if (/tls|certificate|ssl/i.test(message)) return "TLS ERROR";
    if (/incomplete|configuration|unavailable/i.test(message)) return "CONFIGURATION INCOMPLETE";
    return "SMTP SERVER UNREACHABLE";
}

async function verifyEmailConnection() {
    try {
        const transporter = await createTransporter();
        await transporter.verify();
        return { success: true };
    }
    catch (error) { return { success: false, error: classifyEmailError(error) }; }
}

async function sendTestEmail(recipient) {
    const smtp = await getSmtpSettings();
    if (!(smtp.recipients || []).includes(recipient)) {
        throw new Error("Select a configured backup recipient.");
    }
    return sendEmail({
        to: recipient,
        subject: "KAIRA LUXE - SMTP Configuration Test",
        text: "This is a KLBS configuration test email. No business data is included."
    });
}

module.exports = {
    sendEmail, verifyEmailConnection, sendTestEmail,
    setIntegrationConfigService, classifyEmailError
};
