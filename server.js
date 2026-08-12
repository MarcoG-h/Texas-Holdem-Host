// Texas Hold'em Launcher
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8720;
const HTML = path.join(__dirname, 'index.html');
const mathEngine = require('./math_engine.js');
// Use EXE directory (process.cwd) for logs, not the read-only snapshot
const LOG_DIR = path.join(process.cwd(), 'logs');

try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch(e) {
  // Fallback: use temp dir
  const os = require('os');
  const altDir = path.join(os.tmpdir(), 'texas_logs');
  try { if (!fs.existsSync(altDir)) fs.mkdirSync(altDir, { recursive: true }); } catch(e2) {}
  // Will try LOG_DIR first, fall back silently
}

const server = http.createServer((req, res) => {
  // CORS for localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/math') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const state = JSON.parse(body);
        const decision = mathEngine.decide(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(decision));
      } catch (e) {
        console.error('Math engine error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/save-log') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `texas_${timestamp}.csv`;

        // Build CSV with all columns
        let csv = 'time,player,mode,phase,hand,community,pot,currentBet,playerBet,chips,action,amount';
        csv += ',hs,improveProb,potOdds,facingRaise,tier,bestHand,rawAI,allPlayers\n';

        for (const e of data.entries || []) {
          const aiRaw = (e.aiRaw || '').replace(/"/g, '""');
          const players = (e.table || []).map(p =>
            `${p.name}:${p.hand}($${p.chips})${p.folded?'[FOLD]':''}${p.allIn?'[ALLIN]':''}${p.isD?'[D]':''}${p.isSB?'[SB]':''}${p.isBB?'[BB]':''}`
          ).join('|');
          csv += `\n${e.time},${e.player},${e.mode},${e.phase},${e.hand},${e.community},${e.pot},${e.currentBet},${e.playerBet},${e.chips},${e.action},${e.amount}`;
          csv += `,${e.hs||''},${e.improveProb||''},${e.potOdds||''},${e.facingRaise||''},${e.tier||''},${e.bestHand||''}`;
          csv += `,"${aiRaw}","${players}"`;
        }

        fs.writeFileSync(path.join(LOG_DIR, filename), csv, 'utf8');
        console.log('Log saved:', filename);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: filename }));
      } catch (e) {
        console.error('Log save error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    const html = fs.readFileSync(HTML, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/preflop_equity_browser.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'preflop_equity_browser.js'), 'utf8'));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Texas Hold'em running at http://localhost:${PORT}`);
  console.log(`Logs saved to: ${LOG_DIR}`);
  const cmd = process.platform === 'win32'
    ? `start http://localhost:${PORT}`
    : `open http://localhost:${PORT}`;
  exec(cmd);
});
