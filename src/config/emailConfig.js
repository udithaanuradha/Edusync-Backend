/**
 * src/config/emailConfig.js
 * Purpose: Initializes a stable SMTP transport using nodemailer to send 
 * out system-generated 6-digit verification codes via Brevo's SMTP relay.
 */

// 1. Force environment variables to load first before any initialization logic
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const nodemailer = require('nodemailer');

// 2. Create the unified SMTP transport engine
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, 
    auth: {
        user: process.env.SENDER_EMAIL, 
        pass: process.env.BREVO_API_KEY  
    }
});

/**
 * Sends a stylized Transactional OTP HTML email to a target recipient.
 * @param {string} toEmail - The email address of the registering student or mentor
 * @param {string} otpCode - The randomly generated 6-digit numeric string
 * @returns {Promise} - Resolves upon successful delivery acknowledgment
 */
const sendOtpEmail = async (toEmail, otpCode) => {
    const mailOptions = {
        // Use a clean display identity but route it through your valid sender configuration
        from: '"EduSync Support" <medinieedirisinghe@gmail.com>',
        to: toEmail,
        subject: "Verify Your EduSync Account",
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 480px; margin: 0 auto; background-color: #ffffff;">
                <h2 style="color: #0f172a; margin-bottom: 6px; font-size: 22px;">Welcome to EduSync!</h2>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">Thank you for starting your registration. Use the security verification code below to activate your account profile. This code remains valid for <strong>5 minutes</strong>:</p>
                
                <div style="font-size: 32px; font-weight: 800; color: #2563eb; letter-spacing: 6px; padding: 14px; background-color: #f8fafc; text-align: center; border: 1px dashed #cbd5e1; border-radius: 8px; margin: 24px 0;">
                    ${otpCode}
                </div>
                
                <p style="color: #94a3b8; font-size: 11px; margin-top: 20px; line-height: 1.4;">If you did not initiate this request, you can safely disregard this message; no account will be created without this verification.</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

module.exports = { sendOtpEmail };
