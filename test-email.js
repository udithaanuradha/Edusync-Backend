/**
 * test-email.js
 * Run manually to verify Brevo SMTP credentials and delivery routing.
 */
require('dotenv').config();
const { sendOtpEmail } = require('./src/config/emailConfig');

//  own personal email address to see the test message
const testRecipient = "medinieedirisinghe@gmail.com"; 
const mockOtp = "999888";

console.log(`⏳ Attempting to dispatch verification code ${mockOtp} to ${testRecipient}...`);

sendOtpEmail(testRecipient, mockOtp)
    .then((info) => {
        console.log("=== 🎉 BREVO SMTP CONNECTION SUCCESS ===");
        console.log("Response Details:", info);
        console.log("\n✅ The email was handed off to Brevo successfully! Check your inbox/spam folder.");
        process.exit(0);
    })
    .catch((error) => {
        console.error("=== ❌ BREVO SMTP CONNECTION FAILED ===");
        console.error("Error Breakdown:", error);
        process.exit(1);
    });