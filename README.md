J.A.V.E - Job Application via Email (CLI Tool)

J.A.V.E (Job Application via Email) is a simple yet powerful command-line tool written in JavaScript and Node.js for automating job applications through email. With J.A.V.E, you can streamline the process of sending personalized job applications to multiple employers with just a few commands.

The tool uses Nodemailer and SMTP configuration to send emails, making it compatible with most major email providers such as Gmail, Outlook, etc.
Features

    Automate sending job applications via email.
    Easily configurable with your email provider’s SMTP settings.
    Customizable email body text.
    Simple CLI interface to enter email details.
    Send bulk emails to multiple recipients from a list.

Installation

    Clone this repository or download the project to your local machine.

git clone https://github.com/yourusername/jave.git
cd jave

    Install dependencies.

npm install

Configuration

Before using J.A.V.E, you need to modify the main.js file to configure your email provider's SMTP settings and personalize the email body text.

    SMTP Settings: Open main.js and find the section where SMTP settings are configured. Modify it according to your email provider (e.g., Gmail, Outlook).

    Example configuration for Gmail:

    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'your-email@gmail.com',
            pass: 'your-email-password'
        }
    });

    Email Body: Modify the email body in main.js to suit your job application. You can write your custom message and include placeholders if needed.

Usage

Prepare the Email List: Create a text file with the list of email addresses of the recipients. Each email address should be on a new line in the text file. For example:

employer1@example.com
employer2@example.com
employer3@example.com

Run the Tool: To use J.A.V.E, open your terminal, navigate to the directory where J.A.V.E is located, and run the following command:

    node main.js

    Input Required Information:
        You will be prompted to enter your email address.
        Then, you’ll need to specify the name of the text file (e.g., emails.txt) that contains the list of recipients.

    Let J.A.V.E Do Its Magic: Once you enter the required information, J.A.V.E will automatically send an email to each address on the list.

Example

$ node main.js

Enter your email address: your-email@gmail.com
Enter the name of the text file (e.g., emails.txt): employer_emails.txt

Sending emails...
Emails sent successfully!

Dependencies

    Node.js: Ensure that you have Node.js installed on your machine.
    Nodemailer: This tool uses Nodemailer to send emails via SMTP.
