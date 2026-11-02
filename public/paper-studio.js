(() => {
  'use strict';

  const endpoint = '/.netlify/functions/generate-paper';
  const maxFiles = 6;
  const maxBytes = 3 * 1024 * 1024;
  const questionTypes = [
    'MCQ', 'True or False', 'Fill in the Blanks', 'Match the Following',
    'One-word Answer', 'Very Short Answer', 'Short Answer', 'Long Answer',
    'Numerical Problem', 'Application-based', 'Case-based', 'Diagram-based', 'Custom / Other'
  ];
  const defaultPlan = [
    { id: 'sec-a', title: 'Section A', type: 'MCQ', count: 5, marksEach: 1, instructions: 'Choose the one correct answer.' },
    { id: 'sec-b', title: 'Section B', type: 'True or False', count: 5, marksEach: 1, instructions: 'Write True or False.' },
    { id: 'sec-c', title: 'Section C', type: 'Short Answer', count: 3, marksEach: 4, instructions: 'Answer briefly and show important steps where needed.' },
    { id: 'sec-d', title: 'Section D', type: 'Long Answer', count: 2, marksEach: 5, instructions: 'Write complete and well-organized answers.' }
  ];

  const $p = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let selectedFiles = [];
  let analyzed = null;
  let selectedChapters = new Set();
  let questionPlan = defaultPlan.map(item => ({ ...item }));
  let currentPaper = null;
  let answerKeyVisible = false;
  let lastAction = 'generate';

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
    else {
      const target = $p('paperStatus');
      if (target) target.textContent = message;
    }
  }

  function setPaperStatus(message, kind = '') {
    const node = $p('paperStatus');
    node.textContent = message;
    node.className = `paper-status ${kind}`.trim();
  }

  function setGenerateStatus(message, kind = '') {
    const node = $p('generatePaperStatus');
    node.textContent = message;
    node.className = `paper-status ${kind}`.trim();
  }

  function setBusy(busy, action) {
    $p('paperProgress').classList.toggle('active', busy);
    $p('analyzePaperButton').disabled = busy;
    $p('paperFileInput').disabled = busy;
    $p('paperDrop').style.pointerEvents = busy ? 'none' : '';
    $p('paperDrop').style.opacity = busy ? '.6' : '1';
    $p('paperFiles').querySelectorAll('button').forEach(button => { button.disabled = busy; });
    $p('generatePaperButton').disabled = busy || !analyzed || selectedChapters.size === 0 || $p('generatePaperButton').dataset.planValid === 'false';
    $p('analyzePaperButton').textContent = busy && action === 'analyze' ? 'Reading your portions…' : '✦ Analyze uploaded material';
    $p('generatePaperButton').textContent = busy && action === 'generate' ? 'Generating question paper…' : '✦ Generate my question paper';
  }

  function fileMime(file) {
    const extension = file.name.toLowerCase().split('.').pop();
    const byExtension = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp'
    };
    return byExtension[extension] || file.type;
  }

  function formatBytes(bytes) {
    return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderFiles() {
    const root = $p('paperFiles');
    if (!selectedFiles.length) {
      root.innerHTML = '<div class="hint">No academic files added yet.</div>';
      return;
    }
    root.innerHTML = selectedFiles.map((file, index) => `
      <div class="paper-file">
        <span aria-hidden="true">${fileMime(file) === 'application/pdf' ? '📕' : fileMime(file).startsWith('image/') ? '🖼️' : '📄'}</span>
        <span class="paper-file-name">${esc(file.name)}</span>
        <small>${formatBytes(file.size)}</small>
        <button type="button" data-remove-file="${index}" aria-label="Remove ${esc(file.name)}">Remove</button>
      </div>`).join('');
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const combined = [...selectedFiles];
    for (const file of incoming) {
      if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/jpeg', 'image/png', 'image/webp'].includes(fileMime(file))) {
        setPaperStatus(`${file.name}: unsupported format. Use PDF, DOCX, TXT, JPG, PNG or WEBP.`, 'error');
        continue;
      }
      if (combined.some(existing => existing.name === file.name && existing.size === file.size)) continue;
      combined.push(file);
    }
    if (combined.length > maxFiles) {
      setPaperStatus(`You can upload up to ${maxFiles} files at once.`, 'error');
      return;
    }
    const size = combined.reduce((total, file) => total + file.size, 0);
    if (size > maxBytes) {
      setPaperStatus('The combined upload must be 3 MB or smaller. Remove a file or choose smaller files.', 'error');
      return;
    }
    selectedFiles = combined;
    analyzed = null;
    selectedChapters.clear();
    currentPaper = null;
    $p('paperOutput').classList.remove('visible');
    $p('paperChapters').innerHTML = '<div class="empty">Select Analyze uploaded material to identify chapters.</div>';
    renderFiles();
    setPaperStatus(`${selectedFiles.length} file(s) ready for analysis.`);
    refreshGenerateButton();
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try uploading it again.`));
      reader.onload = () => {
        const mime = fileMime(file);
        const raw = String(reader.result || '');
        const comma = raw.indexOf(',');
        if (comma < 0) return reject(new Error(`Could not encode ${file.name}. Try uploading it again.`));
        resolve({ name: file.name, type: mime, dataUrl: `data:${mime};base64,${raw.slice(comma + 1)}` });
      };
      reader.readAsDataURL(file);
    });
  }

  async function encodeFiles() {
    const all = await Promise.all(selectedFiles.map(readAsDataUrl));
    return all;
  }

  async function requestAI(payload) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      throw new Error('Could not reach the AI service. Check your internet connection and make sure the Netlify function has been deployed.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      let message = body.error || `The AI service returned an error (${response.status}).`;
      if (Array.isArray(body.validationErrors) && body.validationErrors.length) message += ` Details: ${body.validationErrors.join(' ')}`;
      throw new Error(message);
    }
    return body;
  }

  function renderChapters() {
    const root = $p('paperChapters');
    if (!analyzed || !Array.isArray(analyzed.chapters) || !analyzed.chapters.length) {
      root.innerHTML = '<div class="empty">No chapters were detected. Try a clearer file.</div>';
      return;
    }
    root.innerHTML = `
      <div class="form-actions" style="margin-top:0;margin-bottom:5px">
        <button type="button" class="tiny-button" id="selectAllPaperChapters">Select all</button>
        <button type="button" class="tiny-button" id="clearPaperChapters">Clear selection</button>
      </div>
      ${analyzed.chapters.map((chapter, index) => {
        const name = String(chapter.title || `Lesson ${index + 1}`);
        const checked = selectedChapters.has(name) ? 'checked' : '';
        const topics = Array.isArray(chapter.topics) ? chapter.topics : [];
        const topicHtml = topics.length ? `<div style="display:grid;gap:5px;margin:9px 0 0 22px">${topics.map((topic, topicIndex) => {
          const topicLabel = `${name} — ${topic}`;
          const topicChecked = checked || selectedChapters.has(topicLabel) ? 'checked' : '';
          return `<label style="font-weight:500;font-size:10px;color:#77738e"><input type="checkbox" data-topic-index="${topicIndex}" data-topic-chapter="${index}" ${topicChecked}/> ${esc(topic)}</label>`;
        }).join('')}</div>` : '<small>No separate topics were identified.</small>';
        return `<div class="paper-chapter">
          <label><input type="checkbox" data-chapter-index="${index}" ${checked}/><span><strong>${esc(name)}</strong></span></label>
          ${topicHtml}
        </div>`;
      }).join('')}`;
    refreshGenerateButton();
  }

  function chapterSelectionChanged(target) {
    if (!analyzed || !target) return;
    if (target.matches('[data-chapter-index]')) {
      const chapter = analyzed.chapters[Number(target.dataset.chapterIndex)];
      if (!chapter) return;
      if (target.checked) {
        selectedChapters.add(chapter.title);
        (chapter.topics || []).forEach(topic => selectedChapters.delete(`${chapter.title} — ${topic}`));
      } else {
        selectedChapters.delete(chapter.title);
      }
    } else if (target.matches('[data-topic-index]')) {
      const chapter = analyzed.chapters[Number(target.dataset.topicChapter)];
      const topic = chapter?.topics?.[Number(target.dataset.topicIndex)];
      if (!chapter || !topic) return;
      const topicKey = `${chapter.title} — ${topic}`;
      if (selectedChapters.has(chapter.title) && !target.checked) {
        selectedChapters.delete(chapter.title);
        (chapter.topics || []).forEach(other => {
          if (other !== topic) selectedChapters.add(`${chapter.title} — ${other}`);
        });
      } else if (target.checked) {
        selectedChapters.add(topicKey);
      } else {
        selectedChapters.delete(topicKey);
      }
    }
    renderChapters();
  }

  function refreshGenerateButton() {
    const valid = Boolean(analyzed && selectedChapters.size && selectedFiles.length && $p('generatePaperButton').dataset.planValid !== 'false');
    const busy = $p('paperProgress').classList.contains('active');
    $p('generatePaperButton').disabled = !valid || busy;
  }

  async function analyzeFiles() {
    if (!selectedFiles.length) {
      setPaperStatus('Upload at least one academic file first.', 'error');
      return;
    }
    setBusy(true, 'analyze');
    setPaperStatus('Reading your files, identifying chapters and extracting topics…');
    try {
      const files = await encodeFiles();
      const result = await requestAI({ action: 'analyze', files });
      analyzed = result.analysis;
      selectedChapters = new Set((analyzed.chapters || []).map(chapter => chapter.title));
      if (!$p('paperSubject').value.trim() && analyzed.subject) $p('paperSubject').value = analyzed.subject;
      renderChapters();
      setPaperStatus(`Analysis complete. Found ${analyzed.chapters.length} chapter(s). Select the portions for your paper.`, 'success');
      toast('Academic portions analyzed successfully.');
    } catch (error) {
      analyzed = null;
      selectedChapters.clear();
      $p('paperChapters').innerHTML = '<div class="empty">Analysis did not finish. Check the file and AI setup, then try again.</div>';
      setPaperStatus(error.message, 'error');
      refreshGenerateButton();
    } finally {
      setBusy(false, 'analyze');
    }
  }

  function renderPlan() {
    const root = $p('paperConfigList');
    root.innerHTML = questionPlan.map((item, index) => `
      <div class="paper-config-row" data-section-id="${esc(item.id)}">
        <div class="field"><label>Section heading</label><input data-plan-field="title" value="${esc(item.title)}" maxlength="50" aria-label="Section ${index + 1} heading"></div>
        <div class="field"><label>Question type</label><select data-plan-field="type" aria-label="Section ${index + 1} question type">${questionTypes.map(type => `<option value="${esc(type)}" ${item.type === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></div>
        <div class="field"><label>Questions</label><input data-plan-field="count" type="number" min="1" max="40" value="${Number(item.count)}" /></div>
        <div class="field"><label>Marks each</label><input data-plan-field="marksEach" type="number" min="1" max="20" value="${Number(item.marksEach)}" /></div>
        <button type="button" class="paper-remove" data-remove-section="${esc(item.id)}" aria-label="Remove section ${index + 1}">×</button>
      </div>
      <div class="field" style="margin:-3px 0 3px 10px"><label>Section instruction (optional)</label><input data-section-id="${esc(item.id)}" data-plan-field="instructions" value="${esc(item.instructions || '')}" placeholder="e.g. Answer all questions" maxlength="180" /></div>
    `).join('');
    updatePlanTotals();
  }

  function updatePlanTotals() {
    const count = questionPlan.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
    const marks = questionPlan.reduce((sum, item) => sum + (Number(item.count) || 0) * (Number(item.marksEach) || 0), 0);
    $p('paperQuestionTotal').textContent = count;
    $p('paperMarksTotal').textContent = marks;
    const valid = questionPlan.length >= 1 && questionPlan.length <= 12 && count >= 1 && count <= 40 && questionPlan.every(item => Number.isInteger(Number(item.count)) && Number(item.count) >= 1 && Number(item.count) <= 40 && Number.isInteger(Number(item.marksEach)) && Number(item.marksEach) >= 1 && Number(item.marksEach) <= 20);
    $p('generatePaperButton').dataset.planValid = String(valid);
    refreshGenerateButton();
    if (!valid) setGenerateStatus('Use 1–40 questions in total, 1–20 marks per question, and at most 12 sections.', 'error');
    else if (!$p('generatePaperStatus').classList.contains('error')) setGenerateStatus('');
  }

  function addQuestionSection() {
    if (questionPlan.length >= 12) {
      setGenerateStatus('You can add up to 12 question sections.', 'error');
      return;
    }
    const index = questionPlan.length;
    questionPlan.push({ id: `sec-${Date.now()}-${index}`, title: `Section ${String.fromCharCode(65 + index)}`, type: 'Short Answer', count: 2, marksEach: 2, instructions: '' });
    renderPlan();
  }

  function getPlanPayload() {
    return questionPlan.map(item => ({
      id: item.id,
      title: item.title.trim() || 'Questions',
      type: item.type,
      count: Number(item.count),
      marksEach: Number(item.marksEach),
      instructions: item.instructions || ''
    }));
  }

  function renderPaper(paper) {
    const theme = $p('paperTheme').value;
    const fontSize = Number($p('paperFontSize').value) || 12;
    const showMarks = $p('paperShowMarks').checked;
    const showSource = $p('paperShowSource').checked;
    const answerSpace = $p('paperAnswerSpace').checked;
    const node = $p('paperDocument');
    node.className = `paper-document paper-${theme}`;
    node.style.setProperty('--paper-font-size', `${fontSize}px`);
    const totalQuestions = paper.sections.reduce((sum, section) => sum + section.questions.length, 0);
    const questionHtml = paper.sections.map(section => `
      <section class="paper-section">
        <h3>${esc(section.title)}${showMarks ? ` <span style="float:right">${section.questions.reduce((sum, q) => sum + Number(q.marks), 0)} marks</span>` : ''}</h3>
        ${section.instructions ? `<p class="section-instructions">${esc(section.instructions)}</p>` : ''}
        ${section.questions.map((question, index) => `
          <div class="paper-question">
            <div class="paper-question-top">
              <div class="paper-question-text"><strong>${esc(question.id)}.</strong> ${esc(question.question)}</div>
              ${showMarks ? `<span class="paper-marks">[${Number(question.marks)}]</span>` : ''}
            </div>
            ${question.options && question.options.length ? `<ol class="paper-options" type="A">${question.options.map(option => `<li>${esc(option)}</li>`).join('')}</ol>` : ''}
            ${showSource && question.sourceLesson ? `<div class="paper-muted">Lesson: ${esc(question.sourceLesson)}</div>` : ''}
            ${answerSpace && !['MCQ', 'True or False'].includes(question.type) ? `<div class="paper-answer-space">${Array.from({ length: Math.min(5, Math.max(1, Math.ceil(Number(question.marks) / 2))) }, () => '<span></span>').join('')}</div>` : ''}
          </div>`).join('')}
      </section>`).join('');
    const instructions = Array.isArray(paper.instructions) ? paper.instructions : [];
    const answerHtml = paper.answerKey.map(item => `
      <div class="paper-answer-item">
        <strong>${esc(item.questionId)}. ${esc(item.answer)}</strong>
        ${item.explanation ? `<div>${esc(item.explanation)}</div>` : ''}
        ${item.markingPoints && item.markingPoints.length ? `<ul>${item.markingPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    node.innerHTML = `
      ${paper.schoolName ? `<div class="paper-school">${esc(paper.schoolName)}</div>` : ''}
      <h2>${esc(paper.title || paper.subject || 'Question Paper')}</h2>
      <p class="paper-exam">${esc(paper.examName || 'Practice Examination')}</p>
      <div class="paper-meta">
        <span><strong>Subject:</strong> ${esc(paper.subject)}</span>
        <span><strong>Class:</strong> ${esc(paper.className || '—')}</span>
        <span><strong>Time:</strong> ${Number(paper.durationMinutes)} minutes</span>
        <span><strong>Maximum marks:</strong> ${Number(paper.totalMarks)}</span>
        <span><strong>Questions:</strong> ${totalQuestions}</span>
        <span><strong>Exam date:</strong> ${esc(paper.examDate || '—')}</span>
        <span><strong>Name:</strong> __________________________</span>
        <span><strong>Roll number:</strong> ____________________</span>
        <span><strong>Date:</strong> __________________________</span>
      </div>
      ${instructions.length ? `<div class="paper-instructions"><strong>General Instructions</strong><ol>${instructions.map(item => `<li>${esc(item)}</li>`).join('')}</ol></div>` : ''}
      ${questionHtml}
      <div style="text-align:center;border-top:1px solid #aaa;margin-top:22px;padding-top:10px;font-size:10px;font-weight:700">— End of Question Paper —</div>
      <section class="paper-answer-key" id="paperAnswerKey" style="display:${answerKeyVisible ? 'block' : 'none'}">
        <h3>Answer Key and Explanations</h3>
        ${answerHtml}
      </section>`;
    $p('paperOutput').classList.add('visible');
    $p('toggleAnswerKey').textContent = answerKeyVisible ? 'Hide answer key' : 'View answer key';
  }

  function paperPayload(files) {
    const selected = Array.from(selectedChapters);
    return {
      action: 'generate',
      files,
      schoolName: $p('paperSchool').value.trim(),
      examName: $p('paperExamName').value.trim() || 'Practice Examination',
      subject: $p('paperSubject').value.trim() || analyzed?.subject || '',
      className: $p('paperClass').value.trim(),
      examDate: $p('paperDate').value,
      durationMinutes: Number($p('paperDuration').value),
      difficulty: $p('paperDifficulty').value,
      questionStyle: $p('paperStyle').value,
      selectedLessons: selected,
      questionPlan: getPlanPayload()
    };
  }

  async function generatePaper() {
    if (!analyzed || selectedChapters.size === 0) {
      setGenerateStatus('Analyze your files and select at least one chapter first.', 'error');
      return;
    }
    if ($p('generatePaperButton').dataset.planValid === 'false') {
      setGenerateStatus('Check the question counts and marks in your configuration.', 'error');
      return;
    }
    const plan = getPlanPayload();
    const totalQuestions = plan.reduce((sum, item) => sum + item.count, 0);
    if (totalQuestions > 40) {
      setGenerateStatus('Keep the complete question paper to 40 questions or fewer.', 'error');
      return;
    }
    setBusy(true, 'generate');
    setGenerateStatus('Preparing the selected portions and generating your examination paper…');
    answerKeyVisible = false;
    currentPaper = null;
    $p('paperOutput').classList.remove('visible');
    try {
      const files = await encodeFiles();
      const result = await requestAI(paperPayload(files));
      currentPaper = result.paper;
      renderPaper(currentPaper);
      setGenerateStatus(`Paper ready: ${result.validation.questionCount} questions · ${result.validation.totalMarks} marks. Counts and marks passed validation.`, 'success');
      toast('Your question paper has been generated.');
      $p('paperOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setGenerateStatus(error.message, 'error');
    } finally {
      setBusy(false, 'generate');
    }
  }

  function updatePreviewIfReady() {
    if (currentPaper) renderPaper(currentPaper);
    const style = document.getElementById('paperPrintPageRule');
    if (style) style.textContent = `@page { size: A4 ${$p('paperOrientation').value}; margin: 15mm; }`;
  }

  function printPaper(answerKeyOnly = false) {
    if (!currentPaper) return;
    if (answerKeyOnly) answerKeyVisible = true;
    renderPaper(currentPaper);
    document.body.classList.toggle('print-answer-key', answerKeyOnly);
    window.print();
    setTimeout(() => document.body.classList.remove('print-answer-key'), 500);
  }

  // File picker and drag/drop.
  $p('paperDrop').addEventListener('click', () => $p('paperFileInput').click());
  $p('paperDrop').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $p('paperFileInput').click(); }
  });
  $p('paperFileInput').addEventListener('change', event => {
    addFiles(event.target.files);
    event.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(name => $p('paperDrop').addEventListener(name, event => {
    event.preventDefault(); $p('paperDrop').classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(name => $p('paperDrop').addEventListener(name, event => {
    event.preventDefault(); $p('paperDrop').classList.remove('dragover');
  }));
  $p('paperDrop').addEventListener('drop', event => addFiles(event.dataTransfer.files));
  $p('paperFiles').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-file]');
    if (!button) return;
    selectedFiles.splice(Number(button.dataset.removeFile), 1);
    analyzed = null;
    selectedChapters.clear();
    currentPaper = null;
    renderFiles();
    $p('paperChapters').innerHTML = '<div class="empty">Analyze your uploaded materials to see detected chapters and topics.</div>';
    $p('paperOutput').classList.remove('visible');
    setPaperStatus('A file was removed. Analyze the remaining files again.');
    refreshGenerateButton();
  });

  $p('analyzePaperButton').addEventListener('click', analyzeFiles);
  $p('generatePaperButton').addEventListener('click', generatePaper);
  $p('addPaperSection').addEventListener('click', addQuestionSection);

  $p('paperConfigList').addEventListener('input', event => {
    const field = event.target.dataset.planField;
    if (!field) return;
    const row = event.target.closest('[data-section-id]');
    if (!row) return;
    const item = questionPlan.find(section => section.id === row.dataset.sectionId);
    if (!item) return;
    if (field === 'count' || field === 'marksEach') item[field] = Number(event.target.value);
    else item[field] = event.target.value;
    updatePlanTotals();
  });
  $p('paperConfigList').addEventListener('change', event => {
    const field = event.target.dataset.planField;
    if (!field) return;
    const row = event.target.closest('[data-section-id]');
    if (!row) return;
    const item = questionPlan.find(section => section.id === row.dataset.sectionId);
    if (!item) return;
    item[field] = field === 'count' || field === 'marksEach' ? Number(event.target.value) : event.target.value;
    updatePlanTotals();
  });
  $p('paperConfigList').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-section]');
    if (!button) return;
    questionPlan = questionPlan.filter(item => item.id !== button.dataset.removeSection);
    renderPlan();
  });

  $p('paperChapters').addEventListener('change', event => {
    if (event.target.matches('[data-chapter-index], [data-topic-index]')) chapterSelectionChanged(event.target);
  });
  $p('paperChapters').addEventListener('click', event => {
    if (event.target.id === 'selectAllPaperChapters') {
      selectedChapters = new Set((analyzed?.chapters || []).map(chapter => chapter.title));
      renderChapters();
    }
    if (event.target.id === 'clearPaperChapters') {
      selectedChapters.clear();
      renderChapters();
    }
  });

  ['paperTheme', 'paperOrientation', 'paperFontSize', 'paperShowMarks', 'paperShowSource', 'paperAnswerSpace'].forEach(id => {
    $p(id).addEventListener('change', updatePreviewIfReady);
  });
  $p('toggleAnswerKey').addEventListener('click', () => {
    answerKeyVisible = !answerKeyVisible;
    if (currentPaper) renderPaper(currentPaper);
  });
  $p('printQuestionPaper').addEventListener('click', () => printPaper(false));
  $p('regeneratePaper').addEventListener('click', generatePaper);

  // Printing the answer key separately is opt-in; it is never included with the question paper by default.
  $p('printAnswerKey').addEventListener('click', () => printPaper(true));

  const pageStyle = document.createElement('style');
  pageStyle.id = 'paperPrintPageRule';
  pageStyle.textContent = '@page { size: A4 portrait; margin: 15mm; }';
  document.head.appendChild(pageStyle);

  // Default configuration matches a balanced 32-mark mock exam.
  renderPlan();
  renderFiles();
})();
