# JAVE — Job Application via Email and Agent

JAVE started as a simple bulk email tool for job applications. It has since evolved into a two-part system: a job scraper with an interactive interface, and an automated LinkedIn application agent.

---

## What It Does

**Part 1 — Scout** finds and displays relevant job listings from LinkedIn in your terminal. You can browse listings, read full descriptions, and select jobs you want to apply to.

**Part 2 — Agent** takes Scout's output further. It evaluates each job against your profile, waits for your approval, tailors your resume, fills supported LinkedIn Easy Apply forms, and stops for a complete review. The application is submitted only after you explicitly type `SUBMIT`.

---

## Project Structure

```
jave/
├── scout.js          # Browse jobs interactively (no applying)
├── apply.js          # Full agent — search, evaluate, approve, apply
├── scrapers.js       # Fetches jobs from LinkedIn and JSearch API
├── evaluator.js      # Scores job descriptions against your profile using Gemini
├── tailor.js         # Tailors your resume to a job description using Gemini
├── applier.js        # Controls the browser and fills LinkedIn Easy Apply forms
├── defaults.json     # Your personal info and default answers for application forms
├── applications.json # Auto-generated log of every application attempted
└── .env              # API keys and file paths (not committed to git)
```

---

## Requirements

- Node.js 22.3 or higher
- Chromium installed (`/usr/bin/chromium` on Arch Linux)
- LibreOffice (required to convert DOCX resumes to PDF before upload)
- A Gemini API key (free tier available at aistudio.google.com)
- A RapidAPI key with JSearch subscribed (optional, adds more job sources beyond LinkedIn)

Install Node dependencies:

```bash
npm install
```

---

## Configuration

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_gemini_api_key
RESUME_PATH=./my_resume.docx
OUTPUT_DIR=./output
CHROMIUM_PATH=/usr/bin/chromium
CHROMIUM_PROFILE=/home/yourusername/.config/chromium
JSEARCH_API_KEY=your_rapidapi_key_here
```

`JSEARCH_API_KEY` is optional. Without it, Scout pulls from LinkedIn only.

Fill in `defaults.json` with your profile and default application answers before running the agent. `null` values are never guessed; the agent asks for them when a form requires an answer.

---

## One-Time Setup for the Agent

The agent uses your existing Chromium session to stay logged into LinkedIn. Before running the agent for the first time:

1. Open Chromium manually
2. Go to linkedin.com and log in, ticking "Keep me logged in"
3. Close Chromium completely
4. Run the agent — it will pick up your session automatically

Make sure Chromium is fully closed before running the agent. Two instances sharing the same profile will cause conflicts.

---

## Usage

**Browse jobs without applying:**

```bash
node scout.js
```

You will be prompted to enter a job title or keyword. Scout fetches matching jobs, ranks them by freshness and relevance, and displays them in a color-coded list. Select any job to read its full description and access the original link.

**Run the full agent:**

```bash
node apply.js "Software Engineer"
```

The agent will:

1. Fetch up to 15 LinkedIn jobs matching your keyword
2. Evaluate each one against `defaults.json`; anything below 50% match is skipped automatically
3. Display a match summary and wait for you to approve preparation
4. Read the configured DOCX or PDF resume and tailor it without inventing experience
5. Save the tailored resume as DOCX and convert it to PDF with LibreOffice
6. Open Chromium and fill supported Easy Apply text fields, selects, radio buttons, checkboxes, and resume uploads
7. Ask for any answer that is absent from the profile instead of guessing
8. Display every collected answer and keep the browser form open for verification
9. Submit only when you explicitly type `SUBMIT`; `EDIT` returns to review and `CANCEL` exits without submission
10. Record confirmed, unconfirmed, cancelled, skipped, incomplete, and failed outcomes in `applications.json`

---

## Resume Tailoring

Tailoring runs automatically after you approve preparation. It can also be tested in isolation via Scout — select a job, open its detail view, and choose the tailor option.

The base resume may be DOCX or a selectable PDF. Set its path with `RESUME_PATH`. DOCX input is extracted with Mammoth, and all resumes used for applications are converted to PDF with LibreOffice.

Tailored DOCX and PDF resumes are saved to the `output` folder with the company name and a timestamp in the filename.

---

## Application Log

Every job the agent processes is recorded in `applications.json`, including:

- Job title and company
- Match score and reasoning
- Skills matched and missing
- Application status: applied, submitted but unconfirmed, cancelled before submission, incomplete, skipped, or error

---

## Limitations

- LinkedIn Easy Apply forms vary significantly between companies. Most are handled automatically, but complex forms with custom questions will pause and ask you for input.
- Jobs that redirect to external company websites are skipped by design.
- LinkedIn may occasionally detect browser automation and log out the session. If this happens, log back in manually in Chromium and run the agent again.
- JSearch free tier allows 200 requests per month.
- Gemini free tier has per-minute request limits. Running large batches quickly may hit these.