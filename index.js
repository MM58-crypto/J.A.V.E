const http = require('http')
const fs = require('fs')
const url = require('url')
const nodemailer = require('nodemailer');
const readline = require('node:readline');
const figlet = require('figlet');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

figlet('JAVE', function(err, data) {
  if (err) {
    console.log('Hmmm, there seems to be an error');
    console.dir(err);
    return;
  }
  console.log(data);
  let usr_email, emails_file;

rl.question(`Please enter your email address: `, (ans1) => {
    usr_email = ans1;
    console.log('Your email ' +  usr_email);

  rl.question('Enter the file name that contains list of emails: ', (ans2) => {
        emails_file = ans2;
        const emails = fs.readFileSync(emails_file, 'utf8').split(',').map(email=> email.trim().replace(/['"]+/g, '')).filter(email => email);
        console.log('email file: ' + emails_file);

    rl.question('Enter a text file containing the email body: ', (ans3) => {
        email_body = ans3;
        const body = fs.readFileSync(email_body, 'utf8');


      // smtp setup
      const transporter =
            nodemailer.createTransport({
              host: "smtp.gmail.com",
              port: 465,
              secure: true,
              auth: {
                user: usr_email,
                pass:  "ftrh rjei cqip idql"
              },
            });
    // email templates ? method 1: display to usr the suggested templates and let him select from the available templates
    // the usr needs to insert information like desired role, ....
    // method 2: provide text files that the user can pass as input for email body (idk about this)
    // maybe i can link an LLM with JAVE to generate templates
async function emailIt(rec_email) {
    const info = await transporter.sendMail({
        from: usr_email,
        to: rec_email,
        subject: "Job opportunity inquiry - Software Engineer",
        text: body,

        attachments: [
            {
                filename: 'Mohd_Magdi_resume(web).pdf',
                path: '/home/mmk/mm-resumes/Mohd_Magdi_resume(web).pdf'
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
});


});


