/**
 * 定制服装客户发现工具 - 零依赖服务器
 *
 * 仅使用 Node.js 内置模块（http, https, fs, url）
 * 不需要 npm install，有 node.exe 就能运行
 *
 * 功能：
 * 1. 托管静态页面（standalone.html）
 * 2. 代理搜索请求到 Google（服务端请求，无 CORS 问题）
 * 3. 解析搜索结果并返回 JSON
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 生产环境需要监听所有网络接口
const PUBLIC_DIR = __dirname;

// ==================== MIME Types ====================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// ==================== Search Config ====================
const SEARCH_QUERIES = {
  instagram: ['site:instagram.com "custom clothing"','site:instagram.com "custom" "dress"','site:instagram.com "looking for" custom dress','site:instagram.com "tailor" need'],
  facebook: ['site:facebook.com "custom clothing"','site:facebook.com "looking for" tailor','site:facebook.com groups "custom" clothes','site:facebook.com "custom made" want'],
  tiktok: ['site:tiktok.com "custom clothing"','site:tiktok.com "custom outfit"','site:tiktok.com "tailor"','site:tiktok.com "custom" dress'],
  pinterest: ['site:pinterest.com "custom clothing"','site:pinterest.com custom dress "want"','site:pinterest.com "custom" outfit'],
  twitter: ['site:twitter.com "custom clothing"','site:twitter.com "need" tailor','site:x.com "custom" clothing'],
  youtube: ['site:youtube.com "custom clothing"','site:youtube.com "custom shirt" review','site:youtube.com "custom" dress'],
  reddit: ['site:reddit.com "custom clothing"','site:reddit.com "where to buy" custom','site:reddit.com "bespoke" recommend']
};

const PLATFORM_NAMES = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
  pinterest: 'Pinterest', twitter: 'Twitter/X', youtube: 'YouTube', reddit: 'Reddit'
};

// ==================== Google Search (server-side) ====================
function searchGoogle(query) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'www.google.com',
      path: `/search?q=${encoded}&hl=en&num=15`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', (e) => reject(new Error(`Request failed: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ==================== Parse Google HTML ====================
function parseGoogleResults(html, platform, keyword) {
  const results = [];
  if (!html || html.length < 100) return results;

  // Method 1: Extract from script data (Google's modern format often uses this)
  // Look for result data in various patterns

  // Try to find result blocks - Google uses various structures
  // Pattern A: Look for structured data
  const blocks = html.split(/<div[^>]*class="[^"]*g[^"]*"[^>]*>/g);

  if (blocks.length > 1) {
    for (let i = 1; i < blocks.length; i++) {
      const r = parseBlock(blocks[i], platform, keyword);
      if (r) results.push(r);
    }
  }

  // Pattern B: Try alternate structure (div.Gx5Zad or div.dtop)
  if (results.length < 2) {
    const altBlocks = html.split(/<div[^>]*class="[^"]*(?:Gx5Zad|dtop|fG8Fp)[^"]*"[^>]*>/g);
    if (altBlocks.length > 1) {
      results.length = 0;
      for (let i = 1; i < altBlocks.length; i++) {
        const r = parseBlock2(altBlocks[i], platform, keyword);
        if (r) results.push(r);
      }
    }
  }

  // Pattern C: Extract via URL matching as last resort
  if (results.length < 1) {
    const urlPattern = /https?:\/\/(?:www\.)?([^\/"'\s]+)(\/[^"'\s]{1,200})?/g;
    let m;
    const urls = [];
    const platformDomains = { instagram: /instagram\.com/i, facebook: /facebook\.com|fb\.com/i, tiktok: /tiktok\.com/i, pinterest: /pinterest\.com/i, twitter: /twitter\.com|x\.com/i, youtube: /youtube\.com/i, reddit: /reddit\.com/i };
    const domainRegex = platformDomains[platform];

    if (domainRegex) {
      while ((m = urlPattern.exec(html)) !== null) {
        const fullUrl = m[0];
        if (domainRegex.test(fullUrl) && !urls.includes(fullUrl)) {
          urls.push(fullUrl);
        }
      }
    }

    urls.slice(0, 15).forEach((u, idx) => {
      let username = '';
      try {
        const p = new URL(u).pathname.split('/').filter(Boolean);
        if (platform === 'instagram' && !['p','reel','explore','stories'].includes(p[0]||'')) username = p[0] || '';
        else if (platform === 'tiktok') { const at = u.match(/@(\w+)/); if(at) username = '@'+at[1]; }
        else if (platform === 'facebook') { const f = u.match(/facebook\.com\/([^\/?]+)/); if(f && !['groups','pages','photo','video'].includes(f[1])) username = f[1]; }
        else if (platform === 'twitter' || platform === 'x') { const t = u.match(/(?:twitter|x)\.com\/(\w+)/); if(t && !['hashtag','search'].includes(t[1])) username = t[1]; }
        else if (platform === 'reddit') { const r = u.match(/reddit\.com\/user\/(\w+)/); if(r) username = 'u/'+r[1]; }
        else if (platform === 'pinterest') { const pi = u.match(/pinterest\.com\/([^\/?]+)/); if(pi && !['pin','search'].includes(pi[1])) username = pi[1]; }
      } catch(e) {}

      results.push({
        platform, username: username || 'user_' + (idx+1), display_name: username || PLATFORM_NAMES[platform] + ' User',
        profile_url: u, post_url: u, bio: PLATFORM_NAMES[platform] + ' - potential lead for: ' + keyword,
        email: '', phone: '', whatsapp: '', source_keyword: keyword, status: 'new'
      });
    });
  }

  // Deduplicate by URL
  const seen = new Set();
  return results.filter(r => {
    const key = r.profile_url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

function parseBlock(block, platform, keyword) {
  // Extract URL - try multiple patterns
  let url = '';
  const urlPatterns = [
    /<a[^>]*href="(https?:\/\/[^"]+?)"/,
    /href="\/url\?q=(https?:\/\/[^&"]+?)&/,
    /"url":"(https?:\/\/[^"]+?)"/
  ];
  for (const p of urlPatterns) {
    const m = block.match(p);
    if (m) { url = m[1]; if (url.includes('/url?q=')) url = decodeURIComponent(url.match(/\/url\?q=([^&]+)/)[1]); break; }
  }
  if (!url) return null;

  // Filter by platform domain
  const domains = { instagram: /instagram\.com/i, facebook: /facebook\.com|fb\.com/i, tiktok: /tiktok\.com/i, pinterest: /pinterest\.com/i, twitter: /twitter\.com|x\.com/i, youtube: /youtube\.com/i, reddit: /reddit\.com/i };
  const d = domains[platform];
  if (!d || !d.test(url)) return null;

  // Extract title
  let title = '';
  const tMatch = block.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/);
  if (tMatch) title = tMatch[1].replace(/<[^>]+>/g,'').trim();

  // Extract snippet
  let snippet = '';
  const sPatterns = [
    /<div[^>]*class="[^"]*(?:VwiC3b|BNeawe|st)[^"]*"[^>]*>([\s\S]{0,500}?)<\/div>/,
    /<span[^>]*class="[^"]*(?:aCOpRe|st)[^"]*"[^>]*>([\s\S]{0,500}?)<\/span>/
  ];
  for (const p of sPatterns) {
    const m = block.match(p);
    if (m) { snippet = m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); break; }
  }

  // Extract username from URL
  let username = '';
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean);
    if (platform === 'instagram') { const u = p.find(x => !['p','reel','explore','stories','tags'].includes(x)); if(u) username = u; }
    else if (platform === 'tiktok') { const a = url.match(/@(\w+)/); if(a) username = '@'+a[1]; }
    else if (platform === 'facebook') { const f = url.match(/facebook\.com\/([^\/?]+)/); if(f && !['groups','pages','photo','video','story','events'].includes(f[1])) username = f[1]; }
    else if (platform === 'twitter' || platform === 'x') { const t = url.match(/(?:twitter|x)\.com\/(\w+)/); if(t && !['hashtag','search'].includes(t[1])) username = t[1]; }
    else if (platform === 'reddit') { const r = url.match(/reddit\.com\/user\/(\w+)/); if(r) username = 'u/'+r[1]; }
    else if (platform === 'pinterest') { const pi = url.match(/pinterest\.com\/([^\/?]+)/); if(pi && !['pin','search','ideas'].includes(pi[1])) username = pi[1]; }
  } catch(e) {}

  // Extract contacts from snippet
  const emails = snippet.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
  const phones = snippet.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}/g) || [];

  return {
    platform, username: username || title.split(/\s+/).slice(0,2).join('_').toLowerCase() || 'unknown',
    display_name: title || username || 'Unknown',
    profile_url: url, post_url: url,
    bio: (title ? title + ' - ' : '') + (snippet ? snippet.substring(0, 300) : ('Post on ' + PLATFORM_NAMES[platform])),
    email: emails[0] || '', phone: phones[0] || '', whatsapp: phones[0] || '',
    source_keyword: keyword, status: 'new'
  };
}

function parseBlock2(block, platform, keyword) {
  // Alternative parser for different Google layout
  let url = '';
  const m = block.match(/href="(https?:\/\/[^"]+?)"/);
  if (m) url = m[1];
  if (!url) return null;

  const domains = { instagram: /instagram\.com/i, facebook: /facebook\.com|fb\.com/i, tiktok: /tiktok\.com/i, pinterest: /pinterest\.com/i, twitter: /twitter\.com|x\.com/i, youtube: /youtube\.com/i, reddit: /reddit\.com/i };
  if (!domains[platform]?.test(url)) return null;

  let title = '';
  const tMatch = block.match(/<[^>]*>(.{5,100})<\/a>/);
  if (tMatch) title = tMatch[1].replace(/<[^>]+>/g,'').trim();

  let snippet = block.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0, 300);

  return {
    platform, username: title?.split(/\s+/)[0]?.toLowerCase() || 'user',
    display_name: title || 'Unknown', profile_url: url, post_url: url,
    bio: snippet || ('Post on ' + PLATFORM_NAMES[platform]),
    email: '', phone: '', whatsapp: '', source_keyword: keyword, status: 'new'
  };
}

// ==================== HTTP Server ====================
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ============= API: Search =============
  if (pathname === '/api/search' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { keywords, platforms, depth } = JSON.parse(body);
        if (!keywords || !platforms || platforms.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Missing keywords or platforms' }));
          return;
        }

        const queriesPerPlatform = depth === 'fast' ? 1 : depth === 'deep' ? 4 : 2;
        const allResults = [];
        const totalQueries = platforms.length * queriesPerPlatform;
        let completed = 0;

        // Let the client know total count
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });

        for (const pid of platforms) {
          const queries = (SEARCH_QUERIES[pid] || ['site:'+pid+'.com "custom"']).slice(0, queriesPerPlatform);

          for (const q of queries) {
            const fullQuery = q + ' ' + keywords;
            try {
              console.log(`Searching ${pid}: ${fullQuery.substring(0,80)}...`);
              const html = await searchGoogle(fullQuery);
              const results = parseGoogleResults(html, pid, keywords);
              for (const r of results) {
                if (!allResults.some(x => x.profile_url === r.profile_url)) {
                  allResults.push(r);
                }
              }
            } catch (e) {
              console.error(`${pid} search error:`, e.message);
            }
            completed++;
            // Small delay between queries
            if (completed < totalQueries) await new Promise(r => setTimeout(r, 500));
          }
        }

        // Sort: results with contacts first
        allResults.sort((a, b) => {
          const aScore = (a.email ? 10 : 0) + (a.whatsapp ? 10 : 0);
          const bScore = (b.email ? 10 : 0) + (b.whatsapp ? 10 : 0);
          return bScore - aScore;
        });

        res.end(JSON.stringify({ results: allResults.slice(0, 40), total: allResults.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ============= API: Keep alive / ping =============
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
    return;
  }

  // ============= Static Files =============
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║      定制服装客户发现工具                         ║
║      服务器已启动！                               ║
╠══════════════════════════════════════════════════╣
║  本地访问:                                       ║
║  →  http://127.0.0.1:${PORT}                    ║
║  →  http://localhost:${PORT}                     ║
║                                                  ║
║  线上部署: 绑定域名后自动生效                     ║
╠══════════════════════════════════════════════════╣
║  按 Ctrl+C 停止服务器                             ║
╚══════════════════════════════════════════════════╝
  `);
});
