# J.A.V.E - Job Application via Email 

J.A.V.E (Job Application via Email) is a simple yet powerful command-line tool written in JavaScript and Node.js for automating job applications through email. With J.A.V.E, you can streamline the process of sending personalized job applications to multiple employers with just a few commands.

The tool uses Nodemailer and SMTP configuration to send emails, making it compatible with most major email providers such as Gmail, Outlook, etc.

## Features

- Automate sending job applications via email.
- Easily configurable with your email provider’s SMTP settings.
- Customizable email body text.
- Simple CLI interface to enter email details.
- Send bulk emails to multiple recipients from a list.

## Installation

Clone this repository or download the project to your local machine.
 ```sh
git clone https://github.com/MM58-crypto/jave.git
cd jave
```
Install dependencies.
```
npm install readline nodemailer figlet 
```
## Configuration

Before using J.A.V.E, you need to modify the index.js file to configure your email provider's SMTP settings and personalize the email body text.

### SMTP Settings: 
Open index.js and find the section where SMTP settings are configured. Modify it according to your email provider (e.g., Gmail, Outlook).
     
Example configuration for Gmail:
```javascript     
 const transporter =
     nodemailer.createTransport({
         host: "smtp.gmail.com",
         port: 465,
         secure: true,
         auth: {
             user: your-email@gmail.com,
             pass: your-app-password
         },
     });
```
### Email Body: 
Modify the email body in index.js to suit your job application. You can write your custom message and include placeholders if needed.
You must also modify the attachments data structure (filename and path) to include your resume.
```javascript
const info = await transporter.sendMail({
        from: usr_email,
        to: rec_email,
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
                filename: '<your_resume>.pdf',
                path: '/path/to/<your_resume>.pdf'
            }
        ]
    });

```

## Usage

Prepare the Email List: Create a text file with the list of email addresses of the recipients. Each email address should be on a new line in the text file. For example:
```
employer1@example.com,
employer2@example.com,
employer3@example.com
```

Run the Tool: To use J.A.V.E, open your terminal, navigate to the directory where J.A.V.E is located, and run the following command:
```sh
node index.js
```
Input Required Information:
- You will be prompted to enter your email address.
- Then, you’ll need to specify the name of the text file (e.g., emails.txt) that contains the list of recipients.

Let J.A.V.E Do Its Magic: Once you enter the required information, J.A.V.E will automatically send an email to each address on the list.

## Example
```sh
$ node index.js
```

![image](https://github.com/user-attachments/assets/be510c86-3970-4c42-833f-3663abe23000)


## Dependencies

- Node.js: Ensure that you have Node.js installed on your machine.
- Nodemailer: This tool uses Nodemailer to send emails via SMTP.
- Figlet: To fully implement the FIGfont spec in JavaScript.
