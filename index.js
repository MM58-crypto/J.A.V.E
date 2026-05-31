const fs = require('fs');
const nodemailer = require('nodemailer');
const figlet = require('figlet');
require('dotenv').config();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const USR_EMAIL    = 'mohammed.magdi999@gmail.com';          // your Gmail address
const EMAILS_FILE  = 'emails/emails_latest_edition.txt';                // comma-separated recipient list
const BODY_FILE    = 'body.txt';                      // plain text email body
const RESUME_PATH  = '/home/mmk/mm-resumes/Mohd_Magdi_resume_7.0.pdf';                    // path to your resume file
const SUBJECT      = 'Software Engineer – Open to Opportunities';
// ──────────────────────────────────────────────────────────────────────────────

// load recipients and body
const emails = fs
  .readFileSync(EMAILS_FILE, 'utf8')
  .split(',')
  .map(e => e.trim().replace(/['"]+/g, '').replace(/\n/g, ''))
  .filter(e => e.length > 0);

const body = fs.readFileSync(BODY_FILE, 'utf8');

// smtp transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: USR_EMAIL,
    pass: process.env.smtp_pass,
  },
});

// send a single email
async function emailIt(recipient) {
  const info = await transporter.sendMail({
    from: USR_EMAIL,
    to: recipient,
    subject: SUBJECT,
    text: body,
    attachments: [
      {
        filename: 'Mohd_Magdi_Resume.pdf',
        path: RESUME_PATH,
      },
    ],
  });
  console.log(`Sent to ${recipient} — ID: ${info.messageId}`);
}

// main
async function run() {
  figlet('JAVE', (err, data) => {
    if (!err) console.log(data);
  });

  console.log(`Recipients loaded: ${emails.length}`);
  console.log('Sending emails...\n');

  for (const email of emails) {
    await emailIt(email).catch(err =>
      console.error(`Failed to send to ${email}:`, err.message)
    );
  }

  console.log('\nAll emails processed.');
}

run();
