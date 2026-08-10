const nodemailer = require("nodemailer");


/* ===========================================
   EMAIL CONFIGURATION
=========================================== */

const transporter = nodemailer.createTransport({

    host: process.env.SMTP_HOST,

    port:
        Number(
            process.env.SMTP_PORT ||
            587
        ),

    secure:
        process.env.SMTP_SECURE === "true",

    auth: {

        user:
            process.env.SMTP_USER,

        pass:
            process.env.SMTP_PASSWORD

    }

});


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

    const info =
        await transporter.sendMail({

            from:
                process.env.SMTP_FROM ||
                process.env.SMTP_USER,

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

async function verifyEmailConnection() {

    try {

        await transporter.verify();

        console.log("✓ SMTP connection verified successfully.");

        return {
            success: true
        };

    } catch (error) {

        console.error(
            "✗ SMTP connection failed:",
            error.message
        );

        return {
            success: false,
            error: error.message
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
