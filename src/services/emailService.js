const nodemailer = require("nodemailer");

const {
    getSettings
} = require("../database/settingsService");


/* ===========================================
   GET SMTP SETTINGS
=========================================== */

async function getSmtpSettings() {

    const settings =
        await getSettings();

    return {

        host:
            settings?.smtp_host ||
            process.env.SMTP_HOST ||
            "smtp.gmail.com",

        port:
            Number(
                settings?.smtp_port ||
                process.env.SMTP_PORT ||
                587
            ),

        secure:
            settings?.smtp_secure !== null &&
            settings?.smtp_secure !== undefined
                ? Number(settings.smtp_secure) === 1
                : process.env.SMTP_SECURE === "true",

        user:
            settings?.smtp_user ||
            process.env.SMTP_USER,

        password:
            settings?.smtp_password ||
            process.env.SMTP_PASSWORD,

        from:
            settings?.smtp_from ||
            process.env.SMTP_FROM ||
            settings?.smtp_user ||
            process.env.SMTP_USER

    };

}


/* ===========================================
   CREATE SMTP TRANSPORTER
=========================================== */

async function createTransporter() {

    const smtp =
        await getSmtpSettings();

    return nodemailer.createTransport({

        host:
            smtp.host,

        port:
            smtp.port,

        secure:
            smtp.secure,

        auth: {

            user:
                smtp.user,

            pass:
                smtp.password

        }

    });

}


/* ===========================================
   SEND EMAIL
=========================================== */

async function sendEmail({

    to,

    subject,

    text,

    html,

    attachments

}) {

    const transporter =
        await createTransporter();

    const smtp =
        await getSmtpSettings();

    const info =
        await transporter.sendMail({

            from:
                smtp.from,

            to,

            subject,

            text,

            html,

            attachments

        });

    return {

        success: true,

        messageId:
            info.messageId

    };

}


/* ===========================================
   VERIFY EMAIL CONNECTION
=========================================== */

async function verifyEmailConnection() {

    try {

        const transporter =
            await createTransporter();

        await transporter.verify();

        console.log(
            "✓ SMTP connection verified successfully."
        );

        return {

            success: true

        };

    }

    catch (error) {

        console.error(
            "✗ SMTP connection failed:",
            error.message
        );

        return {

            success: false,

            error:
                error.message

        };

    }

}


/* ===========================================
   MODULE EXPORTS
=========================================== */

module.exports = {

    sendEmail,

    verifyEmailConnection

};