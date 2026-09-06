/**
 * src/config/emailConfig.js
 * Purpose: Initializes a stable SMTP transport using nodemailer to send 
 * out system-generated transactional emails via Brevo's SMTP relay.
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
 * TYPE 1: Sends a stylized Transactional OTP HTML email to a target recipient.
 */
const sendOtpEmail = async (toEmail, otpCode) => {
    const mailOptions = {
        // Use the project Gmail sender address for consistent delivery from the configured account.
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

/**
 * TYPE 2: Sends a Transactional Mentor Invitation HTML email.
 */
const sendMentorInviteEmail = async (toEmail, mentorName, groupName, setupUrl) => {
    const mailOptions = {
        from: '"EduSync Support" <medinieedirisinghe@gmail.com>',
        to: toEmail,
        subject: "Invitation: Join Edusync as an Industry Mentor",
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #1e293b;">
              <h3 style="color: #0f172a;">Hello ${mentorName},</h3>
              <p>You have been assigned as the Industry Mentor for <b>Group ${groupName}</b>.</p>
              <p>To access your mentor dashboard and review project progress, please configure your account credentials by clicking the button below:</p>
              
              <p style="margin: 20px 0;">
                <a href="${setupUrl}" style="background-color:#2563eb;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Set Up My Account</a>
              </p>
              
              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                <p style="color: #64748b; font-size: 12px; margin-bottom: 6px;">If the button above does not work or if you need to copy the link directly into your browser:</p>
                <p style="color: #2563eb; font-size: 12px; word-break: break-all; margin: 0;">
                  <a href="${setupUrl}" style="color: #2563eb; text-decoration: underline;">${setupUrl}</a>
                </p>
              </div>

              <br/>
              <p style="color: #475569; font-size: 13px;">Thank you,<br/>Academic Project Coordinator Team</p>
            </body>
          </html>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * TYPE 3: Sends a stylized Password Reset Link HTML email.
 */
const sendPasswordResetLinkEmail = async (toEmail, userName, resetUrl) => {
    const mailOptions = {
        from: '"EduSync Security" <medinieedirisinghe@gmail.com>',
        to: toEmail,
        subject: "Reset Your EduSync Password",
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 480px; margin: 0 auto; background-color: #ffffff;">
                <h2 style="color: #0f172a; margin-bottom: 6px; font-size: 22px;">Reset Your Password</h2>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">Hello ${userName || 'User'},</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.5;">We received a request to reset the password for your EduSync account. Click the button below to choose a new password. This link will remain valid for <strong>15 minutes</strong>:</p>
                
                <div style="text-align: center; margin: 28px 0;">
                    <a href="${resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; text-decoration: none; display: inline-block;">
                        Reset My Password
                    </a>
                </div>
                
                <p style="color: #64748b; font-size: 12px; line-height: 1.4;">If the button above does not work, copy and paste this link into your browser:</p>
                <p style="color: #2563eb; font-size: 11px; word-break: break-all; line-height: 1.4;">${resetUrl}</p>
                
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                <p style="color: #94a3b8; font-size: 11px; margin: 0; line-height: 1.4;">If you did not request a password reset, you can safely ignore this email; your password will remain unchanged.</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

/**
 * TYPE 4: Sends a Mentor Offboarding & Appreciation HTML email.
 */
const sendMentorOffboardingAppreciationEmail = async (toEmail, mentorName, groupName) => {
    const mailOptions = {
        from: '"EduSync Support" <medinieedirisinghe@gmail.com>',
        to: toEmail,
        subject: `EduSync: Mentorship Transition & Appreciation for Group ${groupName}`,
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 520px; margin: 0 auto; background-color: #ffffff;">
                <h2 style="color: #0f172a; margin-bottom: 6px; font-size: 20px;">Mentorship Transition Notice</h2>
                <p style="color: #334155; font-size: 14px; line-height: 1.6;">Dear ${mentorName || 'Industry Mentor'},</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                    Thank you very much for your valuable time, guidance, and expertise dedicated to <strong>Group ${groupName}</strong> in EduSync.
                </p>
                <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                    As per recent project coordination updates, the mentorship role for this group has been transitioned. We sincerely appreciate your industry expertise and invaluable contribution to our students' learning journey.
                </p>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
                <p style="color: #64748b; font-size: 13px; margin: 0; line-height: 1.5;">
                    Best Regards,<br/>
                    <strong>Academic Project Coordination Team</strong><br/>
                    EduSync Academic Portal
                </p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

// Export all functions so different parts of the backend can use them
module.exports = { 
    sendOtpEmail, 
    sendMentorInviteEmail,
    sendPasswordResetLinkEmail,
    sendMentorOffboardingAppreciationEmail
};