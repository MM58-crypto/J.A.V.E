const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Document, Packer, Paragraph } = require('docx');
const { convertResumeToPdf, loadBaseResume } = require('../tailor');

async function createResumeFixture(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jave-resume-'));
  const resumePath = path.join(outputDir, 'resume.docx');
  const document = new Document({
    sections: [{
      children: [
        new Paragraph('John Doe'),
        new Paragraph('Software Engineer'),
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
