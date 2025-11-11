# J.A.V.E — Job Application VIA Email

J.A.V.E is a lightweight Node.js utility that automates sending job-application emails (with a resume attachment) to a list of recipients. 

> Note: This tool is intended to help automate legitimate, personalized job-application outreach only. Be mindful of email provider limits and anti-spam best practices.

## Features
- Prompt-driven CLI: enter your email, recipients file, email body file and resume path.
- Sends a plain-text email with an attached resume (PDF).
- Uses nodemailer with SMTP (example configured for Gmail).
- Basic scheduling/planning code is present (node-schedule imported) and can be expanded.

## Requirements
- Node.js (v14+ recommended)
- npm
- A valid SMTP account and password (for Gmail use an App Password if you have 2FA enabled)
- Files for:
  - recipients (comma-separated emails)
  - email body (plain text)
  - a resume file (PDF or other file type)

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/MM58-crypto/J.A.V.E.git
cd J.A.V.E
npm install
```

Dependencies used by the project:
- nodemailer
- figlet
- node-schedule
- (built-in) fs, http, url, readline

## Configuration

This script reads your SMTP password from the environment variable `smtp_pass`:

Linux / macOS (bash/zsh):
```bash
export smtp_pass="YOUR_SMTP_PASSWORD_OR_APP_PASSWORD"
node index.js
```

Windows PowerShell:
```powershell
$env:smtp_pass="YOUR_SMTP_PASSWORD_OR_APP_PASSWORD"
node index.js
```

Or prefix on a single command (POSIX shells):
```bash
smtp_pass="YOUR_SMTP_PASSWORD" node index.js
```

Important notes about Gmail:
- If you use a Gmail account for sending, create an App Password (recommended) and use that as `smtp_pass`. Google often blocks "less secure apps" so regular account passwords may not work.
- Be careful about provider sending limits and account security.

## Usage

Run the script:

```bash
node index.js
```

The script will prompt you for:
1. Your email address (used as the SMTP user and the "from" address)
2. The file name containing a list of recipient emails (comma-separated)
3. A text file containing the email body
4. The file path of your resume (attachment)

Example files:
- recipients.txt
  ```
  hiring@example.com, recruiter@example.org, devteam@company.io
  ```
- body.txt
  ```
  Hello,

  I'm reaching out to express my interest in the Software Engineer role at Company X.
  Please find my resume attached.

  Best regards,
  Jane Doe
  ```
- Resume.pdf (path to your resume file)

The script reads the recipients file with:
- fs.readFileSync(file, 'utf8').split(',') — so recipients must be comma-separated (whitespace is trimmed).

By default the script sends immediately to each listed recipient.


## Example Usage 

1. Prepare the files:
   - recipients.txt (comma-separated emails)
   - body.txt (plain-text message)
   - Resume.pdf (your resume)

2. Export your SMTP password and run:
   ```bash
   export smtp_pass="my-app-password"
   node index.js
   ```

3. Enter the prompts when requested:
   - Your email address
   - recipients.txt
   - body.txt
   - path/to/Resume.pdf

4. Monitor the console for "Email sent successfully: <messageId>" lines.

## Contributing

If you'd like to contribute improvements feel free to open issues or pull requests.

