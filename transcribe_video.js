require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

const videoPath = 'input_video.mp4';
const audioDir = 'chunks';
const audioBaseName = 'chunk';
const ext = 'mp3';

if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

const transcriptionDict = {};
let lock = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForUnlock() {
  while (lock) {
    await sleep(10);
  }
  lock = true;
}

function releaseLock() {
  lock = false;
}

function extractAudioChunks() {
  execSync(`ffmpeg -i "${videoPath}" -f segment -segment_time 10 -c copy ${audioDir}/${audioBaseName}%03d.${ext}`);
}

async function transcribeChunk(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'srt');

  const res = await axios.post(
    'https://api.openai.com/v1/audio/translations',
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      responseType: 'text'
    }
  );

  return res.data;
}

function parseSRT(srtText) {
  const blocks = srtText.trim().split(/\n\n+/);
  const results = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timecode = lines[1].trim();
      const text = lines.slice(2).join(' ').trim();
      results.push({ timecode, text });
    }
  }

  return results;
}

async function processAllChunks() {
  extractAudioChunks();
  const files = fs.readdirSync(audioDir).filter(f => f.endsWith(`.${ext}`)).sort();

  for (const file of files) {
    const fullPath = path.join(audioDir, file);
    const srt = await transcribeChunk(fullPath);
    const entries = parseSRT(srt);

    await waitForUnlock();
    for (const { timecode, text } of entries) {
      transcriptionDict[timecode] = text;
    }
    releaseLock();
  }

  fs.writeFileSync('transcription.json', JSON.stringify(transcriptionDict, null, 2));
  console.log('Transcription complete.');
}

processAllChunks().catch(err => {
  console.error('Error:', err.response?.data || err.message);
});
