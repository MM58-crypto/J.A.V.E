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
});

test('DOCX resume converts to a nonempty readable PDF', async t => {
  const { outputDir, resumePath } = await createResumeFixture(t);
  const pdfPath = convertResumeToPdf(resumePath, outputDir);
  const bytes = fs.readFileSync(pdfPath);

  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');

  const text = await loadBaseResume(pdfPath);
  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.match(text, /Programming Languages:/);
});

test('base resume path is explicit', async () => {
  await assert.rejects(loadBaseResume(), /Base resume path is required/);
});

test('model career edits reach DOCX and PDF while identity is rendered only locally', async t => {
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
    generateContent: async ({ prompt }) => {
      assert.match(prompt, /Build Node\.js APIs backed by PostgreSQL/);
      assert.match(prompt, /automated tests and SQL databases/);
      assert.match(prompt, /JavaScript/);
      assert.doesNotMatch(prompt, /PRIVATE_NAME_CANARY|PRIVATE_EMAIL_CANARY|999999999|old-private@example/);
      return {
        summary: 'Software Engineer with 3 years of experience developing services with automated tests and skills in Node.js, PostgreSQL.',
        edits: [{
          index: 2,
          text: 'Developed SQL-backed services, using automated tests to support reliability.',
        }],
      };
    },
  });
  const renderedText = await loadBaseResume(result.savedTo);

  assert.match(renderedText, /PRIVATE_NAME_CANARY_73A1/);
  assert.match(renderedText, /PRIVATE_EMAIL_CANARY_92B7@example\.test/);
  assert.match(renderedText, /\+999999999/);
  assert.match(renderedText, /Node\.js, PostgreSQL/);
  assert.doesNotMatch(renderedText, /old-private@example\.test/);
  const pdfText = await loadBaseResume(result.pdfPath);
  assert.match(renderedText, /Developed SQL-backed services, using automated tests to support reliability/);
  assert.match(pdfText, /Developed SQL-backed services, using automated tests to support reliability/);
  assert.doesNotMatch(renderedText, /Developed reliable services with automated tests and SQL databases/);
  assert.equal(path.basename(result.savedTo), 'PRIVATE_NAME_CANARY_73A1_Backend_Software_Engineer_resume.docx');
  assert.equal(path.basename(result.pdfPath), 'PRIVATE_NAME_CANARY_73A1_Backend_Software_Engineer_resume.pdf');
  assert.equal(path.dirname(result.savedTo), path.dirname(result.pdfPath));

  // The same candidate and role must not overwrite an earlier application.
  const later = await tailorResume(job, resumePath, {
    privateProfile, careerProfile, outputDir,
    generateContent: async () => ({
      summary: 'Software Engineer with 3 years of experience developing services with automated tests and skills in Node.js, PostgreSQL.',
      edits: [{
        index: 1,
        text: 'Implemented REST APIs while building and maintaining production web applications.',
      }],
    }),
  });
  assert.equal(path.basename(later.pdfPath), path.basename(result.pdfPath));
  assert.notEqual(later.pdfPath, result.pdfPath);
  assert.match(await loadBaseResume(result.pdfPath), /Developed SQL-backed services/);
  assert.match(await loadBaseResume(later.pdfPath), /Implemented REST APIs while building and maintaining production web applications/);
});
