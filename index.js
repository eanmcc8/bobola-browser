// import fs from 'fs';
// import express from 'express';
// import puppeteer from 'puppeteer';
// import mjpegServer from 'mjpeg-server';
// import {fileURLToPath} from 'url';
const fs = require('fs');
const express = require('express');
const puppeteer = require('puppeteer');
const mjpegServer = require('mjpeg-server');
const fileURLToPath = require('url');

// Configuration
const config = {
  startUrl: 'https://www.bing.com',
  shotDelay: 300,
  clickDelay: 300,
  typeDelay: 150,
  screenshotQuality: 75,
  port: 8080,
  headless: true,
  recordingFile: 'interaction_log.txt',
  interactionsDataFile: 'interactions.json'
};

// Hardcoded credentials for Basic Auth
const authCredentials = { login: 'admin', password: 'password' };

// Utility sleep
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Helper to get client IP
const getIP = req => req.headers['x-forwarded-for'] || req.socket.remoteAddress;

// Load existing interactions if any
let interactions = [];
if (fs.existsSync(config.interactionsDataFile)) {
  try {
    interactions = JSON.parse(fs.readFileSync(config.interactionsDataFile, 'utf-8'));
  } catch (e) {
    interactions = [];
  }
}

// Save interactions to file
function saveInteractions() {
  fs.writeFileSync(config.interactionsDataFile, JSON.stringify(interactions, null, 2));
}

// Record interaction
function recordInteraction(action) {
  interactions.push({ timestamp: new Date().toISOString(), action });
  saveInteractions();
}

// Basic Auth Middleware
function basicAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.split(' ')[1] || '';
  const [login, password] = Buffer.from(token, 'base64').toString().split(':');

  if (login === authCredentials.login && password === authCredentials.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
  res.status(401).send('Authentication required.');
}

// Main async function
async function start({ port = 8080, startUrl = config.startUrl } = {}) {
  const browser = await puppeteer.launch({ headless: config.headless });
  const tabs = []; // array of { page, title, url, mjpegClients: [] }

  // Create initial tab
  const mainPage = await browser.newPage();
  await mainPage.goto(startUrl);
  tabs.push({ page: mainPage, title: await mainPage.title(), url: startUrl, mjpegClients: [] });

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(basicAuth);

  // Serve main UI
  app.get('/', (req, res) => {
    res.send(renderMainUI(tabs));
  });

  // Input overlay
  app.get('/input_overlay.html', async (req, res) => {
    const currentTab = getCurrentTab(req, tabs);
    const keyInputHasFocus = await currentTab.page.evaluate(() => {
      return document.activeElement.matches('input,textarea,[contenteditable],select');
    });
    res.type('html');
    res.end(renderInputOverlay({ keyInputHasFocus }));
  });

  // Viewport probes CSS
  app.get('/probe-viewport.css', (req, res) => {
    res.type('css');
    res.end(renderViewportProbes());
  });

  // Resize viewport
  app.get('/set-viewport-dimensions/width/:width/height/:height/set.png', async (req, res) => {
    const currentTab = getCurrentTab(req, tabs);
    const { width, height } = req.params;
    const w = parseInt(width);
    const h = parseInt(height);
    if (isNaN(w) || isNaN(h)) {
      res.status(400).send('Invalid dimensions');
      return;
    }
    try {
      await currentTab.page.setViewport({ width: w, height: h });
      await broadcastShot(currentTab);
      await currentTab.page.reload();
      await broadcastShot(currentTab);
      res.type('png');
      res.end('OK');
    } catch (e) {
      console.error('Resize error:', e);
      res.status(500).send('Resize failed');
    }
  });

  // MJPEG stream
  app.get('/viewport.mjpeg', async (req, res) => {
    const currentTab = getCurrentTab(req, tabs);
    const mjpeg = mjpegServer.createReqHandler(req, res);
    currentTab.mjpegClients = currentTab.mjpegClients || [];
    currentTab.mjpegClients.push({ mjpeg, ip: getIP(req) });
    await broadcastShot(currentTab);
    await broadcastShot(currentTab);
  });

  // User interactions
  app.post('/carpediem', async (req, res) => {
    const currentTab = getCurrentTab(req, tabs);
    const { 'viewport.x': x, 'viewport.y': y, text, address, scroll } = req.body;
    let action = null;

    if (isFiniteNumber(x) && isFiniteNumber(y)) {
      action = { type: 'click', x: parseFloat(x), y: parseFloat(y) };
    } else if (typeof text === 'string') {
      action = { type: 'typing', text };
    } else if (typeof address === 'string') {
      action = { type: 'go', address };
    } else if (typeof scroll === 'string') {
      if (scroll === 'up') action = { type: 'scrollup' };
      if (scroll === 'down') action = { type: 'scrolldown' };
    }

    if (action) {
      recordInteraction(action);
      await performAction(currentTab.page, action);
    }

    const keyInputHasFocus = await currentTab.page.evaluate(() => {
      return document.activeElement.matches('input,textarea,[contenteditable],select');
    });

    res.type('html');
    res.end(renderInputOverlay({ keyInputHasFocus }));
  });

  // Export interactions
  app.get('/interactions/export', (req, res) => {
    res.download(config.interactionsDataFile);
  });

  // Import interactions
  app.post('/interactions/import', (req, res) => {
    try {
      if (fs.existsSync(config.interactionsDataFile)) {
        interactions = JSON.parse(fs.readFileSync(config.interactionsDataFile, 'utf-8'));
        res.json({ success: true, message: 'Interactions loaded.' });
      } else {
        res.status(404).json({ error: 'No saved interactions found.' });
      }
    } catch (e) {
      res.status(500).json({ error: 'Failed to load interactions.' });
    }
  });

  // Create new tab
  app.post('/tab/new', async (req, res) => {
    const page = await browser.newPage();
    const url = req.body.url || config.startUrl;
    await page.goto(url);
    tabs.push({ page, title: await page.title(), url, mjpegClients: [] });
    res.json({ success: true, tabId: tabs.length - 1 });
  });

  // Close tab
  app.post('/tab/close/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (tabs[id]) {
      await tabs[id].page.close();
      tabs.splice(id, 1);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Tab not found' });
    }
  });

  // Switch tab
  app.post('/tab/switch/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (id >= 0 && id < tabs.length) {
      // For simplicity, just acknowledge
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Tab not found' });
    }
  });

  // Start server
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });

  // Helper functions
  function getCurrentTab(req, tabs) {
    // For simplicity, always return first tab
    return tabs[0];
  }

  async function performAction(page, action) {
    switch (action.type) {
      case 'click':
        await page.mouse.click(action.x, action.y, { delay: config.clickDelay });
        break;
      case 'typing':
        await page.keyboard.type(action.text, { delay: config.typeDelay });
        break;
      case 'go':
        await page.goto(action.address);
        break;
      case 'scrollup':
        await page.evaluate(() => window.scrollBy(0, -100));
        break;
      case 'scrolldown':
        await page.evaluate(() => window.scrollBy(0, 100));
        break;
    }
  }

  async function broadcastShot(tab) {
    try {
      const shot = await tab.page.screenshot({ type: 'jpeg', quality: config.screenshotQuality });
      tab.mjpegClients?.forEach(({ mjpeg }) => {
        try {
          mjpeg.write(shot);
        } catch (e) {
          console.warn('MJPEG write error:', e);
        }
      });
    } catch (e) {
      console.error('Screenshot error:', e);
    }
  }

  // UI rendering functions
  function renderMainUI(tabs) {
    const tabListHtml = tabs.map((t, i) => `<li>Tab ${i}: ${t.title} - <button onclick="switchTab(${i})">Switch</button></li>`).join('');
    return `
      <!DOCTYPE html>
      <html><head><title>Remote Puppeteer</title></head><body>
        <h1>Remote Puppeteer Browser</h1>
        <ul>${tabListHtml}</ul>
        <button onclick="newTab()">New Tab</button>
        <script>
          function switchTab(id) {
            fetch('/tab/switch/' + id, { method: 'POST' }).then(() => location.reload());
          }
          function newTab() {
            fetch('/tab/new', { method: 'POST', headers: {'Content-Type': 'application/json'} }).then(() => location.reload());
          }
        </script>
      </body></html>
    `;
  }

  function renderInputOverlay({ keyInputHasFocus }) {
    return `
      <!DOCTYPE html>
      <html><head><meta name=viewport content=width=device-width,initial-scale=1></head><body>
        <form method=POST action=/carpediem>
          ${keyInputHasFocus ? `
            <textarea name=text placeholder="Text to send"></textarea>
            <button>Send</button>
          ` : `
            <button name=scroll value=down>Down</button>
            <button name=scroll value=up>Up</button>
          `}
        </form>
      </body></html>
    `;
  }

  function renderViewportProbes() {
    const sizes = [];
    for (let w = 300; w <= 1920; w += 32) {
      for (let h = 300; h <= 1080; h += 32) {
        sizes.push({ w, h });
      }
    }
    return sizes
      .map(({ w, h }) => `
        @media screen and (min-width: ${w}px) and (min-height: ${h}px) {
          body {
            background-image: url("/set-viewport-dimensions/width/${w}/height/${h}/set.png");
          }
        }
      `)
      .join('\n');
  }

  function isFiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }
}

// Run the server
start({ port: process.argv[2] ? parseInt(process.argv[2]) : undefined });
