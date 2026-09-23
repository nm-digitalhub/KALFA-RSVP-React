import express from 'express';
import { spawn } from 'child_process';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
let transport = null;
let mcpProcess = null;

// נקודת קצה לחיבור ה-SSE של קלאוד
app.get('/mcp', (req, res) => {
  console.log('🔗 Claude configuration initiated...');
  
  // הגדרת הצינור המאובטח של ה-MCP
  transport = new SSEServerTransport('/mcp/message', res);

  // הפעלת ה-Internal CLI הרשמי של כרום כבן תהליך (Sub-process)
  mcpProcess = spawn('npx', ['chrome-devtools-mcp@latest', '--no-usage-statistics']);

  // העברת הודעות מה-CLI של כרום בחזרה לקלאוד
  mcpProcess.stdout.on('data', (data) => {
    if (transport && transport.send) {
       try {
         const message = JSON.parse(data.toString());
         transport.send(message);
       } catch {
         // התעלמות מפלט שאינו JSON (כמו לוגים של מערכת).
         // זה סינון פלט, לא הסתרת שגיאה: stdout של תהליך מערכת
         // מעורב שורות JSON עם לוגים חופשיים, ורק הראשונות נוגעות לנו.
       }
    }
  });

  mcpProcess.stderr.on('data', (data) => {
    console.error(`[Chrome DevTools Log]: ${data}`);
  });
});

// נקודת קצה לקבלת פקודות המשך מקלאוד והעברתן ישירות לכרום
app.post('/mcp/message', express.json(), (req, res) => {
  if (mcpProcess && mcpProcess.stdin.writable) {
    mcpProcess.stdin.write(JSON.stringify(req.body) + '\n');
    res.status(200).end();
  } else {
    res.status(400).send('No active MCP Chrome process session found');
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🚀 MCP Remote Chrome Bridge is running stable on port 3000');
});
