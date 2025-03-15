const http = require('http')
const fs = require('fs')
const url = require('url')
const nodemailer = require('nodemailer');
const readline = require('node:readline');

// usr should supply the list file
//let emails_file = '';
//const emails_file = 'uae_emails.txt';
//const emails = fs.readFileSync(emails_file, 'utf8').split(',').map(email=> email.trim().replace(/['"]+/g, '')).filter(email => email);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let usr_email, emails_file;
//let email_body; // usr passes a txt file with body

rl.question(`Please enter your email address: `, (ans1) => {
    usr_email = ans1;
    console.log('Your email ' +  usr_email);

  rl.question('Enter the file name that contains list of emails: ', (ans2) => {
        emails_file = ans2;
        const emails = fs.readFileSync(emails_file, 'utf8').split(',').map(email=> email.trim().replace(/['"]+/g, '')).filter(email => email);
        console.log('email file: ' + emails_file);

      // smtp setup
      const transporter =
            nodemailer.createTransport({
              host: "smtp.gmail.com",
              port: 465,
              secure: true,
              auth: {
                user: usr_email,
                pass: ""
              },
            });
// get addresses from usr input
// body text can be a text file inputted by the usr

async function emailIt(rec_email) {
    const info = await transporter.sendMail({
        from: usr_email,
        to: rec_email, // loop through an email list & send mail for each address
        //bcc: emails,
        subject: "Job opportunity inquiry - Software developer",
        text: `Dear Sir/Ma'am,

I’m writing to express interest in a Software Developer role at your esteemed company. With experience in software development, API testing, and system optimization, I’m eager to contribute to your team.

I’m proficient in Python, Java, C++, JavaScript, and frameworks like Django, Flask, and React, with additional experience in AWS and containerization tools.

I’ve attached my resume and would appreciate the opportunity to discuss how my skills align with your needs. Feel free to contact me to schedule an interview.

Thank you for your consideration

Best Regards,

`,

        attachments: [
            {
                filename: 'Mohd_Magdi_resume_5.1(web).pdf',
                path: '/home/mmk/mm-resumes/Mohd_Magdi_resume_5.1(web).pdf'
            }
        ]
    });

    console.log("Email sent successfully: ", info.messageId);
}
for (let i=0; i < emails.length; i++) {
   emailIt(emails[i]).catch(console.error);
}

rl.close();
    });
});


module.exports = "jave"
