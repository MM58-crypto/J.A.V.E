const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { convertResumeToPdf, loadBaseResume } = require('../tailor');

const resumePath = path.join(__dirname, '..', 'my_resume.docx');

test('dummy DOCX resume text is extracted for tailoring', async () => {
  const text = await loadBaseResume(resumePath);
  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.match(text, /Programming Languages:/);
  assert.ok(text.length > 2000);
});

test('dummy DOCX converts to a nonempty readable PDF', async t => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jave-resume-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const pdfPath = convertResumeToPdf(resumePath, outputDir);
  const bytes = fs.readFileSync(pdfPath);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 10000);

  const text = await loadBaseResume(pdfPath);
  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.match(text, /Programming Languages:/);
});
