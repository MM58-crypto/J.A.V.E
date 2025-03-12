const http = require('http')
const fs = require('fs')
const url = require('url')
const nodemailer = require('nodemailer');

// usr should supply the list file
const emails_file = 'emails2.txt';
const emails = fs.readFileSync(emails_file, 'utf8').split(',').map(email=> email.trim().replace(/['"]+/g, '')).filter(email => email);
// smtp setup
const transporter =
      nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
              user: "mohammed.magdi999@gmail.com",
              pass: "tmmp wxom ixml yiiu"
          },
      });
// get addresses from usr input
//body text can be a text file inputted by the usr
async function emailIt() {
    const info = await transporter.sendMail({
        from: '"Mohd Magdi" <mohammed.magdi999@gmail.com>',
        to: 'hr@jatco.com.sa', // loop through an email list & send mail for each address
        bcc: emails,
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

emailIt().catch(console.error);

//server.listen(port, () => console.log('Server listening on port ' + port ));
