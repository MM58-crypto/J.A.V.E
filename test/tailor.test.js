const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Document, Packer, Paragraph } = require('docx');
const { convertResumeToPdf, loadBaseResume, tailorResume } = require('../tailor');

async function createResumeFixture(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jave-resume-'));
  const resumePath = path.join(outputDir, 'resume.docx');
  const document = new Document({
    sections: [{
      children: [
        new Paragraph('John Doe'),
        new Paragraph('Software Engineer'),
        new Paragraph('old-private@example.test | +111111111'),
        new Paragraph('EXPERIENCE'),
        new Paragraph('Built and maintained production web applications and REST APIs.'),
        new Paragraph('Developed reliable services with automated tests and SQL databases.'),
        new Paragraph('SKILLS'),
        new Paragraph('Programming Languages: JavaScript, Python, C++'),
      ],
    }],
  });
  fs.writeFileSync(resumePath, await Packer.toBuffer(document));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  return { outputDir, resumePath };
}

test('DOCX resume text is extracted for tailoring', async t => {
  const { resumePath } = await createResumeFixture(t);
  const text = await loadBaseResume(resumePath);

  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.match(text, /Programming Languages:/);
  assert.ok(text.length > 200);
});

test('DOCX resume converts to a nonempty readable PDF', async t => {
  const { outputDir, resumePath } = await createResumeFixture(t);
  const pdfPath = convertResumeToPdf(resumePath, outputDir);
  const bytes = fs.readFileSync(pdfPath);

  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 5000);

  const text = await loadBaseResume(pdfPath);
  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.match(text, /Programming Languages:/);
});

test('base resume path is explicit', async () => {
  await assert.rejects(loadBaseResume(), /Base resume path is required/);
});

test('tailoring is local and injects private identity only during rendering', async t => {
  const { outputDir, resumePath } = await createResumeFixture(t);
  const privateProfile = {
    personal: {
      full_name: 'PRIVATE_NAME_CANARY_73A1',
      email: 'PRIVATE_EMAIL_CANARY_92B7@example.test',
      phone: '+999999999',
      linkedin: 'https://linkedin.example/private-canary',
      github: 'https://github.example/private-canary',
      location: 'Private City',
    },
    application: {},
    field_aliases: {},
  };
  const careerProfile = {
    headline: 'Software Engineer',
    years_experience: 3,
    education: 'Bachelor degree',
    skills: ['JavaScript', 'Node.js', 'PostgreSQL'],
    languages: ['English'],
    target_roles: ['Software Engineer'],
  };
  const job = {
    title: 'Backend Software Engineer',
    company: 'Privacy Test Company',
    description: 'Build Node.js APIs backed by PostgreSQL.',
  };

  const result = await tailorResume(job, resumePath, {
    privateProfile,
    careerProfile,
    outputDir,
  });
  const renderedText = await loadBaseResume(result.savedTo);

  assert.match(renderedText, /PRIVATE_NAME_CANARY_73A1/);
  assert.match(renderedText, /PRIVATE_EMAIL_CANARY_92B7@example\.test/);
  assert.match(renderedText, /\+999999999/);
  assert.match(renderedText, /Node\.js, PostgreSQL/);
  assert.doesNotMatch(renderedText, /old-private@example\.test/);
  assert.ok(fs.existsSync(result.pdfPath));
});
