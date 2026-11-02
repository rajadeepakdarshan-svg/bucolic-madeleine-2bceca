# StudySmart AI — updated website with AI question-paper generation

This is the user's existing StudySmart AI planner with a new AI Question Paper Studio added. The original timetable, progress dashboard, focus timer, exam countdown, coach tips, and revision reminders are preserved.

## What was added

- Multi-file uploads: PDF, DOCX, TXT, JPG, PNG, and WEBP.
- A document-analysis step that identifies the subject, academic level, chapters, and topics.
- Chapter selection before question generation.
- Editable question sections with question type, section heading, question count, marks per question, and section instructions.
- Automatic total question and total marks calculations.
- Difficulty and question-style choices.
- Paper appearance controls: traditional / modern / minimal, A4 portrait / landscape, font size, marks visibility, lesson labels, and answer-writing space.
- AI question paper generation using the OpenAI Responses API and Structured Outputs.
- Backend checks for exact question counts, section types, per-question marks, total marks, duplicate questions, four-option MCQs, and a corresponding answer key. The backend makes one correction attempt if its first response fails validation.
- Separate answer-key reveal and print, and question-paper print / Save as PDF.
- The API key is read only by the Netlify Function and never placed in browser code.

## Project structure

```text
StudySmartAI-website/
├── netlify.toml
├── netlify/
│   └── functions/
│       └── generate-paper.mjs
└── public/
    ├── index.html
    └── paper-studio.js
```

## Required setup

1. Deploy this **whole project folder**, not just `public/`. Netlify needs `netlify.toml` and `netlify/functions/generate-paper.mjs` to deploy the backend function.
2. In Netlify, open the same StudySmart AI site and add an environment variable:
   - `OPENAI_API_KEY` = your secret OpenAI API key.
   - `OPENAI_MODEL` = `gpt-4.1` (optional; this is the default in the function).
3. Keep the API key in Netlify environment variables only. Never paste it into `index.html`, `paper-studio.js`, a public prompt, or a Git repository.
4. Redeploy after setting the environment variable.
5. Open the site and use **Question paper** in the left navigation. Upload a small PDF or clear photo, choose **Analyze uploaded material**, select chapters, configure the sections, and choose **Generate my question paper**.

## Deploying to the existing Netlify site

The safest repeatable option is to deploy the project root with Netlify CLI or connect the project to a Git repository. From a terminal opened in this project folder:

```bash
npm install -g netlify-cli
netlify login
netlify link
netlify deploy --prod
```

When `netlify link` asks, select the existing StudySmart AI Netlify site. The `netlify.toml` file tells Netlify to publish `public/` and deploy functions from `netlify/functions/`.

If using Netlify's logged-in Drop workflow, upload the unzipped **project root folder** containing `netlify.toml`, `public/`, and `netlify/`. Do not upload only the `public/` folder. Confirm in Netlify that the function `generate-paper` appears under Functions after deployment.

## Limits and important notes

- Up to 6 files and 3 MB combined per request. This leaves room for Base64 encoding within Netlify's buffered function request limit.
- Supported uploads: PDF, DOCX, TXT, JPG, JPEG, PNG, WEBP.
- The OpenAI Responses API processes PDFs and DOCX files; image uploads are sent as image inputs for reading/OCR-like visual text understanding.
- Uploaded documents are sent to the OpenAI API when the student chooses Analyze or Generate. This code does not save uploaded files to a database or persistent file store. Do not upload private student records or sensitive personal information.
- API usage may incur charges. Review the account's current pricing and usage limits before a public demonstration.
- The public endpoint has file-size and question-count limits, but does not include account login or durable per-user rate limiting. For a public production service, add user authentication, abuse protection, and a proper privacy notice.
- The question paper uses browser print. In the print dialog, choose **Save as PDF** to download a PDF. The answer key has its own separate print button.
- A successful generation verifies structure and marks, not academic correctness in every detail. Review the questions and answer key before using them in a real exam.

## Local preview

Open `public/index.html` in a browser to preview the planner interface. The original planner works locally. The AI Question Paper Studio requires the deployed Netlify Function and a configured API key; local `file://` previews cannot call that function. For local full-stack testing, use Netlify CLI (`netlify dev`) from the project root after configuring an environment variable in a local `.env` file. Never commit `.env`.
